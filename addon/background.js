/* Terminvorschläge – Hintergrundlogik
 *
 * Ablauf:
 *  1. Button im Verfassen-Fenster -> Popup berechnet freie Slots (computeSlots)
 *  2. Übernehmen -> Reservierungen im Kalender + Liste mit Bestätigungslinks in die Mail (applyProposal)
 *  3. Versand -> Empfänger/Message-ID werden gespeichert (onBeforeSend/onAfterSend)
 *  4. Eingehende Mail mit [TV-<id>-<nr>] im Betreff -> Termin fest, übrige Reservierungen löschen,
 *     Videolink erzeugen, Bestätigung (+ .ics) an das Gegenüber senden (confirmProposal)
 */
"use strict";

// ------------------------------------------------------------------ Speicher
let lockChain = Promise.resolve();
function withLock(fn) {
  const p = lockChain.then(() => fn());
  lockChain = p.catch(() => {});
  return p;
}

async function getProposals() {
  const { proposals } = await browser.storage.local.get("proposals");
  return proposals || {};
}

function updateProposal(id, mutator) {
  return withLock(async () => {
    const all = await getProposals();
    const p = all[id];
    if (!p) {
      return null;
    }
    const res = await mutator(p);
    all[id] = p;
    await browser.storage.local.set({ proposals: all });
    return res === undefined ? p : res;
  });
}

function insertProposal(p) {
  return withLock(async () => {
    const all = await getProposals();
    all[p.id] = p;
    await browser.storage.local.set({ proposals: all });
  });
}

const OPEN_STATES = ["draft", "sending", "sent"];

// ------------------------------------------------------------------ Hilfen
function notify(cfg, title, message) {
  if (cfg && cfg.notify === false) {
    return;
  }
  browser.notifications
    .create({ type: "basic", iconUrl: browser.runtime.getURL("icons/icon.svg"), title, message })
    .catch(() => {});
}

function isWritable(c) {
  return !c.disabled && !c.readOnly && !c.subscribed;
}

async function busyCalendarIds(cfg) {
  if (cfg.busyCalendarIds && cfg.busyCalendarIds.length) {
    return cfg.busyCalendarIds;
  }
  const cals = await browser.terminCalendar.getCalendars();
  return cals.filter(c => !c.disabled).map(c => c.id);
}

async function reserveCalendarId(cfg, override) {
  const cals = await browser.terminCalendar.getCalendars();
  if (override && cals.some(c => c.id == override && isWritable(c))) {
    return override;
  }
  if (cfg.reserveCalendarId && cals.some(c => c.id == cfg.reserveCalendarId && isWritable(c))) {
    return cfg.reserveCalendarId;
  }
  const writable = cals.find(c => c.isDefault && isWritable(c)) || cals.find(isWritable);
  if (!writable) {
    throw new Error("Kein beschreibbarer Kalender gefunden.");
  }
  return writable.id;
}

function slotText(cfg, slot) {
  return tvFormatSlot(slot, cfg.slotFormat);
}

