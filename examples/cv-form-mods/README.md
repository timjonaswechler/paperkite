# Formular-Mod-Beispiele im normalen Lebenslaufbereich

Auf `prototype/cv-mod-import` laufen die Formular-Primitives **in der normalen Bewerbungs-App**. Es gibt keinen zusätzlichen Build, Port oder Startbefehl. Maßgeblich sind [Ziel und Vertrag A–H](../../docs/vorlagen-mods.md#verbindliches-produktziel-vorlage-bestimmt-formular).

## Verwenden

1. Die App wie bisher bauen und starten: `npm run build`, `npm start`. Die bestehenden Node-/Buildvoraussetzungen und Schutzregeln für die laufende Installation gelten unverändert; vor einem produktiven Neustart sichern, keinen zweiten Server gegen dieselben Daten starten.
2. Bewerbung öffnen, **Lebenslauf** wählen.
3. Unter **LaTeX-Vorlage für diesen Lebenslauf** einen Eintrag **Formular · Beispiel · CV** oder **Formular · Beispiel · Portfolio** auswählen und den Wechsel bestätigen.
4. Felder ausfüllen, Einträge hinzufügen, sortieren, löschen oder mit **Im PDF** auswählen. Entwürfe lassen sich ohne vollständige Pflichtangaben speichern.
5. **Speichern**, **PDF bauen** und **PDF-Vorschau** verwenden dieselben Funktionen wie bisher. Änderungen normal speichern und neu laden; kein separater Prototyp-Datenspeicher.

Der erste Wechsel übernimmt keine alten CV-Inhalte automatisch. Sie bleiben mitsamt ihren LaTeX-Quellen erhalten. Mit der bisherigen Vorlage lässt sich zum alten Editor zurückkehren; ein späterer Wechsel zum Formular zeigt wieder die gespeicherten Formularwerte. Nicht zugeordnete Felder bleiben gespeichert. Inkompatible Bindungstypen werden abgewiesen, nicht still umgewandelt.

## Beispielquellen

`cv/` und `portfolio/` enthalten ausschließlich synthetische, handgeschriebene `mod.json`-/`main.tex`-Pakete. `format.lua` ist ihre gemeinsame Standardformatierung. Das Manifest bestimmt Felder und Anordnung, die LaTeX-Datei die Ausgabe. Beispielpakete sind zunächst nur als Auswahl verfügbar; erst die ausdrückliche Bindung hält die ausgewählte Version in der Datenbank fest. Spätere Änderungen erzeugen neue Inhalts-IDs und verändern alte Bindungen nicht.

Prüfung: `node --import tsx --test test/cv-form-primitives.test.ts`. Der bestehende `scripts/smoke-integrated-cv.ts` prüft alte und formularbasierte CVs gemeinsam im regulären Kandidatenclient; kein eigener Formular-Testclient. Ergebnisse stehen in [VERIFIKATION.md](../../VERIFIKATION.md).

Dies ist noch kein allgemeiner v2-Paketimport oder eine echte KI-Formularerstellung. Medienfelder, verschachtelte Sammlungen und automatische Feldzuordnung/Master-CV bleiben spätere Schritte. Der Branch-Stand ist nicht allein durch die Quelländerungen produktiv ausgerollt.
