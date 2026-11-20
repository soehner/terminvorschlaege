/* Erzeugt eine iCalendar-Einladung (RFC 5545 / iTIP REQUEST) */
"use strict";

function tvIcsDate(ms) {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function tvIcsEscape(s) {
  return String(s || "")
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/([,;])/g, "\\$1");
}

function tvIcsFold(line) {
  const out = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = " " + rest.slice(74);
  }
  out.push(rest);
  return out.join("\r\n");
}

/**
 * @param {object} e {method?: "REQUEST"|"CANCEL", uid, start, end, title, description, location, url,
 *                    organizer:{email,name}, attendees:[{email,name}], sequence}
 */
function tvBuildIcs(e) {
  const cn = n => (n ? `;CN="${String(n).replace(/"/g, "")}"` : "");
  const lines = [
    "BEGIN:VCALENDAR",
    "PRODID:-//Terminvorschlaege//Thunderbird Add-on//DE",
    "VERSION:2.0",
    `METHOD:${e.method || "REQUEST"}`,
    "BEGIN:VEVENT",
    `UID:${e.uid}`,
    `SEQUENCE:${e.sequence || 0}`,
    `DTSTAMP:${tvIcsDate(Date.now())}`,
    `DTSTART:${tvIcsDate(e.start)}`,
    `DTEND:${tvIcsDate(e.end)}`,
    `SUMMARY:${tvIcsEscape(e.title)}`,
  ];
  if (e.description) {
    lines.push(`DESCRIPTION:${tvIcsEscape(e.description)}`);
  }
  if (e.location) {
    lines.push(`LOCATION:${tvIcsEscape(e.location)}`);
  }
  if (e.url) {
    lines.push(`URL:${e.url}`);
  }
  if (e.organizer && e.organizer.email) {
    lines.push(`ORGANIZER${cn(e.organizer.name)}:mailto:${e.organizer.email}`);
  }
  for (const a of e.attendees || []) {
    lines.push(
      `ATTENDEE${cn(a.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=${e.method === "CANCEL" ? "FALSE" : "TRUE"}:mailto:${a.email}`
    );
  }
  const cancel = e.method === "CANCEL";
  lines.push(`STATUS:${cancel ? "CANCELLED" : "CONFIRMED"}`, "TRANSP:OPAQUE", "END:VEVENT", "END:VCALENDAR");
  return lines.map(tvIcsFold).join("\r\n") + "\r\n";
}

if (typeof module !== "undefined") {
  module.exports = { tvBuildIcs };
}