function confirmLink(cfg, p, slot) {
  const vars = { id: p.id, nr: slot.nr, termin: slotText(cfg, slot), betreff: p.title };
  const token = `TV-${p.id}-${slot.nr}`;
  if (cfg.linkMode === "url") {
    return tvFill(cfg.linkUrlTemplate, Object.assign({ token }, vars));
  }
  const addr = cfg.confirmAddress || p.ownEmail;
  const subject = tvFill(cfg.confirmSubject, vars);
  const body = tvFill(cfg.confirmBody, vars);
  return `mailto:${addr}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function buildHtmlBlock(cfg, p) {
  const items = p.slots
    .map(
      s =>
        `<li>${tvEscapeHtml(slotText(cfg, s))} – <a href="${tvEscapeHtml(confirmLink(cfg, p, s))}">${tvEscapeHtml(
          cfg.linkText
        )}</a></li>`
    )
    .join("");
  const intro = cfg.introText ? `<p>${tvEscapeHtml(cfg.introText)}</p>` : "";
  const outro = cfg.outroText ? `<p>${tvEscapeHtml(cfg.outroText)}</p>` : "";
  return `<div class="tv-terminvorschlag" data-tv="TV-${p.id}">${intro}<ul>${items}</ul>${outro}</div>`;
}

function buildTextBlock(cfg, p) {
  const lines = [];
  if (cfg.introText) {
    lines.push(cfg.introText, "");
  }
  for (const s of p.slots) {
    lines.push(`• ${slotText(cfg, s)}`);
    lines.push(`  ${cfg.linkText}: <${confirmLink(cfg, p, s)}>`);
  }
  if (cfg.outroText) {
    lines.push("", cfg.outroText);
  }
  return lines.join("\n") + "\n";
}

function textToHtml(text) {
  return tvEscapeHtml(text)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
    .replace(/\n/g, "<br>");
}

/** Fügt HTML an der Cursorposition ein, sonst vor Signatur/Zitat bzw. am Ende */
async function insertIntoCompose(tabId, html, text) {
  const details = await browser.compose.getComposeDetails(tabId);
  if (details.isPlainText) {
    const body = details.plainTextBody || "";
    const sig = body.indexOf("\n-- \n");
    const newBody = sig >= 0 ? body.slice(0, sig) + "\n" + text + body.slice(sig) : text + "\n" + body;
    await browser.compose.setComposeDetails(tabId, { plainTextBody: newBody });
    return;
  }
  try {
    const [res] = await browser.scripting.executeScript({
      target: { tabId },
      func: h => {
        const sel = document.getSelection();
        const inBody = sel && sel.rangeCount && document.body.contains(sel.anchorNode);
        if (!inBody) {
          return false;
        }
        return document.execCommand("insertHTML", false, h);
      },
      args: [html],
    });
    if (res && res.result) {
      return;
    }
  } catch (e) {
    console.warn("Terminvorschläge: Einfügen am Cursor nicht möglich, nutze Fallback", e);
  }
  let body = details.body || "<html><body></body></html>";
  const markers = ['<div class="moz-signature"', '<div class="moz-cite-prefix"', "<blockquote", "<pre class=\"moz-signature\""];
  const pos = markers.map(m => body.indexOf(m)).filter(i => i >= 0).sort((a, b) => a - b)[0];
  if (pos !== undefined) {
    body = body.slice(0, pos) + html + body.slice(pos);
  } else if (body.includes("</body>")) {
    body = body.replace("</body>", html + "</body>");
  } else {
    body += html;
  }
  await browser.compose.setComposeDetails(tabId, { body });
}

async function identityInfo(identityId) {
  try {
    const id = identityId ? await browser.identities.get(identityId) : await browser.identities.getDefault();
    return id || {};
  } catch (e) {
    return {};
  }
}

function parseRecipients(list) {
  return (Array.isArray(list) ? list : list ? [list] : [])
    .map(r => (typeof r === "string" ? tvParseAddress(r) : null))
    .filter(r => r && r.email);
}

// ------------------------------------------------------------------ Slots berechnen
async function computeSlots(req) {
  const cfg = await tvLoadConfig();
  const now = Date.now();
  const horizon = req.horizonDays || cfg.horizonDays;
  const from = req.from ? new Date(req.from).getTime() : now;
  const busy = await browser.terminCalendar.getBusy({
    calendarIds: await busyCalendarIds(cfg),
    start: Math.min(now, from) - 86400000,
    end: Math.max(now, from) + (horizon + 2) * 86400000,
    allDayBusy: !!cfg.allDayBusy,
    tentativeBusy: cfg.tentativeBusy !== false,
    ignoreDeclined: cfg.ignoreDeclined !== false,
  });
  const durationMin = req.durationMin || cfg.durationMin;
  const candidates = tvComputeCandidates({ busy, config: cfg, now, from, durationMin, horizonDays: horizon });
  // bereits gewählte (behaltene) Slots blockieren Nachbarn
  const keep = (req.keep || []).map(s => ({ start: s.start, end: s.end }));
  const remaining = candidates.filter(c => !tvOverlapsKeep(c, keep, cfg.bufferMin));
  const need = Math.max(0, (req.count || cfg.defaultCount) - keep.length);
  const perDayUsed = {};
  keep.forEach(k => {
    const key = tvDayKey(new Date(k.start));
    perDayUsed[key] = (perDayUsed[key] || 0) + 1;
  });
  const filtered = remaining.filter(c => (perDayUsed[c.day] || 0) < (cfg.maxPerDay || 1));
  const picked = tvSelectSlots(filtered, {
    count: need,
    maxPerDay: cfg.maxPerDay,
    strategy: cfg.strategy,
    bufferMin: cfg.bufferMin,
    exclude: new Set(req.exclude || []),
  });
  const slots = keep.concat(picked).sort((a, b) => a.start - b.start);
  return {
    slots: slots.map(s => ({ start: s.start, end: s.end, text: slotText(cfg, s) })),
    available: candidates.length,
  };
}

function tvOverlapsKeep(c, keep, bufferMin) {
  const b = (bufferMin || 0) * 60000;
  return keep.some(k => k.start < c.end + b && k.end > c.start - b);
}

// ------------------------------------------------------------------ Vorschlag übernehmen
async function applyProposal(req) {
  const cfg = await tvLoadConfig();
  const details = await browser.compose.getComposeDetails(req.tabId);
  const ident = await identityInfo(details.identityId);
  const calendarId = await reserveCalendarId(cfg, req.calendarId);
  const title = (req.title || details.subject || "Termin").trim();
  const recipients = parseRecipients(details.to).concat(parseRecipients(details.cc));

  const p = {
    id: tvRandomId(8),
    created: Date.now(),
    status: "draft",
    tabId: req.tabId,
    title,
    subject: details.subject || "",
    identityId: details.identityId || null,
    ownEmail: (ident.email || "").toLowerCase(),
    ownName: ident.name || "",
    recipients,
    calendarId,
    slots: [],
  };

  const sorted = req.slots.slice().sort((a, b) => a.start - b.start);
  const total = sorted.length;
  try {
    for (let i = 0; i < total; i++) {
      const s = sorted[i];
      const slot = { nr: i + 1, start: s.start, end: s.end };
      const name = recipients[0] ? tvPersonName(recipients[0].name) || recipients[0].email : "";
      slot.eventId = await browser.terminCalendar.createEvent(calendarId, {
        title: tvFill(cfg.reserveTitle, { betreff: title, name, nr: slot.nr, anzahl: total }),
        start: s.start,
        end: s.end,
        status: "TENTATIVE",
        transparency: "OPAQUE",
        categories: ["Terminvorschlag"],
        marker: p.id,
        description:
          `Terminvorschlag ${slot.nr} von ${total} (Kennung TV-${p.id}).\n` +
          `Wird automatisch entfernt, sobald ein anderer Vorschlag bestätigt wird.` +
          (recipients.length ? `\nEmpfänger: ${recipients.map(r => r.email).join(", ")}` : ""),
      });
      p.slots.push(slot);
    }
  } catch (e) {
    // bereits angelegte Reservierungen zurückrollen
    for (const s of p.slots) {
      await browser.terminCalendar.deleteEvent(calendarId, s.eventId).catch(() => {});
    }
    throw e;
  }

  await insertProposal(p);
  if (req.noInsert) {
    return p;
  }
  await insertIntoCompose(req.tabId, buildHtmlBlock(cfg, p), buildTextBlock(cfg, p));
  return { id: p.id, count: p.slots.length };
}

// ------------------------------------------------------------------ Stornieren / Aufräumen
async function deleteReservations(p, exceptNr) {
  for (const s of p.slots) {
    if (s.nr === exceptNr || s.deleted) {
      continue;
    }
    try {
      await browser.terminCalendar.deleteEvent(p.calendarId, s.eventId);
    } catch (e) {
      console.warn("Terminvorschläge: Löschen fehlgeschlagen", e);
    }
    s.deleted = true;
  }
}

async function cancelProposal(id, status = "cancelled") {
  return updateProposal(id, async p => {
    if (p.status === "confirmed") {
      return p;
    }
    await deleteReservations(p, null);
    p.status = status;
    p.closed = Date.now();
    return p;
  });
}

async function maintenance() {
  const cfg = await tvLoadConfig();
  const all = await getProposals();
  const now = Date.now();
  for (const p of Object.values(all)) {
    if (!OPEN_STATES.includes(p.status) || p.status === "sending") {
      continue;
    }
    if (cfg.expiryDays > 0 && now - p.created > cfg.expiryDays * 86400000) {
      await cancelProposal(p.id, "expired");
      continue;
    }
    // vergangene Slots freigeben
    const past = p.slots.filter(s => !s.deleted && s.start < now);
    if (past.length) {
      await updateProposal(p.id, async q => {
        for (const s of q.slots) {
          if (!s.deleted && s.start < now) {
            await browser.terminCalendar.deleteEvent(q.calendarId, s.eventId).catch(() => {});
            s.deleted = true;
          }
        }
        if (q.slots.every(s => s.deleted)) {
          q.status = "expired";
          q.closed = now;
        }
      });
    }
  }
  // alte, abgeschlossene Einträge nach 90 Tagen entfernen
  await withLock(async () => {
    const list = await getProposals();
    let changed = false;
    for (const [id, p] of Object.entries(list)) {
      const confirmedSlot = p.confirmed && p.slots.find(s => s.nr === p.confirmed.nr);
      const ref = Math.max(p.closed || 0, confirmedSlot ? confirmedSlot.end : 0);
      if (!OPEN_STATES.includes(p.status) && ref && now - ref > 90 * 86400000) {
        delete list[id];
        changed = true;
      }
    }
    if (changed) {
      await browser.storage.local.set({ proposals: list });
    }
  });
}

// ------------------------------------------------------------------ Bestätigung
async function sendConfirmationMail(cfg, p, slot, attendee, video, sourceMessageId) {
  if (cfg.sendConfirmation === "none" || !attendee || !attendee.email) {
    return false;
  }
  const termin = slotText(cfg, slot);
  const videoBlock = video && video.url
    ? "\n" + tvFill(cfg.videoText, { url: video.url }) + (video.info ? "\n" + video.info : "") + "\n"
    : "";
  const vars = {
    name: tvPersonName(attendee.name),
    termin,
    betreff: p.title,
    url: (video && video.url) || "",
    videoBlock,
  };
  const subject = tvFill(cfg.confirmationMailSubject, vars);
  const text = tvFill(cfg.confirmationMailBody, vars).replace(/\n{3,}/g, "\n\n");
  const ident = await identityInfo(p.identityId);
  const html = ident.composeHtml !== false;

  const details = { subject, to: [attendee.name ? `${attendee.name} <${attendee.email}>` : attendee.email] };
  if (p.identityId) {
    details.identityId = p.identityId;
  }
  if (html) {
    details.isPlainText = false;
    details.body = `<html><body><p>${textToHtml(text)}</p></body></html>`;
  } else {
    details.isPlainText = true;
    details.plainTextBody = text;
  }
  // Keine Einladung an die eigene Adresse: Thunderbird würde sie als Einladung zum
  // bereits vorhandenen eigenen Termin behandeln (gleiche UID) und diesen verändern.
  const toSelf = attendee.email.toLowerCase() === (p.ownEmail || "").toLowerCase();
  if (cfg.attachIcs && !toSelf) {
    const ics = tvBuildIcs({
      uid: `${slot.eventId}`,
      start: slot.start,
      end: slot.end,
      title: p.title,
      description: text,
      location: (video && video.url) || "",
      url: (video && video.url) || "",
      organizer: { email: p.ownEmail, name: p.ownName },
      attendees: [attendee],
    });
    details.attachments = [{ file: new File([ics], "einladung.ics", { type: "text/calendar" }), name: "einladung.ics" }];
  }

  let tab;
  if (sourceMessageId) {
    try {
      tab = await browser.compose.beginReply(sourceMessageId, "replyToSender", details);
    } catch (e) {
      tab = null;
    }
  }
  if (!tab) {
    tab = await browser.compose.beginNew(details);
  }
  if (cfg.sendConfirmation === "send") {
    await browser.compose.sendMessage(tab.id, { mode: "sendNow" });
  }
  return !!details.attachments;
}

/**
 * @param {string} id Vorschlags-ID
 * @param {number} nr Slot-Nummer (1-basiert)
 * @param {object} [source] {messageId, author}
 * @param {boolean} [manual] manuell ausgelöst (keine Absenderprüfung)
 */
async function confirmProposal(id, nr, source = {}, manual = false) {
  const cfg = await tvLoadConfig();
  const author = tvParseAddress(source.author || "");

  // 1. Status prüfen und auf "confirming" setzen (verhindert Doppelverarbeitung)
  const check = await updateProposal(id, async p => {
    if (p.status === "confirmed" || p.status === "confirming") {
      return { error: p.confirmed && p.confirmed.nr === nr ? "duplicate" : "already", p };
    }
    if (!OPEN_STATES.includes(p.status)) {
      return { error: "closed", p };
    }
    const slot = p.slots.find(s => s.nr === nr);
    if (!slot || slot.deleted) {
      return { error: "noslot", p };
    }
    if (!manual && cfg.checkSender && p.recipients.length && author.email) {
      if (!p.recipients.some(r => r.email === author.email)) {
        return { error: "sender", p };
      }
    }
    p.status = "confirming";
    return { ok: true, p: JSON.parse(JSON.stringify(p)), slot: Object.assign({}, slot) };
  });

  if (!check) {
    return { ok: false, error: "unknown" };
  }
  if (!check.ok) {
    const p = check.p;
    const msgs = {
      already: `Für „${p.title}“ wurde bereits ein anderer Termin bestätigt. Neue Bestätigung von ${author.email || "?"} für Option ${nr} bitte manuell klären.`,
      closed: `Bestätigung für „${p.title}“ (Option ${nr}) eingegangen, der Vorschlag ist aber bereits ${p.status === "expired" ? "abgelaufen" : "storniert"}.`,
      noslot: `Bestätigung für „${p.title}“: Option ${nr} existiert nicht (mehr).`,
      sender: `Bestätigung für „${p.title}“ von unbekanntem Absender ${author.email} – nicht automatisch übernommen.`,
    };
    if (msgs[check.error]) {
      notify(cfg, "Terminvorschläge – Prüfung nötig", msgs[check.error]);
    }
    return { ok: false, error: check.error };
  }

  const p = check.p;
  const slot = check.slot;
  const attendee =
    (author.email && (p.recipients.find(r => r.email === author.email) || author)) || p.recipients[0] || null;
  if (attendee && !attendee.name && author.email === attendee.email) {
    attendee.name = author.name;
  }

  try {
    // 2. Videokonferenz
    let video = null;
    try {
      video = await tvCreateVideoMeeting(cfg, {
        title: p.title,
        start: slot.start,
        end: slot.end,
        organizer: { email: p.ownEmail, name: p.ownName },
        attendees: attendee ? [attendee] : [],
        proposalId: p.id,
      });
    } catch (e) {
      console.error(e);
      notify(cfg, "Terminvorschläge – Videolink", `Videolink konnte nicht erzeugt werden: ${e.message}`);
    }

    // 3. Kalendereintrag fest machen
    const name = attendee ? tvPersonName(attendee.name) || attendee.email : "";
    const descr = [
      `Bestätigt${attendee ? " von " + (attendee.name ? `${attendee.name} <${attendee.email}>` : attendee.email) : ""} am ${new Date().toLocaleString("de-DE")}.`,
      video && video.url ? `Videokonferenz: ${video.url}` : "",
      video && video.moderatorUrl ? `Moderator-/Host-Link: ${video.moderatorUrl}` : "",
      video && video.info ? video.info : "",
    ]
      .filter(Boolean)
      .join("\n");
    const data = {
      title: tvFill(cfg.confirmedTitle, { betreff: p.title, name, email: attendee ? attendee.email : "" }),
      start: slot.start,
      end: slot.end,
      status: "CONFIRMED",
      transparency: "OPAQUE",
      marker: "",
      description: descr,
      location: video && video.url ? video.url : "",
      url: video && video.url ? video.url : "",
      categories: ["Terminvorschlag"],
    };
    if (cfg.addAttendees && attendee) {
      data.attendees = [attendee];
      data.organizer = { email: p.ownEmail, name: p.ownName };
    }
    const updated = await browser.terminCalendar.updateEvent(p.calendarId, slot.eventId, data);
    if (!updated) {
      slot.eventId = await browser.terminCalendar.createEvent(p.calendarId, data);
    }

    // 4. Übrige Reservierungen löschen
    await updateProposal(id, async q => {
      await deleteReservations(q, nr);
      const s = q.slots.find(x => x.nr === nr);
      s.eventId = slot.eventId;
      q.status = "confirmed";
      q.closed = Date.now();
      q.confirmed = {
        nr,
        at: Date.now(),
        from: attendee,
        videoUrl: video && video.url,
        moderatorUrl: video && video.moderatorUrl,
        recreate: video && video.recreate,
        sourceMessageId: source.messageId || null,
      };
    });

    // BBB: Meeting kurz vor Beginn erneut anlegen (falls verfallen)
    if (video && video.recreate && slot.start - 15 * 60000 > Date.now()) {
      browser.alarms.create(`tv-bbb-${id}`, { when: slot.start - 15 * 60000 });
    }

    // 5. Bestätigung an das Gegenüber
    try {
      const icsSent = await sendConfirmationMail(cfg, p, slot, attendee, video, source.messageId);
      await updateProposal(id, q => {
        q.confirmed.icsSent = icsSent;
      });
    } catch (e) {
      console.error(e);
      notify(cfg, "Terminvorschläge", `Bestätigungs-Mail konnte nicht gesendet werden: ${e.message}`);
    }

    notify(
      cfg,
      "Termin bestätigt",
      `${p.title}: ${slotText(cfg, slot)}${attendee ? " mit " + (attendee.name || attendee.email) : ""}`
    );
    return { ok: true };
  } catch (e) {
    console.error(e);
    await updateProposal(id, async q => {
      if (q.status === "confirming") {
        q.status = "sent";
      }
    });
    notify(cfg, "Terminvorschläge – Fehler", `Bestätigung fehlgeschlagen: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

// ------------------------------------------------------------------ Bestätigten Termin absagen
/**
 * @param {string} id
 * @param {object} opt {reason, newProposals:boolean, mode:"send"|"draft"}
 */
// Termine, die das Add-on selbst löscht (kein Auslösen der Kalender-Lösch-Automatik)
const selfDeleted = new Set();

async function withdrawConfirmed(id, opt = {}) {
  const cfg = await tvLoadConfig();
  const all = await getProposals();
  const p = all[id];
  if (!p || p.status !== "confirmed" || !p.confirmed) {
    throw new Error("Nur bestätigte Termine können abgesagt werden.");
  }
  const slot = p.slots.find(s => s.nr === p.confirmed.nr);
  const attendee = p.confirmed.from;
  const mode = opt.mode || cfg.cancelSend;

  // 1. Status setzen, dann Kalender (sofern nicht schon im Kalender gelöscht)
  await updateProposal(id, q => {
    q.status = "withdrawn";
    q.withdrawn = { at: Date.now(), reason: opt.reason || "", viaCalendar: !!opt.alreadyDeleted };
    q.closed = Date.now();
  });
  if (!opt.alreadyDeleted) {
    selfDeleted.add(slot.eventId);
    await browser.terminCalendar.deleteEvent(p.calendarId, slot.eventId).catch(e => {
      console.warn("Terminvorschläge: Termin nicht gelöscht", e);
    });
    setTimeout(() => selfDeleted.delete(slot.eventId), 60000);
  }
  browser.alarms.clear(`tv-bbb-${id}`).catch(() => {});

  // 2. Absage-Mail
  if (!attendee || !attendee.email || mode === "none") {
    notify(cfg, "Termin abgesagt", `${p.title}: ${slotText(cfg, slot)} (ohne Mail)`);
    return { ok: true };
  }
  const reason = (opt.reason || "").trim();
  const vars = {
    name: tvPersonName(attendee.name),
    termin: slotText(cfg, slot),
    betreff: p.title,
    grund: reason,
    grundBlock: reason ? "\n\n" + reason : "",
    neueTermine: "%%TV-NEU%%",
  };
  let text = tvFill(cfg.cancelMailBody, vars);
  if (opt.newProposals && !text.includes("%%TV-NEU%%")) {
    // Platzhalter vor die Grußformel bzw. ans Ende setzen
    const idx = text.lastIndexOf("\n\n");
    text = idx > 0 ? text.slice(0, idx) + "\n\n%%TV-NEU%%" + text.slice(idx) : text + "\n\n%%TV-NEU%%";
  }
  if (!opt.newProposals) {
    text = text.replace(/\n*%%TV-NEU%%\n*/g, "\n\n");
  }
  text = text.replace(/\n{3,}/g, "\n\n").trim();

  const ident = await identityInfo(p.identityId);
  const html = ident.composeHtml !== false;
  const details = {
    subject: tvFill(cfg.cancelMailSubject, vars),
    to: [attendee.name ? `${attendee.name} <${attendee.email}>` : attendee.email],
  };
  if (p.identityId) {
    details.identityId = p.identityId;
  }
  if (html) {
    details.isPlainText = false;
    details.body = `<html><body><p>${textToHtml(text)}</p></body></html>`;
  } else {
    details.isPlainText = true;
    details.plainTextBody = text;
  }
  // Kalender-Absage passend zur ursprünglichen Einladung (gleiche UID, höhere SEQUENCE)
  if (p.confirmed.icsSent !== false && cfg.attachIcs) {
    const ics = tvBuildIcs({
      method: "CANCEL",
      uid: `${slot.eventId}`,
      sequence: 1,
      start: slot.start,
      end: slot.end,
      title: p.title,
      description: text.replace(/%%TV-NEU%%/g, ""),
      organizer: { email: p.ownEmail, name: p.ownName },
      attendees: [attendee],
    });
    details.attachments = [{ file: new File([ics], "absage.ics", { type: "text/calendar" }), name: "absage.ics" }];
  }

  let tab = null;
  if (p.confirmed.sourceMessageId) {
    try {
      tab = await browser.compose.beginReply(p.confirmed.sourceMessageId, "replyToSender", details);
    } catch (e) {
      tab = null;
    }
  }
  if (!tab) {
    tab = await browser.compose.beginNew(details);
  }

  // 3. Optional: neue Vorschläge direkt in die Absage einfügen
  let newCount = 0;
  if (opt.newProposals) {
    try {
      const dur = Math.round((slot.end - slot.start) / 60000);
      const res = await computeSlots({ count: cfg.defaultCount, durationMin: dur, exclude: [slot.start] });
      if (res.slots.length) {
        const np = await applyProposal({
          tabId: tab.id,
          slots: res.slots.map(s => ({ start: s.start, end: s.end })),
          title: p.title,
          noInsert: true,
        });
        newCount = np.slots.length;
        const cur = await browser.compose.getComposeDetails(tab.id);
        if (cur.isPlainText) {
          await browser.compose.setComposeDetails(tab.id, {
            plainTextBody: (cur.plainTextBody || "").replace("%%TV-NEU%%", buildTextBlock(cfg, np)),
          });
        } else {
          await browser.compose.setComposeDetails(tab.id, {
            body: (cur.body || "").replace(/(<p>)?%%TV-NEU%%(<br>)*/, "</p>" + buildHtmlBlock(cfg, np) + "<p>"),
          });
        }
      }
    } catch (e) {
      console.error(e);
      notify(cfg, "Terminvorschläge", `Neue Vorschläge konnten nicht eingefügt werden: ${e.message}`);
    }
    if (!newCount) {
      const cur = await browser.compose.getComposeDetails(tab.id);
      if (cur.isPlainText) {
        await browser.compose.setComposeDetails(tab.id, { plainTextBody: (cur.plainTextBody || "").replace("%%TV-NEU%%", "") });
      } else {
        await browser.compose.setComposeDetails(tab.id, { body: (cur.body || "").replace("%%TV-NEU%%", "") });
      }
    }
  }

  if (mode === "send") {
    await browser.compose.sendMessage(tab.id, { mode: "sendNow" });
  }
  notify(
    cfg,
    "Termin abgesagt",
    `${p.title}: ${slotText(cfg, slot)}` +
      (mode === "send" ? " – Absage gesendet" : " – Absage-Mail zur Kontrolle geöffnet") +
      (newCount ? `, ${newCount} neue Vorschläge` : "")
  );
  return { ok: true, newProposals: newCount };
}

/** Bestätigter Termin wurde im Kalender gelöscht -> Absage vorbereiten/senden */
async function handleCalendarDelete(info) {
  if (!info || !info.id || selfDeleted.has(info.id)) {
    return;
  }
  const all = await getProposals();
  const p = Object.values(all).find(
    x => x.status === "confirmed" && x.confirmed && x.slots.some(s => s.nr === x.confirmed.nr && s.eventId === info.id)
  );
  if (!p) {
    return;
  }
  const cfg = await tvLoadConfig();
  if (cfg.calendarDeleteAction === "none") {
    return;
  }
  const slot = p.slots.find(s => s.nr === p.confirmed.nr);
  if (slot.end < Date.now()) {
    return; // vergangene Termine aufräumen ist keine Absage
  }
  // Kurz warten: Verschieben in einen anderen Kalender oder Neuaufbau des Zwischenspeichers
  // erscheinen ebenfalls als "gelöscht", der Termin taucht dann aber gleich wieder auf.
  await new Promise(r => setTimeout(r, 8000));
  const again = await browser.terminCalendar.findEvent(info.id).catch(() => null);
  if (again) {
    if (again.calendarId && again.calendarId !== p.calendarId) {
      await updateProposal(p.id, q => {
        q.calendarId = again.calendarId;
      });
    }
    return;
  }
  const fresh = (await getProposals())[p.id];
  if (!fresh || fresh.status !== "confirmed") {
    return;
  }
  try {
    await withdrawConfirmed(p.id, {
      alreadyDeleted: true,
      reason: "",
      newProposals: !!cfg.cancelNewProposals,
      mode: cfg.calendarDeleteAction,
    });
  } catch (e) {
    console.error(e);
    notify(cfg, "Terminvorschläge", `Absage konnte nicht erstellt werden: ${e.message}`);
  }
}

// ------------------------------------------------------------------ Zuordnung eingehender Mails
async function matchMessage(header, withFull = true) {
  const subject = header.subject || "";
  const all = await getProposals();
  const t = subject.match(TV_TOKEN_RE);
  if (t && all[t[1].toLowerCase()]) {
    return { id: t[1].toLowerCase(), nr: parseInt(t[2], 10), exact: true };
  }
  const i = subject.match(TV_ID_RE);
  if (i && all[i[1].toLowerCase()]) {
    return { id: i[1].toLowerCase(), nr: null, exact: false };
  }
  const open = Object.values(all).filter(p => OPEN_STATES.includes(p.status) || p.status === "confirmed");
  if (!open.length) {
    return null;
  }
  if (withFull) {
    try {
      const full = await browser.messages.getFull(header.id);
      const refs = []
        .concat(full.headers["in-reply-to"] || [], full.headers.references || [])
        .join(" ");
      const hit = open.find(p => p.messageId && refs.includes(p.messageId.replace(/[<>]/g, "")));
      if (hit) {
        return { id: hit.id, nr: null, exact: false };
      }
    } catch (e) {
      // ignorieren
    }
  }
  const author = tvParseAddress(header.author).email;
  const bySender = open.filter(p => p.status !== "confirmed" && p.recipients.some(r => r.email === author));
  if (bySender.length) {
    return { id: bySender[bySender.length - 1].id, nr: null, exact: false };
  }
  return null;
}

async function handleNewMessage(header) {
  const { processed = [] } = await browser.storage.local.get("processed");
  if (processed.includes(header.id)) {
    return;
  }
  const cfg = await tvLoadConfig();
  const m = await matchMessage(header, true);
  if (!m) {
    return;
  }
  await browser.storage.local.set({ processed: processed.concat(header.id).slice(-500) });
  if (m.exact && cfg.autoConfirm) {
    await confirmProposal(m.id, m.nr, { messageId: header.id, author: header.author });
  } else {
    const all = await getProposals();
    const p = all[m.id];
    if (p && OPEN_STATES.includes(p.status)) {
      notify(
        cfg,
        "Antwort auf Terminvorschlag",
        `${header.author}: „${header.subject}“ – bitte Mail öffnen und über den Terminvorschläge-Button bestätigen.`
      );
    }
  }
}

// ------------------------------------------------------------------ Listener
browser.messages.onNewMailReceived.addListener(async (folder, messageList) => {
  let list = messageList;
  while (list) {
    for (const h of list.messages) {
      try {
        await handleNewMessage(h);
      } catch (e) {
        console.error("Terminvorschläge:", e);
      }
    }
    list = list.id ? await browser.messages.continueList(list.id) : null;
  }
});

browser.terminCalendar.onItemDeleted.addListener(info => {
  handleCalendarDelete(info).catch(e => console.error("Terminvorschläge:", e));
});

browser.compose.onBeforeSend.addListener(async (tab, details) => {
  const all = await getProposals();
  const mine = Object.values(all).filter(p => p.tabId === tab.id && p.status === "draft");
  if (!mine.length) {
    return {};
  }
  const cfg = await tvLoadConfig();
  const body = (details.isPlainText ? details.plainTextBody : details.body) || "";
  const recipients = parseRecipients(details.to).concat(parseRecipients(details.cc), parseRecipients(details.bcc));
  let subject = details.subject || "";
  for (const p of mine) {
    if (!body.includes(`TV-${p.id}`)) {
      // Liste wurde aus der Mail entfernt -> Reservierungen freigeben
      await cancelProposal(p.id);
      continue;
    }
    await updateProposal(p.id, q => {
      q.status = "sending";
      q.recipients = recipients;
      q.subject = subject;
    });
    if (cfg.addTokenToSubject && !TV_ID_RE.test(subject) && !TV_TOKEN_RE.test(subject)) {
      subject = `${subject} [TV-${p.id}]`.trim();
    }
  }
  return subject !== (details.subject || "") ? { details: { subject } } : {};
});

browser.compose.onAfterSend.addListener(async (tab, sendInfo) => {
  const all = await getProposals();
  for (const p of Object.values(all)) {
    if (p.tabId === tab.id && p.status === "sending") {
      await updateProposal(p.id, q => {
        if (sendInfo.error) {
          q.status = "draft";
        } else {
          q.status = "sent";
          q.sent = Date.now();
          q.messageId = sendInfo.headerMessageId || null;
          q.tabId = null;
        }
      });
    }
  }
});

browser.compose.onAfterSave.addListener(async (tab, saveInfo) => {
  if (saveInfo.mode !== "draft" || saveInfo.error) {
    return;
  }
  const all = await getProposals();
  for (const p of Object.values(all)) {
    if (p.tabId === tab.id && p.status === "draft") {
      await updateProposal(p.id, q => {
        q.draftSaved = true;
      });
    }
  }
});

browser.tabs.onRemoved.addListener(async tabId => {
  const cfg = await tvLoadConfig();
  const all = await getProposals();
  for (const p of Object.values(all)) {
    if (p.tabId === tabId && p.status === "draft") {
      if (cfg.cancelIfNotSent && !p.draftSaved) {
        await cancelProposal(p.id);
      } else {
        await updateProposal(p.id, q => {
          q.tabId = null;
        });
      }
    }
  }
});

browser.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name === "tv-maintenance") {
    await maintenance();
  } else if (alarm.name.startsWith("tv-bbb-")) {
    const id = alarm.name.slice(7);
    const p = (await getProposals())[id];
    const cfg = await tvLoadConfig();
    if (p && p.status === "confirmed" && p.confirmed && p.confirmed.recreate) {
      try {
        await tvBbbCreate(cfg, p.confirmed.recreate);
      } catch (e) {
        notify(cfg, "BigBlueButton", `Meeting für „${p.title}“ konnte nicht angelegt werden: ${e.message}`);
      }
    }
  }
});

