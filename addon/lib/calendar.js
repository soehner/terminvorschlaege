/* Kalenderzugriff über den offiziellen Kalender-Entwurf von Thunderbird
 * (github.com/thunderbird/webext-experiments, Ordner calendar/experiments/calendar,
 * unverändert unter experiments/calendar eingebunden).
 *
 * Stellt dieselben Funktionen bereit, die das Add-on früher über die eigene
 * Experiment-API „terminCalendar“ hatte. Termine kommen als jCal (RFC 7265) an und
 * werden hier ausgewertet, damit der übrige Code unverändert bleiben kann.
 */
"use strict";

var TV_MARKER_PROP = "x-terminvorschlag-id";

// ------------------------------------------------------------------ jCal-Hilfen
function tvJcalProps(comp) {
  return (comp && comp[1]) || [];
}

function tvJcalSubs(comp) {
  return (comp && comp[2]) || [];
}

function tvJcalProp(comp, name) {
  return tvJcalProps(comp).find(p => p[0] === name) || null;
}

function tvJcalAll(comp, name) {
  return tvJcalProps(comp).filter(p => p[0] === name);
}

function tvJcalValue(comp, name) {
  const p = tvJcalProp(comp, name);
  return p ? p[3] : null;
}

function tvJcalSet(comp, name, type, value, params = {}) {
  comp[1] = tvJcalProps(comp).filter(p => p[0] !== name);
  if (value !== null && value !== undefined && value !== "") {
    comp[1].push([name, params, type].concat(Array.isArray(value) ? value : [value]));
  }
}

/** Liefert die VEVENT-Komponente eines Kalendereintrags (jCal) und den VCALENDAR drumherum. */
function tvJcalEvent(jcal) {
  if (!Array.isArray(jcal)) {
    return { vcal: null, vevent: null };
  }
  if (jcal[0] === "vevent") {
    return { vcal: null, vevent: jcal };
  }
  const events = tvJcalSubs(jcal).filter(c => c[0] === "vevent");
  // die Serie selbst (ohne RECURRENCE-ID) hat Vorrang, sonst das einzelne Vorkommen
  const vevent = events.find(c => !tvJcalProp(c, "recurrence-id")) || events[0] || null;
  return { vcal: jcal, vevent };
}

// ------------------------------------------------------------------ Zeiten
function tvParseUtcOffset(s) {
  const m = /^([+-])(\d{2}):?(\d{2})(?::?(\d{2}))?$/.exec(String(s || "").trim());
  if (!m) {
    return 0;
  }
  const v = ((+m[2] * 60 + +m[3]) * 60 + (+m[4] || 0)) * 1000;
  return m[1] === "-" ? -v : v;
}

/** ISO-8601-Dauer wie P1D, PT1H30M, -PT15M in Millisekunden */
function tvParseDuration(s) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(s || "").trim());
  if (!m) {
    return 0;
  }
  const v = ((((+m[2] || 0) * 7 + (+m[3] || 0)) * 24 + (+m[4] || 0)) * 60 + (+m[5] || 0)) * 60000 + (+m[6] || 0) * 1000;
  return m[1] === "-" ? -v : v;
}

/** Wandzeit (Felder) als UTC-Millisekunden betrachtet */
function tvWallMs(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(value);
  if (!m) {
    return NaN;
  }
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] || 0, +m[5] || 0, +m[6] || 0);
}

/** Abstand einer IANA-Zeitzone zu UTC zum Zeitpunkt utcMs (wirft bei unbekannter Zone) */
function tvIntlOffset(utcMs, tz) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = {};
  for (const p of f.formatToParts(new Date(utcMs))) {
    parts[p.type] = p.value;
  }
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** n-ter Wochentag (byday wie "-1SU", "2SU") eines Monats als Tag des Monats */
function tvNthWeekday(year, month, byday) {
  const m = /^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(String(byday || ""));
  if (!m) {
    return null;
  }
  const wd = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"].indexOf(m[2]);
  const n = m[1] ? parseInt(m[1], 10) : 1;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (n > 0) {
    const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    const d = 1 + ((wd - first + 7) % 7) + (n - 1) * 7;
    return d <= days ? d : null;
  }
  const last = new Date(Date.UTC(year, month - 1, days)).getUTCDay();
  const d = days - ((last - wd + 7) % 7) + (n + 1) * 7;
  return d >= 1 ? d : null;
}

