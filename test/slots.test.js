/* Tests der Slot-Berechnung: node test/slots.test.js */
"use strict";
const assert = require("assert");
global.TV_WEEKDAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const S = require("../addon/lib/slots.js");
const U = require("../addon/lib/util.js");
const { tvBuildIcs } = require("../addon/lib/ics.js");

const cfg = {
  workHours: { 0: "", 1: "09:00-12:00, 13:00-17:00", 2: "09:00-12:00, 13:00-17:00", 3: "09:00-12:00, 13:00-17:00", 4: "09:00-12:00, 13:00-17:00", 5: "09:00-13:00", 6: "" },
  excludedDates: "2026-11-26",
  durationMin: 60,
  bufferMin: 15,
  stepMin: 30,
  leadHours: 24,
  horizonDays: 14,
};
// Montag, 23.11.2026, 08:00
const now = new Date(2026, 10, 23, 8, 0).getTime();
const at = (d, h, m = 0) => new Date(2026, 10, d, h, m).getTime();

assert.deepStrictEqual(S.tvParseWindows("09:00-12:00, 13:00-17:00"), [[540, 720], [780, 1020]]);
assert.ok(S.tvParseExcluded("2026-12-24, 2026-12-27..2027-01-06")("2027-01-02"));

const busy = [
  { start: at(24, 9), end: at(24, 11) }, // Di 9-11 belegt
];
const cands = S.tvComputeCandidates({ busy, config: cfg, now });
// Vorlauf 24h: nichts vor Di 08:00
assert.ok(cands.every(c => c.start >= now + 24 * 3600000));
// Di: 9-11 belegt + 15 Min Puffer -> erster Slot 11:30? 11:30-12:30 überschreitet Fenster -> erster 13:00
const tue = cands.filter(c => c.day === "2026-11-24");
assert.strictEqual(new Date(tue[0].start).getHours(), 13);
// Donnerstag ausgeschlossen, Wochenende frei
assert.ok(!cands.some(c => c.day === "2026-11-26"));
assert.ok(!cands.some(c => [0, 6].includes(new Date(c.start).getDay())));
// Freitag nur bis 13 Uhr
assert.ok(cands.filter(c => new Date(c.start).getDay() === 5).every(c => c.end <= new Date(c.start).setHours(13, 0)));

const spread = S.tvSelectSlots(cands, { count: 3, maxPerDay: 1, strategy: "spread", bufferMin: 15 });
assert.strictEqual(spread.length, 3);
assert.strictEqual(new Set(spread.map(s => s.day)).size, 3);
const earliest = S.tvSelectSlots(cands, { count: 4, maxPerDay: 2, strategy: "earliest", bufferMin: 15 });
assert.strictEqual(earliest.length, 4);
for (let i = 1; i < earliest.length; i++) {
  assert.ok(earliest[i].start >= earliest[i - 1].end + 15 * 60000, "keine Überlappung inkl. Puffer");
}

const txt = U.tvFormatSlot({ start: at(24, 13), end: at(24, 14) }, "{wochentag}, {datum}, {von} – {bis} Uhr");
assert.strictEqual(txt, "Dienstag, 24.11.2026, 13:00 – 14:00 Uhr");
const m = "Re: Terminbestätigung: Dienstag [TV-abcd2345-2]".match(U.TV_TOKEN_RE);
assert.deepStrictEqual([m[1], m[2]], ["abcd2345", "2"]);
assert.deepStrictEqual(U.tvParseAddress('"Max Muster" <Max@Example.org>'), { name: "Max Muster", email: "max@example.org" });

const ics = tvBuildIcs({ uid: "x", start: at(24, 13), end: at(24, 14), title: "Test, mit; Zeichen", organizer: { email: "a@b.de" }, attendees: [{ email: "c@d.de", name: "C" }] });
assert.ok(ics.includes("METHOD:REQUEST") && ics.includes("SUMMARY:Test\\, mit\\; Zeichen"));

console.log("Vorschläge (verteilt):");
spread.forEach(s => console.log("  •", U.tvFormatSlot(s, "{wochentag}, {datum}, {von} – {bis} Uhr")));
console.log("Alle Tests bestanden.");

// Wochentags-Verteilung: Situation Fr 20.11.2026, 4 Vorschläge, 14 Tage, Wochenende frei
{
  const now2 = new Date(2026, 10, 20, 11, 0).getTime();
  const cfg2 = Object.assign({}, cfg, { excludedDates: "" });
  const c2 = S.tvComputeCandidates({ busy: [], config: cfg2, now: now2 });
  const wd = S.tvSelectSlots(c2, { count: 4, maxPerDay: 1, strategy: "weekdays", bufferMin: 15 });
  const days = wd.map(s => new Date(s.start).getDay());
  assert.strictEqual(new Set(days).size, 4, "4 verschiedene Wochentage");
  console.log("Vorschläge (Wochentage):");
  wd.forEach(s => console.log("  •", U.tvFormatSlot(s, "{wochentag}, {datum}, {von} – {bis} Uhr")));
  for (const n of [1, 2, 5, 7, 9, 12]) {
    const r = S.tvSelectSlots(c2, { count: n, maxPerDay: 2, strategy: "weekdays", bufferMin: 15 });
    assert.strictEqual(r.length, n, "Anzahl " + n);
    if (n <= 5) assert.strictEqual(new Set(r.map(s => new Date(s.start).getDay())).size, n);
  }
  console.log("Wochentags-Tests bestanden.");
}
