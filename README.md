# Bewerbungen auf srv

Private Bewerbungsverwaltung auf Basis des **vollständigen T3 Code v0.1.10** mit dokumentenzentrierter Bewerbungsverwaltung und nativer Chatengine. Die eigene T3-Laufzeit ergänzt einen strukturierten Hintergrundauftrag für Stellenanalysen; **https://bewerbung.teejayslab.de** öffnet direkt die Bewerbungsverwaltung, ohne Anmeldung oder Pairing, ausschließlich über NetBird. Der bisherige `/bewerbung/`-Einstieg leitet dorthin weiter.

T3 startet als eigener, gepinnter Prozess mit eigener Datenhaltung unter `data/native-t3/`; die bestehende T3-Installation und ihre Gespräche werden nicht als App-Datenbank verwendet. Die Anwendung unterstützt ausschließlich ihren einen Webserver: keine zusätzlichen Environments, native Mobile-/Desktop-App-Anbindung, integriertes Browsing/Recording, Settle-Automatik oder Snooze. Die Weboberfläche bleibt auf Handys nutzbar; Stellenlink-Analyse, PDF-Vorschau und allgemeine Provider-Werkzeuge bleiben unabhängig davon erhalten. Provider, Modelle, Werkzeugrechte und Berechtigungsmodi bleiben unter Kontrolle der nativen T3-Engine. Eine einzige T3-Seitenleiste enthält Bewerbungen mit mehreren Chats; eine zusätzliche Fach-Seitenleiste gibt es nicht.

## Benutzen

