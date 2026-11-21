# Vorlagen-Mods mit KI-erstellter Datenanbindung

**Status: erste integrierte Fassung auf `prototype/cv-mod-import`.** Upload, nativer KI-Thread, feste PDF-Prüfungen und Auswahl einer unveränderlichen geprüften Version sind in Einstellungen und Lebenslauf eingebunden. Der [isolierte Entwicklungsprototyp](../prototypes/cv-mod-import/README.md) bleibt zusätzlich vorhanden. Die ABI und begrenzten Prüfungen sind keine allgemeine Kompatibilitäts- oder Layoutgarantie. Ergänzung zum [CV-Datenmodell](cv-datenmodell.md). Ziel: LaTeX-Projekte verschiedener Herkunft an dieselben CV-Daten anbinden, ohne bei Inhaltsänderungen erneut eine KI oder eine neue manuell zu pflegende Vorlage zu benötigen. Der [akzeptierte Editor](../prototypes/cv-kompakt/README.md) bleibt der feste Bedienentwurf.

## Verbindliches Produktziel: Vorlage bestimmt Formular

**Mod = LaTeX-Vorlage + deklaratives Formular + Datenanbindung.** Ein nativer Agent soll diese Teile später für die Vorlage erzeugen und mit dem Nutzer weiterbearbeiten. Kein wachsendes Universalschema für Beruf, Bildung oder Kenntnisse. Die App rendert aus derselben Definition die Eingaben und prüft deren Typen. Normales Bearbeiten und PDF-Bauen benötigt keine KI und verändert den Mod nicht. Nutzer verantworten Inhalt und Gestaltung; die App verantwortet Speicherung, Versionsbindungen, technische Grenzen und verbindliche Bedienfunktionen. Das ist keine Garantie pixelgleicher Browser-/PDF-Darstellung.

Die nachfolgenden v1-Beschreibungen sind der bestehende Übergang, nicht die vollständige Umsetzung dieses Ziels. Der akzeptierte HTML-Entwurf bleibt Bedienreferenz, kein Pflicht-Feldsatz.

### Erster Prototyp und Vertrag v2

**Status 21.11.2026:** Der Durchstich ist auf `prototype/cv-mod-import` in den normalen Lebenslaufbereich eingebunden, mit regulärem App-Build, Start und PDF-/Vorschaupfad. Kein eigenständiger Formular-Prototyp-Build, Zweitserver oder zusätzlicher Port. [Verwendung und Beispiele](../examples/cv-form-mods/README.md), [beobachtete Nachweise](../VERIFIKATION.md). Noch nicht produktiv ausgerollt und nicht durch eine echte KI erstellt.

Der erste Durchstich verwendet manuell erstellte, ausschließlich synthetische Mods, keine echte KI-Erstellung und keine automatische Inhaltsmigration. Der Prototyp ist ein Branch der normalen App, keine zusätzliche Anwendung. Vorhandene Bewerbungen bleiben im alten Editor, bis ausdrücklich ein Formular-Mod gewählt wird. Alte CV-Daten und LaTeX-Quellen bleiben dabei erhalten; generische Formularwerte werden getrennt pro Bewerbung gespeichert. Der Rückwechsel ist möglich, und auch bisher nicht zugeordnete Formularwerte bleiben aufbewahrt. Format `bewerbung-cv-form-v2`, Engine `lualatex`, relativer `.tex`-Einstiegspunkt und `form` bilden das Manifest. Layoutdateien und Manifest werden zusammen als feste Version veröffentlicht.

Primitives: `text`, `content` (gemeinsamer Absatz-/Aufzählungseditor), `group`, `columns`, `entries`. Gruppen und Spalten sind reine Anordnung, keine eigenen Datenobjekte. Feld- und Sammlungsschlüssel binden relativ zum Dokument beziehungsweise Eintrag; Schlüssel sind je Bindungskontext eindeutig. Felder tragen Beschriftung, optional `required` und zwingend `target: pdf|metadata`. Beschriftungen sind nie automatisch CV-Text. Verschachtelte Sammlungen, Medienprimitives und eigene Stylingprogramme gehören nicht zum ersten Durchstich.

