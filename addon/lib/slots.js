/* Berechnung freier Termin-Slots */
"use strict";

/** "09:00-12:00, 13:00-17:00" -> [[540,720],[780,1020]] (Minuten ab Mitternacht) */
function tvParseWindows(str) {
  const result = [];
  for (const part of String(str || "").split(/[,;]/)) {
    const m = part.trim().match(/^(\d{1,2})[:.](\d{2})\s*[-–]\s*(\d{1,2})[:.](\d{2})$/);
    if (!m) {
      continue;
    }
    const a = +m[1] * 60 + +m[2];
    const b = +m[3] * 60 + +m[4];
    if (b > a) {
      result.push([a, b]);
    }
  }
  return result.sort((x, y) => x[0] - y[0]);
}

function tvDayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/** "2026-12-24, 2026-12-27..2027-01-06" -> Funktion(dayKey) => boolean */
function tvParseExcluded(str) {
  const singles = new Set();
  const ranges = [];
  for (const part of String(str || "").split(/[,;\s]+/)) {
    const p = part.trim();
    if (!p) {
      continue;
    }
    const r = p.split("..");
    if (r.length == 2) {
      ranges.push([r[0], r[1]]);
    } else {
      singles.add(p);
    }
  }
  return key => singles.has(key) || ranges.some(([a, b]) => key >= a && key <= b);
}

/**
 * Alle möglichen Slots im Zeitraum.
 * @param {object} p
 * @param {Array<{start:number,end:number}>} p.busy
 * @param {object} p.config
 * @param {number} [p.now]
 * @param {number} [p.from] - frühester Tag (ms)
 * @param {number} [p.durationMin]
 * @param {number} [p.horizonDays]
 */
function tvComputeCandidates(p) {
  const cfg = p.config;
  const now = p.now || Date.now();
  const dur = (p.durationMin || cfg.durationMin) * 60000;
  const buf = (cfg.bufferMin || 0) * 60000;
  const step = Math.max(5, cfg.stepMin || 30) * 60000;
  const earliest = now + (cfg.leadHours || 0) * 3600000;
  const horizon = p.horizonDays || cfg.horizonDays || 14;
  const excluded = tvParseExcluded(cfg.excludedDates);
  const busy = (p.busy || []).slice().sort((a, b) => a.start - b.start);

  const base = new Date(Math.max(now, p.from || 0));
  const day0 = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  const out = [];

  for (let d = 0; d < horizon; d++) {
    const day = new Date(day0.getFullYear(), day0.getMonth(), day0.getDate() + d);
    const key = tvDayKey(day);
    if (excluded(key)) {
      continue;
    }
    const windows = tvParseWindows(cfg.workHours[day.getDay()]);
    for (const [a, b] of windows) {
      const wEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, b).getTime();
      for (let m = a; ; m += step / 60000) {
        const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, m).getTime();
        const end = start + dur;
        if (end > wEnd) {
          break;
        }
        if (start < earliest) {
          continue;
        }
        const conflict = busy.some(x => x.start < end + buf && x.end > start - buf);
        if (!conflict) {
          out.push({ start, end, day: key });
        }
      }
    }
  }
  return out;
}

function tvOverlaps(slot, chosen, bufMs) {
  return chosen.some(c => c.start < slot.end + bufMs && c.end > slot.start - bufMs);
}

/**
 * Wählt aus den Kandidaten die Vorschläge aus.
 * @param {Array} candidates
 * @param {object} opt {count, maxPerDay, strategy, bufferMin, exclude:Set<number>}
 */
function tvSelectSlots(candidates, opt) {
  const count = Math.max(1, opt.count || 3);
  const maxPerDay = Math.max(1, opt.maxPerDay || 1);
  const bufMs = (opt.bufferMin || 0) * 60000;
  const exclude = opt.exclude || new Set();
  const cands = candidates.filter(c => !exclude.has(c.start));
  const chosen = [];
  const perDay = {};

  if (opt.strategy === "earliest") {
    for (const c of cands) {
      if (chosen.length >= count) {
        break;
      }
      if ((perDay[c.day] || 0) >= maxPerDay || tvOverlaps(c, chosen, bufMs)) {
        continue;
      }
      chosen.push(c);
      perDay[c.day] = (perDay[c.day] || 0) + 1;
    }
    return chosen.sort((a, b) => a.start - b.start);
  }

  // Verteilt: Tage gleichmäßig über den Zeitraum auswählen, Uhrzeiten variieren
  const byDay = new Map();
  for (const c of cands) {
    if (!byDay.has(c.day)) {
      byDay.set(c.day, []);
    }
    byDay.get(c.day).push(c);
  }
  const days = [...byDay.keys()];
  const D = days.length;
  if (!D) {
    return [];
  }
  const order = [];
  const n = Math.min(count, D);
  const weekday = key => new Date(key + "T12:00:00").getDay();
  if (opt.strategy === "weekdays") {
    // gleichmäßiger Abstand, aber möglichst jeder Wochentag nur einmal
    const gap = n == 1 ? 1 : Math.max(1, Math.floor((D - 1) / (n - 1)));
    const used = new Set();
    let idx = 0;
    while (order.length < n && idx < D) {
      let pick = -1;
      for (let j = idx; j < D; j++) {
        if (!used.has(weekday(days[j]))) {
          pick = j;
          break;
        }
      }
      if (pick < 0) {
        pick = idx; // alle Wochentage ab hier schon vergeben
      }
      order.push(days[pick]);
      used.add(weekday(days[pick]));
      idx = pick + gap;
    }
    // falls am Ende Tage fehlen: zuerst noch unbenutzte Wochentage auffüllen
    const rest = days.filter(d => !order.includes(d));
    rest.sort((a, b) => used.has(weekday(a)) - used.has(weekday(b)));
    for (const d of rest) {
      if (order.length >= n) {
        break;
      }
      order.push(d);
      used.add(weekday(d));
    }
  } else {
    for (let i = 0; i < n; i++) {
      const idx = n == 1 ? 0 : Math.round((i * (D - 1)) / (n - 1));
      if (!order.includes(days[idx])) {
        order.push(days[idx]);
      }
    }
  }
  for (const d of days) {
    if (!order.includes(d)) {
      order.push(d);
    }
  }

  let k = 0;
  for (let round = 1; round <= maxPerDay && chosen.length < count; round++) {
    for (const d of order) {
      if (chosen.length >= count) {
        break;
      }
      if ((perDay[d] || 0) >= round) {
        continue;
      }
      const options = byDay.get(d).filter(c => !tvOverlaps(c, chosen, bufMs));
      if (!options.length) {
        continue;
      }
      let pick;
      const pref = k % 3;
      if (pref == 0) {
        pick = options[0];
      } else if (pref == 1) {
        pick = options.find(c => new Date(c.start).getHours() >= 13) || options[options.length - 1];
      } else {
        pick = options[Math.floor(options.length / 2)];
      }
      chosen.push(pick);
      perDay[d] = (perDay[d] || 0) + 1;
      k++;
    }
  }
  return chosen.sort((a, b) => a.start - b.start);
}

if (typeof module !== "undefined") {
  module.exports = { tvParseWindows, tvParseExcluded, tvComputeCandidates, tvSelectSlots, tvDayKey };
}
