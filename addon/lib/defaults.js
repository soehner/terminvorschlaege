/* Standard-Konfiguration. Alle Werte sind über die Einstellungsseite änderbar. */
"use strict";

var TV_DEFAULTS = {
  // --- Kalender ---
  busyCalendarIds: [], // leer = alle aktivierten Kalender
  reserveCalendarId: "", // leer = erster beschreibbarer Kalender
  allDayBusy: false, // ganztägige Termine blockieren?
  tentativeBusy: true, // vorläufige Termine anderer blockieren?
  ignoreDeclined: true, // abgelehnte Einladungen ignorieren

  // --- Zeitfenster ---
  // Wochentag 0 = Sonntag … 6 = Samstag; Format "HH:MM-HH:MM, HH:MM-HH:MM"
  workHours: {
    0: "",
    1: "09:00-12:00, 13:00-17:00",
    2: "09:00-12:00, 13:00-17:00",
    3: "09:00-12:00, 13:00-17:00",
    4: "09:00-12:00, 13:00-17:00",
    5: "09:00-13:00",
    6: "",
  },
  excludedDates: "", // z. B. "2026-12-24, 2026-12-31" oder Bereiche "2026-12-24..2027-01-06"
  durationMin: 60,
  bufferMin: 15,
  stepMin: 30,
  leadHours: 24, // frühester Vorschlag ab jetzt + X Stunden
  horizonDays: 14,
  maxPerDay: 1,
  defaultCount: 3,
  strategy: "weekdays", // "weekdays" = verteilt + verschiedene Wochentage, "spread" = nur verteilt, "earliest" = früheste zuerst

  // --- Texte ---
  reserveTitle: "[Reserviert] {betreff}",
  confirmedTitle: "{betreff} – {name}",
  slotFormat: "{wochentag}, {datum}, {von} – {bis} Uhr",
  introText: "Ich schlage Ihnen folgende Termine vor:",
  outroText: "Bitte klicken Sie einfach auf den Link hinter Ihrem Wunschtermin.",
  linkText: "Diesen Termin bestätigen",
  confirmSubject: "Terminbestätigung: {termin} [TV-{id}-{nr}]",
  confirmBody: "Hiermit bestätige ich den Termin am {termin}.",

  // --- Bestätigungslink ---
  linkMode: "mailto", // "mailto" | "url"
  confirmAddress: "", // leer = Absenderadresse der Vorschlags-Mail
  linkUrlTemplate: "https://example.org/termin?token={token}",

  // --- Automatik ---
  autoConfirm: true, // Bestätigungs-Mails automatisch verarbeiten
  checkSender: true, // nur Bestätigungen der ursprünglichen Empfänger akzeptieren
  addTokenToSubject: true, // Kennung [TV-xxxx] an Betreff anhängen
  cancelIfNotSent: true, // Reservierungen löschen, wenn Mail verworfen wird
  expiryDays: 7, // Reservierungen nach X Tagen ohne Bestätigung löschen (0 = nie)
  addAttendees: false, // Gegenüber als Teilnehmer im Kalendereintrag speichern
  sendConfirmation: "send", // "send" | "draft" | "none"
  attachIcs: true,
  confirmationMailSubject: "Termin bestätigt: {termin}",
  confirmationMailBody:
    "Guten Tag {name},\n\nvielen Dank, der Termin am {termin} ist fest eingeplant.\n{videoBlock}\nViele Grüße",
  notify: true,
  configVersion: 2,

  // --- Absage bestätigter Termine ---
  cancelSend: "draft", // "draft" = zur Kontrolle öffnen, "send" = sofort senden
  cancelNewProposals: true, // neue Vorschläge standardmäßig anbieten
  calendarDeleteAction: "draft", // bestätigten Termin im Kalender gelöscht: "draft" | "send" | "none"
  cancelMailSubject: "Terminabsage: {termin}",
  cancelMailBody:
    "Guten Tag {name},\n\nleider muss ich unseren Termin am {termin} absagen.{grundBlock}\n\n{neueTermine}\n\nViele Grüße",

  // --- Video ---
  videoProvider: "none", // none | static | jitsi | bbb | teams | zoom | webhook
  videoStaticUrl: "",
  jitsiBaseUrl: "https://meet.jit.si/",
  jitsiPrefix: "Termin",
  bbbUrl: "", // z. B. https://bbb.example.org/bigbluebutton/
  bbbSecret: "",
  bbbModeratorName: "",
  teamsClientId: "",
  teamsTenant: "common",
  zoomAccountId: "",
  zoomClientId: "",
  zoomClientSecret: "",
  webhookUrl: "",
  webhookAuthHeader: "",
  videoText: "Zugangslink zur Videokonferenz: {url}",
};

var TV_WEEKDAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

async function tvLoadConfig() {
  const { config } = await browser.storage.local.get("config");
  // Migration 1.0 -> 1.1: bisherige Standard-Verteilung auf neue Wochentags-Verteilung umstellen
  if (config && !config.configVersion) {
    if (config.strategy === "spread") {
      config.strategy = "weekdays";
    }
    config.configVersion = 2;
  }
  return Object.assign({}, TV_DEFAULTS, config || {}, {
    workHours: Object.assign({}, TV_DEFAULTS.workHours, (config && config.workHours) || {}),
  });
}

async function tvSaveConfig(config) {
  await browser.storage.local.set({ config });
}