`entries` liefert unveränderlich die App-Aktionen Hinzufügen, Löschen, Umsortieren und **Im PDF**. Das Manifest kann diese Aktionen nicht abschalten. Einträge besitzen stabile IDs, `included` und eigene `values`; Dokumentwerte bleiben getrennt vom Mod. Ausgeschaltete Daten bleiben gespeichert. Pflichtfelder werden beim Build geprüft; leere Entwürfe dürfen gespeichert werden. Unbekannte, sichere Werte bleiben bei einem Modwechsel erhalten und werden als nicht zugeordnet gemeldet; inkompatible Typwechsel werden abgewiesen statt konvertiert. Kein neuer Rollenkatalog oder globales Pflicht-Kurzprofil, keine SQL-Struktur je Vorlage.

Der Renderer führt keinen generierten JavaScript-Code aus. Der Adapter erhält im isolierten Builder nur PDF-Felder und eingeschlossene Einträge über `CV_DATA_FILE`. Für den bestehenden LuaLaTeX-Runner wird ausschließlich im Build-Snapshot dessen v1-Startmanifest erzeugt; das eigentliche Formularmanifest bleibt separat erhalten. Das ist Runner-Wiederverwendung, kein v1-Mod-Import. Daten-, Formular- und Layoutstand werden gemeinsam festgehalten; alte Versionen/PDFs werden nicht überschrieben.

### Feste Abnahmekriterien A–H

Diese Kriterien sind der Evaluator, nicht nachträglich an grüne Ergebnisse anzupassen:

| ID  | Erfolg                                                                                               | Nachweis                                                                          |
| --- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| A   | Ziel, Verantwortung, Vertrag, erster Umfang und Nichtziele widerspruchsfrei dokumentiert             | diese Seite und Datenmodell/README                                                |
| B   | Unterschiedliche Feldnamen und Anordnung aus zwei Mods, gleicher Renderer ohne CV-Sonderfälle        | synthetischer CV und Projektportfolio, echte Formularbedienung                    |
| C   | Hinzufügen, Löschen, Reihenfolge und Im-PDF bei jeder Sammlung, nicht abwählbar                      | Browseraktionen und abgewiesene Manifest-Overrides                                |
| D   | Werte/IDs/Auswahl persistent; veraltete Revisionen abgewiesen; Öffnen/Lesen unverändert              | SQLite-Neuöffnung, Konflikttest und Browser-Reload                                |
| E   | Echtes PDF enthält ausgewählte Inhalte in Reihenfolge, nicht ausgeschlossene Werte oder UI-Metadaten | Offline-LuaLaTeX und unabhängige Textextraktion, Sonderzeichen                    |
| F   | Leere/mehrere Einträge und Mischtext; ungültige Primitives/Bindungen/IDs sichtbar abgewiesen         | feste positive und negative Testfälle                                             |
| G   | Dokumente und Modversionen unabhängig; alte PDFs fest; fremde Werte erhalten                         | zweites Dokument, neue Modversion, erneutes Laden alter Artefakte                 |
| H   | Vollständiger Ablauf Desktop 1440×1000 und Mobil 390×844 ohne Überbreite/JS-Fehler                   | Browserablauf plus menschliche Sichtprüfung der Beschriftungen und Bedienelemente |

Vorherige Tests sind keine neue Baseline. Fehlende v2-Unterstützung wird als fehlende Funktion dokumentiert, nicht als aussagekräftiger Importfehler. Pro Iteration muss ein Kriterium neu erfüllt werden und müssen zuvor bestandene Kriterien erhalten bleiben; die erste Iteration ohne verifizierbaren Fortschritt beendet den Durchlauf mit Blockerbericht. Arbeitsprotokolle und Messungen liegen ignoriert unter `.work/`, nicht als zweite Zielbeschreibung.

### Nichtziele und spätere Schritte

