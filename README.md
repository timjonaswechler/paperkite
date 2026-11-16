# Bewerbungen auf srv

Unabhängige Einzelbenutzer-Webapp mit eigener SQLite, lokalen Dokumenten und Pi-/Codex-Assistent. Erreichbar unter **https://srv.devices.teejayslab.de/bewerbung/** ausschließlich über NetBird. Der Dienst bindet nur **127.0.0.1:3119**; Caddy erhält das `/bewerbung`-Prefix.

## Benutzen

1. **Eigene Dateien:** Zeugnisse und Anlagen einmal zentral hochladen. In neuen oder bestehenden Bewerbungen die relevanten Dateien auswählen. Das ist keine Liste interner Lua-/TeX-Dateien.
2. **Neue Bewerbung** öffnet ein Formular mit Unternehmen und Rolle als Pflichtfeldern, Status, Ausschreibung/URL, Notizen, CV-/Anschreiben-Ausgangspunkt und Anlagen. Erst „Bewerbung anlegen“ erzeugt eine Bewerbung; Abbrechen/Escape nicht. Der vorhandene Mac-Master wird angeboten, `general` bevorzugt. Ohne Master ist ein neutrales Anschreiben möglich.
3. Der Hauptbereich ist der **Chat**. Anbieter und Modell im Composer wählen; Schreiben/Bearbeiten verlangt jeweils eine sichtbare Einzelfreigabe. Nicht abgesendete Texte bleiben pro Bewerbung gespeichert. Die Einstellungen bestimmen Enter-Verhalten, Farbschema und Standard-Harness für neue Bewerbungen.
4. **Unterlagen** im Kopfbereich öffnet rechts PDF-Builds, Vorschau, Logs, Verlauf, Downloads und die ausgewählten Anlagen. Auch unfertige Entwürfe sind erlaubt. Beide TeX-Engines laufen zweimal; Fehler ersetzen keinen erfolgreichen Stand. „Festhalten“ markiert einen erfolgreichen, unveränderlichen Dokumentstand.
5. **Rechtsklick auf eine Bewerbung:** öffnen/schließen, Details, Status, unabhängige Kopie sowie Unterlagen/Quellen. Eine Kopie startet als Entwurf und übernimmt keine KI-Sitzung oder Builds. Geöffnete Bewerbungen stehen oben; Schließen entfernt nur diesen Eintrag, nicht die Bewerbung. Die sechs Statusgruppen darunter sind davon unabhängig: Entwurf, In Arbeit, Fertig, Gesendet, Absage, Zusage.
6. **Lebenslauf / Quellen bearbeiten** ist der separate erweiterte Lua-/TeX-Editor mit Datei- und CV-Eintragsübernahme. Das Profil benennt `cv/profiles/<name>.lua` ohne Endung. Der optionale automatische Build gilt nach manuellem Speichern einer Quelldatei.

Zum Versenden **Dokumentpaket** verwenden: Es enthält nur die neuesten erfolgreichen CV-/Anschreiben-PDFs und die aktuell ausgewählten Anlagen. **Quellen-ZIP und Buildquellen enthalten interne Bewerbungsdaten einschließlich Notizen und sind nicht zum Versand bestimmt.** Buildquellen behalten ihre damalige Anlagenauswahl; spätere Auswahl- oder Bezeichnungsänderungen ändern diesen Stand nicht. Ein früheres erfolgreiches PDF kann gegenüber den aktuellen Quellen veraltet sein – Vorschau und Revision vor dem Versand prüfen. Status „Gesendet“ verschickt keine E-Mail.

Tastenkürzel bei Seitenfokus: Strg/⌘+K Suche, Strg/⌘+N neue Bewerbung, Strg/⌘+, Einstellungen. Die Suche umfasst Unternehmen, Rolle, Notizen, Ausschreibung und gespeicherte Chatnachrichten, mit Statusfilter; keine Volltextsuche in hochgeladenen PDFs.

### Zentrale Anlagen

Erlaubt sind PDF, JPG und PNG mit passendem Dateikopf und Dateiendung: maximal **25 MiB pro Datei**, **1 GiB Ablage**, **100 MiB und 40 Anlagen pro Bewerbung**. Identische Bytes werden anhand SHA-256 nur einmal gespeichert. Dateiinhalte bleiben unverändert; jede Bewerbung hat ihre eigene Auswahl. Bezeichnungen gelten zentral. Hochladen ist eine eigene Aktion: bereits hochgeladene Dateien bleiben auch nach Abbrechen eines Bewerbungsformulars in der Ablage.

