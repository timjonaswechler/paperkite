# Zielarchitektur: Upstream-first mit eigenständiger Produktschicht

**Status: gemeinsam festgelegt; Schritt 2 abgeschlossen.** Bestätigt sind das Quell-Overlay mit zunächst realen Kopien und Datei-Overrides sowie ein app-eigener Serverprozess für Fachlogik und native T3-Laufzeit. Dieses Dokument ist die maßgebliche Architekturentscheidung, keine Behauptung einer bereits implementierten oder funktionsfähig nachgewiesenen Zielarchitektur. Die [Quellbefunde](t3-integration.md) begründen die Entscheidung; Schritt 3 wurde separat freigegeben; sein aktueller Stand steht in Abschnitt 9.

## 1. Bereits festgelegter Auftrag

Paperkite wird im eigenen Branch und Worktree neu aufgebaut. Die bisherige Anwendung, ihre Daten und die installierten T3-Versionen bleiben unberührt.

- T3 bleibt eine unveränderte, versionierte Grundlage. Eigene Funktionen und notwendige Integrationsänderungen liegen in unseren Quellen.
- Nach einem bewussten T3-Update sollen unverändert verwendete Teile ohne manuelles Übertragen aktualisiert werden. Eigene Anpassungen bleiben klein und auffindbar.
- Paperkite soll später eigenständig weiterentwickelt werden können; der Fork muss dafür archiviert werden können, ohne Herkunft und reproduzierbare Quellen zu verlieren.
- T3s relevante Toolchain, Qualitätsregeln, Entwicklungsabläufe und Dokumentationskonventionen gelten auch für unsere Quellen.
- Nicht benötigte native Funktionen müssen gezielt nicht angeboten beziehungsweise tatsächlich deaktiviert werden können. Die Architektur muss dafür geeignete Grenzen besitzen.
- Die Auswahl und Ausgestaltung der Produktfunktionen erfolgt in Schritt 4 gemeinsam mit Bestand und aktuellem Issue-Stand. Schritt 2 entscheidet beispielsweise nicht, ob interne Git-Checkpoints zum späteren Produkt gehören.

Ausgangspunkt ist der beim Neuaufbau gewählte offizielle T3-Commit `43a0e74fb97672caed8b92fc38fc832bda4a5628`; Quelle und Pin stehen in [upstream.json](../../integration/t3/upstream.json). Ein beweglicher Branch ist keine Produktversion.

## 2. Festgelegte Architekturentscheidung

**Ein eigener Paperkite-Server und Webclient verwenden die benötigten nativen T3-Module. Ein deklaratives Quell-Overlay verbindet beide beim Aufbau eines generierten Workspace.** Es wird weder die installierte T3-Anwendung erweitert noch die Chatengine nachgebaut.

Gemeinsam bestätigt wurden zwei Entscheidungen:

1. Ein generierter Workspace mit eigenen Ergänzungen und ausdrücklich erfassten Datei-Overrides. Zunächst reale Kopien im Buildoutput, Symlinks nur als optionale spätere Optimierung.
2. Ein app-eigener Serverprozess für unsere Anwendungsdienste und die eingebundene native Laufzeit. Keine zusätzliche fachliche API-Serverinstanz als Ausgangsmodell.

Die Implementierung bleibt an den Nachweis aus Schritt 3 gebunden. Falls T3s konkrete Kopplungen eine dieser Entscheidungen untragbar machen, wird dieser Befund zur Architekturentscheidung zurückgebracht; er ist keine Erlaubnis für einen stillen grundlegenden Umbau.

## 3. Projektstruktur und Verantwortlichkeiten

Der Zielaufbau ist nach Zuständigkeit getrennt. Nicht benötigte Verzeichnisse werden nicht vorab als leere Pakete angelegt.

```text
vendor/t3/                         Unverändertes, gepinntes Git-Submodul
apps/
  web/src/                         Eigene Oberfläche und Web-Einstiege
  server/src/paperkite/             Eigener Server-Einstieg und API-Anbindung
packages/
  paperkite-core/                  Eigene Fachlogik und Persistenzdienste
  paperkite-contracts/             Eigene fachliche Datenverträge
integration/t3/                    Zuordnung zu T3, Adapter, Overlay-Vertrag
  overrides/                       Notwendige bearbeitete T3-Dateien
  product-lock.yaml                Gemeinsamer Abhängigkeitsstand
tooling/                           Aufbau und Prüf-Einstiege
docs/{internals,operations,user}/   Architektur, Entwicklung/Betrieb, Nutzung
.github/workflows/                 Aktive Paperkite-Pipelines
.build/t3/                         Generierter, verwerfbarer Workspace
.local/                            Getrennte lokale Entwicklungsdaten
```