/** Abstand zu UTC aus einer VTIMEZONE-Definition für eine Wandzeit (UTC-Millisekunden der Felder) */
function tvVtimezoneOffset(vtz, wall) {
  let best = null;
  let earliest = null;
  for (const obs of tvJcalSubs(vtz)) {
    if (obs[0] !== "standard" && obs[0] !== "daylight") {
      continue;
    }
    const to = tvParseUtcOffset(tvJcalValue(obs, "tzoffsetto"));
    const from = tvParseUtcOffset(tvJcalValue(obs, "tzoffsetfrom"));
    const start = tvWallMs(String(tvJcalValue(obs, "dtstart") || ""));
    if (isNaN(start)) {
      continue;
    }
    if (!earliest || start < earliest.start) {
      earliest = { start, from };
    }
    const onsets = [start];
    const rrule = tvJcalValue(obs, "rrule");
    if (rrule && typeof rrule === "object" && String(rrule.freq).toUpperCase() === "YEARLY") {
      const s = new Date(start);
      const month = +(Array.isArray(rrule.bymonth) ? rrule.bymonth[0] : rrule.bymonth) || s.getUTCMonth() + 1;
      const byday = Array.isArray(rrule.byday) ? rrule.byday[0] : rrule.byday;
      const until = rrule.until ? tvWallMs(String(rrule.until)) : Infinity;
      const y = new Date(wall).getUTCFullYear();
      for (const year of [y - 1, y]) {
        const day = byday ? tvNthWeekday(year, month, byday) : s.getUTCDate();
        if (!day) {
          continue;
        }
        const t = Date.UTC(year, month - 1, day, s.getUTCHours(), s.getUTCMinutes(), s.getUTCSeconds());
        if (t >= start && t <= until) {
          onsets.push(t);
        }
      }
    }
    for (const rd of tvJcalAll(obs, "rdate")) {
      for (const v of rd.slice(3)) {
        const t = tvWallMs(String(v));
        if (!isNaN(t)) {
          onsets.push(t);
        }
      }
    }
    for (const t of onsets) {
      if (t <= wall && (!best || t > best.t)) {
        best = { t, to };
      }
    }
  }
  if (best) {
    return best.to;
  }
  return earliest ? earliest.from : null;
}

/**
 * Wandelt eine DTSTART/DTEND-Eigenschaft (jCal) in Millisekunden seit Epoch.
 * @returns {{ms:number, isDate:boolean}|null}
 */
function tvJcalTime(prop, vcal) {
  if (!prop) {
    return null;
  }
  const params = prop[1] || {};
  const type = prop[2];
  const value = String(prop[3] || "");
  if (type === "date" || /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    return m ? { ms: new Date(+m[1], +m[2] - 1, +m[3]).getTime(), isDate: true } : null;
  }
  if (/Z$/i.test(value)) {
    const ms = Date.parse(value);
    return isNaN(ms) ? null : { ms, isDate: false };
  }
  const wall = tvWallMs(value);
  if (isNaN(wall)) {
    return null;
  }
  const tzid = params.tzid;
  if (tzid) {
    // 1. bekannte IANA-Zone (Normalfall, z. B. Europe/Berlin)
    try {
      const guess = wall - tvIntlOffset(wall, tzid);
      return { ms: wall - tvIntlOffset(guess, tzid), isDate: false };
    } catch (e) {
      // keine IANA-Zone -> mitgelieferte VTIMEZONE auswerten
    }
    const vtz = tvJcalSubs(vcal).find(c => c[0] === "vtimezone" && tvJcalValue(c, "tzid") === tzid);
    const off = vtz ? tvVtimezoneOffset(vtz, wall) : null;
    if (off !== null) {
      return { ms: wall - off, isDate: false };
    }
  }
  // schwebende Zeit: als lokale Zeit verstehen
  const d = new Date(wall);
  return {
    ms: new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()).getTime(),
    isDate: false,
  };
}

/** Beginn und Ende eines VEVENT */
function tvEventTimes(vevent, vcal) {
  const start = tvJcalTime(tvJcalProp(vevent, "dtstart"), vcal);
  if (!start) {
    return null;
  }
  let end = tvJcalTime(tvJcalProp(vevent, "dtend"), vcal);
  if (!end) {
    const dur = tvJcalValue(vevent, "duration");
    if (dur) {
      end = { ms: start.ms + tvParseDuration(dur), isDate: start.isDate };
    } else {
      end = { ms: start.isDate ? start.ms + 86400000 : start.ms, isDate: start.isDate };
    }
  }
  return { start: start.ms, end: end.ms, isDate: start.isDate };
}