Nur unbenutzte Anlagen lassen sich entfernen. Verweise aus anderen Bewerbungen oder erfolgreichen gespeicherten Builds verhindern das Löschen. Die Sicherung muss deshalb Datenbank, Quellen, Builds **und** `data/documents/` gemeinsam enthalten.

### Einzelne CV-Einträge wiederverwenden

Unter „Lebenslauf / Quellen bearbeiten“ → „Einzelne Lebenslauf-Einträge wiederverwenden“ Quellbewerbung, Quellprofil und Zielprofil (`cv/profiles/*.lua`) auswählen, Einträge markieren und übernehmen. Unterstützt werden `experience`/`engagement` mit `date`, `title`, `org`, `bullets` sowie `skills` mit `label`, `items`.

- **Anhängen:** ausgewählte Einträge folgen den vorhandenen Einträgen.
- **Ersetzen:** nur Bereiche mit ausgewählten Einträgen werden vollständig ersetzt; andere Bereiche bleiben erhalten. Vorher erscheint eine Bestätigung.
- Reihenfolge innerhalb eines Bereichs: Quellreihenfolge, nicht Klickreihenfolge. Es entstehen persistente, unabhängige Kopien. Eine inzwischen geänderte Quelle oder ein geändertes Ziel verlangt neues Laden.
- Ein begrenzter Literalparser verarbeitet ausschließlich `return {…}` mit Tabellen, Zeichenketten, Zahlen und Booleschen Werten. Kommentare und lange Lua-Zeichenketten werden unterstützt. Funktionen, Variablen, Berechnungen, gemischte/mehrdeutige Tabellen und nicht unterstützte Escapes werden mit Positionsmeldung abgelehnt; kein Lua wird auf dem Host ausgeführt.
- Kommentare und Formatierung **im Zielprofil** werden neu serialisiert; unbekannte literale Felder bleiben erhalten. Die Quellbytes bleiben unverändert. Lua-/TeX-Editor und Quellen-ZIP sind weiterhin der manuelle Ausweg.

Alte importierte Anschreiben bleiben ausschließlich im Vorlagenbestand als Referenzen. Neue Bewerbungen beginnen standardmäßig mit dem neutralen `anschreiben/Anschreiben.tex`. Nur eine ausdrücklich gewählte frühere Bewerbung oder vollständige Kopie übernimmt deren Anschreiben; dabei alte Empfänger und Inhalte vor Verwendung anpassen. Alte Firmen-/Bildreferenzen werden nicht automatisch als neue Fakten interpretiert.

## Originalvorlage importieren

Das Importformat ist eine Datei-Map mit Base64-Inhalten:

```json
{"format":"bewerbung-template-v1","files":{"cv/Lebenslauf.tex":"<base64>","cv/lua/loader.lua":"<base64>","fonts/SourceSans3-Light.ttf":"<base64>"}}
```

Vom Mac über die bestehende NetBird-Verbindung direkt per HTTPS:

```sh
curl --fail-with-body \
  -H 'Content-Type: application/json' -H 'X-Bewerbung-Request: 1' \
  --data-binary @template.json \
  https://srv.devices.teejayslab.de/bewerbung/api/templates/import
```

Keine SSH-Zugangsdaten nötig. Alternativ unter „Einstellungen“ → „Vorlagen“ → „JSON importieren“ auswählen. Der importierte Master enthält 38 Quellen, Bilder und Schriftdateien (rund 7,8 MB dekodiert). Der tatsächliche allgemeine Lebenslauf wurde auf srv gebaut: zwei A4-Seiten, eingebettete SourceSans3-Schriften und identische Textextraktion einschließlich Reihenfolge und Umbrüchen wie die lokale Referenz. Die Quelldateien auf dem Mac wurden nicht verändert; vorhandene Bewerbungsarchive wurden nicht migriert.

Grenzen: 24 MiB HTTP-JSON, 16 MiB dekodiert insgesamt, 4 MiB je Datei, 160 Dateien. UTF-8 für Texte, kanonisches Base64, keine Symlinks/Archive/Skripte/absoluten Pfade oder `..`. Erlaubt sind:

- `cv/Lebenslauf.tex`
- `cv/{lua,profile,profiles}/<Name>.lua`
- `cv/preamble/<Name>.tex`
- `cv/assets/<Name>.{jpg,jpeg,png}`
- `anschreiben/<Name>.tex`, `anschreiben/assets/<Name>.{jpg,jpeg,png}`
- `fonts/SourceSans3-<Variante>.ttf`

