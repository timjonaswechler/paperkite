# CV-Daten und eigene LaTeX-Vorlagen

**Stand: 20.11.2026. Status: Diskussionsentwurf, nicht implementiert.** Ziel ist eine eigene hochgeladene LaTeX-Vorlage, deren vorgesehene Stellen beim Build mit strukturierten CV-Daten aus der App befüllt werden. Der Inhalt soll nicht bei jeder Bearbeitung in neu angelegte, dauerhaft zu pflegende TeX-Dokumente umgeschrieben werden.

## Festgehaltene Anforderungen

- Die Bedienung von [Variante 3](../prototypes/cv-kompakt/accepted/2026-11-20-v1/document-editor.html) ist freigegeben; Umfang und Hash stehen in [acceptance.json](../prototypes/cv-kompakt/accepted/2026-11-20-v1/acceptance.json).
- Freigegeben ist die direkte Dokumentbearbeitung mit Hinzufügen und zusätzlichen Stichpunkten, nicht das Beispiel-Layout oder dessen feste Abschnitte.
- Die eigene LaTeX-Vorlage bestimmt das spätere PDF-Layout. Ein Abschnitt „Profil/Kurzprofil“ ist optional und darf bei fehlenden Daten nicht automatisch ergänzt werden.
- Einträge werden über die Weboberfläche verwaltet. Layout und Inhalt müssen getrennt bleiben; reguläre Inhaltsänderungen schreiben nicht fortlaufend die LaTeX-Vorlage um.
- Bestehende Bewerbungen, Quellen und native Chats werden während dieser Konzeptarbeit nicht migriert oder verändert.

## Geprüfter Istzustand

Der aktuelle CV-Editor lädt ein Lua-Profil und schreibt Änderungen wieder in dieselbe Profildatei. Der Import erwartet ein bestimmtes Paket mit `cv/Lebenslauf.tex` und `cv/lua/loader.lua`; ein beliebiges LaTeX-Projekt wird noch nicht allgemein unterstützt. Der Builder verwendet für CVs LuaLaTeX, einen festen Einstiegspunkt und einen isolierten Quellensnapshot. Die Datenbank ist derzeit nicht alleinige Quelle der CV-Inhalte.

Nachweise: [CV-Editor](../vendor/t3/apps/web/src/bewerbung/components/DocumentEditors.tsx), [Profilzugriffe](../server/store.ts), [Importregeln](../server/files.ts), [Vorlagenverwaltung](../server/templates.ts), [Build-Snapshots](../server/builds.ts), [LaTeX-Runner](../builder/build.py).

## Vorgeschlagene Trennung

### 1. CV-Dokument: Inhalte und Revision

Ein bewerbungsbezogenes CV-Dokument enthält Kontaktdaten und eine geordnete Liste tatsächlich vorhandener Abschnitte. Abschnitte enthalten Einträge; Einträge enthalten typisierte Felder und gegebenenfalls geordnete Stichpunkte. Abschnitte, Einträge und Stichpunkte erhalten stabile IDs, unabhängig von ihrer Reihenfolge.

Bekannte Abschnittstypen können Berufserfahrung, Ausbildung und Kenntnisse sein; eigene Abschnitte müssen möglich bleiben. „Kurzprofil“ ist nur ein möglicher Typ, kein verpflichtendes Feld. Benutzerdefinierte Felder dürfen nicht beim Wechseln oder Speichern eines Editors verschwinden. Daten sind strukturierter Inhalt, nicht die HTML-Darstellung des Prototyps und nicht frei ausführbarer TeX-Code.

**Speichervorschlag:** zunächst ein schema-validiertes, revisioniertes CV-Dokument in SQLite mit strukturiertem JSON-Inhalt. Konkrete Tabellen und Feldnamen sind noch offen. Es soll genau eine maßgebliche Inhaltsquelle geben, keine unkontrollierten parallelen Schreibstände in Datenbank und Lua-Datei.

Ein zentraler Basislebenslauf zum Wiederverwenden ist ein möglicher zusätzlicher Dokumenttyp, noch keine beschlossene Pflichtfunktion. Falls eingeführt, sollen Bewerbungen unabhängige Übernahmen erhalten: Änderungen an Bewerbung A dürfen weder Bewerbung B noch bereits gebaute PDFs ändern.

### 2. Vorlagenversion: Layout und Datenzuordnung

Eine Vorlagenversion umfasst LaTeX-Quellen, benötigte Assets, Einstiegspunkt, passende Engine sowie die Zuordnung zwischen CV-Daten und Vorlagenstellen. Das hochgeladene Original bleibt nachvollziehbar; eine nötige einmalige Anpassung der Vorlage wird ausdrücklich bestätigt und als neue Version geführt.