Die eigenen Pakete tragen Paperkite-Namen, damit sie beim Zusammensetzen nicht mit T3s vorhandenen Paketen kollidieren.

**Abhängigkeitsregeln:** Unsere Fachlogik und fachlichen Verträge importieren keine T3-internen Threadmodelle, Stores oder Provideradapter. Die Integration darf native APIs und Typen verwenden und übersetzt sie in unsere Verträge. Die App-Einstiege setzen eigene Dienste und Integration zusammen. T3-Quellen importieren unsere Funktionen nur über die ausdrücklich erfassten Integrationsänderungen; der Vendor selbst bleibt unverändert.

Fachliche Identitäten und Speicherung gehören Paperkite. Native Chatpersistenz bleibt bei T3; die Integration verwaltet Referenzen auf native Projekte und Threads. Eigene Bewerbungsfelder werden nicht in T3-interne Tabellen eingebaut. Konkrete fachliche Schemas und Wiederverwendungsabläufe gehören in Schritt 4.

## 4. Quell-Overlay und Änderungen an T3

Eigene neue Dateien werden additiv eingebunden. Vor einer Ersetzung wird geprüft, ob vorhandene Exporte, Zusammensetzung von außen oder ein Adapter genügen. Erforderliche Ersatzdateien werden in unseren Quellen bearbeitet, nicht im Vendor und nicht direkt im Buildoutput.

Der Overlay-Vertrag erfasst Quell- und Zielpfad, Begründung sowie den ursprünglichen Upstream-Commit und Datei-Hash. Unbeabsichtigte Kollisionen werden abgewiesen. Der generierte Workspace ist niemals eine zweite maßgebliche Quelle.

**Ausgangsvariante: Kopien im Buildoutput.** Der Generator kopiert den gepinnten T3-Stand und legt unsere Ergänzungen und Ersatzdateien darüber. Das dupliziert Dateien auf dem Datenträger, aber nicht den von uns zu pflegenden Quellbestand. Generatoren und Installer können so nicht durch einen Link in den Vendor schreiben.

**Symlinks:** Unveränderte Quellen könnten stattdessen auf den Vendor zeigen. Das spart Speicher und Kopierarbeit, verbessert aber den Updateabgleich nicht. Schreibbare Metadaten und generierte Dateien müssen weiterhin reale Kopien sein. Modulauflösung und Modulidentität von Node, Vite und Typprüfer müssen dabei nachgewiesen werden. Symlinks sind deshalb keine Voraussetzung für den ersten Nachweis und kein offener Architekturblocker.

Patch-Dateien oder weitreichende Resolver-Aliase werden nicht zusätzlich als zweite Anpassungsstrategie eingeführt. Wenn sich Datei-Overrides in Schritt 3 als ungeeignet erweisen, wird eine begründete Alternative vorgelegt.

## 5. Start, Funktionsgrenzen und Isolation

Der eigene Server-Einstieg setzt die benötigten nativen Dienste zusammen, statt den vollständigen Standardserver unverändert als Blackbox zu starten. Die Quellprüfung zeigt dafür fest verdrahtete Worker und RPC-Abhängigkeiten; fertige Erweiterungsschnittstellen für alle Bereiche werden nicht vorausgesetzt.

Eine zentrale Produktkonfiguration steuert die Integration an vier Grenzen:

- **Start:** Welche Dienste und Worker werden aufgebaut?
- **Operationen:** Welche Befehle und Schnittstellen sind ausführbar? Eine erforderliche Sperre greift vor Zustandsänderungen, nicht nur in einem UI-Einstieg.
- **Auskunft:** Welche Fähigkeiten meldet der Server tatsächlich als verfügbar?
- **Oberfläche:** Welche Navigation, Einstellungen und sonstigen Einstiege bietet Paperkite an?

Die vorhandene Anmeldung und native Berechtigungsprüfung bleiben erhalten. Verfügbarkeit ersetzt keine Autorisierung. Die konkreten Profilwerte und die endgültige UI werden hier nicht festgelegt.

