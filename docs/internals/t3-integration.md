# Quellbefunde zu den T3-Integrationsgrenzen

Diese Befunde begründen den [maßgeblichen Architekturentwurf](architecture.md). Sie sind weder eine zusätzliche Architekturentscheidung noch eine Auswahl späterer Produktfunktionen. Geprüft wurde der [gepinnte T3-Stand](../../integration/t3/upstream.json), Commit `43a0e74fb97672caed8b92fc38fc832bda4a5628`; die Aussagen wurden durch Quelllektüre, nicht durch Ausführung der betroffenen Dienste gewonnen.

## Anwendungskomposition ist nicht allgemein austauschbar

[`server.ts`](../../vendor/t3/apps/server/src/server.ts) exportiert `runServer`, während wesentliche Kompositions-Layer privat bleiben. `layerRuntimeCoreDependenciesBase` baut unter anderem Settlement- und PR-Worker auf. `layerMakeRoutes` bindet Browser-, Peer- und weitere Produktbereiche ein. Ein eigener Dienst neben diesem unveränderten Einstieg entfernt diese Arbeit nicht.

[`ws.ts`](../../vendor/t3/apps/server/src/ws.ts) beschafft beim Aufbau von `layerWsRpc` unter anderem Terminal-, Preview-, Geräte-, Update- und Peer-Dienste. Einzelne Layer wegzulassen kann deshalb Pflichtabhängigkeiten anderer Layer verletzen. Eine bloße Filterung sichtbarer RPC-Namen macht diese Abhängigkeiten nicht optional. Dagegen sind im [MCP-Server](../../vendor/t3/apps/server/src/mcp/McpHttpServer.ts) verschiedene Toolkit-Layer einzeln exportiert und damit grundsätzlich zusammensetzbar.

[`ServerEnvironment.ts`](../../vendor/t3/apps/server/src/environment/ServerEnvironment.ts) meldet zahlreiche Fähigkeiten fest als verfügbar. Die Auskunft muss zum wirklichen Funktionsumfang passen. Eine geänderte Auskunft allein verhindert jedoch keine Ausführung.

Die [FeatureFlags](../../vendor/t3/packages/shared/src/FeatureFlags.ts) sind einzelne experimentelle Schalter, kein allgemeines Produktprofil. Die [Managed Policy](../../vendor/t3/packages/contracts/src/managedPolicy.ts) besitzt echte Einschränkungen für einige Bereiche wie Updates, Connect und Preview-Tunnel. Sie bietet nicht für jede native Funktion einen allgemeinen Ausschalter.

## Web- und Laufzeitabhängigkeiten

[`AppSidebarLayout.tsx`](../../vendor/t3/apps/web/src/components/AppSidebarLayout.tsx) bindet die native Threadsidebar direkt ein. Eigene Navigation kann deshalb nicht einfach als beliebige Sidebar-Komponente übergeben werden. Wie wenig Anpassung für die gewünschte Integration nötig ist, muss am konkreten Einstieg nachgewiesen werden.

[`binMain.ts`](../../vendor/t3/apps/server/src/binMain.ts) behandelt interne Hilfsbefehle für Providerworker, Dokumentverarbeitung und ACP-MCP-Bridges. Ein eigener Programmeinstieg darf diese für die verwendeten Adapter benötigten Aufrufpfade nicht unbeabsichtigt abschneiden.

[`runtimeLayer.ts`](../../vendor/t3/apps/server/src/orchestration-v2/runtimeLayer.ts) und [`CheckpointService.ts`](../../vendor/t3/apps/server/src/orchestration-v2/CheckpointService.ts) koppeln Checkpoints an native Läufe. Das ist ein Hinweis auf möglichen Änderungsaufwand, keine Empfehlung oder Entscheidung zur Verwendung von Git im späteren Produkt.

## Eigenes Datenhome allein verhindert nicht alle Berührungspunkte

[`resolveBaseDir`](../../vendor/t3/apps/server/src/os-jank.ts) fällt ohne ausdrückliche Vorgabe auf `~/.t3` zurück. [Die Pfadableitung](../../vendor/t3/apps/server/src/config.ts) legt Datenbank, Settings, Secrets, Anhänge und Laufzeitstatus unter dem gewählten Home ab.

[`resolveHostCliCommand`](../../vendor/t3/apps/server/src/cli/invocation.ts) kann ein globales `t3` aus dem `PATH` wählen. Ein eigener Server mit fremdem CLI-Aufruf wäre deshalb keine durchgängige Trennung.

[ManagedPolicy](../../vendor/t3/apps/server/src/policy/ManagedPolicy.ts) verwendet standardmäßig [maschinenweite Ladewege](../../vendor/t3/packages/shared/src/managedPolicyFile.ts), unter Linux `/etc/t3code/policy.json`. Das darf nicht als Paperkite-eigene Produktkonfiguration beschrieben oder ungefragt verändert werden. Native Update- und Dienstverwaltung besitzt außerdem eigene Launcher- und Installationskonventionen; siehe [Serverupdates](../../vendor/t3/docs/internals/07_server-updates.md).

Die konkreten Home-/Konfigurationspfade verwendeter Provideradapter sind vor echtem Providerbetrieb separat zu prüfen. Aus getrennten T3-Daten lässt sich keine vollständige Isolation der Provider-CLIs ableiten.

## Was diese Untersuchung nicht belegt

Die Befunde belegen fehlende oder eingeschränkte Anschlussstellen, nicht die Funktionsfähigkeit unseres Overlay- oder Laufzeitvorschlags. Noch nicht nachgewiesen sind der vollständige Produktbuild, das Weglassen konkreter Dienste, eine isolierte native Chat-/Panelnutzung und ein Upgrade zwischen zwei Pins. Ebenso ist nicht garantiert, dass Symlinks für die Modulauflösung aller verwendeten Werkzeuge geeignet sind. Diese Ausführungsnachweise gehören in Schritt 3.