`<Name>` erlaubt Buchstaben, Ziffern, `_` und `-`. `Lebenslauf.tex` und `lua/loader.lua` sind Pflicht. Die Antwort nennt Vorlagen-ID, Anzahl und Größe. Import erzeugt einen neuen unveränderlichen Bestand und ändert keine bestehenden Bewerbungen. Jede Bewerbung erhält eine unabhängige Arbeitskopie. Eigene Lua-/TeX-Dateien werden erst im isolierten Builder ausgeführt.

Die Servervorlage lädt die mitgelieferten SourceSans3-TTFs direkt: In `cv/preamble/fonts.tex` tragen alle SourceSans3-Familien `Path=../fonts/, Extension=.ttf`. Nur diese Pfadangabe wurde gegenüber dem Mac-Master angepasst; Latin Modern Roman bleibt eine Systemschrift des Builder-Images. Bei einem erneuten Import eines unveränderten Mac-Masters diese Anpassung mitnehmen. Der Importer schreibt Fontdefinitionen nicht automatisch um.

Die 16-MiB-Gesamtgrenze gilt auch für spätere Änderungen einschließlich `application.json`, Datei-/Eintragsübernahmen und KI-Schreibzugriffe. Überschreitungen werden vor dem Ersetzen von Dateien oder Ändern der Revision abgelehnt. Pi prüft die tatsächliche Mutation nach der Einzelfreigabe; Schreiben/Bearbeiten laufen nacheinander.

## Pi, Codex und Grenzen

Der installierte Pi läuft als bestehender Nutzer mit eigenem Arbeitsverzeichnis und eigenen Sitzungsdateien pro Bewerbung. Die App kopiert keine Zugangsdaten und nutzt weder T3-API noch T3-Datenbank. Der Hostprozess liest seine vorhandene native Authentifizierung. Modellanfragen können Dokumente an den ausgewählten Modellanbieter übertragen; **die App-Datenhaltung** bleibt lokal, Anbieter-Retention wird dadurch nicht kontrolliert.

Nur `read`, `edit`, `write` auf erlaubte Bewerbungsdateien; jede Änderung verlangt eine einzelne UI-Freigabe. Keine Shell, MCP, fremden Extensions, Skills oder Kontextdateien. Ohne geladenes Freigabe-Modul startet kein Turn. Das ist eine Werkzeuggrenze im vertrauenswürdigen Pi-Prozess, kein vollständiger OS-Sandbox für den Harness selbst. Stoppen/Neustart verwirft offene Freigaben; diese werden nicht automatisch wieder genehmigt.

Im Composer kann zwischen **Pi** und dem installierten **Codex CLI 0.167.0** gewechselt werden. Jeder Harness hat seine eigene native Sitzung innerhalb derselben Bewerbung; Gesprächskontext wird nicht zwischen Harnesses übertragen. Providerwahl und Sitzungen bleiben nach Neustart erhalten. Kopieren übernimmt weder Providerwahl noch Sitzungsidentität.

Codex verwendet den echten gepinnten T3-App-Server-Client über stdio, nicht die T3-Server-API. `data/codex/<Bewerbung>/` enthält eine getrennte native Codex-Home mit eigener Konfiguration und Sitzungen; `auth.json` ist ein Verweis auf die vorhandene native Anmeldung. Die App liest/kopiert keine Tokeninhalte. Ein benanntes Berechtigungsprofil erlaubt native Dateizugriffe nur lesend im jeweiligen Arbeitsbereich, ohne Werkzeug-Netzwerk. Shell, Subagents, MCP/Apps und fremde Skills sind nicht eingebunden. Native Shell-/Patch-/Sandbox-Erweiterungen werden **abgelehnt**, nicht automatisch genehmigt. Änderungen laufen ausschließlich über `bewerbung_write` mit sichtbarer Einzelentscheidung; `bewerbung_read` und `bewerbung_write` prüfen die Dokument-Allowlist. `application.json` ist nur lesbar. Es gibt kein „für Sitzung erlauben“.

Codex-Initialisierung/Resume prüft Provider-Thread-ID, Arbeitsverzeichnis, eigenen Sitzungsdateipfad und bestätigte Berechtigungsrichtlinie. Ein fremder Thread wird nicht fortgesetzt. Der Codex-Prozess und sein nativer Tool-Host sind vertrauenswürdige Hostprogramme; dies ist keine Behauptung einer vollständigen OS-Sandbox für diese Prozesse selbst.

