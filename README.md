# Paperkite

**Zielarchitektur festgelegt; Schritt 3 in Umsetzung und Prüfung.** Der Neuaufbau erfolgt getrennt von der bisherigen Anwendung im Branch `architecture/upstream-core`. Dieser Stand ist kein einsatzbereiter Ersatz der Bewerbungsverwaltung.

## Festgelegte Architektur

Die maßgebliche [Zielarchitektur](docs/internals/architecture.md) ist **Upstream-first mit eigenständiger Produktschicht**: unverändertes T3, eigene Fachmodule, ein app-eigener Serverprozess und ein reproduzierbares Quell-Overlay mit zunächst realen Kopien und Datei-Overrides.

Die [T3-Quellbefunde](docs/internals/t3-integration.md) begründen die notwendigen Integrationsgrenzen. Sie entscheiden nicht über einzelne spätere Produktfunktionen. Schritt 3 wurde separat freigegeben. Den implementierten Stand und die noch offenen Abnahmen beschreibt die [Zielarchitektur](docs/internals/architecture.md#9-arbeitsstand-von-schritt-3).

## Vorhandener Arbeitsstand

T3 liegt unverändert als Git-Submodul unter `vendor/t3/`; der genaue Stand steht im [Upstream-Pin](integration/t3/upstream.json). Eigene Server- und Web-Einstiege, Runtime-Verträge und -Policy, Integrations-Overrides, Produkt-Lockstand, Bootstrap und CI-Konfiguration sind vorhanden. Der Zwischenstand ist noch nicht vollständig abgenommen; insbesondere ist der Produktionsbuild noch unbestätigt. Alte App, produktive Daten und Betriebsdateien werden hier nicht mitgeführt.

- [Vorhandenes Entwicklungsgerüst und Prüfbefehle](docs/operations/development.md)
- [Aktueller Updateablauf](docs/operations/upstream.md)
- [Geerbte Entwicklungsregeln](AGENTS.md)

Die eigenen Paperkite-Quellen stehen unter der [MIT-Lizenz](LICENSE). T3s eigene [MIT-Lizenz](vendor/t3/LICENSE), [Drittlizenzen](vendor/t3/third-party-licenses/) und [Markenbedingungen](vendor/t3/TRADEMARK.md) bleiben beim Original. Diese Quelle ist keine offizielle T3-Distribution.