Jetzt: generischer Formularrenderer im normalen Lebenslaufbereich, gemeinsame Datenpersistenz und echte PDF-Ausgabe über die bestehende Buildwarteschlange. Die Docker-Buildisolation bleibt erhalten; sie ist kein eigener App-Build-/Startweg. Später: tatsächliche Agentenerstellung desselben Formats, weitere Primitives, bewusste Migration/Feldzuordnung und Master-CV-Verwaltung. Kein Produktivrollout, keine Massenmigration, keine zusätzlichen Modellrunden, Agenten oder Infrastruktur im ersten Durchstich. Keine vollständige automatische Übertragbarkeit zwischen beliebigen Formularen versprechen; sichere unbekannte Werte bleiben dennoch erhalten. Technische Kompatibilität beliebiger TeX-Projekte bleibt begrenzt.

## Zielumfang eines Mods

Die erste integrierte Fassung enthält Original-ZIP, Quellenhashes, Manifest, Adapterdateien und feste Prüfstände. Separate Lizenz-/Laufzeitmetadaten, allgemeine Editor-Darstellungsregeln und teilbare Exporte sind noch kein vollständiger Produktvertrag. Das weitergehende Ziel ist ein versioniertes Vorlagenpaket mit:

- LaTeX-Layout und benötigten Dateien/Assets; Herkunft und Lizenz werden festgehalten.
- Einem Manifest für Einstiegspunkt, Engine, benötigte Laufzeit, CV-Schemaversion und Adapter-Schnittstellenversion.
- Einem Adapter, der strukturierte CV-Daten in die vorhandenen Vorlagenbefehle beziehungsweise vorbereitete Einfügestellen einbindet.
- Deklarative Angaben zu unterstützten Abschnitten/Feldern, optionalen Erweiterungen, Textabsätzen/Stichpunktlisten/gemischten Inhalten und deren Darstellung im Editor sowie im PDF. Die eigene Vorlage ist nicht das globale Pflichtschema.
- Synthetischen Beispieldaten, einem Prüfbericht und einer Vorschau der geprüften Mod-Version.

Das hochgeladene Original bleibt als nachvollziehbarer Ausgangsstand erhalten. Eine nötige Integrationskopie gehört zur neuen Mod-Version. Normale Bearbeitung von CV-Inhalten verändert weder diese Vorlage noch den Adapter.

## Importablauf und Zielumfang

1. **Quellen aufnehmen.** Ein eigenes Projekt, ein Overleaf-Quellpaket oder eine fremde Vorlage wird zunächst als vollständiges Dateipaket übernommen. Ein PDF allein reicht nicht für eine allgemein bearbeitbare LaTeX-Anbindung. Herkunft, Datei-Hashes und fehlende Abhängigkeiten erfassen.
2. **Kompatibilität prüfen.** Hauptdatei, Engine, Fonts und Pakete ermitteln. Fehlende Bestandteile oder Anforderungen außerhalb der unterstützten Buildumgebung werden sichtbar gemeldet; keine stillen globalen Runtime-Änderungen.
3. **Eigenen nativen KI-Thread anlegen.** Ein Thread pro Mod-Erstellung beziehungsweise ausdrücklicher Adapterüberarbeitung, nicht pro Bewerbung oder PDF-Build. Er untersucht die Arbeitskopie, erstellt Adapter/Manifest und nötige einmalige Layout-Anpassungen. Er ist dem Vorlagenimport zugeordnet und legt keine Testbewerbung an. Erst der ausdrücklich beschriftete Start löst die möglicherweise kostenpflichtige Modellrunde aus.
4. **Unabhängige Prüfungen ausführen.** Die aktuelle Fassung baut fünf feste synthetische Fälle: mehrere Einträge/Stichpunkte, Absatz mit Sonderzeichen, gemischte Reihenfolge, optionales Rollenfeld und leere Abschnitte ohne erzwungenen Profilbereich. Fehlende erwartete Texte verhindern den Reviewstatus. Ein nicht deklariertes Rollenfeld wird als nicht unterstützt angezeigt, nicht als bestandener Rollen-Test. Zusätzliche Abschnitte, beliebige Feldkombinationen, lange Dokumente und Layoutqualität sind damit nicht pauschal bewiesen; den jeweiligen Mod manuell prüfen. Ein erfolgreicher Compilerlauf allein reicht nicht.
5. **Vorschau prüfen und Mod aktivieren.** Die konkrete geprüfte Version wird auswählbar. Offene Zuordnungen und nicht abgebildete Felder müssen sichtbar sein. Fehlgeschlagene Importe bleiben als solche erkennbar und können im zugeordneten Thread überarbeitet werden.