Die Laufzeit muss gegenüber installierten T3-Builds getrennt sein:

- eigener absoluter Programmeinstieg, eigenes Datenhome, eigene Laufzeitdateien, Listener und Dienstverwaltung;
- kein Rückfall auf `~/.t3`, kein automatisches Seeding und keine Übernahme bestehender Sitzungen;
- kein versehentlicher Aufruf des globalen `t3` und kein Überschreiben installierter Binaries oder Dienste;
- native interne Hilfsaufrufe und Bridges bleiben an unseren Programmeinstieg gebunden;
- eigene Produktbeschränkungen verändern keine maschinenweite T3-Policy; bestehende administrative Beschränkungen werden nicht stillschweigend umgangen;
- Provider-Homes und Anmeldedaten werden ausdrücklich behandelt, nicht pauschal kopiert oder durch ein global umgeleitetes `HOME` vermeintlich isoliert.

Der gemeinsame Prozess spart zusätzliche Verbindungs- und Authentifizierungslogik. Er ist keine OS-Sandbox. Ein späterer separater Fachserver bleibt durch die Modulgrenzen möglich.

## 6. Abhängigkeiten, Entwicklungsregeln und Dokumentation

Der zusammengesetzte Workspace verwendet den versionierten Produkt-Lockstand unter `integration/t3/product-lock.yaml`. Er geht vom gepinnten T3-Stand aus und umfasst zusätzlich unsere Pakete. T3s Kataloge, Patches und Versionsvorgaben werden übernommen; das Original-Lockfile im Submodul wird nicht verändert. Der Installations-/Buildablauf löst keine neuen Versionen nebenbei auf.

Unsere Root-Regeln übernehmen die relevanten [T3-Entwicklungsregeln](../../vendor/t3/AGENTS.md), darunter Effect-Konventionen, native UI-Primitives, React Compiler und verhaltensorientierte Tests. Die Root-Pipeline prüft unsere Quellen und das tatsächlich zusammengesetzte Produkt. Sie umfasst Pin-/Vendor-Prüfung, Architekturgrenzen, Formatierung, Lint, Typprüfung, Tests, Generatoren, Kataloge, ungenutzten Code und den Produktionsbuild. Änderungen an unseren Quellen dürfen nicht durch upstreamspezifische Pfadfilter übersehen werden.

Upstreams Release-Infrastruktur, Secrets und Desktop-/Mobile-Veröffentlichungen werden nicht ungeprüft übernommen. Die technische T3-Dokumentation bleibt beim Original; unsere Dokumentation beschreibt eigene Architektur und Abweichungen. Tutorials und Betriebsanweisungen werden erst für tatsächlich verfügbare Abläufe geschrieben.

## 7. Aktualisieren und später unabhängig werden

Ein Update wählt einen neuen konkreten Commit. Daraus wird der Workspace mit unseren Quellen neu erzeugt. Unveränderte native Dateien stammen dadurch automatisch aus dem neuen Stand.

Für bearbeitete Ersatzdateien werden drei Fassungen verglichen: altes Upstream-Original, neues Upstream-Original und unsere Fassung. Eine konfliktfreie Zusammenführung kann als Vorschlag erzeugt werden; Konflikte verlangen Bearbeitung. Ein erfolgreicher Textmerge ersetzt keine Verhaltensprüfung. Produkt-Lockstand und Anpassungen werden zusammen mit dem neuen Pin versioniert und geprüft; kein automatisches Deployment folgt daraus.

Beim späteren Ausstieg werden die tatsächlich verwendeten T3-Teile einzeln weiterverwendet, übernommen oder ersetzt. Die Fachmodule benötigen dafür keine neue fachliche Identität oder von T3 abhängige Datenschemata. Gepinnte Quellen, Herkunft und Lizenzhinweise müssen weiterhin verfügbar bleiben. Das Archivieren eines Forks beendet nicht die Wartung übernommener Komponenten.

## 8. Abgrenzung und Abschluss von Schritt 2

Nicht beschlossen werden hier einzelne native Produktfunktionen, Bewerbungsabläufe, endgültige UI, Datenmigration oder Deployment. Aus einer technischen Kopplung folgt insbesondere keine Entscheidung, eine Funktion beizubehalten. Bestand und dann aktueller Issue-Stand werden in Schritt 4 gemeinsam behandelt.