1. **Neue Bewerbung:** Stellen-Link einfügen. Das Modell aus **Settings → Bewerbungen → Stellenanalyse** erkennt Unternehmen, Stelle und Anforderungen. Ohne eigene Auswahl gilt T3s Textgenerierungsmodell. Erkannte Angaben prüfen und korrigieren; erst **Bewerbung anlegen** erzeugt die Bewerbung. Quelle, gelesener Text und Anforderungen werden gespeichert. Bei Zugriffssperren den Ausschreibungstext einfügen; alternativ Angaben manuell eingeben. Es entsteht dabei kein Chat. Öffentliche HTTP(S)-Seiten werden gelesen, interne/NetBird-Adressen nicht; JavaScript-/Login-Seiten können den Text-Fallback benötigen.
2. **Übersicht:** Eine Bewerbung öffnet ihre Dokumentenübersicht, nicht den Chat. Die Standardvorlage wird intern gewählt; eine Ausgangsbasis muss beim Anlegen nicht ausgewählt werden. Neue Bewerbungen und Kopien starten **In Arbeit**.
3. **Lebenslauf:** Angaben direkt im Dokument bearbeiten, Stationen und eigene Abschnitte hinzufügen. Jeder Eintrag hat einen gemeinsamen Inhaltsbereich; Enter schreibt weiter, **Aufzählung** schaltet die Formatierung um, ohne separate Absatz-/Listen-Bausteine anzulegen. Das gilt auch für Kenntnisse. **Im PDF** ausschalten, um einen Eintrag aufzubewahren, aber nicht auszugeben; im Bearbeitenmodus wieder einschalten. Kleine Feldnamen sind Formularbeschriftungen, keine Textpräfixe. **Lesen** blendet sie, die Bedienelemente und ausgeschlossene Einträge aus; das genaue PDF-Layout liefert weiterhin die Vorlage. Esc nimmt das fokussierte Feld zurück. Speichern und PDF-Build gelten nur für diese Bewerbung. Bestehende literale Lua-Daten werden beim Öffnen gelesen, erst beim Speichern mit dem CV-Dokument abgeglichen; unbekannte Quellfelder bleiben erhalten, Lua-Kommentare/Formatierung können entfallen. Individuelle Lua-/TeX-Logik bleibt über **Erweiterte Quellen** bearbeitbar.
4. **Anschreiben:** Absender, Empfänger, Betreff und Text verfassen und als PDF bauen. Eine eigene LaTeX-Vorlage lässt sich unter **Anschreiben-Vorlage hochladen** einbinden ([Ablauf](#eigene-anschreiben-vorlagen)). Vorhandene individuelle TeX-Vorlagen werden nicht ungefragt ersetzt. Änderungen nativer Werkzeuge am TeX werden nicht aus veralteten Texteditor-Metadaten überschrieben. Beide TeX-Engines laufen zweimal; Fehler ersetzen kein früheres erfolgreiches PDF. Vorschau, Buildverlauf, Logs und „Festhalten“ bleiben verfügbar.
5. **Versandpaket:** Originale Anlagen aus der zentralen Bibliothek auswählen, anschließend Quellen, Reihenfolge, Seiten und Kompression je Ausgabedatei bestimmen. Standard ist eine Gesamt-PDF; alternativ ZIP mit getrennten oder selbst zusammengestellten PDFs. Dateinamen folgen `Dokument_Name_Firma_Stelle.pdf`; den eigenen Namen unter **Settings → Bewerbungen** hinterlegen. Leere Namensbestandteile werden ausgelassen.
6. **Chats (optional):** Unterstützung bei Formulierungen oder Optimierungen. Mehrere unabhängige Gespräche und ungesendete Entwürfe bleiben erhalten; alle Chats einer Bewerbung verwenden dieselben Arbeitsquellen. Der Bewerbungsname im gemeinsamen Breadcrumb führt aus dem Chat zurück zur Bewerbungsübersicht, ohne einen neuen Chat anzulegen; ungesendete Entwürfe bleiben erhalten. Composer, Verlauf, Werkzeuge, Modelle und Berechtigungsmodi bleiben nativ. Es gibt keine zusätzliche Dokument-Tool-Allowlist oder erzwungene Einzelgenehmigung für Chats.
7. **Rechtsklick auf eine Bewerbung:** Details, Status, unabhängige Kopie, Unterlagen/Quellen und bestätigtes Löschen. Es gibt genau fünf Statusgruppen: **In Arbeit, Fertig, Gesendet, Absage, Zusage**. Der Status gilt für die Bewerbung, nicht für einzelne Chats. Eine Kopie übernimmt keine KI-Sitzung oder Builds.

Zum Versenden **Versandpaket erstellen** verwenden. Der Plan bleibt gespeichert, fertige Downloads behalten ihren festen Quellenstand. Nach Änderungen die Aktualität prüfen und bei Bedarf neu bauen oder **Neueste PDF-Stände übernehmen** wählen. **Quellen-ZIP und Buildquellen enthalten interne Bewerbungsdaten einschließlich Notizen und sind nicht zum Versand bestimmt.** Buildquellen behalten ihre damalige Anlagenauswahl; spätere Auswahl- oder Bezeichnungsänderungen ändern diesen Stand nicht. Ein früheres erfolgreiches PDF kann gegenüber den aktuellen Quellen veraltet sein – Vorschau und Revision vor dem Versand prüfen. Status „Gesendet“ verschickt keine E-Mail.

Die vorhandenen Chat-/Modell-Tastenkürzel bleiben nutzbar; Suche und neue Chats beziehen sich auf Bewerbungen. Kürzel der entfernten Frontend-Funktionen werden nicht mehr angeboten. Die separate Bewerbungssuche umfasst Unternehmen, Rolle, Notizen, Ausschreibung und gespeicherte alte Chatnachrichten, mit Statusfilter; keine Volltextsuche in hochgeladenen PDFs. Stellenanalyse-Modell, Download-Name, PDF-Autobuild, Vorlagen und zentrale Unterlagenbibliothek stehen direkt unter **Settings → Bewerbungen**, ohne zusätzlichen Einstellungsdialog; auch die Einstellungssuche führt zu diesen Abschnitten. Darstellung, Sendetastenkombination sowie die Vorgaben für Chatmodelle und Berechtigungen bleiben in den jeweiligen T3-Einstellungen; das Stellenanalyse-Modell ist davon unabhängig. Die früheren Fachfelder `theme`, `sendOnEnter` und `defaultProvider` werden beim Start einmalig entfernt, ohne PDF-Autobuild, eingeklappte Statusgruppen oder native T3-Einstellungen zu überschreiben. Die markierten Einstellungsseiten und mehrere zugehörige Menü-/Shortcut-/Dialog-Einstiege sind entfernt. Der vollständige Funktionsabbau einschließlich verbleibender Frontend-Einstiege und des gepinnten nativen Backends ist noch offen.

### Zentrale Anlagen

Erlaubt sind PDF, JPG und PNG mit passendem Dateikopf und Dateiendung: maximal **25 MiB pro Datei**, **1 GiB Ablage**, **100 MiB und 40 Anlagen pro Bewerbung**. Identische Bytes werden anhand SHA-256 nur einmal gespeichert. Dateiinhalte bleiben unverändert; jede Bewerbung hat ihre eigene Auswahl. Bezeichnungen gelten zentral. Hochladen ist eine eigene Aktion: bereits hochgeladene Dateien bleiben auch nach Abbrechen eines Bewerbungsformulars in der Ablage.

Tags gelten zentral und werden ohne Änderung der Dateibytes gespeichert: maximal 20 Tags mit je 40 Zeichen, Leerraum bereinigt, Kleinschreibung und ohne Duplikate. Suche und Tagfilter lassen sich kombinieren.

Ausgewählte Anlagen erhalten unabhängige Arbeitskopien im nativen Workspace unter `bewerbungsunterlagen/`; `auswahl.json` beschreibt die aktuelle Auswahl. Eigene Änderungen und bewusst gelöschte Kopien werden nicht automatisch überschrieben beziehungsweise wiederhergestellt. Zentrale Originale bleiben erhalten. Änderungen an diesen Arbeitskopien werden **nicht automatisch** als Bibliotheksdatei gespeichert oder ins Versandpaket aufgenommen.

Nur unbenutzte Anlagen lassen sich entfernen. Verweise aus anderen Bewerbungen oder erfolgreichen gespeicherten Builds verhindern das Löschen. Die Sicherung muss deshalb Datenbank, Quellen, Builds **und** `data/documents/` gemeinsam enthalten.

### Build-Versionen aufräumen

Unter **PDF-Vorschau → Buildverlauf und Logs → Löschen** einzelne Builds nach Bestätigung endgültig entfernen: PDF, damalige Eingaben und Log. Andere Versionen, aktuelle Bewerbungsquellen, zentrale Anlagen, fertige Versandpakete und lokale Downloads bleiben erhalten. Laufende/queued Builds, **festgehaltene** Versionen sowie in gespeicherten Versand-/PDF-Plänen oder laufenden/erfolgreichen Aufträgen verwendete Builds sind geschützt; der Verlauf zeigt den Grund.

Unter **Settings → Bewerbungen → PDF-Erstellung → Alte Builds automatisch bereinigen** lässt sich die automatische Bereinigung einschalten. Standard ist **aus**. Ab dem nächsten erfolgreichen Build bleiben je Bewerbung und Dokumenttyp der neue Stand und geschützte Versionen erhalten; ältere ungeschützte Builds einschließlich fehlgeschlagener Läufe werden entfernt. Ein fehlgeschlagener neuer Build löscht nichts. Das Einschalten allein räumt noch nicht auf. Dateibereinigung wird dauerhaft protokolliert und bei Dateisystemfehlern am nächsten Serverstart erneut versucht; der neue erfolgreiche Build bleibt dabei erfolgreich.

### PDFs zusammenstellen und optimieren

In **Eigene Dateien** lassen sich weiterhin einzelne Dateien zusammenstellen oder optimieren. Der Bereich **Versandpaket** einer Bewerbung erstellt eine Gesamt-PDF oder ein ZIP mit bis zu acht Ausgabedateien aus erfolgreichen Builds und ausgewählten Originalen. **Eine Original-PDF unverändert** übernimmt genau eine vollständige PDF bytegleich; Zusammenstellen erzeugt eine neue PDF. Reihenfolge über Pfeile ändern, Quellen abwählen und bei PDFs Seiten wie `1-3,5` angeben. JPG/PNG werden als einzelne A4-Seiten ohne verlustbehaftete Bildneukodierung eingebettet.

- **Keine zusätzliche Kompression** fügt gewählte Seiten zusammen, ohne einen zusätzlichen Optimierungs- oder Bildreduktionsschritt.
- **Verlustfrei** optimiert PDF-Strukturen und Kompression ohne Verringerung der Bildauflösung.
- **Kompakt (150 dpi)** kann Bilder verkleinern und die Lesbarkeit oder PDF-Zusatzinformationen beeinträchtigen. Text bleibt normalerweise Text; keine Garantie für beliebige Eingabedokumente. Ergebnis vor Versand prüfen.
- Originale werden nie überschrieben. **Digitale Signaturen gelten nur im Original**; Zusammenfügen oder Neuverpacken erzeugt eine andere Datei. Eine bestimmte Zielgröße ist nicht garantiert. Ist eine einzelne vollständige PDF bereits kleiner, bleibt deren unveränderte Ausgabe erhalten.
- Paketplan, Ausgaben, Reihenfolge und Seiten werden je Bewerbung gespeichert. Neuere Builds werden nicht unbemerkt in bestehende Downloads eingesetzt. **Neueste PDF-Stände übernehmen** aktualisiert die Buildreferenzen im bearbeiteten Plan. Fertige Ergebnisse sind eigenständige, unveränderliche PDFs; Originale bleiben erhalten.
- Laufende Aufträge können geschlossen und über **Bisherige PDF-Aufträge** wieder aufgerufen werden. Ergebnisse lassen sich herunterladen oder bis 25 MiB als neue Bibliotheksdatei speichern. Identische Ergebnisse verwenden den bereits vorhandenen Eintrag, ohne dessen Bezeichnung/Tags zu überschreiben.
- Je aufbereiteter PDF maximal 40 Quellen und 500 Ergebnis-Seiten; Anlagen zusammen höchstens 100 MiB. Ein Versandpaket enthält höchstens acht Ausgaben und 180 MiB. Verarbeitung nur lokal im isolierten Container ohne Netzwerk. Kennwortgeschützte oder beschädigte PDFs werden mit Fehler abgelehnt; Originale und frühere Ergebnisse bleiben erhalten.

### Vorlagen verwalten und Bewerbungen löschen

Unter **Settings → Bewerbungen → Vorlagen** Vorlagen benennen, duplizieren, exportieren, als Standard setzen oder bestätigt löschen. **Aus Bewerbung als Vorlage speichern** hält eine neue unabhängige Kopie der bearbeiteten CV-/TeX-Quellen fest, ohne interne Bewerbungsmetadaten. Erst die erste Vorlage wird automatisch Standard; spätere Kopien/Importe wechseln einen vorhandenen Standard nicht ungefragt. Löschen einer Vorlage verändert bestehende Bewerbungen nicht.

**Bewerbung löschen** verlangt eine Bestätigung und den aktuellen Datenstand. Chat, Arbeitsdateien, Sitzungen und eigene Build-/PDF-Ergebnisse werden entfernt; zentrale Uploads und andere Bewerbungen bleiben erhalten. Aktive Agenten, Freigaben oder PDF-Aufträge verhindern Löschen. Dateibereinigung ist dauerhaft protokolliert und wird nach einem Prozessabbruch beim nächsten Start fortgesetzt; Symlink-Ziele außerhalb des Bestands werden nicht verfolgt. Es gibt keine Wiederherstellungsschaltfläche; vorhandene Betriebsbackups werden nicht mitgelöscht.

### Einzelne CV-Einträge wiederverwenden

Unter „Lebenslauf / Quellen bearbeiten“ → „Einzelne Lebenslauf-Einträge wiederverwenden“ Quellbewerbung, Quellprofil und Zielprofil (`cv/profiles/*.lua`) auswählen, Einträge markieren und übernehmen. Unterstützt werden `experience`/`engagement` mit `date`, `title`, `org`, `bullets` sowie `skills` mit `label`, `items`.

- **Anhängen:** ausgewählte Einträge folgen den vorhandenen Einträgen.
- **Ersetzen:** nur Bereiche mit ausgewählten Einträgen werden vollständig ersetzt; andere Bereiche bleiben erhalten. Vorher erscheint eine Bestätigung.
- Reihenfolge innerhalb eines Bereichs: Quellreihenfolge, nicht Klickreihenfolge. Es entstehen persistente, unabhängige Kopien. Eine inzwischen geänderte Quelle oder ein geändertes Ziel verlangt neues Laden.
- Ein begrenzter Literalparser verarbeitet ausschließlich `return {…}` mit Tabellen, Zeichenketten, Zahlen und Booleschen Werten. Kommentare und lange Lua-Zeichenketten werden unterstützt. Funktionen, Variablen, Berechnungen, gemischte/mehrdeutige Tabellen und nicht unterstützte Escapes werden mit Positionsmeldung abgelehnt; kein Lua wird auf dem Host ausgeführt.
- Kommentare und Formatierung **im Zielprofil** werden neu serialisiert; unbekannte literale Felder bleiben erhalten. Die Quellbytes bleiben unverändert. Lua-/TeX-Editor und Quellen-ZIP sind weiterhin der manuelle Ausweg.

Alte importierte Anschreiben bleiben ausschließlich im Vorlagenbestand als Referenzen. Neue Bewerbungen beginnen standardmäßig mit dem neutralen `anschreiben/Anschreiben.tex`. Nur eine ausdrücklich gewählte frühere Bewerbung oder vollständige Kopie übernimmt deren Anschreiben; dabei alte Empfänger und Inhalte vor Verwendung anpassen. Alte Firmen-/Bildreferenzen werden nicht automatisch als neue Fakten interpretiert.

## Formularbasierte Vorlagen-Mods: Ziel und erster Prototyp

Das [verbindliche Produktziel samt Vertrag und Kriterien A–H](docs/vorlagen-mods.md#verbindliches-produktziel-vorlage-bestimmt-formular) ist: LaTeX-Vorlage, Formular aus App-Primitives und Datenanbindung gemeinsam als Mod. Auf `main` sind die Formular-Mods **Teil der normalen App**: derselbe Build (`npm run build`), derselbe Start (`npm start`), derselbe Lebenslaufbereich. Kein zusätzliches Frontend, kein Prototyp-Port. In einer Bewerbung unter **Lebenslauf → LaTeX-Vorlage für diesen Lebenslauf** stehen die geprüften eigenen Vorlagen bereit. V2 verwendet denselben kompakten Dokumentstil mit direkter Textbearbeitung wie der bisherige Editor, keine separaten Formular-Karten. Die alten CV-/Portfolio-Demos sind aus der App und ihrer Auswahl entfernt. Der Wechsel ist ausdrücklich und übernimmt alte CV-Daten nicht automatisch; Rückwechsel und vorhandene Daten bleiben erhalten. Der Serverstand ist auf srv verfügbar; vorhandene Bewerbungen wechseln weiterhin nicht automatisch zum Formular-Mod. Der folgende Importablauf erzeugt standardmäßig v2-Formulare. Die Softwarekette ist mit ersetztem Agenten und echten Offline-PDFs geprüft. Ein öffentlicher Overleaf-Mod hat inzwischen auch den echten Agenten-/PDF-Ablauf bestanden: Im bestehenden Thread ergänzte der Agent fehlende Originalpakete in einem isolierten Builder und korrigierte den Adapter; nach unabhängiger Abstandsreparatur und Prüfung ist der Mod auswählbar. Das ist ein begrenzter Einzelfallnachweis, keine allgemeine Modell-/Layoutgarantie ([Echttest](VERIFIKATION.md#agent-installiert-builder-pakete-21112026)).

## Eigene Lebenslauf-Vorlagen

Unter **Settings → Bewerbungen → Vorlagen** oder im Lebenslauf unter **LaTeX-Vorlage hochladen** ein Quellen-ZIP wählen. **Hochladen & KI starten kann Modellkosten verursachen und Quellinhalte an den gewählten Anbieter übertragen.** Ein eigener nativer Thread erhält den vollständigen v2-Auftrag und erstellt Formular und LaTeX-Datenanbindung mit den vorhandenen Provider-/Modell-/Berechtigungseinstellungen. **Dokument / Anlage** speichert dagegen eine normale Anlage ohne KI; eine PDF allein ist keine bearbeitbare LaTeX-Vorlage.

Neue Importe verwenden **LuaLaTeX** und `bewerbung-cv-form-v2`: vorlagenspezifische Textfelder, ein gemeinsamer Inhaltseditor, Gruppen, responsive Spalten und wiederholbare Einträge aus App-Primitives. Der beauftragte v2-Import akzeptiert keinen stillen Rückfall auf v1. Bereits vorhandene v1-Mods und ihre Rechecks bleiben kompatibel. ZIP-Grenzen: 8 MiB komprimiert, 32 MiB entpackt, 200 Einträge, 4 MiB je übernommener Datei; keine Symlinks, verschlüsselten Archive oder ZIP64. Benötigte Fonts und Pakete müssen verfügbar sein. Nicht jedes LaTeX-Projekt ist damit kompatibel.

Der konkrete KI-Auftrag steht in `server/cv-form-model.ts` und wird dem Thread als `ADAPTER-CONTRACT.md` bereitgestellt. Unklare Zuordnungen oder fehlende Abhängigkeiten stellt der Agent als Rückfragen im selben Thread; eine `NEEDS-INPUT.md` hält sie für die App fest. Nach Klärung die Rückfragedatei im Thread entfernen lassen und **Erneut prüfen** wählen. Es entsteht dabei kein Ersatzthread.

Nach der KI-Erstellung folgen vier formularabhängige synthetische PDF-Prüfungen: alle deklarierten PDF-Felder und Mischinhalte, geänderte Reihenfolge, ausgeschlossene Einträge/Metadaten und leere Sammlungen. V1-Rechecks behalten ihre fünf bisherigen Fälle. **Geprüft · zur Durchsicht** bedeutet keine allgemeine Layout- oder Vollständigkeitsgarantie: Test-PDFs und den eigenen CV-Build vor Verwendung ansehen. Offene Fragen im verlinkten KI-Thread beantworten und anschließend **Erneut prüfen**; dabei startet keine zusätzliche Modellrunde. Ein Serverneustart erzeugt ebenfalls keinen Ersatzthread.

Einen geprüften Mod im Lebenslauf auswählen. Die Bewerbung bindet genau dessen geprüfte Version; spätere Adapteränderungen aktualisieren sie nicht still. Normale Inhaltsänderungen und PDF-Builds brauchen keine KI und ändern die LaTeX-Vorlage nicht. Bei v2 bestimmt die Mod-Definition Felder und Anordnung des Editors; die Eintragsbedienung liefert immer die App. Neue Einträge stehen oben. Ziehen innerhalb des Abschnitts (Desktop) oder die Pfeile verschieben eins/ganz nach oben oder unten; **Verschiebung rückgängig** stellt nur die vorige Reihenfolge wieder her, nicht frühere Texte. **Im PDF** und bestätigtes Löschen gehören ebenfalls fest dazu. Dasselbe gilt im bisherigen CV-Editor; kein Mod kann diese Funktionen abschalten. Danach wie gewohnt speichern; im PDF gilt die gespeicherte Reihenfolge. Freie Zeitraumtexte werden nicht automatisch als Startdatum interpretiert. Beim ersten Wechsel vom alten Editor bleiben seine Daten erhalten, werden aber nicht automatisch zugeordnet. Auch beim Wechsel zwischen Formularen bleiben sichere fremde Werte aufbewahrt; inkompatible Typbindungen werden sichtbar abgewiesen. V1 verwendet weiterhin den bisherigen Editor mit zusätzlichen deklarierten Textfeldern. Es gibt keinen verpflichtenden Profilabschnitt, kein globales Rollenfeld und keine Inhaltsvariantenverwaltung. Ein unbenutzter Import lässt sich samt zugehörigem nativen Projekt/Thread und Dateien entfernen; Verweise aus Bewerbungen verhindern das Löschen.

Der [akzeptierte Bedienentwurf](prototypes/cv-kompakt/README.md) bleibt unverändert als Referenz erhalten. Das [CV-Datenmodell](docs/cv-datenmodell.md) beschreibt den integrierten Übergangsstand und die noch offene zentrale Master-CV-Verwaltung. Der [isolierte Entwicklungsprototyp](prototypes/cv-mod-import/README.md) mit `npm run prototype:cv-mods` und die ausdrücklich simulierte HTML-Demo bleiben zusätzlich verfügbar. Der folgende JSON-Import ist weiterhin der kompatible Weg für vollständige alte Quellenpakete.

## Eigene Anschreiben-Vorlagen

**Der KI-Start kann Modellkosten verursachen und Quellinhalte an den gewählten Anbieter übertragen.** Eine PDF allein genügt nicht; benötigt wird ein LaTeX-Quellen-ZIP mit den benötigten Vorlagendateien.

1. In einer bearbeitbaren Bewerbung **Anschreiben → Anschreiben-Vorlage hochladen** öffnen, ZIP wählen und **Hochladen & KI starten** drücken. Alternativ in **Settings → Bewerbungen → Vorlagen** die Dateiart **Anschreiben-Vorlage** wählen.
2. Nach den vier Prüf-PDFs die Ausgabe ansehen und **Für dieses Anschreiben verwenden** wählen. Bei Rückfragen den vorhandenen Thread nutzen und anschließend **Erneut prüfen**; das startet keine neue Modellrunde.
3. Absender, Empfänger, Betreff, Anrede, Anschreibentext und Grußformel bearbeiten, speichern und PDF bauen. Die Vorlage bestimmt das LaTeX-Layout; diese erste Anschreiben-Anbindung verwendet bewusst die sechs vorhandenen Brief-Felder, kein neues frei definierbares Formular. Gespeicherte Texte bleiben beim Vorlagenwechsel erhalten.

Anschreiben- und CV-Vorlagen sind getrennt auswählbar. Die Bewerbung bindet eine feste geprüfte Version; andere Bewerbungen und alte PDFs bleiben unverändert. **Bestehende Anschreiben-Vorlage** kehrt zur bisherigen Quelle zurück. Bei einer bisherigen Textvorlage werden die aktuellen Brief-Felder übernommen; individuelle TeX-Quellen bleiben unverändert erhalten und werden nicht automatisch als Brieftext interpretiert. Vollständige Kopien und ausdrücklich gewählte Anschreibenübernahmen erhalten unabhängige Brief-Felder und dieselbe feste Version. Verwendete Importe können nicht gelöscht werden. **Gesendet** bleibt schreibgeschützt.

Die Softwarekette ist mit einem ersetzten Agenten und echten Offline-PDFs geprüft, nicht mit einer zusätzlich beauftragten realen Anschreiben-Modellrunde. Format, Dateneingang und Grenzen: [Anschreiben-Vertrag](docs/vorlagen-mods.md#anschreiben-layoutimporte).

## Originalvorlage importieren

Das Importformat ist eine Datei-Map mit Base64-Inhalten:

```json
{
  "format": "bewerbung-template-v1",
  "files": {
    "cv/Lebenslauf.tex": "<base64>",
    "cv/lua/loader.lua": "<base64>",
    "fonts/SourceSans3-Light.ttf": "<base64>"
  }
}
```

Vom Mac über die bestehende NetBird-Verbindung direkt per HTTPS:

```sh
curl --fail-with-body \
  -H 'Content-Type: application/json' -H 'X-Bewerbung-Request: 1' \
  --data-binary @template.json \
  https://bewerbung.teejayslab.de/bewerbung/api/templates/import
```

Über diese NetBird-Origin ist kein eigener Zugriffstoken nötig. Der Gateway stellt die native Anmeldung intern bereit; explizit mitgesendete T3-API-Tokens behalten ihre eigenen Dateirechte. Keine Zugangsdaten in Dateien oder Shell-History eintragen. Der Import über die Browseroberfläche ist einfacher: unter „Settings“ → „Bewerbungen“ → „Vorlagen“ → „JSON importieren“ auswählen. Der importierte Master enthält 38 Quellen, Bilder und Schriftdateien (rund 7,8 MB dekodiert). Der tatsächliche allgemeine Lebenslauf wurde auf srv gebaut: zwei A4-Seiten, eingebettete SourceSans3-Schriften und identische Textextraktion einschließlich Reihenfolge und Umbrüchen wie die lokale Referenz. Die Quelldateien auf dem Mac wurden nicht verändert; vorhandene Mac-Bewerbungsarchive wurden nicht migriert.

Grenzen: 24 MiB HTTP-JSON, 16 MiB dekodiert insgesamt, 4 MiB je Datei, 160 Dateien. UTF-8 für Texte, kanonisches Base64, keine Symlinks/Archive/Skripte/absoluten Pfade oder `..`. Erlaubt sind:

- `cv/Lebenslauf.tex`
- `cv/{lua,profile,profiles}/<Name>.lua`
- `cv/preamble/<Name>.tex`
- `cv/assets/<Name>.{jpg,jpeg,png}`
- `anschreiben/<Name>.tex`, `anschreiben/assets/<Name>.{jpg,jpeg,png}`
- `fonts/SourceSans3-<Variante>.ttf`

`<Name>` erlaubt Buchstaben, Ziffern, `_` und `-`. `Lebenslauf.tex` und `lua/loader.lua` sind Pflicht. Die Antwort nennt Vorlagen-ID, Anzahl und Größe. Import erzeugt einen neuen unveränderlichen Bestand und ändert keine bestehenden Bewerbungen. Jede Bewerbung erhält eine unabhängige Arbeitskopie. Eigene Lua-/TeX-Dateien werden erst im isolierten Builder ausgeführt.

Die Servervorlage lädt die mitgelieferten SourceSans3-TTFs direkt: In `cv/preamble/fonts.tex` tragen alle SourceSans3-Familien `Path=../fonts/, Extension=.ttf`. Nur diese Pfadangabe wurde gegenüber dem Mac-Master angepasst; Latin Modern Roman bleibt eine Systemschrift des Builder-Images. Bei einem erneuten Import eines unveränderten Mac-Masters diese Anpassung mitnehmen. Der Importer schreibt Fontdefinitionen nicht automatisch um.

Die 16-MiB-Gesamtgrenze und Dateiauswahl gelten für verwaltete Quellenimporte, Fach-Editor, Datei-/Eintragsübernahmen und Build-Snapshots einschließlich `application.json`. Das ist **keine zusätzliche Beschränkung der nativen T3-Werkzeuge**. Änderungen verwalteter Quellen durch native Werkzeuge werden vor fachlichen Änderungen abgeglichen; veraltete Editorstände werden mit Revisionskonflikt abgelehnt. `application.json` ist eine generierte Sicht der fachlichen Metadaten, kein alternativer Schreibzugriff auf die SQLite.

## Originales T3 und vorhandene Gespräche

Verwendet wird ein angepasster T3-Server v0.1.10 als eigener Linux-x64-Build mit nativer Chatengine. Der Build ergänzt die strukturierte Stellenanalyse über dieselben Provider-/Textgenerierungsadapter wie Threadtitel und entfernt die aktiven Mehrserver-, Browser-/Recording- und Settle-Einstiege. Provider und deren Berechtigungsmodi bleiben nativ. Die installierte separate T3-Instanz bleibt unverändert. Quelle und Prüfsummen: [PROVENIENZ.md](PROVENIENZ.md), `native-t3/source.json`, `native-t3/source-audit.json`. Der Start schlägt ohne gültige Runtime-Konfiguration fehl; es gibt keinen Rückfall auf den früheren Chat.

Jede Bewerbung erhält ein eigenes lokales Git-Repository, damit die nativen Git-/Worktree-Funktionen nicht das übergeordnete App-Repository verwenden. Die Vorbereitung erzeugt **keinen Commit und keinen Remote**. Native Git-Metadaten werden nicht als fachliche Quellen exportiert; spätere native Checkpoints/Git-Aktionen bleiben original.

Der Zugriffsschutz der Bewerbungs-Origin ist NetBird, nicht ein zusätzliches Browser-Pairing. Der Gateway verwendet dafür eine eigene, vom originalen T3-CLI ausgestellte Sitzung mit dessen normalen Clientrechten. Ihr Token bleibt nur im Arbeitsspeicher des Wrappers und wird vor Ablauf bei Bedarf erneuert; keine Zugangsdaten der installierten T3-Instanz werden übernommen. Host-/Origin-Prüfungen gelten für HTTP und WebSockets. Alle über diese NetBird-Origin zugelassenen Nutzer erhalten dieselben normalen Clientrechte. Explizite API-Tokens behalten ihre eigenen Scopes. Die Fach-API prüft weiter die native Anmeldung: Lesen verlangt `filesystem:read`, Änderungen `filesystem:write`; native Projektänderungen autorisiert T3 zusätzlich selbst. Native Provider und Berechtigungsmodi bleiben unverändert.

Pi schreibt native Sitzungen in die eigene App-Ablage. Codex verwendet eine eigene native Home; ausschließlich die vorhandene normale Anmeldung wird gegebenenfalls über einen Auth-Dateiverweis genutzt. Tokeninhalte werden nicht kopiert. Eigene Provider-Einstellungen bleiben danach unter Kontrolle der originalen T3-Einstellungen. Die Modi können umfassende Hostzugriffe erlauben: **Das ist keine zusätzliche OS-Sandbox.** Modellanfragen können Inhalte an den gewählten Anbieter übertragen.

Die separate Altarchiv-Ansicht ist entfernt. Der alte fachliche Chatbestand wurde am 20.11.2026 auf Benutzerwunsch aus der aktiven Datenhaltung gelöscht: Ereignisse, Legacy-Sitzungszuordnung und alte Pi-Sitzungsdatei. Die Tabellen für Altverlauf und alte Composer-Entwürfe sind leer. Aktuelle native Chats und Bewerbungsunterlagen bleiben erhalten; eine konsistente Sicherung vor dem Löschen liegt unter `backups/legacy-chat-purge-20261120T101357Z/`.

Eine einmalige Offline-Vorbereitung kopiert bestehende Bewerbungssitzungen in die unabhängige native Ablage. Anschließend importiert die **unveränderte T3-Willkommensoberfläche** die ausgewählten Projekte/Gespräche. Pi behält die Sitzungs-UUID mit neuem Kopie-Dateipfad; Codex die native UUID in einem eigenen Altverlaufs-Profil. Kopierte Codex-Indizes werden auf die Kopien umgestellt; alte `config.toml`-Werkzeugrichtlinien und Zugangsdaten werden nicht kopiert. Originale bleiben erhalten.

Der originale Import zeigt begrenzte Historie, nicht garantiert alle alten Werkzeug-/Anhangdetails. Das frühere zusätzliche Facharchiv steht nach dessen ausdrücklich beauftragter Löschung nicht mehr zur Verfügung. Historischer Gesprächskontext kann erhalten bleiben; es werden keine erfundenen Prompts zur Kontextrekonstruktion abgesendet. Neue Gespräche verwenden die nativen T3-Defaults. Kein automatischer E-Mail-Versand.

## Betrieb und Backup

Laufzeit: Node 22.23.2, Docker und vorhandenes Pi/Codex. Der app-eigene native Server liegt getrennt unter `native-t3/runtime/`; sein Zustand unter `data/native-t3/`. Für Backend- und Frontend-Build braucht es **isoliert Node 26.13.1 und pnpm 12.14.0**, entsprechend `vendor/t3/package.json`; Host-/Dienst-Node nicht ersetzen. Runtime-/Clientänderungen nur bei gestopptem `bewerbung.service` und nach konsistenter Sicherung anwenden.

```sh
cd /home/redjoker/workspace/containers/bewerbung
npm ci
npm run check && npm test
# Einmalig: Original-Runtime nur lesen/kopieren, niemals mit deren Datenhome starten.
node scripts/prepare-native-runtime.mjs /home/redjoker/.t3/runtime/versions/0.1.10
# Vorher mit der isolierten Original-Toolchain in vendor/t3:
# pnpm install --filter @t3tools/web... --filter t3... --filter @t3tools/scripts... --frozen-lockfile
T3_BUILD_NODE=/absoluter/pfad/zum/isolierten/node-26.13.1 npm run build
# Erst nach konsistentem Backup und Offline-Migration wieder starten.
systemctl --user start bewerbung.service
```

Nur `bewerbung.service` verwaltet die neue App samt eigenem Originalserver; **nicht `t3code.service` neu starten**. Die früheren zusätzlichen Dienstgrenzen (2 GiB, 256 Tasks, `NoNewPrivileges`) entfallen entsprechend dem laufenden T3; `KillMode=mixed` erlaubt dessen geordnetes Beenden. Die ursprünglichen nativen T3-Ressourcen-/Berechtigungsfunktionen bleiben maßgeblich, die separaten Dokument-Container unverändert geschützt. Listener sind ausschließlich Loopback: Gateway `3120`, Originalserver `3121`, bisheriger Weiterleitungs-/API-Einstieg `3119`. Variablen: `PUBLIC_PORT`, `T3_NATIVE_PORT`, `LEGACY_PORT`, `PUBLIC_ORIGIN`, `DATA_DIR`.

`npm run build` baut den vollständigen nativen Client und den erweiterten Server und aktualisiert den App-Programmpin. Installation in die laufende Runtime wird verweigert; vorher den Bewerbungsdienst stoppen und frisch sichern. Mit `T3_BUILD_RUNTIME="$PWD/.work/<name>/runtime"` stattdessen isoliert bauen; dieses Ziel enthält anschließend `build-manifest.json` mit dem neuen Programmpin. Auf speicherbegrenztem srv kann `T3CODE_WEB_SOURCEMAP=0` die zusätzlichen Source Maps abschalten; der Build ohne Maps wurde für den überarbeiteten CV-Editor geprüft. Ein zusätzlicher `NODE_OPTIONS=--max-old-space-size=1536` gilt dann nur für den Build, nicht für den Dienst. `src/` und der kleine alte Build bleiben ausschließlich Kompatibilitäts-/Testbestand; `npm test` erzeugt diese Fixture über `build:legacy-tests`. Sie werden vom neuen Gateway nicht als Chat ausgeliefert. Original-Binärdateien direkt aufrufen; `pnpm exec` ist für die installierte Toolchain kein notwendiger Prüfschritt.

**Erstmigration:** laufende Fachaufträge/Agenten beenden, nur `bewerbung.service` stoppen und den aktuellen vollständigen Bestand konsistent sichern. Danach `node --import tsx scripts/migrate-native-sessions.ts --offline` ausführen, starten und in T3 die gewünschten Projekte/Threads importieren. Das Skript verweigert eine Erstmigration über eine schon gestartete native Datenbank. Nie ein älteres Betriebsbackup über zwischenzeitliche Benutzeränderungen zurückspielen.

**Öffnen:** mit NetBird verbinden und `https://bewerbung.teejayslab.de/` aufrufen. `/` und `/pair` leiten ohne Codeeingabe nach `/bewerbungen`. Auch ein frischer Browser oder ein veraltetes T3-Cookie benötigt kein Pairing. Der Originalserver auf Loopback bleibt authentifizierungspflichtig; nur der vorgelagerte Bewerbungs-Gateway übernimmt den NetBird-Zugang. CLI-Aufrufe dieser Instanz immer mit ihrem eigenen `--base-dir`, nie versehentlich mit der bestehenden `~/.t3`-Datenbank.

`data/` enthält `bewerbung.sqlite` einschließlich WAL/SHM und bewerbungsbezogener `cv_documents`, Vorlagen, Bewerbungsdateien, zentrale Anlagen (`documents/`), native Pi-/Codex-Sitzungen sowie Build-Eingaben/-Ausgaben. `data/cv-mod-imports/` enthält zusätzlich Importdatenbank, Original-ZIPs, KI-Arbeitskopien, Prüf-PDFs und unveränderliche geprüfte Mod-Stände und muss vollständig mitgesichert werden. Fachliche Einstellungen, geöffnete Bewerbungen, alte Chatentwürfe, Tags, Vorlagenbezeichnungen/Standard, PDF-Pläne, Aufträge und Anlagenverweise liegen in derselben Fach-SQLite. Native T3-Daten liegen getrennt in `data/native-t3/`; native Browser-/Draft-Zustände bleiben unter Kontrolle des Originalclients. `data/pdf-jobs/` enthält PDF-Ergebnisse; Eingabekopien werden nach Verarbeitung entfernt. `data/delivery-jobs/` enthält feste PDF-/ZIP-Versandpakete; Pläne und Jobmetadaten liegen in der Fach-SQLite und werden mitgesichert. Beim Update werden fehlende Organisationstabellen ergänzt; vorhandene Bewerbungen und native Sitzungen werden nicht neu angelegt. Beim Sichern Symlinks erhalten, **nicht dereferenzieren**: Codex verweist auf die vorhandene native Anmeldung außerhalb der App. Für konsistente Sicherungen den Bewerbungsdienst stoppen, **das gesamte Verzeichnis** kopieren und anschließend wieder starten. Rücksicherung nur bei gestopptem Dienst; Rechte 0700/0600 beibehalten. Dazu Quellcode, Lockfile und das Docker-Image sichern:

```sh
docker save bewerbung-tex:2026-11-16 -o bewerbung-tex.tar
```

Der Builder verwendet die konkrete Image-ID aus `builder/image-id`, nicht einen beweglichen Tag. Das Grundimage entsteht mit `docker build --network host -t bewerbung-tex:base builder`. Der aktuell aktive Builder ergänzt NewTX 1.756 und Kastrup/binhex auf dem weiterhin lokal vorhandenen, unveränderten Originalimage: `sh builder/newtx/build.sh`. Dieses Skript prüft die Basis-ID, lädt ausschließlich SHA-256-festgelegte CTAN-Archive in `.work/tex-newtx-dependencies` und baut die Ergänzung ohne Netzwerk. Es schreibt nur eine **Kandidaten-ID**, nicht den produktiven Pin; vorbereitete Archive ermöglichen einen Offline-Neuaufbau. Die Quellen samt Lizenzhinweisen liegen im Image unter `/usr/local/share/texmf/doc`. Nach unabhängiger Prüfung wird `builder/image-id` ausdrücklich aktualisiert und der Bewerbungsdienst neu gestartet; nicht das nackte Grundimage als Ersatz aktivieren. Netzwerk nur beim Paketdownload; Dokument-Builds laufen mit `--network=none`, read-only Root/Inputs, ohne Capabilities/Shell-Escape, als Nutzer, mit PID-/CPU-/RAM-/Dateigrößen- und 120-Sekunden-Limit. Temporäre Schreibbereiche sind begrenzte tmpfs. Systemfonts müssen lesbar sein (`openin_any=a`); es sind keine Host-Geheimnisse in den Container gemountet.

Die zusätzlichen PDF-Werkzeuge laufen in einem eigenen gepinnten Image, nicht als Hostprogramme:

```sh
docker build --network host -t bewerbung-pdf:workflow-v1 pdf-tools
docker image inspect bewerbung-pdf:workflow-v1 --format '{{.Id}}' > pdf-tools/image-id
```

`pdf-tools/image-id` und das zugehörige Docker-Image mitsichern. Ohne konfiguriertes Image meldet die API fehlende PDF-Verfügbarkeit; die Oberfläche bietet keine scheinbar funktionierende Verarbeitung. Der Runtime-Container erhält nur die konkreten Eingabekopien und seinen Ausgabeordner, ohne Netzwerk, beschreibbares Root-Dateisystem oder Host-Geheimnisse; mit Zeit-, Prozess-, CPU-, RAM- und Ausgabegrenzen. Quelle: qpdf, Ghostscript, img2pdf/Pillow aus dem Image.

## Privates Routing

`bewerbung.teejayslab.de` besitzt einen eigenen DNS-A-Eintrag auf die NetBird-Adresse `100.87.56.89`. Der dedizierte Caddy-Host verwendet das vorhandene vertrauenswürdige Wildcard-Zertifikat, prüft NetBird-Quell- **und** Zieladresse und leitet ohne Prefix-/WebSocket-/Authentifizierungsanpassungen an `127.0.0.1:3120` weiter. Nicht-NetBird-Anfragen werden abgewiesen. Das alte `/bewerbung/api` bleibt der Fach-API-Pfad auf der neuen Origin; originale T3-Endpunkte bleiben unverändert an `/api`, `/ws` und den übrigen nativen Root-Pfaden.

Bestehende Caddy-/DNS-Einträge anderer Anwendungen nicht ersetzen. Rücknahme nur als gezielte Entfernung des eigenen Hostblocks und DNS-Eintrags, niemals durch Rückspielen eines alten Gesamt-Caddyfiles oder einer alten DNS-Zone.

Quellherkunft: [PROVENIENZ.md](PROVENIENZ.md). Prüfungen und historischer Stand: [VERIFIKATION.md](VERIFIKATION.md).