Der Thread nutzt die normalen nativen Provider-, Modell- und Berechtigungsmodi. Die Aktivierung eines geprüften Mod-Artefakts ist ein Produktablauf, keine neue Tool-Allowlist oder Pflichtgenehmigung für einzelne Modellwerkzeuge. Es wird keine Mehrserver-/Environment-Verwaltung in die App zurückgebracht.

## Vertrag zwischen Daten und Mod

Das **gemeinsame CV-Datenmodell wird versioniert**; die erste integrierte ABI heißt `bewerbung-cv-mod-prototype-v1` und unterstützt zunächst LuaLaTeX sowie deklarative Textfelder. Feldpfade haben die Form `person.<Feld>`, `entry.<Feld>` oder `<Abschnittstyp>.<Feld>`. Es gibt unabhängige Bewerbungs-CVs, keine zusätzliche Inhaltsvarianten- oder Rollenprofilverwaltung. Eine zentrale Master-Verwaltung bleibt ein noch nicht umgesetzter Teil des Zielmodells. Ein Mod regelt im Ziel zusätzlich das Formular aus App-Primitives; v1 deklariert bislang nur zusätzliche Textfelder. Eine KI erfindet nicht für jede Vorlage eine eigene Datenbankstruktur. Vorlagenspezifische Zusatzfelder werden über definierte, typisierte Erweiterungen beschrieben und bleiben beim Vorlagenwechsel erhalten.

Einträge enthalten optionale typisierte Felder und geordnete Inhaltsblöcke: Textabsätze, Stichpunktlisten oder eine Mischung. Rolle/Berufsbezeichnung ist eine mögliche CV-Angabe, kein verpflichtendes Feld und keine Verwaltung benannter Inhaltsvarianten. Die Mod deklariert die vorhandenen Felder und verbindet die Daten mit den konkreten Layout-Befehlen. Daten und Inhaltsblöcke besitzen stabile IDs; keine festen Textpositionen oder Platzhalter nur für eine bestimmte Anzahl von Jobs. Fehlendes Kurzprofil bleibt fehlend. Nicht unterstützte Daten werden nicht gelöscht und nicht stillschweigend als erfolgreich ausgegeben.

Darstellungsanpassung ist von redaktioneller Bearbeitung zu trennen: Die Mod kann vorhandene Texte oder Listenelemente passend zum Layout ausgeben, darf aber nicht stillschweigend Inhalte ergänzen, auslassen, kürzen oder neu formulieren. Wortlaut und Reihenfolge bleiben erhalten; eine gewünschte Umformulierung ist eine ausdrückliche Inhaltsänderung. Der normale Build erhält dadurch keine KI-Runde.

KI-generierter Adaptercode ist Teil eines nicht vertrauenswürdigen Buildpakets, kein beliebiges Host-Plugin. Seine Ausführung gehört in die isolierte Buildumgebung. Die Hostanwendung wählt einen unterstützten Runner; ein Manifest ist kein Freibrief für Shellkommandos oder Datenbankzugriffe auf dem Host. Die bestehende Isolation von PDF-Jobs ist von den frei gewählten nativen Modellberechtigungen zu unterscheiden.

## Normaler Betrieb nach dem Import

Ein Build verwendet ausschließlich:

- eine feste CV-Datenrevision,
- eine feste Mod-/Vorlagen-/Adapterversion,
- eine dokumentierte unterstützte Buildumgebung.

