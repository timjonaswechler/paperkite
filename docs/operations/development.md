# Entwicklung

Dieser Ablauf beschreibt das Grundgerüst aus dem freigegebenen, noch nicht abgeschlossenen Schritt 3; maßgeblich sind die [Architektur und ihr Arbeitsstand](../internals/architecture.md). Er gilt nicht für den Betrieb der bisherigen Anwendung. Voraussetzung sind Git, die in `package.json` festgelegte isolierte Node-/pnpm-Toolchain und genügend Platz für T3 und seine Abhängigkeiten. Host-/Dienst-Node nicht ersetzen.

## Arbeitsort und Freigaben

Entwicklung, Abhängigkeitsoperationen, lokale Prüfungen und Builds erfolgen im bestehenden MacBook-Checkout `/Users/tim-jonaswechler/workspace/repositories/timjonaswechler/personal/paperkite-upstream-core`. Prüfungen und Builds nur im jeweils ausdrücklich freigegebenen Umfang starten.

`srv` ist ausschließlich für späteren Betrieb und Deployment vorgesehen. Dort keine Quelländerungen, Abhängigkeitsoperationen, Prüfungen, Builds, Bereinigung oder Synchronisierung ausführen. Ein Transfer Linux-kompatibler Release-Artefakte und deren Deployment benötigen eine separate ausdrückliche Freigabe; dieser Entwicklungsablauf erteilt sie nicht. Die bestehenden CI-Gates bleiben unverändert.

## Einrichten und prüfen

1. Gepinnte Quelle holen: `git submodule update --init vendor/t3`. Nicht rekursiv zusätzliche Referenzrepositories initialisieren.
2. `pnpm setup` ausführen. Das prüft den Pin, erzeugt `.build/t3/` und installiert dort die Web-/Server-/Scripts-Abhängigkeiten mit dem versionierten `integration/t3/product-lock.yaml`, abgeleitet von T3s Lockfile. Niemals in `vendor/t3/` installieren.
3. `pnpm test` prüft die bootstrapfähige Komposition ohne Abhängigkeiten.
4. `pnpm build` baut Web und Server mit den nativen T3-Skripten. Dabei entstehen die Routertypen.
5. `pnpm check` prüft eigene Quellen mit T3s Formatter/Linter sowie Webclient, Server, Scripts und eigene Pakete mit dem Effect-Typprüfer. Zusätzlich laufen die gezielten Importgraph-Tests sowie die Git-/Provider-Import- und Abhängigkeitsprüfung. Ohne vorherigen Build können die neuen Routentypen fehlen.
6. `pnpm upstream:check` muss weiterhin den unveränderten Vendor-Baum bestätigen.

`pnpm compose` aktualisiert nur den generierten Workspace. Vor jedem Produktbefehl erfolgt die Zusammensetzung erneut. Nach Änderungen während eines laufenden Devservers `pnpm compose` separat ausführen; ein eigener Watcher ist noch nicht implementiert. Unveränderte Overlay-Dateien und der unveränderte Produkt-Lockstand werden nicht neu geschrieben, damit ihre Zeitstempel bestehende Werkzeugzustände nicht unnötig invalidieren. Niemals Änderungen in `.build/t3/` als fertige Arbeit betrachten.