Geprüft mit vorhandener Anmeldung: Pi `openai/gpt-6.1-sol`, Codex `gpt-6.1-sol`; Streaming, Resume, Stoppen und erlaubte/abgelehnte Schreibanfragen. Der Modellkatalog ist keine allgemeine Zusage der Kontofreigabe: frühere Pi-Anfragen an `gpt-4.1-mini` und `gpt-5.4-mini` wurden vom ChatGPT-Zugang abgelehnt. Claude wird nicht angeboten.

Umfangreiche strukturierte CV-Formulare fehlen weiterhin; Inhalte werden im Lua-/TeX-Editor bearbeitet, Metadaten im Formular. Kein automatischer Versand und keine Löschfunktion für Bewerbungen. Lange gespeicherte Chatverläufe werden vollständig seitenweise geladen und mit laufenden Ereignissen ohne Duplikate zusammengeführt.

## Betrieb und Backup

Voraussetzungen: Node 22.23.2, Docker sowie vorhandenes Pi und Codex. Host-Node wurde nicht geändert.

```sh
cd /home/redjoker/workspace/containers/bewerbung
npm ci
npm run check && npm test && npm run build
systemctl --user restart bewerbung.service
systemctl --user status bewerbung.service
```

Nur diesen Dienst neu starten, nicht T3. `bewerbung.service` ist unter `~/.config/systemd/user/` verlinkt und aktiviert. `PORT` und `DATA_DIR` sind überschreibbar; Standard ist `3119` bzw. `./data`.

`data/` enthält `bewerbung.sqlite` einschließlich WAL/SHM, Vorlagen, Bewerbungsdateien, zentrale Anlagen (`documents/`), native Pi-/Codex-Sitzungen sowie Build-Eingaben/-Ausgaben. Einstellungen, geöffnete Bewerbungen, Chatentwürfe und Anlagenverweise liegen in derselben SQLite. Beim Update werden fehlende Organisationstabellen ergänzt; vorhandene Bewerbungen und native Sitzungen werden nicht neu angelegt. Beim Sichern Symlinks erhalten, **nicht dereferenzieren**: Codex verweist auf die vorhandene native Anmeldung außerhalb der App. Für konsistente Sicherungen den Bewerbungsdienst stoppen, **das gesamte Verzeichnis** kopieren und anschließend wieder starten. Rücksicherung nur bei gestopptem Dienst; Rechte 0700/0600 beibehalten. Dazu Quellcode, Lockfile und das Docker-Image sichern:

```sh
docker save bewerbung-tex:2026-11-16 -o bewerbung-tex.tar
```

Der Builder verwendet die konkrete Image-ID aus `builder/image-id`, nicht einen beweglichen Tag. Neuaufbau: `docker build --network host -t bewerbung-tex:2026-11-16 builder`, anschließend `docker image inspect bewerbung-tex:2026-11-16 --format '{{.Id}}' > builder/image-id`. Host-Netz nur beim Paketdownload; Dokument-Builds laufen mit `--network=none`, read-only Root/Inputs, ohne Capabilities/Shell-Escape, als Nutzer, mit PID-/CPU-/RAM-/Dateigrößen- und 120-Sekunden-Limit. Temporäre Schreibbereiche sind begrenzte tmpfs. Systemfonts müssen lesbar sein (`openin_any=a`); es sind keine Host-Geheimnisse in den Container gemountet.

## Caddy – angewendet

Innerhalb des vorhandenen `handle @netbird` im **443-Hostblock**, vor dem T3-Fallback:

```caddy
@bewerbung path /bewerbung /bewerbung/*
handle @bewerbung {
    reverse_proxy 127.0.0.1:3119 {
        flush_interval -1
    }
}
```

Kein `handle_path`: Das Prefix bleibt erhalten. Am 16.11.2026 autorisiert angewendet; bestehende NetBird-Quell-/Zielprüfung, `/interface`, T3-Fallback, 403-Fallback und Port 8443 unverändert. Backup: `/containers/caddy/backups/Caddyfile.before-bewerbung-20261116-191623`. Erfolgreich validiert und heiß geladen:

```sh
docker exec caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```

T3 wurde nicht neu gestartet. HTTPS-App, Assets, API, SSE und echte PDF-/ZIP-Downloads geprüft; fremde Quelle oder falsche Zieladresse weiterhin 403. Einzelheiten und Grenzen stehen in der Verifikation.

Quellherkunft: [PROVENIENZ.md](PROVENIENZ.md). Prüfungen: [VERIFIKATION.md](VERIFIKATION.md).