Der vorhandene Code ist nicht allein durch seine Existenz eine Abnahme dieser Zielarchitektur. Für den nachfolgend freigegebenen Schritt 3 gelten weiterhin alle unten genannten Nachweise.

**Schritt 2 ist abgeschlossen.** Beide Entscheidungen aus Abschnitt 2 wurden bestätigt. Daraus folgt keine automatische Freigabe für Schritt 3, weitere Implementierung, Builds oder Produktentscheidungen aus Schritt 4.

Schritt 3 muss mit einem kleinen, isolierten Grundgerüst zeigen:

1. Eigene Oberfläche und ausgewählte native Chat-/Panelmechanismen funktionieren mit einem kostenlosen Test-/Replayprovider.
2. Der Integrationsmechanismus kann einen technischen Bereich tatsächlich sperren und korrekt als nicht verfügbar melden, einschließlich direkter Befehlswege. Das Testbeispiel ist keine endgültige Produktentscheidung.
3. Gleichzeitiger Betrieb berührt keine installierte T3-Laufzeit, deren Daten oder Dienstverwaltung.
4. Produktionsbuild und relevante Qualitätsprüfungen erfassen unser Produkt und lassen den Vendor unverändert.
5. Ein kontrollierter Wechsel zwischen zwei Upstream-Pins übernimmt unveränderte Quellen und behandelt eine eigene Anpassung nachvollziehbar.

Scheitert ein Nachweis, wird die Ursache eingegrenzt und eine erforderliche Architekturänderung ausdrücklich vorgelegt. Der Nachweis wird nicht durch veränderte Abnahmekriterien ersetzt.

## 9. Arbeitsstand von Schritt 3

Implementiert sind eigene Server- und Web-Einstiege, die Pakete `@paperkite/core` und `@paperkite/contracts` für Runtime-Policy und -Status, Integrationsadapter, ausdrücklich erfasste Datei-Overrides und der Produkt-Lockstand. Das Standardprofil `proof` richtet den kostenlosen nativen Replayprovider ein, beschränkt Provider-Treiber auf `acpRegistry` und sperrt explizite Settlement-Befehle sowie den zugehörigen Worker. Der Prüfbefehl `pnpm proof` wählt ausdrücklich den Replayprovider; das Profil ist keine Sandbox für beliebige zusätzlich konfigurierte ACP-Programme. Das ist ein technisches Testprofil, keine Entscheidung über die späteren Produktfunktionen.

Der aktuelle isolierte `pnpm proof` weist zwei getrennte Instanzen, lokale Anmeldungstrennung, zwei abgeschlossene Replayrunden ohne Dateisnapshots oder versteckte Git-Refs und eine Side-Chat-Verknüpfung nach. Settlement und PR-Verknüpfung werden vor Threadänderungen abgewiesen; entfernte Git-/Forge-/Issue-Methoden fehlen im Produkt-RPC-Vertrag. Ein frischer Web-/Serverbuild und der Browsernachweis mit dessen gebündelten Webdateien sind inzwischen erfolgreich. Chat, Datei-Picker, Skripteditor, Befehlspalette, Einstellungen und Side-Chat wurden in Chromium ohne JavaScript-Laufzeitfehler geprüft.

Die Git-Funktionen sind aus der aktiven Produktzusammensetzung entfernt. Die aktive Server-/Orchestrierungszusammensetzung konstruiert keine Git-/VCS-/Review-/Clone-/Worktree-/Repositorydienste mehr. Produkt-RPC, MCP und Web bieten diese Funktionen nicht mehr an. Ordner-/Scratch-Starts, gemeinsame Delegation, Dateien, Skripte, Modellzugang und Konversations-Rollback bleiben erhalten. Datei-Restore und alte Git-Workspace-Eingaben scheitern vor Zustandsänderungen. `missing`-Checkpoints erhalten IDs, Reihenfolge und Konversationsverknüpfungen ohne Snapshotdienst. Bereinigung und Startup verändern keine vorhandenen Checkouts, Refs oder Snapshots.

