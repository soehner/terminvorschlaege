# Terminvorschläge – Thunderbird-Add-on

Erzeugt per Knopfdruck im Verfassen-Fenster Terminvorschläge aus den freien Zeiten im Kalender, reserviert sie und automatisiert die komplette Abstimmung bis zum Videokonferenz-Link.

## Ablauf

1. **Button „Terminvorschläge“** in der Symbolleiste des Verfassen-Fensters öffnet ein Fenster mit
   Anzahl, Dauer, „frühestens ab“, Zeitraum und Kalendertitel. Die freien Termine werden sofort berechnet.
   Unpassende Vorschläge abwählen → **Neu berechnen** ersetzt sie.
2. **Reservieren & einfügen** (Kalender für die Reservierungen im Popup wählbar, Vorgabe aus den Einstellungen, sonst der zuletzt verwendete Kalender)
   - Jeder Vorschlag wird als *vorläufiger* Termin („[Reserviert] Betreff“) im Kalender eingetragen.
   - In die Mail kommt an der Cursorposition (sonst vor Signatur/Zitat) eine Aufzählung im Format
     `Montag, 23.11.2026, 10:00 – 11:00 Uhr – Diesen Termin bestätigen`.
   - Der Link öffnet beim Empfänger eine fertige Antwort-Mail mit dem Betreff
     `Terminbestätigung: … [TV-ab12cd34-2]`. Es wird also kein Server gebraucht.
3. **Beim Senden** merkt sich das Add-on die Empfänger und die Message-ID und hängt (optional) `[TV-ab12cd34]` an den Betreff.
   Wurde die Liste vor dem Senden wieder aus der Mail gelöscht oder die Mail verworfen, werden die Reservierungen freigegeben.
4. **Bestätigung kommt an** (Betreff enthält `[TV-id-nr]`):
   - Absender wird geprüft (muss einer der ursprünglichen Empfänger sein, abschaltbar),
   - Videokonferenz wird erzeugt (Teams, BigBlueButton, Zoom, Jitsi, fester Link oder Webhook),
   - der gewählte Termin wird fest („bestätigt“, Titel „Betreff – Name“, Videolink als Ort, Moderator-Link in der Beschreibung),
   - **alle anderen Reservierungen werden gelöscht**,
   - an das Gegenüber geht automatisch eine Terminbestätigung mit Videolink und `.ics`-Einladung (oder als Entwurf zur Kontrolle),
   - Desktop-Benachrichtigung.
5. **Antwortet jemand ohne Link** (normale Antwort, Zuordnung über Betreff-Kennung, In-Reply-To oder Absender), erscheint
   eine Benachrichtigung. In der Nachrichtenansicht dann auf **„Terminvorschlag bestätigen“** klicken und die Option wählen.
6. **Bestätigten Termin absagen**: in den Einstellungen bei „Terminvorschläge“ auf **„Absagen“** klicken oder in der
   Bestätigungs-Mail auf den Add-on-Button. Der Termin wird aus dem Kalender gelöscht. Das Gegenüber bekommt eine
   Absage-Mail mit Kalender-Absage (`.ics`, METHOD:CANCEL, gleiche UID wie die Einladung), wahlweise mit Grund und gleich
   mit neuen Terminvorschlägen. Die Mail wird sofort gesendet oder zur Kontrolle geöffnet (einstellbar).
   **Auch beim Löschen im Kalender:** Löscht man einen bestätigten Termin direkt im Kalender (auch auf einem anderen Gerät
   mit Abgleich), öffnet das Add-on nach ca. 8 Sekunden automatisch die Absage-Mail (einstellbar: zur Kontrolle öffnen /
   sofort senden / nichts tun). Verschieben in einen anderen Kalender löst keine Absage aus, vergangene Termine ebenfalls nicht.
7. **Aufräumen**: Alle 15 Minuten werden vergangene Reservierungen gelöscht und Vorschläge nach X Tagen ohne Antwort verworfen.
   Unter *Einstellungen → Terminvorschläge* sieht man alle Vorschläge und kann sie manuell bestätigen oder stornieren.
   Schneller geht es über den Knopf **„Terminvorschläge“ in der Werkzeugleiste des Hauptfensters**: Er öffnet direkt die Liste
   (bzw. holt sie nach vorne, wenn sie schon offen ist). Bestätigte Termine, die schon vorbei sind, erscheinen grau als
   „stattgefunden“ und lassen sich nicht mehr absagen, nur noch entfernen.

## Installation

```sh
./build.sh            # erzeugt dist/terminvorschlaege-<version>.xpi
```

Thunderbird → *Add-ons und Themes* → Zahnrad → *Add-on aus Datei installieren…* → die `.xpi` wählen.
Zum Entwickeln: *Extras → Entwicklerwerkzeuge → Add-ons debuggen → Temporäres Add-on laden* → `addon/manifest.json`.