Die Zuordnung muss einmal festlegen, wie etwa Name, berufliche Stationen und Stichpunkte in die vorhandenen LaTeX-Befehle gelangen. Listen werden zur Buildzeit durchlaufen; es gibt keine feste Zahl von Stationen oder Platzhalter nur für „Job 1 bis 3“. Abschnittsbezeichnungen und Darstellung kommen aus der gewählten Vorlage beziehungsweise ihrer Zuordnung. Erforderliche Daten sind vorlagenspezifisch, nicht globale Pflichtabschnitte der App.

**Kein blindes Suchen/Ersetzen:** Aus beliebigem TeX lässt sich nicht zuverlässig ableiten, welcher Text ein Datenfeld ist. Empfohlen ist ein einmaliger geprüfter Adapter, der vorhandene Vorlagenbefehle beziehungsweise explizite Einfügestellen an die Daten anbindet. Die vorgeschlagene konkrete Ausgestaltung sind [Vorlagen-Mods mit einem eigenen KI-Thread für die einmalige Adaptererstellung](vorlagen-mods.md). Der Thread erstellt die Anbindung, feste App-Prüfungen und eine echte Build-Vorschau prüfen sie. Normale PDF-Builds benötigen danach keine KI-Runde.

Ein Vorlagenwechsel löscht keine bisher erfassten Inhalte. Nicht verwendete Felder bleiben erhalten und werden kenntlich gemacht. Reihenfolge und Sichtbarkeit der Ausgabe sind explizite Einstellungen der Vorlage/Zuordnung; auch hier ist kein „Profil“-Abschnitt vorgegeben.

### 3. Build: reproduzierbarer Datenstand

Ein Build bindet eine feste CV-Revision, Vorlagenversion und Adapterversion zusammen. Aus diesem Stand wird im isolierten Buildverzeichnis eine technische Dateneingabe erzeugt, etwa Lua/JSON oder TeX-Makros, je nach bestätigter Integration. Die Vorlage liest diese Daten an den vorgesehenen Stellen ein und erzeugt die PDF.

Diese technische Transferdatei ist keine neue manuell zu pflegende Lebenslauf-Quelldatei bei jeder Bearbeitung. Datenbankzugriffe oder Netzwerkzugriff aus LaTeX sind nicht nötig. Der gespeicherte Build-Snapshot und bereits erstellte PDFs bleiben unveränderlich. Normale Texte werden für den gewählten Ausgabekanal korrekt maskiert; Text wie `&`, `%` oder `_` darf nicht versehentlich zu ausführbarem TeX werden.

## Webansicht und bestehende Quellen

Der akzeptierte Prototyp beschreibt die kompakte Bearbeitung, nicht eine garantierte pixelgenaue LaTeX-Vorschau. Der spätere Editor zeigt die tatsächlich vorhandenen Abschnitte und Felder des Dokuments. Das exakte PDF-Layout stammt aus der hochgeladenen Vorlage und wird mit dem echten Build geprüft.

Bestehende Lua-Profile brauchen einen ausdrücklichen, verlustarmen Import einschließlich zusätzlicher literaler Felder. Individuelle Lua-Logik darf nicht stillschweigend zu vermeintlich gleichwertigen Daten konvertiert werden. Auch bewusst über native Werkzeuge geänderte Datenquellen benötigen eine klar geregelte, revisionsgeprüfte Übernahme statt stiller gegenseitiger Überschreibungen. Dafür wird keine neue Einschränkung allgemeiner nativer Werkzeuge oder Providerrechte vorgeschlagen.

## Nächster konkreter Schritt

Die genannte eigene Mac-/iCloud-Vorlage als vollständiges Paket mit Hauptdatei, eingebundenen Dateien und benötigten Assets ansehen, gern mit fiktiven Personendaten. Der Mac ist als verknüpft und erreichbar gemeldet; der Ordnerinhalt wurde noch nicht gelesen. Der Pfad existiert nicht lokal auf srv, und die direkten Dateiwerkzeuge dieser Sitzung bieten keinen Mac-Dateizugriff. Daran werden benötigte Abschnitte/Felder, Engine und die einmalige Datenanbindung konkret entworfen. Erst danach das Produktionsschema, den Import-/Adaptervertrag und die Migration festlegen. Es ist noch keine Umsetzung oder Ausrollung dieses neuen Modells beauftragt worden.

Vor Umsetzung gezielt zu prüfen: Vorlage ohne Kurzprofil; zusätzliche eigene Abschnitte; beliebig viele Einträge/Stichpunkte; Sonderzeichen; unveränderte Vorlagenquellen bei Inhaltsänderungen; unabhängige Bewerbungen; Konflikte beim Speichern; korrekte Aktualitätsanzeige und reproduzierbare PDFs aus alten Daten-/Vorlagenversionen.