**Freigegeben ist ein Git-unabhängiger Suchbackend mit ausschließlich lesender Filterkompatibilität.** Git-Ignore-/Index-/Konfigurationsdaten dürfen Dateiausschlüsse bestimmen, aber keine Repository-, Status-, Branch- oder Änderungsfunktionen begründen. [WorkspaceEntries](../../integration/t3/overrides/apps/server/src/workspace/WorkspaceEntries.ts) und [WorkspaceSearchIndex](../../integration/t3/overrides/apps/server/src/workspace/WorkspaceSearchIndex.ts) verwenden dafür asynchrone Ordnersnapshots und einen begrenzten Inhaltsworker statt libgit2 oder Git-Prozessen. Fokussierte integrierte Tests und die Abhängigkeitsprüfung bestätigen die Entkopplung. Sucharbeit und Dateigrößen sind begrenzt; unvollständige Ergebnisse werden als solche markiert. Reguläre Ausdrücke verwenden JavaScript-Syntax und laufen mit Abbruchgrenze in einem eigenen Worker; ungültige oder nicht unterstützte Muster werden mit einem Hinweis wörtlich gesucht. `.gitignore`, `.ignore`, Repository-/globale Ausschlüsse, erfasste Browse-Dateien und Gitlink-Grenzen bleiben Filtereingaben; Verzeichnispfade sind literal, ohne die früheren Git-CLI-Pathspec-Nebeneffekte. Nicht lesbare oder nicht unterstützte relevante Metadaten führen zum Fehler statt zur Freigabe ausgeblendeter Dateien. Split-/Sparse-Indizes und filterrelevante Branch-/Hasconfig-Includes sind nicht unterstützt; für abweichende Systemkonfigurationspfade ist `GIT_CONFIG_SYSTEM` erforderlich. Bestehende Metadaten werden nicht umgeschrieben oder migriert.

Die [Graphprüfung](../../integration/t3/scripts/checkPrGraph.ts) sperrt entfernte Git-/PR-/Issue-/Accountimplementierungen, Hostingpakete und Git-Bibliotheken in den Produktabhängigkeiten. Sie erfasst Server, den eigenen CLI und Web sowie direkte Git-Prozessanfragen; reine Texte oder vollständig entfernte Typimporte gelten nicht als Operationen. Alle drei Einstiege und `pnpm check` sind erfolgreich. Fokussierte Datei-/Such-, Orchestrierungs-, CLI-/MCP- und Webtests sowie der erneuerte Replaynachweis sind erfolgreich. Frischer Produktionsbuild und fokussierter Browserlauf sind ebenfalls nachgewiesen; die vollständige native CI-Abnahme ist damit nicht ersetzt.

Alle vereinbarten Git-Host- und Issue-Integrationen einschließlich Linear sind entfernt; URLs bleiben gewöhnliche Links. Pure SDK-/Historientypen in der unveränderten Grundlage sind keine aktiven Produktfunktionen. Lokale Anmeldung, Modellzugangsdaten und Cursor-Chat bleiben unabhängig von Cursor Origin erhalten. Nicht unterstützte Host-Daten werden weder importiert noch migriert oder öffentlich ausgegeben. Pairing und zusätzliche Environments bleiben gesperrt, ohne gespeicherte Grants oder Verbindungen zu löschen. Vendor, bestehende Daten und Entwicklungsinfrastruktur bleiben unverändert.

`pnpm upstream:plan` erstellt inzwischen Drei-Wege-Vorschläge, ohne Quellen oder Pins umzuschreiben. Konflikte und neue Additionskollisionen bleiben sichtbar; ein sauberer Merge ist weiterhin prüfpflichtig. Ein begrenzter Quellkompositionsnachweis mit zwei realen Upstream-Pins sowie Git-Fixtures für saubere und konfliktbehaftete Änderungen liegen vor; siehe [Updateablauf](../operations/upstream.md). Ein vollständiger Build-/Laufzeitwechsel beider Pins ist damit nicht bewiesen.

**Schritt 3 ist noch nicht abgeschlossen.** Der zuvor blockierte Produktionsbuild und ein fokussierter Browsernachweis sind inzwischen erfolgreich. Die Speicherüberschreitung wurde auf Tailwinds Quellsuche eingegrenzt und isoliert reproduziert: Das explizite Ausnehmen generierter Ausgaben und installierter Abhängigkeiten verhindert die Rekursion, ohne Anwendungssourcen auszuschließen. Diese [CSS-Quellgrenze](../../integration/t3/overrides/apps/web/src/index.css) ist Teil der Komposition; React Compiler, Lizenzprüfung und Speicherschutz bleiben aktiv. Vollständige Produkt-CI und Build-/Laufzeitwechsel beider Upstream-Pins bleiben offen; ein Deployment ist nicht erfolgt.
