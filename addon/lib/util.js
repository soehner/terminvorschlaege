/* Hilfsfunktionen: Formatierung, Templates, IDs */
"use strict";

var TV_WD =
  typeof TV_WEEKDAYS !== "undefined"
    ? TV_WEEKDAYS
    : ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

function tvPad(n) {
  return String(n).padStart(2, "0");
}

function tvFormatDate(d) {
  return `${tvPad(d.getDate())}.${tvPad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

function tvFormatTime(d) {
  return `${tvPad(d.getHours())}:${tvPad(d.getMinutes())}`;
}

// "Geyer, Matthias" -> "Matthias Geyer"; Anführungszeichen entfernen
function tvPersonName(name) {
  let n = String(name || "").trim().replace(/^["']+|["']+$/g, "").trim();
  const m = n.match(/^([^,]+),\s*([^,]+)$/);
  if (m) {
    // Titel wie "Dr." oder "Prof. Dr." vor den Vornamen stellen
    const t = m[1].trim().match(/^((?:(?:Prof|Dr|Dipl\.-[\wäöü]+|med|rer\. nat|h\. ?c)\.?\s+)+)(.+)$/i);
    n = t ? `${t[1].trim()} ${m[2].trim()} ${t[2].trim()}` : `${m[2].trim()} ${m[1].trim()}`;
  }
  return n;
}

function tvFill(template, vars) {
  return String(template || "").replace(/\{(\w+)\}/g, (m, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) && vars[key] != null ? String(vars[key]) : m
  );
}

/** Variablen für einen Termin-Slot */
function tvSlotVars(slot) {
  const s = new Date(slot.start);
  const e = new Date(slot.end);
  return {
    wochentag: TV_WD[s.getDay()],
    wt: TV_WD[s.getDay()].slice(0, 2),
    datum: tvFormatDate(s),
    von: tvFormatTime(s),
    bis: tvFormatTime(e),
    dauer: Math.round((slot.end - slot.start) / 60000),
  };
}

function tvFormatSlot(slot, format) {
  return tvFill(format, tvSlotVars(slot));
}

function tvEscapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function tvRandomId(len = 8) {
  const chars = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => chars[b % chars.length]).join("");
}

/** "Max Muster <max@x.de>" -> {name, email} */
function tvParseAddress(str) {
  const s = String(str || "").trim();
  const m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) {
    return { name: m[1].trim(), email: m[2].trim().toLowerCase() };
  }
  return { name: "", email: s.toLowerCase() };
}

/** Regex für Bestätigungs-Kennungen im Betreff: [TV-<id>-<nr>] */
var TV_TOKEN_RE = /\[TV-([a-z0-9]{6,12})-(\d{1,2})\]/i;
var TV_ID_RE = /\[TV-([a-z0-9]{6,12})\]/i;

if (typeof module !== "undefined") {
  module.exports = {
    tvFill,
    tvFormatSlot,
    tvSlotVars,
    tvEscapeHtml,
    tvRandomId,
    tvParseAddress,
    TV_TOKEN_RE,
    TV_ID_RE,
  };
}
