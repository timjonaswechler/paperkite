# CV-Daten und eigene LaTeX-Vorlagen

**Stand: 21.11.2026. Status: erste integrierte Fassung für Bewerbungs-CVs und Vorlagen-Mods; zentrale Master-Verwaltung weiterhin Entwurf.** Die beiden Prototypen sind auf `prototype/cv-mod-import` in die App eingebunden. Der [isolierte Entwicklungsstart](../prototypes/cv-mod-import/README.md) bleibt erhalten. Die erste Daten-ABI ist ausdrücklich versioniert und noch keine Zusage allgemeiner LaTeX-Kompatibilität. Ziel ist eine eigene hochgeladene LaTeX-Vorlage, deren vorgesehene Stellen beim Build mit strukturierten CV-Daten aus der App befüllt werden. Der Inhalt soll nicht bei jeder Bearbeitung in neu angelegte, dauerhaft zu pflegende TeX-Dokumente umgeschrieben werden.

## Maßgebliches Ziel und erster Formular-Prototyp

Der verbindliche [Mod-/Primitives-Vertrag und Evaluator A–H](vorlagen-mods.md#verbindliches-produktziel-vorlage-bestimmt-formular) beschreibt die neue Richtung. Nicht die Vorlage in feste CV-Felder pressen: Der Mod definiert das Formular aus App-Primitives. Der erste v2-Durchstich ist auf dem Prototypen-Branch Teil der normalen App: Formularrenderer und alter Editor teilen Lebenslaufbereich, Start, Build und PDF-Vorschau. Generische `values` mit stabilen Eintrags-IDs und `included` liegen bewerbungsbezogen in `cv_form_values`; feste Mod-Pakete in `cv_form_mods`, beides in derselben Fach-Datenbank. `cv_documents.mod_id` bindet die gewählte Version (`form:`-Präfix für v2). Die Tabellen werden ergänzt, bestehende CV-Inhalte aber nicht automatisch migriert oder überschrieben. Der alte `CvData`-/Lua-Stand bleibt beim ausdrücklichen Formularwechsel erhalten und ist nach dem Rückwechsel wieder verfügbar. Kopieren erzeugt unabhängige Formularwerte; Bewerbungslöschung entfernt sie mit. Keine Tabelle je Vorlage. Formular und Layout sind fest versioniert; Werte unabhängig. Sichere nicht zugeordnete Werte bleiben erhalten, inkompatible Typbindungen werden abgewiesen. Die nachfolgenden konkreten v1-Felder beschreiben weiterhin den laufenden Übergang, keine globale Pflichtstruktur für v2.

## Festgehaltene Anforderungen

- Die Bedienung von [Variante 3](../prototypes/cv-kompakt/accepted/2026-11-20-v1/document-editor.html) ist freigegeben; Umfang und Hash stehen in [acceptance.json](../prototypes/cv-kompakt/accepted/2026-11-20-v1/acceptance.json).
- Freigegeben ist die direkte Dokumentbearbeitung mit Hinzufügen und zusätzlichen Stichpunkten, nicht das Beispiel-Layout oder dessen feste Abschnitte.
- Die eigene LaTeX-Vorlage bestimmt das spätere PDF-Layout. Ein Abschnitt „Profil/Kurzprofil“ ist optional und darf bei fehlenden Daten nicht automatisch ergänzt werden. Die hochgeladene eigene Vorlage ist kein Pflichtschema für andere Vorlagen.
- Rolle/Berufsbezeichnung kann als optionale CV-Angabe vorhanden sein; sie ist von der abgelehnten Verwaltung benannter Inhaltsvarianten zu unterscheiden. Einträge können Fließtext, Stichpunkte oder eine Mischung enthalten. Die Mod bindet diese Formen an das jeweilige Layout an.
- Einträge werden über die Weboberfläche verwaltet. Layout und Inhalt müssen getrennt bleiben; reguläre Inhaltsänderungen schreiben nicht fortlaufend die LaTeX-Vorlage um.
- Keine Inhaltsvarianten oder Rollenprofile: kein Variantenobjekt im neuen Datenmodell, kein Variantenparameter und keine Variantenauswahl in der Oberfläche. Es gibt einen Master-Lebenslauf und einen unabhängigen CV-Stand je Bewerbung; Layout-Mods bleiben davon getrennt.
- Bestehende Bewerbungen, Quellen und native Chats bleiben beim Update erhalten. CV-Daten werden erst beim ausdrücklichen Speichern übernommen; kein automatisches Zusammenführen alter Rollendateien.

## Geprüfter Istzustand

Für den v1-Übergang verwendet der [Dokumenteditor](../vendor/t3/apps/web/src/bewerbung/components/CvEditor.tsx) ein bewerbungsbezogenes JSON-Dokument in `cv_documents`: Person, geordnete Abschnitte/Einträge und Absatz-/Listenblöcke mit IDs. [CvDocuments](../server/cv-documents.ts) liest vorhandene literale Daten aus persönlichem Stamm, Bildungskatalog und der bereits verwendeten Lua-Datei. Speichern prüft Bewerbungsrevision und Quellenfingerprint, erhält zusätzliche Literalfelder und schreibt eine kompatible Datenprojektion zurück; LaTeX-Layoutquellen werden nicht verändert. Misslingt der Datenbankschreibzugriff, werden Revision und projizierte Quelldateien wiederhergestellt. Native Quelländerungen werden nicht aus einem alten Editorstand überschrieben; inkompatible individuelle Lua-Logik bleibt ein Fall für die erweiterten Quellen.

Ein Eintrag besitzt optional `included` (fehlend bedeutet eingeschlossen). Ausgeschlossene Einträge bleiben vollständig im Bewerbungs-CV und in der kompatiblen Lua-Projektion (`cv_included`) erhalten. Der Build erhält nur eingeschlossene Einträge; vollständig ausgeschlossene Abschnitte werden nicht als leere Überschriften ausgegeben. Änderungen allein an ausgeschlossenen Inhalten machen einen ansonsten unveränderten Mod-/Makro-Build nicht veraltet. Individuelle Altvorlagen ohne die unterstützte Makro-Anbindung benötigen für diese Auswahl einen Mod, statt ausgeschlossene Inhalte still zu drucken.

Die Weboberfläche bearbeitet den Inhalt eines Eintrags in einem gemeinsamen Texteditor. Absatz-/Listenblöcke bleiben das technische Speicherformat, sind aber keine separat hinzuzufügenden UI-Objekte. Feldbeschriftungen und Auswahlwerkzeuge gehören zur Bearbeitung; im Lesenmodus fehlen sie und ausgeschlossene Einträge.

Damit ist SQLite für normal gespeicherte CV-Dokumente maßgeblich, aber noch nicht die einzige erlaubte Schreibschnittstelle: bewusste externe Änderungen an den alten Lua-Daten invalidieren deren Fingerprint und werden neu eingelesen. Das ist ein expliziter Übergangsvertrag, keine abgeschlossene Entfernung des alten Quellenmodells.

Ein gewählter Mod ist mit seiner unveränderlichen geprüften Versions-ID gebunden. [Builds](../server/builds.ts) halten Daten, Adapter und Quellen fest und erzeugen daraus technische Lua-Daten. Für die vorhandene Loader-/Makrostruktur gibt es eine Build-Snapshot-Anbindung an Absätze und Listen; sie ändert die ursprünglichen Layoutdateien nicht. Andere individuelle Layouts benötigen einen geprüften Mod oder ihre bisherige Quellenbearbeitung. Der vollständige alte JSON-Quellenimport bleibt kompatibel bestehen.

## Vorgeschlagene Trennung

### 1. CV-Dokument: Inhalte und Revision

Ein bewerbungsbezogenes CV-Dokument enthält Kontaktdaten und eine geordnete Liste tatsächlich vorhandener Abschnitte. Abschnitte enthalten Einträge mit typisierten Feldern und geordneten Inhaltsblöcken. Vorgesehen sind mindestens Textabsätze und Stichpunktlisten; ein Eintrag darf mehrere Absätze, eine Liste oder eine Mischung enthalten. Abschnitte, Einträge, Inhaltsblöcke und einzelne Listenelemente erhalten stabile IDs, unabhängig von ihrer Reihenfolge. Die erste Fassung verwendet `person`, `sections`, `entries`, `fields` und `content`; Erweiterungen benötigen einen kompatiblen Versionsvertrag.

Bekannte Abschnittstypen können Berufserfahrung, Ausbildung und Kenntnisse sein; eigene Abschnitte müssen möglich bleiben. „Kurzprofil“ ist nur ein möglicher Typ, kein verpflichtendes Feld. Optionale Angaben wie Rolle/Berufsbezeichnung werden über gemeinsame Felddefinitionen beziehungsweise typisierte Mod-Erweiterungen beschrieben und nur bei tatsächlichem Bedarf angeboten. Sie sind keine Rollenprofil- oder Variantenfunktion. Benutzerdefinierte Felder dürfen nicht beim Wechseln oder Speichern eines Editors verschwinden. Daten sind strukturierter Inhalt, nicht die HTML-Darstellung des Prototyps und nicht frei ausführbarer TeX-Code.

**Umgesetzt im Übergangsstand:** schema-validiertes CV-JSON in `cv_documents` mit Quellenfingerprint und optionaler fester Mod-Version. Die Bewerbung liefert die gemeinsame Revision. Aktuelle Feldnamen stehen in [shared/api.ts](../shared/api.ts); die ABI lautet `bewerbung-cv-mod-prototype-v1`. Die kontrollierte Lua-Projektion dient bestehenden Quellenwerkzeugen, nicht einer zusätzlichen Inhaltsvariantenverwaltung.

Ein zentraler Master-Lebenslauf enthält den wiederverwendbaren Ausgangsbestand. Jede Bewerbung erhält daraus einen unabhängigen, revisionierten CV-Stand. Auswahl, Reihenfolge und Formulierungen werden direkt für diese Bewerbung angepasst, nicht in zusätzlichen benannten Inhaltsvarianten verwaltet. Änderungen an Bewerbung A dürfen weder Master noch Bewerbung B oder bereits gebaute PDFs ändern. Änderungen am Master aktualisieren bestehende Bewerbungen nicht stillschweigend.

#### Konkretisierung aus dem bereitgestellten `cv.zip`

Die [statisch geprüfte Vorlage](vorlagen-mods.md#erster-kandidat-hochgeladenes-cvzip) trennt bereits gemeinsame Personendaten, einen Bildungsbestand mit ausgewählten Quellschlüsseln und vier alte Rollendateien. Diese Dateien beschreiben nur die vorhandene Importquelle; sie werden ausdrücklich nicht als Inhaltsvarianten in das neue System übernommen. Daraus folgt dieser konkretisierte Modellvorschlag:

- **Personenstamm und private Assets:** getrennte Namens-/Kontakt-/Adressfelder, optionale Geburtsangaben sowie Asset-Referenzen für Foto und Unterschrift. Im bewerbungsbezogenen Snapshot bleibt der tatsächlich verwendete Stand erhalten.
- **Wiederverwendbare Einträge:** Bildungsstationen mit Abschluss, Fachrichtung/Zusatz, optionaler Note, Organisation und Zeitraumtext; Berufserfahrung/Engagement mit optionalen typisierten Angaben und Inhaltsblöcken aus Textabsätzen und/oder Stichpunktlisten; Kenntnisgruppen mit Bezeichnung und einzelnen Kenntnissen. Eigene Felder/Abschnittstypen bleiben möglich.
- **Master-CV:** ein gemeinsamer Ausgangsbestand ohne zusätzliche Rollenprofile. Auswahl und Anpassungen für eine Stelle erfolgen erst im zugehörigen Bewerbungs-CV.
- **Bewerbungs-CV:** unabhängiger revisionierter Inhaltsstand plus Referenz auf eine konkrete Mod-Version. Inhaltsanpassungen benötigen keinen neuen Layout-Mod.

Beim einmaligen Import den Ausgangsbestand des Masters festlegen, stabile App-IDs erzeugen und vorhandene Quellschlüssel separat erhalten. Das ist keine neue Pflichtauswahl beim Anlegen einer Bewerbung. Ähnliche Titel/Zeiträume/Organisationen sind kein verlässlicher Identitätsbeweis; die vier alten Quelldateien nicht automatisch zusammenführen und dabei unterschiedliche Texte verlieren. Datums- und Notentexte einschließlich leerer Werte erhalten und nicht ungefragt umdeuten. Abschnitts- und Eintragsreihenfolge ebenfalls nicht automatisch chronologisch neu sortieren.

Im alten Lua-Paket bezeichnet `profile` beziehungsweise `profiles/` eine Rollendatei, **keinen Kurzprofil-Abschnitt**. Diese historische Bezeichnung ist keine Vorgabe für eine neue Variantenfunktion. Die vier aktiven Bereiche sind Bildung, Berufserfahrung, Kenntnisse und Engagement. Die Website darf weder den Kurzprofiltext noch die Berufsbezeichnung aus dem fiktiven UI-Prototyp automatisch hinzufügen.

### 2. Vorlagenversion: Layout und Datenzuordnung

Eine Vorlagenversion umfasst LaTeX-Quellen, benötigte Assets, Einstiegspunkt, passende Engine sowie die Zuordnung zwischen CV-Daten und Vorlagenstellen. Das hochgeladene Original bleibt nachvollziehbar; eine nötige einmalige Anpassung der Vorlage wird ausdrücklich bestätigt und als neue Version geführt.

Die Zuordnung muss einmal festlegen, wie etwa Name, berufliche Stationen und Stichpunkte in die vorhandenen LaTeX-Befehle gelangen. Listen werden zur Buildzeit durchlaufen; es gibt keine feste Zahl von Stationen oder Platzhalter nur für „Job 1 bis 3“. Abschnittsbezeichnungen und Darstellung kommen aus der gewählten Vorlage beziehungsweise ihrer Zuordnung. Erforderliche Daten sind vorlagenspezifisch, nicht globale Pflichtabschnitte der App.

**Kein blindes Suchen/Ersetzen:** Aus beliebigem TeX lässt sich nicht zuverlässig ableiten, welcher Text ein Datenfeld ist. Empfohlen ist ein einmaliger geprüfter Adapter, der vorhandene Vorlagenbefehle beziehungsweise explizite Einfügestellen an die Daten anbindet. Die vorgeschlagene konkrete Ausgestaltung sind [Vorlagen-Mods mit einem eigenen KI-Thread für die einmalige Adaptererstellung](vorlagen-mods.md). Der Thread erstellt die Anbindung, feste App-Prüfungen und eine echte Build-Vorschau prüfen sie. Normale PDF-Builds benötigen danach keine KI-Runde.

Die Mod beschreibt benötigte/optionale Felder sowie die Darstellung von Absätzen, Listen und gemischten Inhalten. Sie darf denselben Inhalt passend zum Layout als Textabsätze oder Liste ausgeben, muss dabei aber Wortlaut, Reihenfolge und Vollständigkeit erhalten. Fließtext nicht ungefragt in neue Aussagen zerlegen, kürzen oder umformulieren; eine gewünschte redaktionelle Umformulierung ist eine ausdrückliche Inhaltsänderung, kein Nebenprodukt des Builds.

Ein Vorlagenwechsel löscht keine bisher erfassten Inhalte. Nicht verwendete Felder oder nicht darstellbare Inhaltsblöcke bleiben erhalten und werden kenntlich gemacht. Reihenfolge und Sichtbarkeit der Ausgabe sind explizite Einstellungen der Vorlage/Zuordnung; auch hier ist kein „Profil“-Abschnitt vorgegeben.

### 3. Build: reproduzierbarer Datenstand

Ein Build bindet eine feste CV-Revision, Vorlagenversion und Adapterversion zusammen. Aus diesem Stand wird im isolierten Buildverzeichnis eine technische Dateneingabe erzeugt, etwa Lua/JSON oder TeX-Makros, je nach bestätigter Integration. Die Vorlage liest diese Daten an den vorgesehenen Stellen ein und erzeugt die PDF.

Diese technische Transferdatei ist keine neue manuell zu pflegende Lebenslauf-Quelldatei bei jeder Bearbeitung. Datenbankzugriffe oder Netzwerkzugriff aus LaTeX sind nicht nötig. Der gespeicherte Build-Snapshot und bereits erstellte PDFs bleiben unveränderlich. Normale Texte werden für den gewählten Ausgabekanal korrekt maskiert; Text wie `&`, `%` oder `_` darf nicht versehentlich zu ausführbarem TeX werden.

## Webansicht und bestehende Quellen

Der akzeptierte Prototyp beschreibt die kompakte Bearbeitung, nicht eine garantierte pixelgenaue LaTeX-Vorschau. Der spätere Editor zeigt die tatsächlich vorhandenen Abschnitte, Felder und Inhaltsblöcke des Dokuments entsprechend den Mod-Felddefinitionen. Es gibt kein global erzwungenes Rollenfeld und keine globale Stichpunktpflicht. Für einen Textabsatz ist direkte Textbearbeitung vorgesehen; „Stichpunkt hinzufügen“ passt zu einer Liste, nicht zwingend zu jedem Eintrag. Das exakte PDF-Layout stammt aus der hochgeladenen Vorlage und wird mit dem echten Build geprüft.

Bestehende Lua-Profile brauchen einen ausdrücklichen, verlustarmen Import einschließlich zusätzlicher literaler Felder. Individuelle Lua-Logik darf nicht stillschweigend zu vermeintlich gleichwertigen Daten konvertiert werden. Auch bewusst über native Werkzeuge geänderte Datenquellen benötigen eine klar geregelte, revisionsgeprüfte Übernahme statt stiller gegenseitiger Überschreibungen. Dafür wird keine neue Einschränkung allgemeiner nativer Werkzeuge oder Providerrechte vorgeschlagen.

## Noch offene Schritte und Prüfgrenzen

Die zentrale Master-CV-Verwaltung und eine einmalige, bewusste Zusammenführung beziehungsweise Auswahl des alten Ausgangsbestands sind weiterhin separat zu gestalten. Bestehende Bewerbungen werden nicht rückwirkend aus alten Rollendateien ersetzt. Kopien eines gespeicherten Bewerbungs-CVs übernehmen dessen Daten und feste Mod-Version unabhängig.

Die Integration wurde mit synthetischen Daten, echten Offline-PDFs und dem vollständigen Webablauf geprüft; Details in [VERIFIKATION.md](../VERIFIKATION.md). Echte KI-Adaptererstellung und der Mod des privaten `cv.zip` sind noch nicht end-to-end verifiziert. Schriftverfügbarkeit und tatsächliches Layout müssen je Import geprüft werden. Die fünf festen Importfälle sind eine begrenzte Inhaltsprüfung, keine allgemeine Garantie für jedes Feld, jede Vorlage oder lange Dokumente. Die private Vorlage ist kein Repository-Testfixture.
