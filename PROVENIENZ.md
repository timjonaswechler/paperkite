# Quellherkunft – T3 mit Bewerbungsnavigation

## Verwendeter Stand

- Original: [pingdotgg/t3code v0.1.10](https://github.com/pingdotgg/t3code/tree/7d32075e3757ded707914e2450c3e392a9665765), Commit `7d32075e3757ded707914e2450c3e392a9665765`, MIT.
- Das auf srv tatsächlich laufende Programm war `~/.t3/runtime/versions/0.1.10/t3`, nicht die ältere Launcher-Version im Dienstpfad.
- Eigene, unveränderte Linux-x64-Runtime-Kopie; Programm-SHA-256: `a07bbbfbabb609d5a3d15926b06a3c57b03cf25e29f68ac10886b95784c0e303`.
- Vollständiger tatsächlicher T3-Quellbaum unter `vendor/t3/`, einschließlich Backend, Contracts, Client-Runtime, Providern, Original-Webclient und Lizenzbeständen. Externe `.repos/`-Referenzcheckouts und generierte Abhängigkeiten/Builds sind kein Teil dieser Kopie. Version und Audit: `native-t3/source.json`, `native-t3/source-audit.json`.
- Eigene Runtime-Dateien liegen unter `native-t3/runtime/`; nie die installierte Runtime umschreiben. Der Server verwendet ausschließlich `data/native-t3/` als neues T3-Datenhome.

## Originale Chatgrenze

Der vollständige T3-Webclient bildet weiterhin die Basis; das gepinnte Backend ist unverändert. Kein iframe, kein nachgebauter Chat und kein Ersatz-Provideradapter. Originale Verlauf-/Werkzeugdarstellung, Anhänge/Kontext, Stores/Reducer, Orchestrierung, Provider und Berechtigungsmodi bleiben die Grundlage.

Auf Benutzerwunsch ist die Frontend-Grenze inzwischen größer als die früheren zwei Integrationsstellen: Die T3-Seitenleistenschale enthält ausschließlich Bewerbungen und deren native Chats. Eine gemeinsame Fachsteuerung verwaltet Anlegen, Status, Unterlagen und Löschen auch während der Chatansicht. Separate Projekt-/Thread-Navigation, alte Command-Palette und doppelte Seitenleiste sind nicht mehr im aktiven UI-Pfad. Vorhandene native IDs bleiben technische Zuordnungen; zusätzliche Chats verwenden das lokale Bewerbungsarbeitsverzeichnis statt neuer Worktrees.

Markierte Einstellungsseiten sind ohne Feature-Komponenten registriert und lehnen direkte Navigation ab. Such-/Menü-/Shortcut-Einstiege, Spracheingabe im Composer, Branch-/Worktree-Auswahl und Verbindungs-/Freigabe-Dialoghosts wurden angepasst beziehungsweise entfernt. Das ist **noch kein vollständiger Funktionsabbau aller Frontend-Einstiege und des Originalbackends**; dessen Implementierungen und native APIs bleiben im gepinnten Programm vorhanden. Sie werden nicht als bereits entfernt ausgewiesen.

PDF-Autobuild, Vorlagen und Unterlagenbibliothek sind direkt in die native Einstellungsseite „Bewerbungen“ eingebettet, mit originalem Seitencontainer, Einstellungsgruppen und Suchzielen. Der zusätzliche Fach-Einstellungsdialog ist aus dem aktiven Frontend entfernt. Die Fachpersistenz enthält keine eigenen Theme-, Sendetasten- oder Providerdefaults mehr; die Migration bereinigt nur diese Altwerte, nicht die nativen Einstellungen.

Neue Fachrouten und `apps/web/src/bewerbung/` verwenden originale UI-Primitiven/Theme-Tokens. Neue Chats verwenden originale Draft-/Projekt-/Chatoperationen ohne automatische Prompts, Modellwechsel oder zusätzliche Werkzeug-Allowlist. Die tatsächlichen Abweichungen vorhandener Originaldateien und neuen Fachdateien stehen in `native-t3/source-audit.json`.

Der komplette originale Server wird als geprüftes Programm gestartet, nicht aus ausgewählten früher extrahierten Modulen zusammengesetzt. Native Endpunkte einschließlich WebSockets werden weitergereicht; nur die Einstiegspfade `/` und `/pair` leiten direkt zur Bewerbungsverwaltung. Der Host-Header bleibt für die originale Cookie-/Origin-Prüfung erhalten. Auf ausdrücklichen Benutzerwunsch ersetzt der NetBird-Zugang das Browser-Pairing: Der Gateway setzt intern ein eigenes natives Sitzungscookie, ohne den Token an den Browser auszugeben. Die Sitzung stammt aus dem originalen `auth session issue` im eigenen App-Datenhome, nicht aus einer installierten Benutzer-/Owner-Anmeldung. Explizite API-Tokens bleiben unverändert; fremde Hosts und Web-Ursprünge werden vor der internen Anmeldung abgewiesen.

## Anwendungseigene Grenzen

`server/{app,store,t3-runtime,t3-access,t3-home,t3-workspace,t3-projects,t3-documents,t3-gateway,t3-main}.ts` verbinden das unveränderte T3 mit der vorhandenen Fachverwaltung:

- Eigene SQLite, Bewerbungen/Quellen, Anlagen/Tags, Vorlagen, Build-/PDF-Aufträge und read-only Altarchiv.
- Echte native Projekte im jeweiligen bestehenden unabhängigen Arbeitsverzeichnis; keine synthetischen Orchestrierungsereignisse.
- NetBird-Zugang ohne Browser-Pairing über eine eigene native Gateway-Sitzung; originale Dateirechtsprüfung für die Fach-API und zusätzliche Projektberechtigungen durch T3 selbst.
- Revisionsabgleich verwalteter Quellen, unabhängige Unterlagen-Arbeitskopien sowie bestätigtes fachliches Löschen erst nach nativer Prozess-/Outbox-Bereinigung.
- Unabhängige native Sitzungsablagen über originale Provider-Konfiguration. Keine übernommenen alten Tool-Allowlist-/Systemprompt-/Freigabeflags.

`migrate-native-sessions.ts` bereitet nur unabhängige Kopien vor. Der Import selbst erfolgt über die originale authentifizierte T3-Willkommensoberfläche (`agentSessions.scan/import`). Native Sitzungsidentitäten bleiben erhalten, die dargestellte native Historie ist nach originalen Grenzen beschränkt. Das vollständige alte Facharchiv und ungesendete Entwürfe bleiben separat lesbar. Die kopierten Codex-Indizes benötigen aktualisierte `rollout_path`-Präfixe; der native Resume wurde ohne Modellturn mit einer vollständigen synthetischen Home-Kopie geprüft.

## Historischer Bestand

`src/`, der alte Harness und die früher extrahierten v0.1.9-Komponenten/Transportdateien bleiben Kompatibilitäts-/Testbestand und Teil der nachvollziehbaren Git-Historie. Sie sind **nicht** der ausgelieferte Chat. Der kanonische Start besitzt keinen Legacy-Fallback; alte Chat-Mutationsendpunkte liefern 410. Historische Provenienz/Prüfungen in älteren Git-Ständen beschreiben das frühere Produkt, nicht die aktuelle native Policy.

## Dokumentverarbeitung und Lizenzen

Lua-Literalparser, Fach-APIs, Tags, Vorlagen, Dateikopien, TeX-Builds und lokale PDF-Werkzeuge sind anwendungseigen. Ihre fachlichen Quoten/Dateiformate sind keine zusätzlichen nativen Chat-Werkzeugbeschränkungen. TeX und PDF-Verarbeitung bleiben isolierte Offline-Container; native Provider sind normale vertrauenswürdige Hostprozesse, keine zugesagte zusätzliche OS-Sandbox.

PDF-Laufzeit: qpdf 12.2.0, Ghostscript 10.05.1, img2pdf 0.6.1, Pillow 11.1.0; konkrete Image-ID in `pdf-tools/image-id`. Keine Cloud-Konvertierung, kein Versprechen über Signaturerhalt oder eine Zielgröße. Referenzen: [qpdf](https://qpdf.readthedocs.io/en/stable/cli.html), [Ghostscript](https://ghostscript.readthedocs.io/en/latest/VectorDevices.html), [img2pdf](https://pypi.org/project/img2pdf/).

MIT-/Drittlizenzbestände bleiben in `vendor/t3/LICENSE`, `vendor/t3/third-party-licenses/`, der kopierten Runtime und den jeweiligen Abhängigkeiten erhalten. Die früheren Hinweise `vendor/LICENSE-T3` und `src/T3-LICENSE.txt` bleiben ebenfalls erhalten. Originale Pi-/Codex-/T3-Programme und Mac-Quelldateien werden nicht ersetzt. Normale native Anmeldung wird genutzt, Tokeninhalte werden nicht in Migrationsartefakte kopiert.
