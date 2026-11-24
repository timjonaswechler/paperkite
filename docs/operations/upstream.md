# T3 aktualisieren und später unabhängig werden

Dieser Ablauf beschreibt den vorhandenen Bootstrap, nicht bereits den gesamten [Zielentwurf](../internals/architecture.md). Der Produkt-Lockstand ist implementiert; der Drei-Wege-Abgleich fehlt noch. Updates sind bewusste Quelländerungen, kein automatisches Deployment. Der Gitlink unter `vendor/t3/` und `integration/t3/upstream.json` müssen denselben Commit nennen. Alle Arbeiten erfolgen im eigenen Branch; Vendor-Änderungen vorher ausschließen.

## Upstream aktualisieren

1. `pnpm upstream:check` ausführen und Release-/Migrationshinweise des Zielstands lesen.
2. Die Quelle aktualisieren und einen konkreten Commit auswählen:

   ```sh
   git -C vendor/t3 fetch origin main
   git -C vendor/t3 checkout --detach <vollständiger-commit-sha>
   ```

   Nicht bloß einen beweglichen Branchnamen als Version speichern. `origin/main` ist ein Auswahlkandidat, kein Releaseversprechen.

3. Commit und Beobachtungszeit in `integration/t3/upstream.json` aktualisieren. Bei einer geänderten Upstream-Toolchain `package.json`, `.node-version` und CI-Setup gemeinsam anpassen. Keine Abhängigkeiten in `vendor/t3/` installieren.
4. Gitlink und Metadaten gemeinsam vormerken: `git add vendor/t3 integration/t3/upstream.json`. Die Komposition verweigert unterschiedliche Pins.
5. Die erfassten Overrides gegen altes und neues Upstream-Original prüfen, in unseren Quellen anpassen und ihre Commit-/Hash-Metadaten aktualisieren. Die Komposition weist abweichende Original-Hashes zurück; sie führt keinen Drei-Wege-Merge aus. Danach mit `pnpm lock` den Produkt-Lockstand aktualisieren und `pnpm setup` ausführen. Der Pinwechsel erzeugt einen frischen Buildworkspace.
6. `pnpm test`, `pnpm build`, `pnpm check` und die relevanten nativen Integrations-/Browserprüfungen ausführen. Zusätzlich CI auf genau diesem Stand abwarten. Provider-Replay statt ungefragter Modellkosten verwenden.
7. Erst nach separater Freigabe über Migration und Rollout entscheiden. Ein neuer Quellstand darf bestehende T3-Daten nicht ungeprüft öffnen.

Ein fehlgeschlagener Versuch wird nur in diesem Branch zurückgenommen: vorherigen Gitlink und die zugehörigen eigenen Änderungen wiederherstellen, dann neu zusammensetzen. Niemals alte Betriebsbackups über laufende Benutzerdaten zurückspielen.

## Was automatisch übernommen wird

Die verwendeten unveränderten T3-Module stammen nach dem Pinwechsel aus dem neuen Stand. Kein manuelles Übertragen ihrer Implementierung ist nötig. Ersetzte Dateien bleiben dagegen unsere Wartungsverantwortung. Die Hashprüfung erzwingt deren erneute Prüfung; sie löst Konflikte nicht selbst.

Die nötigen Ersetzungen einschließlich Begründung und Original-Hash stehen in [composition.json](../../integration/t3/composition.json). Ein Upgradebeweis über zwei verschiedene Pins und ein visueller Chat-/Panelnachweis stehen noch aus; der bisherige Laufzeitnachweis ist im [Arbeitsstand](../internals/architecture.md#9-arbeitsstand-von-schritt-3) festgehalten. Der vorhandene Mechanismus allein belegt keine langfristige Kompatibilität.

## Späterer Ausstieg

Vor Archivierung eines eigenen Forks festlegen, welche nativen Teile unverändert übernommen, selbst gepflegt oder ersetzt werden. Fachliche Paperkite-Identitäten und Daten müssen unabhängig von T3-Thread-/Projektidentitäten bleiben. Die tatsächlichen Integrationsgrenzen im Kompositionsvertrag und die Imports der Produktschicht sind der Ausgangspunkt, kein vorsorgliches Ersatzframework.

Gepinnte Quellen und relevante Buildabhängigkeiten müssen weiterhin verfügbar sein, beispielsweise über erhaltene Gitobjekte beziehungsweise ein eigenes Quellarchiv mit Prüfsummen. Lizenzen, Drittlizenzhinweise und Markenbedingungen bleiben gültig. Das Archivieren des Forks ist kein Löschen der Herkunft und kein Ende unserer Wartungspflicht.