Danach in den Add-on-Einstellungen Kalender, Arbeitszeiten, Texte und den Videoanbieter einrichten.
Der Button muss ggf. einmalig über *Rechtsklick auf die Symbolleiste → Anpassen* in die Verfassen-Symbolleiste gezogen werden.

## Konfiguration (Auszug)

| Bereich | Einstellungen |
|---|---|
| Kalender | geprüfte Kalender, Reservierungskalender, ganztägige/vorläufige Termine blockieren |
| Zeiten | Zeitfenster je Wochentag (`09:00-12:00, 13:00-17:00`), gesperrte Tage/Bereiche, Dauer, Puffer, Raster, Vorlauf, Zeitraum, max. pro Tag, Verteilung |
| Texte | Format (`{wochentag}, {datum}, {von} – {bis} Uhr`), Einleitung, Link-Text, Kalendertitel, Bestätigungs-Mail |
| Automatik | Auto-Bestätigung, Absenderprüfung, Verfall, Bestätigung senden/Entwurf/aus, `.ics`, Teilnehmer eintragen |
| Video | siehe unten |

### Videoanbieter

| Anbieter | Einrichtung |
|---|---|
| **Fester Link** | Persönlicher Raum (Teams-Besprechungsraum, Greenlight-/BBB-Raum, Zoom-PMI …) |
| **Jitsi** | Server-URL; je Termin wird ein zufälliger Raum erzeugt |
| **BigBlueButton** | API-URL + Shared Secret (`bbb-conf --secret`). Meeting + signierte Gast-/Moderator-Links werden erzeugt; 15 Min. vor Beginn wird das Meeting erneut angelegt, falls der Server es verworfen hat (Thunderbird muss laufen). |
| **Microsoft Teams** | Entra-ID-App-Registrierung: Plattform „Web“, Umleitungs-URI wird in den Einstellungen angezeigt, „Zugriffstoken (implizit)“ aktivieren, delegierte Berechtigung `OnlineMeetings.ReadWrite`. Anmeldung beim ersten Termin per Microsoft-Login-Fenster. |
| **Zoom** | Server-to-Server-OAuth-App mit `meeting:write:meeting` (Account-ID, Client-ID, Secret) |
| **Webhook** | POST mit JSON an n8n, Power Automate, Make oder einen eigenen Dienst; Antwort `{"url": "…"}`. Damit lässt sich jedes weitere Tool anbinden. |

Mit „Speichern & Testlink erzeugen“ lässt sich die Anbindung direkt prüfen.

### Web-Link statt Mail-Link

Wer statt `mailto:` eine Bestätigungsseite möchte (ein Klick ohne Mail-Programm), stellt *Link-Art → Web-Link* ein,
z. B. `https://example.org/termin?token={token}`. Der Dienst muss dann nur eine Mail mit `[TV-id-nr]` im Betreff an Sie schicken.
Danach läuft dieselbe Automatik.

## Technik

- Manifest V3 MailExtension, Thunderbird ≥ 128 (getestet mit 160 und 162.0b1).
- Thunderbird hat noch keine fertige Kalender-API für Add-ons. Das Add-on nutzt deshalb den offiziellen
  Entwurf der Kalender-API aus [thunderbird/webext-experiments](https://github.com/thunderbird/webext-experiments/tree/main/calendar)
  (Ordner `addon/experiments/calendar`, unverändert übernommen). `addon/lib/calendar.js` setzt darauf auf
  und wertet die Termine (jCal) aus.
  Experiment-Add-ons haben vollen Zugriff auf Thunderbird und können bei großen Thunderbird-Updates angepasst werden müssen.
- Wird ein bestätigter Termin im Kalender gelöscht, merkt das Add-on das sofort, wenn sein Hintergrund gerade läuft,
  spätestens aber bei der Prüfung alle 15 Minuten.
- Reservierungen tragen die Eigenschaft `X-TERMINVORSCHLAG-ID` und blockieren damit immer weitere Vorschläge.
- Zustand der Vorschläge: `browser.storage.local`.
- Tests: `node test/slots.test.js` und `TZ=Europe/Berlin node test/calendar.test.js`

## Grenzen

- Die Automatik läuft nur, solange Thunderbird geöffnet ist. Mails, die währenddessen eintreffen, werden beim nächsten Abruf verarbeitet.
- Die Bestätigungserkennung liest nur den Betreff. Ändert der Empfänger ihn, hilft die manuelle Bestätigung in der Nachrichtenansicht.
- Bei Mails mit mehreren Empfängern gewinnt die erste Bestätigung. Spätere führen zu einem Hinweis.

## Lizenz

Mozilla Public License 2.0, siehe [LICENSE](LICENSE).
