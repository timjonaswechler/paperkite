# Verifikation – T3-UI-Neuaufbau, 16.11.2026

**VERIFIED für die beschriebenen isolierten Prüfungen.** Die Oberfläche verwendet die in [PROVENIENZ.md](PROVENIENZ.md) abgegrenzten tatsächlichen T3-Komponenten und Tiptap-Extraktionen. Das ist keine Behauptung vollständiger Pixelgleichheit mit der privat installierten T3-Version.

**Produktiv ausgerollt** unter `https://srv.devices.teejayslab.de/bewerbung/`. Nur `bewerbung.service` neu gestartet. Alle vorhandenen Tabelleninhalte sowie Bewerbungs-, Master- und Builddateien vor dem Start bytegleich/fingerprintgleich erhalten; fünf vorhandene Bewerbungen waren bei der Bereitstellung inaktiv. Konsistente Sicherung einschließlich alter Abhängigkeiten: `backups/redesign-20261116T222552Z/`.

Nach dem Rollout im Produktiv-Quellordner erneut erfolgreich: Typecheck und **24/24 Tests** mit getrennten temporären Daten. Geschütztes HTTPS liefert neue HTML-/JS-/CSS-Assets, Organisations-APIs und den ursprünglichen CV. Bestehende T3-/Interface-Routen 200, Off-NetBird 403, Caddyfile-Hash unverändert. Der Dienst bindet weiterhin ausschließlich `127.0.0.1:3119`. Neue Assets: `index-D7v_0mrO.js`, `index-BJviNHFd.css`. Ein zusätzlicher Chromium-Check über das echte HTTPS bestätigt neue Sidebar/Formular, vorausgewähltes `general`, Abbrechen ohne neue Bewerbung und keine Browser-JS-Fehler.

## Umfang und Grenzen

Bewerbungen statt Workspace-/Git-Threads, sechs fachliche Statusgruppen, geöffnete Bewerbungen darüber, Rechtsklickaktionen, neues Formular, Suche, Einstellungen, zentral hochgeladene Anlagen und separater Quelleneditor. Chat ist der Hauptbereich; PDF/Build/Anlagen befinden sich in der rechten Unterlagen-Seitenleiste. Kein Git/PR/Pairing, keine Platzhalter-Anbieter, keine Shell-Freigaben, keine Änderung installierter T3-/Pi-/Codex-Programme oder ihrer Zugangsdaten.

Alle neuen Laufzeitprüfungen verwenden eigene temporäre Daten auf srv. Keine Testbewerbungen im produktiven Bestand. Für den Original-CV wurde ausschließlich der unveränderliche Master gelesen und in getrennten Daten gebaut. Keine Mac-Originaldatei wurde geändert.

## Beobachtete Prüfungen

