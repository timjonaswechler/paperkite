# T3 aktualisieren und später unabhängig werden

Dieser Ablauf beschreibt den vorhandenen Bootstrap, nicht bereits den gesamten [Zielentwurf](../internals/architecture.md). Produkt-Lockstand und Drei-Wege-Vorschläge für Overrides sind implementiert. Updates bleiben bewusste Quelländerungen, kein automatisches Deployment. Der Gitlink unter `vendor/t3/` und `integration/t3/upstream.json` müssen denselben Commit nennen. Alle Arbeiten erfolgen im eigenen MacBook-Branch; Vendor-Änderungen vorher ausschließen.

## Upstream aktualisieren

1. `pnpm upstream:check` ausführen und Release-/Migrationshinweise des Zielstands lesen.
2. Gitobjekte holen und einen konkreten Zielcommit auswählen, ohne den bisherigen Pin bereits umzustellen:

   ```sh
   git -C vendor/t3 fetch origin main
   pnpm --config.verify-deps-before-run=error upstream:plan <vollständiger-commit-sha>
   ```

   Nicht bloß einen beweglichen Branchnamen als Version speichern. `origin/main` ist ein Auswahlkandidat, kein Releaseversprechen. In einem flachen Repository müssen auch die benötigten alten und neuen Commitobjekte verfügbar sein.

3. Den ausgegebenen Plan unter `.local/upstream-plan-*/plan.json` prüfen. Er vergleicht das bisherige Upstream-Original, unseren Override und das neue Original. `unchanged-upstream` erhält unseren Inhalt; `merge-proposal` enthält einen konfliktfrei zusammengeführten Vorschlag, keine fachliche Freigabe. Konflikte, entfernte Originale, Binärdateien und Kollisionen mit eigenen Ergänzungen verlangen manuelle Entscheidung und führen zu Exitcode 1. Nicht reguläre Gitdateien und ungültige Basispins werden abgewiesen. Der Befehl ändert weder Quellen noch Pins oder Lockfiles. Optional kann nach dem Zielcommit ein Gitobjekt-Repository für einen isolierten Quellvergleich angegeben werden; ein weiterer Checkout ist nicht nötig.
4. Erst nach Prüfung die Quelle auf den Zielcommit umstellen (`git -C vendor/t3 checkout --detach <vollständiger-commit-sha>`). Die freigegebenen Vorschläge in unsere Override-Quellen übernehmen und deren Commit-/Hash-Metadaten in `integration/t3/composition.json` aktualisieren. Commit und Beobachtungszeit in `integration/t3/upstream.json` aktualisieren. Bei einer geänderten Upstream-Toolchain `package.json`, `.node-version` und CI-Setup gemeinsam anpassen. Gitlink und Metadaten gemeinsam vormerken: `git add vendor/t3 integration/t3/upstream.json`. Die Komposition verweigert unterschiedliche Pins und ungeprüfte Original-Hashes.
5. Mit `pnpm lock` den Produkt-Lockstand ausdrücklich aktualisieren und `pnpm setup` ausführen. Keine Abhängigkeiten in `vendor/t3/` installieren. Der Pinwechsel erzeugt einen frischen Buildworkspace; eine automatische Übernahme des Merge-Vorschlags erfolgt nicht.
6. `pnpm test`, `pnpm build`, `pnpm check` und die relevanten nativen Integrations-/Browserprüfungen ausführen. Zusätzlich CI auf genau diesem Stand abwarten. Provider-Replay statt ungefragter Modellkosten verwenden.
7. Erst nach separater Freigabe über Migration und Rollout entscheiden. Ein neuer Quellstand darf bestehende T3-Daten nicht ungeprüft öffnen.

Ein fehlgeschlagener Versuch wird nur in diesem Branch zurückgenommen: vorherigen Gitlink und die zugehörigen eigenen Änderungen wiederherstellen, dann neu zusammensetzen. Niemals alte Betriebsbackups über laufende Benutzerdaten zurückspielen.

## Was automatisch übernommen wird

Die verwendeten unveränderten T3-Module stammen nach dem Pinwechsel aus dem neuen Stand. Kein manuelles Übertragen ihrer Implementierung ist nötig. Ersetzte Dateien bleiben dagegen unsere Wartungsverantwortung. Die Hashprüfung erzwingt deren erneute Prüfung; sie löst Konflikte nicht selbst.

Die nötigen Ersetzungen einschließlich Begründung und Original-Hash stehen in [composition.json](../../integration/t3/composition.json). Der begrenzte Quellkompositionsnachweis zwischen `d7ae1e17915c40602e7eb47dce27a6a36167f4c4` und `43a0e74fb97672caed8b92fc38fc832bda4a5628` übernimmt geänderte native Dateien bytegleich und erhält die sieben Overrides. Unabhängige und kollidierende Änderungen am Override werden zusätzlich mit Git-Fixtures geprüft. Das ist kein vollständiger Anwendungsbuild oder Laufzeitvergleich beider Pins und kein Nachweis langfristiger Kompatibilität. Die verbleibenden Abnahmelücken stehen im [Arbeitsstand](../internals/architecture.md#9-arbeitsstand-von-schritt-3).

## Späterer Ausstieg

Vor Archivierung eines eigenen Forks festlegen, welche nativen Teile unverändert übernommen, selbst gepflegt oder ersetzt werden. Fachliche Paperkite-Identitäten und Daten müssen unabhängig von T3-Thread-/Projektidentitäten bleiben. Die tatsächlichen Integrationsgrenzen im Kompositionsvertrag und die Imports der Produktschicht sind der Ausgangspunkt, kein vorsorgliches Ersatzframework.

Gepinnte Quellen und relevante Buildabhängigkeiten müssen weiterhin verfügbar sein, beispielsweise über erhaltene Gitobjekte beziehungsweise ein eigenes Quellarchiv mit Prüfsummen. Lizenzen, Drittlizenzhinweise und Markenbedingungen bleiben gültig. Das Archivieren des Forks ist kein Löschen der Herkunft und kein Ende unserer Wartungspflicht.
