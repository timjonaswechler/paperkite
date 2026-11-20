# Vorlagen-Mods mit KI-erstellter Datenanbindung

**Status: Diskussionsentwurf, nicht implementiert.** Ergänzung zum [CV-Datenmodell](cv-datenmodell.md). Ziel: LaTeX-Projekte verschiedener Herkunft an dieselben CV-Daten anbinden, ohne bei Inhaltsänderungen erneut eine KI oder eine neue manuell zu pflegende Vorlage zu benötigen. Der [akzeptierte Editor](../prototypes/cv-kompakt/README.md) bleibt der feste Bedienentwurf.

## Was ein Mod enthält

Ein Mod ist ein versioniertes Vorlagenpaket mit:

- LaTeX-Layout und benötigten Dateien/Assets; Herkunft und Lizenz werden festgehalten.
- Einem Manifest für Einstiegspunkt, Engine, benötigte Laufzeit, CV-Schemaversion und Adapter-Schnittstellenversion.
- Einem Adapter, der strukturierte CV-Daten in die vorhandenen Vorlagenbefehle beziehungsweise vorbereitete Einfügestellen einbindet.
- Angaben zu unterstützten Abschnitten/Feldern, optionalen Erweiterungen und nicht darstellbaren Inhalten.
- Synthetischen Beispieldaten, einem Prüfbericht und einer Vorschau der geprüften Mod-Version.

Das hochgeladene Original bleibt als nachvollziehbarer Ausgangsstand erhalten. Eine nötige Integrationskopie gehört zur neuen Mod-Version. Normale Bearbeitung von CV-Inhalten verändert weder diese Vorlage noch den Adapter.

## Vorgeschlagener Importablauf

1. **Quellen aufnehmen.** Ein eigenes Projekt, ein Overleaf-Quellpaket oder eine fremde Vorlage wird zunächst als vollständiges Dateipaket übernommen. Ein PDF allein reicht nicht für eine allgemein bearbeitbare LaTeX-Anbindung. Herkunft, Datei-Hashes und fehlende Abhängigkeiten erfassen.
2. **Kompatibilität prüfen.** Hauptdatei, Engine, Fonts und Pakete ermitteln. Fehlende Bestandteile oder Anforderungen außerhalb der unterstützten Buildumgebung werden sichtbar gemeldet; keine stillen globalen Runtime-Änderungen.
3. **Eigenen nativen KI-Thread anlegen.** Ein Thread pro Mod-Erstellung beziehungsweise ausdrücklicher Adapterüberarbeitung, nicht pro Bewerbung oder PDF-Build. Er untersucht die Arbeitskopie, erstellt Adapter/Manifest und nötige einmalige Layout-Anpassungen. Er ist dem Vorlagenimport zugeordnet und legt keine Testbewerbung an. In der aktuellen Konzeptarbeit wird kein solcher Thread gestartet.
4. **Unabhängige Prüfungen ausführen.** Adapter nicht allein anhand seiner selbst erzeugten Tests akzeptieren. Feste App-Prüfungen verwenden synthetische Daten: ohne Kurzprofil; null/ein/viele Einträge und Stichpunkte; zusätzliche Abschnitte; lange Inhalte; Sonderzeichen wie `&`, `%` und `_`. Echte PDFs prüfen: erwartete Inhalte und Wiederholungen vorhanden, keine festen Beispieldaten, keine leeren erzwungenen Überschriften, Layout brauchbar. Ein erfolgreicher Compilerlauf allein reicht nicht.
5. **Vorschau prüfen und Mod aktivieren.** Die konkrete geprüfte Version wird auswählbar. Offene Zuordnungen und nicht abgebildete Felder müssen sichtbar sein. Fehlgeschlagene Importe bleiben als solche erkennbar und können im zugeordneten Thread überarbeitet werden.

Der Thread nutzt die normalen nativen Provider-, Modell- und Berechtigungsmodi. Die Aktivierung eines geprüften Mod-Artefakts ist ein Produktablauf, keine neue Tool-Allowlist oder Pflichtgenehmigung für einzelne Modellwerkzeuge. Es wird keine Mehrserver-/Environment-Verwaltung in die App zurückgebracht.

## Vertrag zwischen Daten und Mod

Das **gemeinsame CV-Datenmodell ist stabil und versioniert**. Eine KI erfindet nicht für jede Vorlage eine eigene Datenbankstruktur. Vorlagenspezifische Zusatzfelder werden über definierte, typisierte Erweiterungen beschrieben und bleiben beim Vorlagenwechsel erhalten.

Einträge und Stichpunkte werden anhand strukturierter Listen mit stabilen IDs verarbeitet, nicht durch feste Textpositionen oder Platzhalter nur für eine bestimmte Anzahl von Jobs. Fehlendes Kurzprofil bleibt fehlend. Nicht unterstützte Daten werden nicht gelöscht und nicht stillschweigend als erfolgreich ausgegeben.

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

Die genannte eigene Mac-/iCloud-Vorlage ist der erste konkrete Kandidat. In der Sitzung auf srv ist dieser Pfad nicht lokal vorhanden. Der Mac ist über die Werkzeugumgebung als erreichbar gemeldet, sein Vorlageninhalt wurde aber noch nicht gelesen: Die derzeit verfügbaren direkten Dateiwerkzeuge arbeiten auf srv. Ein vollständiges ZIP hier im Chat beziehungsweise eine ausdrücklich bereitgestellte Serverkopie ermöglicht die lokale Untersuchung ohne neuen Agenten oder zusätzlichen App-Server.