Bootstrap-Aufrufe von pnpm verwenden [`--config.verify-deps-before-run=error`](https://pnpm.io/settings/build#verifydepsbeforerun): Ist der Abhängigkeitsstand nicht aktuell oder nicht prüfbar, bricht der Aufruf ab, statt automatisch zu installieren. Die Validierung bleibt aktiv. Abhängigkeiten nur über den ausdrücklich freigegebenen Einrichtungsschritt aktualisieren; `pnpm setup` bleibt mit `--frozen-lockfile` auf die vorgesehenen Workspace-Pakete gefiltert.

## Starten

Nach dem Webbuild starten `pnpm dev` und `pnpm start` den eigenen Server-Einstieg mit `<checkout>/.local/t3/` als Datenhome, deaktiviertem Seeding und Loopback-Bindung. Beide bedienen derzeit die gebauten Webdateien; sie starten keinen Vite-HMR-Server. Der Standardport ist `14773`, ein anderer Port kann mit `--port <port>` angegeben werden. Vorhandene T3-/Vite-Verbindungsvariablen werden nicht übernommen. Es werden keine bestehenden Paperkite-/T3-Daten oder Zugangsdaten kopiert und kein Sharing automatisch eingerichtet.

Nach der nativen Ersteinrichtung ist `/paperkite` die minimale eigene Seite. Sie enthält nur den Rückweg in die native Oberfläche. Das Standardprofil `proof` richtet den kostenlosen nativen Replayprovider ein, beschränkt Provider-Treiber auf `acpRegistry` und deaktiviert testweise Settlement einschließlich des Workers und der Sidebar-Einstiege. Keine automatische Modellrunde wird gestartet; bezahlte Provideraufrufe sind kein Teil der Einrichtung. Die spätere Produktauswahl ist damit nicht festgelegt.

`pnpm proof` startet je einen kurzlebigen Server mit den Profilen `proof` und `native` in getrennten temporären Datenhomes unter `.local/`. Es prüft Anmeldungstrennung, das Fehlen der Git-/Forge-/Issue-/Clone-/Worktree-Methoden im Produkt-RPC-Vertrag, verbleibende PR-HTTP-/Linkbefehls-Sperren, Pairing-/Connect-/Peer-Sperren, abgewiesene Schreibzugriffe auf nicht unterstützte Host-Zugangsdaten, den profilierten administrativen CLI, Scratch-Ordner, zwei abgeschlossene Replayrunden ohne Snapshots/versteckte Git-Refs und die native Side-Chat-Verknüpfung. Das ist kein Nachweis eines Git-freien Suchbackends. Nach spätestens 60 Sekunden werden eigene Prozesse und temporäre Daten über den Scope bereinigt. Die Native-Instanz prüft Connect unabhängig von der zusätzlichen Proof-Managed-Policy; nur die Proof-Instanz führt kostenlose Replayrunden aus. Der Befehl ersetzt keinen visuellen Browsernachweis.

`pnpm check:pr-graph` prüft trotz seines historischen Namens die lokalen Server-/CLI-/Web-Importgraphen auf entfernte Git-/VCS-/Clone-/Worktree-/PR-/Issue-/Accountimplementierungen und alle ausgeschlossenen Hostingpakete. pnpm ermittelt zusätzlich die transitiven Workspace-Kanten und direkten externen Abhängigkeiten; auch Git-Bibliotheken und der Git-basierte native Finder sind verboten. Fehlende Produktwurzeln, ungültige Paketmanagerdaten und fehlgeschlagene Aufrufe führen zum Fehler. Die Quellprüfung folgt dynamischen und Worker-URL-Imports, schreibt keine Produktartefakte und führt keine React-Transformationen aus. Sie untersucht nicht den vollständigen inneren Quellgraphen externer Pakete. Wiederverwendete generische Markdown-/Dokument-Primitives sowie zur Laufzeit vollständig entfernte `import type`-Deklarationen bleiben zulässig. Diagnosepfade zeigen, welcher Produkteinstieg eine verbotene Quelle erreicht; zusätzlich werden direkte Git-Prozessanfragen im emittierten lokalen Programm geprüft. Die schnelle Prüfung ersetzt keinen Produktionsbuild.

Die aktive Dateisuche benötigt weder `@ff-labs/fff-node` noch Git. Ignore-/Index-/Konfigurationsdaten werden nur als Filter gelesen; nicht unterstützte relevante Metadaten führen zum Fehler statt zu ungefilterten Treffern. Die Kompatibilitätsgrenzen stehen im [Arbeitsstand](../internals/architecture.md#9-arbeitsstand-von-schritt-3). Vorhandene Indizes nicht zur Fehlerumgehung umschreiben oder migrieren. Native Desktop-/Archivwerkzeuge, die den entfernten Finder voraussetzen, bleiben ausdrücklich nicht unterstützt; ihre Fehler werden nicht als erfolgreicher Build kaschiert.

Prozesse nur im eigenen Terminal starten und kontrolliert beenden. Keine bestehenden Dienste stoppen, keine gemeinsame Datenbank verwenden und keine Entwicklungsdaten zurück in den Altbestand kopieren. `.local/` bleibt unabhängig vom verwerfbaren Buildverzeichnis erhalten.

## Prüfungen im Detail

Fokussierte native Tests nach `pnpm compose` und ausdrücklicher Freigabe aus `.build/t3/` starten, beispielsweise für den Core-Test:

```sh
pnpm --config.verify-deps-before-run=error --filter @paperkite/core exec vp test run --config ../../vite.config.ts --dir . src/RuntimePolicy.test.ts
```

Der äußere pnpm-Filter wählt das Paket und dessen Arbeitsverzeichnis. Für Server- beziehungsweise Webtests `--filter t3` beziehungsweise `--filter @t3tools/web` und die passenden nativen Testargumente verwenden; bei reinen Web-Unit-Tests ausdrücklich `vp test run --project unit <Dateien>` wählen, damit keine Browserprojekte vorbereitet werden. Ein Filter hinter `exec vp` begrenzt nicht pnpm selbst. Der Fehlermodus verhindert eine implizite Installation und lässt Abhängigkeitsprobleme als Fehler sichtbar werden.

Wenn die Sammelausgabe eines Typprüflaufs die Abbruchursache nicht zeigt, den Paket-Checker direkt aus `.build/t3/` ausführen und seinen Exitcode sowie die vollständige Datei prüfen:

```sh
pnpm --config.verify-deps-before-run=error --filter t3 exec effect-tsgo tsrs --noEmit --pretty false > ../../.local/logs/server-typecheck-full.log 2>&1
```

Eine Liste von Suggestions belegt weder einen fehlgeschlagenen Checker noch die Abwesenheit regulärer Fehler. Der direkte Lauf dient der Diagnose und ersetzt oder verändert `pnpm check` nicht.

Die Tests folgen [T3s Testregeln](../../vendor/t3/docs/internals/15_testing.md). Die Root-Pipeline führt weiterhin die vollständigen Web-/Server-Suiten aus, einschließlich Chromiumtests; lokal keine unaufgeforderten Vollsuiten starten.

Der Formatter prüft generierte Kopien unserer Quellen. Korrekturen anschließend in die zugehörigen Originalquellen übernehmen und erneut zusammensetzen; Änderungen nur am Buildoutput verschwinden. Bei geänderten Abhängigkeiten `pnpm lock` ausführen und den aktualisierten Produkt-Lockstand gemeinsam mit den Paketänderungen prüfen und versionieren; die normale Einrichtung verwendet weiterhin `--frozen-lockfile`.

Die geerbten Generator-, i18n- und Knip-Prüfungen laufen in CI zusätzlich. Der unveränderte i18n-Checker prüft auch Desktop-/Mobile-Kataloge und benötigt deren Abhängigkeiten. Der Quality-Job installiert deshalb dort den vollständigen nativen Workspace; die normale lokale Einrichtung bleibt gefiltert. Das aktiviert keine zusätzlichen Produktplattformen. Ein noch nicht gelaufener CI-Job ist keine bestandene Prüfung. Desktop-/Mobile-Releases und Deployment werden nicht durch diese Pipeline freigegeben.
