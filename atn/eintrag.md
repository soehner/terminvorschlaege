# Texte für den Eintrag auf addons.thunderbird.net

## Name
Terminvorschläge

## Zusammenfassung (max. 250 Zeichen)
Schlägt per Knopfdruck freie Termine aus dem Kalender in einer E-Mail vor, reserviert sie und trägt den bestätigten Termin samt Videokonferenz-Link automatisch ein. Ohne Server, ohne Terminbuchungsdienst.

## Beschreibung
Terminabstimmung per E-Mail, aber ohne das übliche Hin und Her.

**So funktioniert es**
1. Beim Verfassen einer Mail auf „Terminvorschläge“ klicken. Das Add-on sucht freie Zeiten in den gewählten Kalendern, verteilt auf verschiedene Wochentage.
2. „Reservieren & einfügen“: Die Vorschläge werden als vorläufige Termine im Kalender geblockt und als Liste mit Bestätigungslinks in die Mail eingefügt.
3. Das Gegenüber klickt auf einen Link. Es öffnet sich eine fertige Antwortmail, die nur noch gesendet werden muss. Ein Webdienst ist dafür nicht nötig.
4. Kommt die Bestätigung an, wird der Termin fest eingetragen, die übrigen Reservierungen werden gelöscht, eine Videokonferenz wird angelegt und das Gegenüber erhält eine Bestätigung mit Link und Kalendereinladung (.ics).

**Weitere Funktionen**
- Arbeitszeiten je Wochentag, Puffer, frühester Beginn, Zeitraum
- Videokonferenz: Microsoft Teams, Zoom, BigBlueButton, Jitsi, fester Link oder eigener Webhook
- Absagen mit Kalender-Absage (.ics), wahlweise gleich mit neuen Vorschlägen. Das funktioniert auch, wenn der Termin auf einem anderen Gerät gelöscht wird.
- Normale Antworten ohne Link werden erkannt und lassen sich mit einem Klick zuordnen.
- Nicht beantwortete Vorschläge und abgelaufene Reservierungen werden automatisch aufgeräumt.
- Sicherung und Wiederherstellung aller Einstellungen

**Hinweis zur Technik**
Thunderbird bietet noch keine offizielle Kalender-Schnittstelle für Add-ons. Terminvorschläge nutzt deshalb eine eigene Experiment-API, um freie Zeiten zu lesen und Termine anzulegen. Die Berechtigung „Nachrichten lesen“ wird nur benötigt, um eingehende Bestätigungen zu erkennen.

Quellcode und Fehlermeldungen: https://github.com/soehner/terminvorschlaege

## Kategorien
Kalender und Termine (Calendar and Date/Time), Nachrichten verfassen (Message and News Reading / Composition)

## Tags
termin, terminplanung, kalender, meeting, teams, zoom, jitsi, bigbluebutton

## Lizenz
Mozilla Public License 2.0 (MPL-2.0)

## Anmerkungen für die Prüfer (Notes to Reviewer)
Calendar access uses an unmodified copy of the published calendar API draft from https://github.com/thunderbird/webext-experiments (folder calendar/experiments/calendar, commit b094c859, 2026-11-20), located in experiments/calendar. Only calendar_calendars, calendar_items and calendar_provider (needed for its startup registration) are declared. The add-on's own previous Experiment API (terminCalendar) has been removed. The add-on reads free/busy information and creates, updates and deletes events in calendars the user selects. The source is not minified or transpiled, the XPI is built with a plain zip (build.sh). No remote code is loaded. Network requests are only made to the video conferencing provider the user configures (optional host permissions are requested at runtime).
