# Verifikation – Bewerbungsabläufe und lokale PDF-Werkzeuge

## Erweiterung vom 17.11.2026

**Isolierte Prüfung erfolgreich: Typecheck, Build und 32/32 Tests ohne Skips.** Keine produktiven Bewerbungen oder Uploads als Testfixtures verwendet. Alle ursprünglichen Sicherheits-, Quoten-, Freigabe- und Verlaufstests bleiben erhalten; keine neuen Abhängigkeiten im Node-Projekt. Die drei Kopfbereich-Schaltflächen wurden bewusst nicht umgestaltet.

- Browser: Entwürfe ohne Gruppe/Badge ganz oben, vereinfachtes Anlegen/Kopieren und Bearbeiten, Entfernen des Pi-/Codex-Hinweises, Tags/Filter, Vorlagenbenennung/Standard/Kopie/Export/Löschung und neue Vorlage aus Bewerbung. Löschdialog mit Abbrechen, Revisionskonflikt und bestätigtem Entfernen; gemeinsame Dateien bleiben erhalten. Desktop-/Mobilabläufe ohne Browser-JS-Fehler.
- PDF-Oberfläche: Reihenfolge, Seitenvalidierung, Kompressionswarnung, Download und Ablage als neue Datei; gespeicherte Abwahl bleibt beim Wiederöffnen bestehen. Globaler Auftrag ist nach Schließen über die Historie wieder erreichbar. Versand-/Quellen-ZIPs bleiben getrennt und inhaltlich unverändert geprüft.
- Echte Offline-Werkzeuge mit synthetischen TeX-/Bildquellen: unabhängige Seitenmarker belegen Reihenfolge `BRAVO-2, ALPHA-3, ALPHA-1`; keine ungewählten Seiten. Text nach kompakter Verarbeitung weiter durchsuchbar und in gleicher Reihenfolge. Verlustfreie Bildeinbettung pixelgleich zur Quelle, kompakter hochauflösender Testscan kleiner und A4. Kennwortgeschützte/beschädigte PDFs und ungültige Seitennummern führen zu Fehlern, nicht zu geänderten Originalen oder verlorenen guten Ergebnissen.
- Echte Pi-/Codex-Prozesse ohne Modellinferenz: zwei unabhängige Katalogsitzungen geöffnet, eine Bewerbung geschlossen/gelöscht; die andere Sitzung bleibt mit identischer nativer Identität nutzbar. Keine neue kostenpflichtige Modellrunde; bestehende Freigabe-/Resume-Nachweise stehen im historischen Abschnitt unten.
- Unit-/HTTP-Verträge: Tagvalidierung vor Mutation, Vorlagen-/Kopienunabhängigkeit, Löschgrenzen einschließlich Auth-Symlink-Zielen und durablem Neustart-Cleanup, unveränderliche PDF-Eingabekopien, deduplizierte Ergebnisablage, Plan-CAS/Ausschlüsse und Quellenbesitz. Fehler von Renderer, Benachrichtigung oder temporärer Dateibereinigung dürfen spätere Aufträge nicht blockieren.

Runtime: qpdf **12.2.0**, Ghostscript **10.05.1**, img2pdf **0.6.1**, Pillow **11.1.0**. Image-ID: `sha256:94b892b760e9e2af2fa4c160c33aaa02d38cbef32e0ff16b748dfcd6b56cd614`; `pdf-tools/image-id` bindet den tatsächlichen Containerstand. Docker ohne Netzwerk, beschreibbares Root oder Host-Geheimnisse; Ressourcen-/Zeitgrenzen in `server/pdf-runner.ts`. Keine Garantie für Signaturerhalt, beliebige PDF-Sonderfunktionen oder eine bestimmte Dateigröße. PDF-Plugin-Pixelabnahme im persönlichen Browser bleibt unbehauptet.

Reproduzierbare Prüfaufrufe im Quellordner:

```sh
npm run check && npm test && npm run build
node --import tsx scripts/smoke-frontend-logic.ts
node --import tsx scripts/smoke-pdf-tools.ts
node --import tsx scripts/smoke-delete-sessions.ts
```

Browserprüfung nur gegen separat gestartete, leere Testablage: `SMOKE_ORIGIN=http://127.0.0.1:<Testport> SMOKE_SYNTHETIC=1 node --import tsx scripts/smoke-redesign.ts`. Das Skript verweigert Nicht-Loopback-Ziele; `SMOKE_HARNESS` nicht setzen, wenn keine Modellinferenz gewünscht ist.

### Bereitstellung