browser.messageDisplay.onMessagesDisplayed.addListener(async (tab, displayed) => {
  const msgs = Array.isArray(displayed) ? displayed : (displayed && displayed.messages) || [];
  let match = null;
  if (msgs.length === 1) {
    match = await matchMessage(msgs[0], false).catch(() => null);
  }
  if (match) {
    browser.messageDisplayAction.enable(tab.id);
  } else {
    browser.messageDisplayAction.disable(tab.id);
  }
});

browser.runtime.onInstalled.addListener(() => {
  browser.alarms.create("tv-maintenance", { periodInMinutes: 60, delayInMinutes: 1 });
});
browser.runtime.onStartup.addListener(() => {
  browser.alarms.create("tv-maintenance", { periodInMinutes: 60, delayInMinutes: 2 });
});

// ------------------------------------------------------------------ Nachrichten von Popup/Optionen
const handlers = {
  async getContext({ tabId }) {
    const cfg = await tvLoadConfig();
    const details = await browser.compose.getComposeDetails(tabId);
    const cals = (await browser.terminCalendar.getCalendars()).filter(isWritable);
    let defaultCalendarId = null;
    try {
      defaultCalendarId = await reserveCalendarId(cfg);
    } catch (e) {
      // kein beschreibbarer Kalender
    }
    return {
      config: cfg,
      subject: details.subject || "",
      to: details.to || [],
      calendars: cals.map(c => ({ id: c.id, name: c.name, isDefault: c.isDefault })),
      defaultCalendarId,
    };
  },
  computeSlots: req => computeSlots(req),
  applyProposal: req => applyProposal(req),
  getCalendars: () => browser.terminCalendar.getCalendars(),
  async listProposals() {
    const cfg = await tvLoadConfig();
    const all = await getProposals();
    return Object.values(all)
      .sort((a, b) => b.created - a.created)
      .map(p => Object.assign({}, p, { slots: p.slots.map(s => Object.assign({ text: slotText(cfg, s) }, s)) }));
  },
  cancelProposal: ({ id }) => cancelProposal(id),
  async deleteProposal({ id }) {
    await cancelProposal(id);
    return withLock(async () => {
      const all = await getProposals();
      delete all[id];
      await browser.storage.local.set({ proposals: all });
    });
  },
  confirmManual: ({ id, nr, messageId, author }) => confirmProposal(id, nr, { messageId, author }, true),
  withdrawConfirmed: ({ id, reason, newProposals, mode }) => withdrawConfirmed(id, { reason, newProposals, mode }),
  async matchDisplayed({ tabId }) {
    let msg;
    if (browser.messageDisplay.getDisplayedMessages) {
      const r = await browser.messageDisplay.getDisplayedMessages(tabId);
      const list = Array.isArray(r) ? r : (r && r.messages) || [];
      msg = list[0];
    } else {
      msg = await browser.messageDisplay.getDisplayedMessage(tabId);
    }
    if (!msg) {
      return null;
    }
    const m = await matchMessage(msg, true);
    if (!m) {
      return { message: msg };
    }
    const cfg = await tvLoadConfig();
    const p = (await getProposals())[m.id];
    return {
      message: msg,
      match: m,
      proposal: Object.assign({}, p, { slots: p.slots.map(s => Object.assign({ text: slotText(cfg, s) }, s)) }),
    };
  },
  async testVideo() {
    const cfg = await tvLoadConfig();
    const start = Date.now() + 86400000;
    return tvCreateVideoMeeting(cfg, {
      title: "Test Terminvorschläge",
      start,
      end: start + 3600000,
      organizer: {},
      attendees: [{ email: "test@example.org", name: "Test" }],
      proposalId: "test",
    });
  },
  runMaintenance: () => maintenance(),
};

browser.runtime.onMessage.addListener(msg => {
  const h = handlers[msg && msg.type];
  if (!h) {
    return undefined;
  }
  return Promise.resolve()
    .then(() => h(msg))
    .then(result => ({ ok: true, result }))
    .catch(e => ({ ok: false, error: e.message || String(e) }));
});