Der Kern erzeugt die technische Dateneingabe im Build-Snapshot; der Adapter bindet sie in das Layout ein. Keine KI-Runde beim normalen Speichern oder PDF-Build, kein erneutes freies Umschreiben der Vorlage und kein LaTeX-Zugriff auf die laufende Datenbank. Bestehende Builds und PDFs bleiben unveränderlich. Eine neue Adapterversion wird ausdrücklich erstellt und ersetzt keine historischen Ausgaben.

Mods können später wiederverwendet oder exportiert werden. Ein teilbares Paket darf keine produktiven CV-Daten, Sitzungstranskripte oder Zugangsdaten enthalten. Bereits in Originalvorlagen hart codierte Personendaten müssen vor einer Freigabe zum Teilen berücksichtigt werden; das lokale Original ist nicht automatisch ein sicheres Exportpaket.

## Grenze von „beliebig“ und nächster Schritt

Die Herkunft der Vorlage soll frei sein, nicht die technische Kompatibilität garantiert. Eigene Klassen, verfügbare Fonts und komplexere Layouts können grundsätzlich durch einen Adapter berücksichtigt werden. Anforderungen wie nicht verfügbare Abhängigkeiten, externe Dienste oder notwendiges Shell-Escape müssen aber vor einer Zusage konkret geprüft werden. Ein fehlgeschlagener Import ist besser als ein scheinbar fertiger Mod mit verlorenem Inhalt oder verändertem Layout.

## Erster Kandidat: hochgeladenes `cv.zip`

Das am 20.11.2026 bereitgestellte ZIP wurde statisch untersucht. Quellenidentität: SHA-256 `6a38a44e3178db06953532c032bdda092b148f504209830658a0ae945110f485`. Private Arbeitskopie und Strukturbericht liegen unter `.work/template-inspection-20261120T121138Z/`; sie enthalten persönliche Vorlagendaten und gehören nicht in Git oder öffentliche Testfixtures. `__MACOSX`, `.DS_Store` und vorhandene Buildausgaben wurden nicht in die Quell-Arbeitskopie übernommen. Kein bereitgestelltes Shellskript, Lua-Programm oder TeX-Dokument wurde ausgeführt.

### Direkt aus den Quellen geprüft

- `cv/Lebenslauf.tex` nutzt LuaLaTeX, lädt `preamble/` und ruft Loader, Validator und Formatter auf.
- `cv/lua/loader.lua`, Funktion `load`: verbindet `profile/personal.lua`, `profile/education.lua` und genau eine Datei aus `profiles/`.
- `cv/profile/personal.lua`: persönliche Daten, Foto-/Signaturpfade, Abschnittsreihenfolge und Auswahl der Bildungsstationen. Reihenfolge: Bildung, Berufserfahrung, Kenntnisse, Engagement. Kein Kurzprofil-Abschnitt.
- `cv/profile/education.lua`: sechs Bildungsstationen mit stabilen Quellschlüsseln; drei sind ausgewählt. Felder: `date`, `degree`, `subtitle`, `grade`, `org`. Noten und Datumsangaben sind Anzeigetexte, keine zu erratenden Zahlen oder Zeitstempel.
- `cv/profiles/`: die vier alten Quelldateien `general`, `software`, `data`, `rechenzentrum` mit unterschiedlichen Auswahlen, Reihenfolgen und Texten bei demselben Layout. Das ist ein Befund zum Upload, keine neue Produktfunktion: Inhaltsvarianten wurden ausdrücklich abgelehnt. Beim einmaligen Import wird ein Master-Ausgangsbestand festgelegt; die App übernimmt weder einen Rollenkatalog noch eine Profil-/Variantenauswahl. Beruf und Engagement enthalten `date`, `title`, `org`, `bullets`; Kenntnisse enthalten `label`, `items`.
- `cv/lua/formatter.lua`, Funktion `render`: setzt Daten in vorhandene LaTeX-Befehle ein, verarbeitet Listen, maskiert TeX-Sonderzeichen und lässt inhaltslose Abschnitte weg. Das ist bereits ein wesentlicher Teil des gewünschten Adapters.
- `cv/lua/validate.lua`: unterstützt vier feste Abschnittsarten und fordert derzeit Bildung in der Abschnittsliste. Das sind Eigenschaften dieses vorhandenen Mod-Kandidaten, keine allgemeinen Pflichtregeln für alle Vorlagen oder das CV-Datenmodell.
- `cv/preamble/commands.tex`: implementiert Header, optionale Foto-/Signaturdarstellung und die Abschnitts-/Eintragsmakros. Das Signaturdatum verwendet aktuell `\today`.
- `cv/preamble/fonts.tex`: erwartet die Schriftfamilie SourceSans3. Im ZIP sind keine Schriftdateien enthalten. Deren Verfügbarkeit in der späteren Buildumgebung ist noch nicht geprüft und darf nicht als gegeben angenommen werden.