| Prüfung | Ergebnis |
|---|---|
| `npm run check` | Erfolgreich einschließlich Frontend, Backend, gemeinsamem Vertrag und Smoke-Skripten |
| `npm test` | **24/24**, keine Skips. Vorhandene Sicherheits-/Quoten-/Verlaufstests erhalten; alte HTTP-Anlegefixtures um das neue Pflichtfeld Rolle ergänzt |
| `npm run build` | Erfolgreich; tatsächlicher Tiptap-/Base-UI-Bundle, etwa 1,2 MB minifiziert. Keine Bundlegrößen-Optimierung behauptet |
| `scripts/smoke-browser.ts` → `smoke-redesign.ts` | Chromium 1440×1000 und 390×844: Abbrechen ohne Anlegen, Anlage/Kopie ohne Master, bevorzugtes `general`, Status unabhängig von Öffnen/Schließen, direkte URL wieder geöffnet, Tastatursuche, echte Kontextmenüs, Auswahl/Upload/Umbenennung und geschütztes Entfernen von Anlagen, Hell/Dunkel, Enter-Einstellung, getrennte Entwürfe einschließlich sofortiger Navigation/Reload, Quelleneditor und unabhängige Kopie, CV-Einträge anhängen/teilweise ersetzen, echter Anschreiben-Build, PDF/Festhalten/Downloads. Keine Browser-JS-Fehler |
| Derselbe Browserflow mit `SMOKE_HARNESS=codex` | Echter Modellkatalog und `gpt-6.1-sol`, sichtbare Einzelfreigabe vor Dateierzeugung, Ablehnung ohne Datei, einmalige Zustimmung mit exakten Bytes, Interrupt und geleerter abgesendeter Entwurf |
| Pi-Browserprüfung plus `scripts/smoke-approvals-ui.ts` | Echter Pi-Katalog/Streaming mit `openai/gpt-6.1-sol`; fachlicher Auftrag für leere CV-Alternativprofile: sichtbare technische Freigabe, Ablehnung ohne Datei, Genehmigung/exakte Bytes, Interrupt und Entwurfsleerung |
| `scripts/smoke-resume-ui.ts`, je Pi/Codex | Vollständiger Testserver-Prozess beendet und mit derselben Datenablage neu gestartet. Modell erinnerte den zuvor zufällig erzeugten genehmigten Dateipfad ohne Werkzeugaufruf; Antwort im neuen Chat sichtbar, kein duplizierter Verlauf |
| `scripts/smoke-history.ts` | Abschlussnachricht hinter mehr als 10.000 gespeicherten Ereignissen nach Navigation und Reload jeweils genau einmal sichtbar |
| `scripts/smoke-restart.ts` | Eigener vollständiger Node-Neustart erhält Metadaten, Dateien und einzelne übernommene CV-Einträge; Quellbytes bleiben unverändert |
| `scripts/smoke-build.ts` | Reale isolierte LuaLaTeX-/pdfLaTeX-Builds, je zwei Durchläufe; echter Compilefehler ersetzt den letzten guten Stand nicht |
| `scripts/smoke-original-template.ts` plus lokale Poppler-Prüfung | Alle 38 Masterdateien unverändert, `general` gewählt, realer CV und neutrales Anschreiben gebaut. CV: **2 A4-Seiten, 1.497.282 Bytes, fünf eingebettete SourceSans3-Varianten mit Unicode-Zuordnung**. `pdftotext -layout` bytegleich mit dem bereits geprüften Referenz-CV |

Die nativen Modelltests verbrauchen echte Kontingente, übertragen aber ausschließlich synthetische Inhalte. Ein Modell kann einen Testauftrag zunächst verbal beantworten oder als nicht fachlich passend ablehnen; das wurde nicht als Freigabe gewertet. Die tatsächlichen technischen Pi-Freigaben wurden mit einem fachlichen CV-Auftrag geprüft. Shell-/Native-Eskalationsgrenzen wurden nicht aufgeweicht.

Screenshots von Sidebar, Formular, Suche, Kontextmenü, Einstellungen, Chat, Quelleneditor und Unterlagen wurden mit den gelieferten Referenzen und den extrahierten Präsentationsgrenzen verglichen. PDF-Bytes und Downloads sind geprüft; Chromium Headless Shell zeigt den nativen PDF-Plugin-Inhalt nicht. Eine Pixelabnahme des PDF-Viewers im persönlichen Browser wird deshalb nicht behauptet; der Öffnen-Link bleibt als Fallback verfügbar.

## Zusätzliche Daten- und Fehlerverträge