function tvMailOf(v) {
  return String(v || "")
    .replace(/^mailto:/i, "")
    .trim()
    .toLowerCase();
}

/**
 * Prüft, ob ein fremder Termin die Zeit belegt (gleiche Regeln wie früher in der eigenen API).
 * @param {object} opt {allDayBusy, tentativeBusy, ignoreDeclined, ownEmails:Set}
 * @returns {{start, end, title, own}|null}
 */
function tvBusyEntry(vevent, vcal, opt = {}) {
  const times = tvEventTimes(vevent, vcal);
  if (!times) {
    return null;
  }
  const own = !!tvJcalValue(vevent, TV_MARKER_PROP);
  if (!own) {
    if (String(tvJcalValue(vevent, "transp") || "").toUpperCase() === "TRANSPARENT") {
      return null;
    }
    const status = String(tvJcalValue(vevent, "status") || "").toUpperCase();
    if (status === "CANCELLED") {
      return null;
    }
    if (status === "TENTATIVE" && opt.tentativeBusy === false) {
      return null;
    }
    if (times.isDate && !opt.allDayBusy) {
      return null;
    }
    if (opt.ignoreDeclined !== false && opt.ownEmails && opt.ownEmails.size) {
      const me = tvJcalAll(vevent, "attendee").find(a => opt.ownEmails.has(tvMailOf(a[3])));
      if (me && String((me[1] || {}).partstat || "").toUpperCase() === "DECLINED") {
        return null;
      }
    }
  }
  return { start: times.start, end: times.end, title: String(tvJcalValue(vevent, "summary") || ""), own };
}

