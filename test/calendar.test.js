/* Tests der Kalender-Auswertung (jCal): TZ=Europe/Berlin node test/calendar.test.js */
"use strict";
const assert = require("assert");
const C = require("../addon/lib/calendar.js");

const berlin = (y, mo, d, h, mi = 0) => Date.UTC(y, mo - 1, d, h - (mo > 3 && mo < 11 ? 2 : 1), mi);

// IANA-Zone, Winter und Sommer
assert.strictEqual(C.tvJcalTime(["dtstart", { tzid: "Europe/Berlin" }, "date-time", "2026-11-24T10:00:00"]).ms, berlin(2026, 11, 24, 10));
assert.strictEqual(C.tvJcalTime(["dtstart", { tzid: "Europe/Berlin" }, "date-time", "2026-07-01T10:00:00"]).ms, berlin(2026, 7, 1, 10));
// UTC
assert.strictEqual(C.tvJcalTime(["dtstart", {}, "date-time", "2026-11-24T09:00:00Z"]).ms, Date.UTC(2026, 10, 24, 9));
// Ganztags
const d = C.tvJcalTime(["dtstart", {}, "date", "2026-11-24"]);
assert.ok(d.isDate);
assert.strictEqual(d.ms, new Date(2026, 10, 24).getTime());

// Windows-Zonenname mit mitgelieferter VTIMEZONE
const vtz = ["vtimezone", [["tzid", {}, "text", "W. Europe Standard Time"]], [
  ["standard", [["dtstart", {}, "date-time", "1601-10-28T03:00:00"], ["rrule", {}, "recur", { freq: "YEARLY", bymonth: 10, byday: "-1SU" }], ["tzoffsetfrom", {}, "utc-offset", "+02:00"], ["tzoffsetto", {}, "utc-offset", "+01:00"]], []],
  ["daylight", [["dtstart", {}, "date-time", "1601-03-25T02:00:00"], ["rrule", {}, "recur", { freq: "YEARLY", bymonth: 3, byday: "-1SU" }], ["tzoffsetfrom", {}, "utc-offset", "+01:00"], ["tzoffsetto", {}, "utc-offset", "+02:00"]], []],
]];
const vcal = ["vcalendar", [], [vtz]];
assert.strictEqual(C.tvJcalTime(["dtstart", { tzid: "W. Europe Standard Time" }, "date-time", "2026-11-24T10:00:00"], vcal).ms, berlin(2026, 11, 24, 10));
assert.strictEqual(C.tvJcalTime(["dtstart", { tzid: "W. Europe Standard Time" }, "date-time", "2026-07-01T10:00:00"], vcal).ms, berlin(2026, 7, 1, 10));
assert.strictEqual(C.tvNthWeekday(2026, 10, "-1SU"), 25);
assert.strictEqual(C.tvNthWeekday(2026, 3, "2SU"), 8);

// Dauer statt DTEND
assert.strictEqual(C.tvParseDuration("PT1H30M"), 90 * 60000);
assert.strictEqual(C.tvParseDuration("P1D"), 86400000);
const ev = (props) => ["vevent", [["dtstart", { tzid: "Europe/Berlin" }, "date-time", "2026-11-24T10:00:00"], ["duration", {}, "duration", "PT1H"], ["summary", {}, "text", "X"]].concat(props), []];
const t = C.tvEventTimes(ev([]));
assert.strictEqual(t.end - t.start, 3600000);

// Belegt-Regeln
const own = new Set(["ich@example.org"]);
assert.ok(C.tvBusyEntry(ev([]), null, {}));
assert.strictEqual(C.tvBusyEntry(ev([["transp", {}, "text", "TRANSPARENT"]]), null, {}), null);
assert.strictEqual(C.tvBusyEntry(ev([["status", {}, "text", "CANCELLED"]]), null, {}), null);
assert.ok(C.tvBusyEntry(ev([["status", {}, "text", "TENTATIVE"]]), null, { tentativeBusy: true }));
assert.strictEqual(C.tvBusyEntry(ev([["status", {}, "text", "TENTATIVE"]]), null, { tentativeBusy: false }), null);
const declined = [["attendee", { partstat: "DECLINED" }, "cal-address", "mailto:Ich@Example.org"]];
assert.strictEqual(C.tvBusyEntry(ev(declined), null, { ownEmails: own }), null);
assert.ok(C.tvBusyEntry(ev(declined), null, { ownEmails: own, ignoreDeclined: false }));
const allDay = ["vevent", [["dtstart", {}, "date", "2026-11-24"], ["dtend", {}, "date", "2026-11-25"]], []];
assert.strictEqual(C.tvBusyEntry(allDay, null, {}), null);
assert.ok(C.tvBusyEntry(allDay, null, { allDayBusy: true }));
// eigene Reservierungen zählen immer (auch vorläufig/transparent)
const mine = C.tvBusyEntry(ev([[C.TV_MARKER_PROP, {}, "unknown", "abc"], ["transp", {}, "text", "TRANSPARENT"]]), null, {});
assert.ok(mine && mine.own);

// Daten in ein VEVENT schreiben und wieder lesen
const v = ["vevent", [["uid", {}, "text", "u1"]], []];
C.tvApplyEventData(v, {
  title: "Test", start: Date.UTC(2026, 10, 24, 9), end: Date.UTC(2026, 10, 24, 10),
  status: "TENTATIVE", transparency: "OPAQUE", categories: ["Terminvorschlag"], marker: "abc",
  organizer: { email: "ich@example.org", name: "Ich" }, attendees: [{ email: "du@example.org", name: "Du" }],
});
const b = C.tvBusyEntry(v, null, {});
assert.deepStrictEqual([b.start, b.end, b.title, b.own], [Date.UTC(2026, 10, 24, 9), Date.UTC(2026, 10, 24, 10), "Test", true]);
C.tvApplyEventData(v, { marker: "", status: "CONFIRMED", location: "" });
assert.ok(!v[1].some(p => p[0] === C.TV_MARKER_PROP || p[0] === "location"));
assert.ok(v[1].some(p => p[0] === "status" && p[3] === "CONFIRMED"));

// Serie und Vorkommen: Serie hat Vorrang
const series = ["vevent", [["uid", {}, "text", "s"]], []];
const occ = ["vevent", [["uid", {}, "text", "s"], ["recurrence-id", {}, "date-time", "2026-11-24T09:00:00Z"]], []];
assert.strictEqual(C.tvJcalEvent(["vcalendar", [], [occ, series]]).vevent, series);
assert.strictEqual(C.tvJcalEvent(["vcalendar", [], [occ]]).vevent, occ);

console.log("calendar.test.js: alle Tests bestanden");