Produktiv am 17.11.2026 ausgerollt; nur `bewerbung.service` neu gestartet. Konsistenter vorheriger Quell-/Daten-/Abhängigkeitsstand: `backups/workflow-20261117T115007Z/previous/`. Fingerprints belegen unveränderte Inhalte aller vorhandenen Tabellen und **1.054** Laufzeitdateien/Symlinks; **6 Bewerbungen, 13 zentrale Dokumente und 2 Vorlagen** erhalten. Neue Funktionen ergänzen ausschließlich eigene Tabellen. Quellenmanifest und Vorher-/Nachher-Fingerprints liegen in derselben Sicherung.

Nach dem Rollout erneut: Typecheck und **32/32 Tests** mit temporären Daten erfolgreich. Geschützter HTTPS-Browsercheck bestätigt Sidebar, vereinfachtes Formular, Abbrechen und Vorlagenverwaltung ohne JS-Fehler; sämtliche mutierenden Browserrequests waren dabei technisch gesperrt und keiner wurde versucht. Bewerbung, T3-Root und `/interface` liefern 200; außerhalb NetBird 403. Bindung weiterhin `127.0.0.1:3119`, Caddyfile-Hash unverändert. Keine weiteren Commits/Pushes und keine Löschung oder PDF-Verarbeitung vorhandener Nutzerinhalte.

## Historischer T3-UI-Neuaufbau, 16.11.2026

**VERIFIED für die beschriebenen isolierten Prüfungen.** Die Oberfläche verwendet die in [PROVENIENZ.md](PROVENIENZ.md) abgegrenzten tatsächlichen T3-Komponenten und Tiptap-Extraktionen. Das ist keine Behauptung vollständiger Pixelgleichheit mit der privat installierten T3-Version.

**Produktiv ausgerollt** unter `https://srv.devices.teejayslab.de/bewerbung/`. Nur `bewerbung.service` neu gestartet. Alle vorhandenen Tabelleninhalte sowie Bewerbungs-, Master- und Builddateien vor dem Start bytegleich/fingerprintgleich erhalten; fünf vorhandene Bewerbungen waren bei der Bereitstellung inaktiv. Konsistente Sicherung einschließlich alter Abhängigkeiten: `backups/redesign-20261116T222552Z/`.

Nach dem Rollout im Produktiv-Quellordner erneut erfolgreich: Typecheck und **24/24 Tests** mit getrennten temporären Daten. Geschütztes HTTPS liefert neue HTML-/JS-/CSS-Assets, Organisations-APIs und den ursprünglichen CV. Bestehende T3-/Interface-Routen 200, Off-NetBird 403, Caddyfile-Hash unverändert. Der Dienst bindet weiterhin ausschließlich `127.0.0.1:3119`. Neue Assets: `index-D7v_0mrO.js`, `index-BJviNHFd.css`. Ein zusätzlicher Chromium-Check über das echte HTTPS bestätigt neue Sidebar/Formular, vorausgewähltes `general`, Abbrechen ohne neue Bewerbung und keine Browser-JS-Fehler.

## Umfang und Grenzen

Damals: Bewerbungen statt Workspace-/Git-Threads, sechs fachliche Statusgruppen, geöffnete Bewerbungen darüber, Rechtsklickaktionen, neues Formular, Suche, Einstellungen, zentral hochgeladene Anlagen und separater Quelleneditor. Chat ist der Hauptbereich; PDF/Build/Anlagen befinden sich in der rechten Unterlagen-Seitenleiste. Kein Git/PR/Pairing, keine Platzhalter-Anbieter, keine Shell-Freigaben, keine Änderung installierter T3-/Pi-/Codex-Programme oder ihrer Zugangsdaten.

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

Beim damaligen UI-Rollout keine Commits/Pushes, keine Änderung der vorhandenen Bewerbungen durch Testfixtures. Der anschließend ausdrücklich beauftragte initiale Git-Commit ist `8a353a1`; für die Erweiterung wurde kein weiterer Commit oder Push erstellt. Die früher wegen abweichender Revision erhaltene Importprüfungs-Bewerbung wird weiterhin nicht bereinigt.

## Nicht behauptet

Keine vollständige OS-Sandbox für native Harness-/Tool-Host-Prozesse, keine automatische E-Mail, keine Vollformulare für sämtliche CV-Inhalte. Keine statistische AI-Wasserzeichenprüfung oder Garantie gegen AI-Erkennung. Kein umfassender Fuzz-/Penetrationstest, kein End-to-End-SIGKILL-Test während offener Freigaben und keine exakte Gleichheit mit privaten T3-Änderungen. Native Shell bleibt bewusst nicht verfügbar.