function tvUtcJcal(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Überträgt die Felder von data (wie früher createEvent/updateEvent) in ein VEVENT */
function tvApplyEventData(vevent, data) {
  if (data.title !== undefined) {
    tvJcalSet(vevent, "summary", "text", data.title || "");
  }
  if (data.start !== undefined) {
    tvJcalSet(vevent, "dtstart", "date-time", tvUtcJcal(data.start));
  }
  if (data.end !== undefined) {
    tvJcalSet(vevent, "duration", "duration", null);
    tvJcalSet(vevent, "dtend", "date-time", tvUtcJcal(data.end));
  }
  const props = {
    description: ["description", "text"],
    location: ["location", "text"],
    status: ["status", "text"],
    transparency: ["transp", "text"],
    url: ["url", "uri"],
  };
  for (const [key, [name, type]] of Object.entries(props)) {
    if (data[key] !== undefined) {
      tvJcalSet(vevent, name, type, data[key] || null);
    }
  }
  if (Array.isArray(data.categories)) {
    tvJcalSet(vevent, "categories", "text", data.categories.length ? data.categories : null);
  }
  if (data.marker !== undefined) {
    tvJcalSet(vevent, TV_MARKER_PROP, "unknown", data.marker || null);
  }
  if (data.organizer && data.organizer.email) {
    const params = data.organizer.name ? { cn: data.organizer.name } : {};
    tvJcalSet(vevent, "organizer", "cal-address", "mailto:" + tvMailOf(data.organizer.email), params);
  }
  if (Array.isArray(data.attendees)) {
    vevent[1] = tvJcalProps(vevent).filter(p => p[0] !== "attendee");
    for (const a of data.attendees) {
      if (a && a.email) {
        const params = { role: "REQ-PARTICIPANT", partstat: "NEEDS-ACTION", rsvp: "FALSE" };
        if (a.name) {
          params.cn = a.name;
        }
        vevent[1].push(["attendee", params, "cal-address", "mailto:" + tvMailOf(a.email)]);
      }
    }
  }
  tvJcalSet(vevent, "dtstamp", "date-time", tvUtcJcal(Date.now()));
  tvJcalSet(vevent, "last-modified", "date-time", tvUtcJcal(Date.now()));
}

// ------------------------------------------------------------------ API (gleiche Form wie früher)
var tvCalendar = {
  async getCalendars() {
    const cals = await messenger.calendar.calendars.query({});
    return cals.map(c => ({
      id: c.id,
      name: c.name,
      type: c.type,
      readOnly: !!c.readOnly,
      disabled: c.enabled === false,
      color: c.color || null,
      // die offizielle API verrät den Standardkalender von Thunderbird nicht
      isDefault: false,
      // abonnierte Internet-Kalender (ICS per http) sind faktisch nicht beschreibbar
      subscribed: c.type == "ics" && /^(https?|webcals?):/i.test(c.url || ""),
    }));
  },

  async ownEmails() {
    const set = new Set();
    try {
      for (const a of await messenger.accounts.list(false)) {
        for (const i of a.identities || []) {
          if (i.email) {
            set.add(i.email.toLowerCase());
          }
        }
      }
    } catch (e) {
      // ohne Identitäten keine Erkennung abgelehnter Einladungen
    }
    return set;
  },

  async getBusy(query) {
    const enabled = new Set((await this.getCalendars()).filter(c => !c.disabled).map(c => c.id));
    const ownEmails = await this.ownEmails();
    const busy = [];
    for (const id of query.calendarIds || []) {
      if (!enabled.has(id)) {
        continue;
      }
      let items;
      try {
        items = await messenger.calendar.items.query({
          calendarId: id,
          type: "event",
          rangeStart: query.start,
          rangeEnd: query.end,
          expand: true,
          returnFormat: "jcal",
        });
      } catch (e) {
        console.error("Terminvorschläge: Kalender nicht lesbar", id, e);
        continue;
      }
      for (const item of items) {
        const { vcal, vevent } = tvJcalEvent(item.item);
        const entry = vevent && tvBusyEntry(vevent, vcal, Object.assign({ ownEmails }, query));
        if (entry && entry.end > query.start && entry.start < query.end) {
          busy.push(entry);
        }
      }
    }
    busy.sort((a, b) => a.start - b.start);
    return busy;
  },

  async createEvent(calendarId, data) {
    const vevent = ["vevent", [["uid", {}, "text", crypto.randomUUID()]], []];
    tvJcalSet(vevent, "created", "date-time", tvUtcJcal(Date.now()));
    tvApplyEventData(vevent, data);
    const created = await messenger.calendar.items.create(calendarId, {
      type: "event",
      format: "jcal",
      item: vevent,
    });
    return (created && created.id) || tvJcalValue(vevent, "uid");
  },

  async updateEvent(calendarId, eventId, data) {
    let current;
    try {
      current = await messenger.calendar.items.get(calendarId, eventId, { returnFormat: "jcal" });
    } catch (e) {
      return false;
    }
    if (!current) {
      return false;
    }
    const jcal = current.item;
    const { vevent } = tvJcalEvent(jcal);
    if (!vevent) {
      return false;
    }
    tvApplyEventData(vevent, data);
    await messenger.calendar.items.update(calendarId, eventId, { format: "jcal", item: jcal });
    return true;
  },

  async deleteEvent(calendarId, eventId) {
    try {
      await messenger.calendar.items.remove(calendarId, eventId);
      return true;
    } catch (e) {
      if (/Could not find item|Invalid calendar/i.test(e.message || "")) {
        return false;
      }
      throw e;
    }
  },

  /** Sucht einen Termin in allen aktivierten Kalendern. null = sicher nicht vorhanden,
   *  undefined = mindestens ein Kalender war nicht lesbar. */
  async findEvent(eventId) {
    let unsure = false;
    for (const c of await this.getCalendars()) {
      if (c.disabled) {
        continue;
      }
      try {
        const found = await messenger.calendar.items.query({ calendarId: c.id, id: eventId });
        if (found && found.length) {
          return { id: found[0].id, calendarId: found[0].calendarId || c.id };
        }
      } catch (e) {
        unsure = true;
      }
    }
    return unsure ? undefined : null;
  },

  onItemDeleted: {
    addListener(fn) {
      messenger.calendar.items.onRemoved.addListener((calendarId, id) => fn({ id, calendarId }));
    },
  },
};

if (typeof module !== "undefined") {
  module.exports = {
    tvJcalEvent,
    tvJcalTime,
    tvEventTimes,
    tvBusyEntry,
    tvApplyEventData,
    tvParseDuration,
    tvVtimezoneOffset,
    tvNthWeekday,
    TV_MARKER_PROP,
  };
}
