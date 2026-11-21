# Datenschutzerklärung für das Thunderbird-Add-on „Terminvorschläge“

Stand: 21.11.2026

**Grundsatz.** Das Add-on arbeitet vollständig lokal in Thunderbird. Es gibt keinen Server des Entwicklers. Es werden keine Nutzungsdaten, Statistiken oder Absturzberichte erhoben oder übertragen. Der Entwickler erhält keinerlei Daten.

**Was lokal verarbeitet wird.** Zum Erstellen von Vorschlägen liest das Add-on Termine aus den Kalendern, die Sie in den Einstellungen auswählen, und legt dort Reservierungen und bestätigte Termine an. Um Bestätigungen zu erkennen, prüft es eingehende Nachrichten auf die Kennung im Betreff ([TV-…]) sowie auf Absender und Antwortbezug. Einstellungen und offene Vorschläge (Titel, Termine, Empfängeradressen) werden im lokalen Speicher von Thunderbird abgelegt. Abgeschlossene Vorschläge werden nach der eingestellten Frist automatisch entfernt.

**E-Mails.** Vorschlags-, Bestätigungs- und Absagemails versendet Thunderbird über Ihr eigenes E-Mail-Konto, so wie jede andere Mail.

**Videokonferenz-Anbieter (optional).** Nur wenn Sie in den Einstellungen einen Anbieter wählen, überträgt das Add-on bei der Bestätigung eines Termins Daten direkt an diesen Anbieter, um ein Meeting anzulegen:
- Microsoft Teams (Microsoft Graph): Titel, Beginn und Ende des Termins
- Zoom: Titel, Beginn, Dauer
- BigBlueButton (Ihr eigener Server): Titel, Meeting-Kennung, Zugangspasswörter
- Webhook (Ihre eigene Adresse): Titel, Beginn, Ende, Organisator und Teilnehmende (Name, E-Mail-Adresse)
- Jitsi und fester Link: Es werden keine Daten übertragen. Der Link wird lokal erzeugt.

Für diese Übertragungen gelten die Datenschutzbestimmungen des jeweiligen Anbieters. Zugangsdaten (Client-ID, Secret, Token) werden nur lokal gespeichert und nur an den jeweiligen Anbieter gesendet.

**Sicherungsdatei.** Die Export-Funktion schreibt Einstellungen (einschließlich Zugangsdaten der Videoanbieter) und Vorschläge in eine Datei auf Ihrem Rechner. Die Datei wird nirgendwohin übertragen.

**Kontakt.** Fragen und Hinweise bitte über https://github.com/soehner/terminvorschlaege/issues.