- Zentraler Speicher: PDF/JPG/PNG anhand Dateikopf und Endung, 25 MiB je Datei, SHA-256-Deduplizierung, 1 GiB Bibliothek. Auswahl genau 100 MiB akzeptiert, 125 MiB vor Mutation abgelehnt; identische/fehlende IDs und veraltete Revisionen ändern weder Auswahl noch Bewerbungsrevision. Die 1-GiB-Abrechnung verwendet eine explizite Größenfixture, keinen zusätzlichen Gigabyte-Testdownload.
- Anlagen pro Bewerbung unabhängig ausgewählt; gemeinsame Datei nicht dupliziert. Erfolgreiche Build-ZIPs behalten die damalige Auswahl trotz späterem Wechsel/Umbenennen. Solche Referenzen verhindern Entfernen. Fremder Build unter einer anderen Bewerbung liefert 404.
- Das Versandpaket enthält ausschließlich letzte erfolgreiche PDFs und aktuelle Anlagen. Exakte ZIP-Eintragslisten geprüft: keine internen Quellen, `application.json`, Notizen oder Buildlogs. Quellen-ZIPs sind getrennt und entsprechend beschriftet.
- Binär-Upload verlangt den Request-Header und behält Host-/Origin-/Cross-Site-Prüfung bei. HTML unter PDF-Namen, falsche MIME-/Endungskombination, Übergröße und fremde Origin abgelehnt. Downloads senden `nosniff` und korrekten Typ.
- Einstellungen verwenden Revisionskonflikte; geöffnete Bewerbungen und Chatentwürfe ändern keine fachliche Revision. Alte Datenbankfixture erhält unveränderte Bewerbungsdaten, Quelldateien und native Sitzungsidentität.
- Kopieren übernimmt keine Sitzung, Providerwahl oder gespeicherten Chatentwurf. Das globale Standard-Harness wird nur für neu angelegte Bewerbungen gesetzt. CV-only-Übernahme kopiert keine alten Firmen-/Ausschreibungs-/Notizdaten oder Anlagen; Anschreibenübernahme ist ausdrücklich gewählt.
- Gespeicherte Modellnamen werden ohne Start eines Harnesses angezeigt. Ein zusätzlicher Test scheiterte zuvor mit `undefined` statt des gespeicherten Codex-Modells; nach Korrektur werden die unterschiedlichen Pi-/Codex-Modelle korrekt angezeigt, Kopien bleiben ohne geerbtes Modell. Der Pi-Picker erkennt auch qualifizierte `provider/model`-IDs.
- Suchtests unterscheiden Unternehmen/Rolle/Notiz/Ausschreibung und fertige Chatnachrichten von flüchtigen Deltas und ungesendeten Entwürfen; Sonderzeichen sind wörtlich, Statusfilter fachlich.
- Bisherige 16-MiB-Arbeitsbereichsgrenze, native Pi-Edit-/Write-Operationen, Einzelfreigaben, Pfad-/Symlink-/Eigentümergrenzen, Lua-Literalparser und vollständige Verlaufspaginierung bleiben abgesichert. Keine Assertions zum Erreichen grüner Checks entfernt oder abgeschwächt.

`npm audit` meldet drei bereits vorhandene Abhängigkeitshinweise: esbuild (low), fflate (moderate, ZIP64-`unzipSync`) und Vite (high, unter anderem Devserver). Es läuft kein Vite-Devserver; der produktive Server entpackt keine ZIP-Uploads. Diese Alt-Pins wurden nicht in eine zusätzliche Abhängigkeitsmodernisierung einbezogen. Das ist keine allgemeine Sicherheitsfreigabe.

## Betrieb und Rücksicherung

Vor dem Rollout werden ursprüngliche Quellhashes, neue Pfadkollisionen und aktive Harnesses/Freigaben/Builds geprüft. Nur `bewerbung.service` wird gestoppt. Die konsistente vollständige Datenkopie erhält Symlinks ohne Dereferenzierung; alte Quellen, Assets und Abhängigkeiten bleiben im privaten Backup. Die additive Migration wird bei gestopptem Dienst gegen Fingerprints aller vorhandenen Tabellen und Quell-/Builddateien geprüft. Bereits geöffnete Browser behalten ihre alten Asset-Hashes; neue HTML-Assets werden anschließend ausgeliefert. Keine automatische Browseraktualisierung, die offene Eingaben verwerfen würde.

Caddy/NetBird bleiben unverändert. Ursprünglicher geschützter Routen-Backupstand: `/containers/caddy/backups/Caddyfile.before-bewerbung-20261116-191623`; Caddyfile-SHA-256 `40c699cd39f57cf93c655ef16a96bb0bd115dabb9f8b60f37b0716f8304a211d`.

Keine Commits/Pushes, keine Änderung der vorhandenen Bewerbungen durch Testfixtures. Die früher wegen abweichender Revision erhaltene Importprüfungs-Bewerbung wird weiterhin nicht bereinigt.

## Nicht behauptet

Keine vollständige OS-Sandbox für native Harness-/Tool-Host-Prozesse, keine automatische E-Mail, keine Vollformulare für sämtliche CV-Inhalte und keine Bewerbungslöschung. Keine statistische AI-Wasserzeichenprüfung oder Garantie gegen AI-Erkennung. Kein umfassender Fuzz-/Penetrationstest, kein End-to-End-SIGKILL-Test während offener Freigaben und keine exakte Gleichheit mit privaten T3-Änderungen. Native Shell bleibt bewusst nicht verfügbar.
