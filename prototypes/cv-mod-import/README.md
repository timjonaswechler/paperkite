# Prototyp: Lebenslauf-Vorlage hochladen und Adapter erstellen

**Branch:** `prototype/cv-mod-import`. Der Upload-/Adapter-Ablauf ist inzwischen auch in die normale App und deren Dokument-Editor eingebunden; Bedienung und Grenzen stehen in der [Hauptanleitung](../../README.md#eigene-lebenslauf-vorlagen). Diese Seite beschreibt den weiterhin getrennten Entwicklungsstart mit eigenen Daten unter `.work/`, nicht die zentrale Master-CV-Verwaltung. Der akzeptierte HTML-Referenzstand bleibt unverändert.

## Ablauf

LaTeX-ZIP → Dokumenttyp **Lebenslauf-Vorlage** → **Hochladen & KI starten** → eigener nativer T3-Thread → Mod-Artefakt → isolierte Testbuilds → PDF-Vorschau und Prüfstatus.

Das ZIP allein startet keine KI. Der ausdrücklich beschriftete Startknopf lädt zuerst hoch und startet anschließend den Auftrag. Jeder Import besitzt eine eigene private Arbeitskopie und einen dauerhaften Status; der native Thread legt keine Bewerbung an. Doppelter Start während eines aktiven Auftrags erzeugt keinen zweiten Thread. Nach Neustart wird ein unterbrochener Auftrag nicht automatisch mit einer neuen kostenpflichtigen Modellrunde ersetzt.

## Lokal auf srv starten

Voraussetzungen: vorhandene Node-/Docker-Installation, gültige app-eigene native Runtime sowie die bereits gepinnten Builder-/PDF-Images. Keine neue Hostinstallation erforderlich.

1. Im Projektverzeichnis `npm run prototype:cv-mods` ausführen. `DATA_DIR` und `T3CODE_HOME` dürfen dafür nicht vorgegeben sein.
2. `http://127.0.0.1:3170/bewerbung/api/prototype/cv-mods` auf srv öffnen. Diese Loopback-Adresse meint den Server, nicht den eigenen Mac. Für externen Zugriff ist eine ausdrücklich eingerichtete Vorschau/Tunnel nötig; Produktiv-Origin und Caddy werden nicht geändert.
3. Bei Bedarf die **nativen Einstellungen** der isolierten Prototyp-Runtime öffnen und Provider, Modell sowie Berechtigungsmodus konfigurieren. Produktive Einstellungen werden nicht kopiert oder überschrieben. Die bestehende normale Provider-Anmeldung kann über die vorhandene App-Home-Vorbereitung verwendet werden.
4. Dokumenttyp und ZIP auswählen, dann **Hochladen & KI starten**. Erst dieser Schritt löst eine echte, potenziell kostenpflichtige Modellrunde aus.
5. Bei „Antwort im Thread nötig“ den verlinkten nativen Chat öffnen. Nach Abschluss entstehen Prüf-PDFs. Nach einer bewussten Adapterüberarbeitung den vorhandenen Adapter erneut prüfen, statt automatisch einen neuen Thread anzulegen.

Eigene Daten liegen standardmäßig unter `.work/cv-mod-import/`. `MOD_PROTOTYPE_DIR` darf nur auf einen Unterordner von `.work/` zeigen. `MOD_PROTOTYPE_PORT` ändert den öffentlichen Prototyp-Port; die beiden internen Ports sind jeweils +1/+2. Der Start übernimmt niemals `data/` oder die installierte separate T3-Instanz. Native CLI-Aufrufe benutzen ausschließlich das eigene Prototyp-Home. Die Modellwerkzeuge und Berechtigungsmodi bleiben nativ; keine eigene Tool-Allowlist.

Die Prototyp-Endpunkte akzeptieren nur die eigene native Gateway-Sitzung, keine fremden/reduzierten API-Tokens, die sonst über den lokalen CLI-Aufruf zusätzliche Rechte erhalten könnten. Das ist eine begrenzte Einbenutzer-Prototyp-Anbindung, noch keine allgemeine Mehrbenutzer-/Token-Delegation.

## Artefakte und Prüfung

Unter `.work/cv-mod-import/mod-imports/<id>/`:

- `original.zip`: unverändertes Uploadpaket; privat, nicht ins Repository übernehmen.
- `workspace/source/`: geprüfte Quellen ohne macOS-Metadaten, Buildausgaben und Archivbestand.
- `workspace/ADAPTER-CONTRACT.md`: der experimentelle Daten-/Ausgabevertrag für den Thread.
- `workspace/mod/`: vom nativen Thread erzeugtes Mod-Paket mit `mod.json` und LaTeX-Dateien.
- `builds/<build-id>/<fall>/`: feste Mod-/Datensnapshots sowie PDF und begrenztes Buildlog.

Der Host führt keinen generierten Host-Adapter aus. LuaLaTeX läuft ohne Netzwerk/Shell-Escape im bestehenden eingeschränkten Docker-Builder. Die Daten werden als technische Literal-Lua-Datei über `CV_DATA_FILE` eingelesen. PDF-Text wird im gepinnten PDF-Image extrahiert.

Die festen synthetischen Fälle prüfen mehrere Einträge, Stichpunkte, Fließtext mit Sonderzeichen, gemischte Blockreihenfolge und leere Abschnitte ohne erzwungenes Kurzprofil. Eine optionale Rolle wird nur getestet, wenn der Mod dieses Feld deklariert; andernfalls erscheint ausdrücklich „Nicht deklariert“, nicht ein vorgetäuschter Erfolg. Fehlende Textmarker, geänderte Originalquellen, Symlinks oder während der Prüfung veränderte Mod-Dateien verhindern den Status „Zur Durchsicht“.

„Zur Durchsicht“ bedeutet bestandene begrenzte Prototypprüfungen, keine garantierte Vollständigkeit oder Layoutfreigabe. Die PDF-Vorschau und eine spätere produktive Aktivierung sind getrennte Schritte. Alte Prüf-PDFs bleiben feste Snapshots, auch wenn im Thread danach weitergearbeitet wird.

## Grenzen dieses Standes

- Zunächst ausschließlich LuaLaTeX und die experimentelle Mod-ABI v1, keine Zusage für jedes LaTeX-Projekt.
- Der isolierte Start legt keine produktiven Bewerbungs-CVs an und importiert private Inhalte nicht in einen Master-Datensatz; die normale App besitzt inzwischen die Dokument-Editor-Anbindung.
- Keine Inhaltsvarianten, Rollenprofile oder Pflicht-Rollen-/Kurzprofilfelder.
- Die eigenständige Prototypoberfläche aktiviert keine produktive Bewerbung; die normale App kann geprüfte Versionen auswählen. Ein sicheres Teilen/Exportieren ist nicht umgesetzt, eigene Uploads können private Daten und Assets enthalten.
- ZIP: maximal 8 MiB komprimiert, 32 MiB entpackt, 200 Mitglieder, 4 MiB je übernommener Datei; keine ZIP64-, verschlüsselten oder Symlink-Pakete. Nur die implementierten LaTeX-/Lua-/Asset-Dateitypen, noch kein universeller Projektimport.
- Fehlende Schriften/Packages werden nicht global nachinstalliert oder still ersetzt. Im bereitgestellten privaten `cv.zip` ist SourceSans3 nicht enthalten; dieses Paket wurde nicht für eine bezahlte Adapterrunde oder als Testfixture verwendet.

## Beobachtete Verifikation

- Root-Typecheck sowie Unit-/Integrationstests, darunter echte Offline-LuaLaTeX-PDFs ausschließlich aus einer synthetischen Testvorlage.
- Browserablauf mit ersetzter KI und ersetztem Builder: Dokumenttyp-Gate, abgewiesene PDF-Datei, genau eine Adaptererstellung, wiederladbarer Status, Mod-Felder, PDF-Endpunkt und mobile Breite.
- Isolierter Start mit echter nativer Runtime und funktionierender Gateway-Autorisierung, ohne Thread-/Modellstart und ohne Bewerbungen.
- CLI-Bridge mit ersetztem CLI-Prozess geprüft: eigenes Home, lokales Projekt, keine Worktree-/Modell-/Berechtigungsüberschreibungen. **Eine echte KI-Adaptererstellung wurde noch nicht ausgeführt.**

Prüfberichte liegen unter `.work/cv-mod-prototype-start/`. Der erste parallele Sidebar-Regressionslauf lief beim Laden in ein Zeitlimit; der anschließende serielle Lauf bestand ohne Code- oder Erwartungsänderung.

`SMOKE_SYNTHETIC=1 node --import tsx scripts/smoke-cv-mod-prototype.ts` prüft den isolierten Browserablauf. `node scripts/render-cv-mod-prototype.mjs` erzeugt eine selbständige Vorschau unter `.work/cv-mod-prototype-start/preview.html`; diese ist sichtbar als **Demo · KI und Builds simuliert** markiert und startet keine Modelle.
