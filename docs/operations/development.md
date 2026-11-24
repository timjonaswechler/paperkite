# Entwicklung

Dieser Ablauf beschreibt das Grundgerüst aus dem freigegebenen, noch nicht abgeschlossenen Schritt 3; maßgeblich sind die [Architektur und ihr Arbeitsstand](../internals/architecture.md). Er gilt nicht für den Betrieb der bisherigen Anwendung. Voraussetzung sind Git, die in `package.json` festgelegte isolierte Node-/pnpm-Toolchain und genügend Platz für T3 und seine Abhängigkeiten. Host-/Dienst-Node nicht ersetzen.

## Einrichten und prüfen

1. Gepinnte Quelle holen: `git submodule update --init vendor/t3`. Nicht rekursiv zusätzliche Referenzrepositories initialisieren.
2. `pnpm setup` ausführen. Das prüft den Pin, erzeugt `.build/t3/` und installiert dort die Web-/Server-/Scripts-Abhängigkeiten mit dem versionierten `integration/t3/product-lock.yaml`, abgeleitet von T3s Lockfile. Niemals in `vendor/t3/` installieren.
3. `pnpm test` prüft die bootstrapfähige Komposition ohne Abhängigkeiten.
4. `pnpm build` baut Web und Server mit den nativen T3-Skripten. Dabei entstehen die Routertypen.
5. `pnpm check` prüft eigene Quellen mit T3s Formatter/Linter sowie Webclient, Server und eigene Pakete mit dem Effect-Typprüfer. Ohne vorherigen Build können die neuen Routentypen fehlen.
6. `pnpm upstream:check` muss weiterhin den unveränderten Vendor-Baum bestätigen.

`pnpm compose` aktualisiert nur den generierten Workspace. Vor jedem Produktbefehl erfolgt die Zusammensetzung erneut. Nach Änderungen während eines laufenden Devservers `pnpm compose` separat ausführen; ein eigener Watcher ist noch nicht implementiert. Niemals Änderungen in `.build/t3/` als fertige Arbeit betrachten.

## Starten

Nach dem Webbuild starten `pnpm dev` und `pnpm start` den eigenen Server-Einstieg mit `<checkout>/.local/t3/` als Datenhome, deaktiviertem Seeding und Loopback-Bindung. Beide bedienen derzeit die gebauten Webdateien; sie starten keinen Vite-HMR-Server. Der Standardport ist `14773`, ein anderer Port kann mit `--port <port>` angegeben werden. Vorhandene T3-/Vite-Verbindungsvariablen werden nicht übernommen. Es werden keine bestehenden Paperkite-/T3-Daten oder Zugangsdaten kopiert und kein Sharing automatisch eingerichtet.

Nach der nativen Ersteinrichtung ist `/paperkite` die minimale eigene Seite. Sie enthält nur den Rückweg in die native Oberfläche. Das Standardprofil `proof` richtet den kostenlosen nativen Replayprovider ein, beschränkt Provider-Treiber auf `acpRegistry` und deaktiviert testweise Settlement einschließlich des Workers und der Sidebar-Einstiege. Keine automatische Modellrunde wird gestartet; bezahlte Provideraufrufe sind kein Teil der Einrichtung. Die spätere Produktauswahl ist damit nicht festgelegt.

`pnpm proof` startet zwei kurzlebige eigene Server mit getrennten temporären Datenhomes unter `.local/`, prüft Anmeldungstrennung, Replaydialog, direkte Befehlssperre und native Side-Chat-Verknüpfung und räumt diese Prozesse und Daten anschließend auf. Es ersetzt keinen visuellen Browsernachweis.

Prozesse nur im eigenen Terminal starten und kontrolliert beenden. Keine bestehenden Dienste stoppen, keine gemeinsame Datenbank verwenden und keine Entwicklungsdaten zurück in den Altbestand kopieren. `.local/` bleibt unabhängig vom verwerfbaren Buildverzeichnis erhalten.

## Prüfungen im Detail

Fokussierte native Tests können nach `pnpm compose` aus `.build/t3/` gestartet werden, beispielsweise `pnpm exec vp test run <Datei>`. Sie folgen [T3s Testregeln](../../vendor/t3/docs/internals/15_testing.md). Die Root-Pipeline führt die vollständigen Web-/Server-Suiten aus, einschließlich Chromiumtests; lokal keine unaufgeforderten Vollsuiten starten.

Der Formatter prüft generierte Kopien unserer Quellen. Korrekturen anschließend in die zugehörigen Originalquellen übernehmen und erneut zusammensetzen; Änderungen nur am Buildoutput verschwinden. Bei geänderten Abhängigkeiten `pnpm lock` ausführen und den aktualisierten Produkt-Lockstand gemeinsam mit den Paketänderungen prüfen und versionieren; die normale Einrichtung verwendet weiterhin `--frozen-lockfile`.

Die geerbten Generator-, i18n- und Knip-Prüfungen laufen in CI zusätzlich. Der unveränderte i18n-Checker prüft auch Desktop-/Mobile-Kataloge und benötigt deren Abhängigkeiten. Der Quality-Job installiert deshalb dort den vollständigen nativen Workspace; die normale lokale Einrichtung bleibt gefiltert. Das aktiviert keine zusätzlichen Produktplattformen. Ein noch nicht gelaufener CI-Job ist keine bestandene Prüfung. Desktop-/Mobile-Releases und Deployment werden nicht durch diese Pipeline freigegeben.