Die beiden gemeinsamen Datenmodule und alle vier Varianten ließen sich mit dem vorhandenen nicht ausführenden Literalparser lesen. Das belegt die statische Einlesbarkeit, keinen erfolgreichen LaTeX-Build. `archive/content-v1/` wird nach README und aktivem Loader nicht geladen und ist kein automatisch zusätzlich zu importierender Datenbestand. Foto und Unterschrift sind private Assets, keine synthetischen Beispieldaten für teilbare Mods.

### Vorgeschlagene Anbindung dieses Mods

Das vorhandene LaTeX-Layout und seine Makros beibehalten. Die App erzeugt beim Build einen festen Datensnapshot des jeweiligen Bewerbungs-CVs; ein schmaler Adapter übersetzt ihn in die bereits erwartete Bundle-Struktur `personal`, `education`, `profile`. Das technische Alt-Feld `profile` erhält ausschließlich die aktuellen CV-Inhalte und bedeutet keine auswählbare Inhaltsvariante; normale Builds lesen nicht wechselweise die alten Rollendateien. Für die vorhandenen Stichpunktdaten genügt voraussichtlich eine einmalige Anpassung der Daten-Ladeschicht in einer versionierten Integrationskopie. Der bestehende Formatter unterstützt derzeit nicht das allgemeine Absatz-/Listen-Blockmodell; für Fließtext oder gemischte Inhalte muss seine Ausgabe ausdrücklich erweitert oder ein entsprechender Adapter ergänzt werden. Für bestehende Bewerbungen mit dieser Loader-/Makrostruktur ist inzwischen eine Build-Snapshot-Anbindung implementiert und mit einer eigenen synthetischen Vorlage auf Absätze, Listen, Reihenfolge und Sonderzeichen geprüft. Das ist kein KI-generierter Mod des privaten Uploads.

Der Formatter kann damit weiter die bestehenden Layout-Makros verwenden. Keine neuen TeX-Layouts pro Inhaltsänderung, keine KI-Runde pro PDF und kein künstlicher Kurzprofil-Abschnitt. Nicht unterstützte zusätzliche Abschnittsarten müssen sichtbar gemeldet oder ausdrücklich angebunden werden, nicht still verloren gehen. Ein festgehaltenes Ausgabedatum gehört in den Build-Snapshot, damit ein späterer Neubau nicht unbemerkt den Datumsinhalt ändert.

**Für diesen privaten Kandidaten noch offen:** bewusste Master-Datenübernahme, Schriftverfügbarkeit und tatsächliche Adapter-/Layoutkontrolle. Die erste Mod-ABI und synthetische Offline-Builds sind umgesetzt; eine echte KI-Adaptererstellung für dieses ZIP wurde nicht gestartet und kein entsprechender Mod aktiviert. Normale CV-Builds verwenden einen einmal gewählten geprüften Stand ohne weitere KI-Runde. Spätere Rechecks erzeugen neue Versionen und verändern alte Bindungen nicht; das Entfernen eines noch verwendeten Imports wird abgewiesen.
