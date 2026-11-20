# Freigegebener Lebenslauf-Editor

**Stand: 20.11.2026.** Der Benutzer hat Variante 3 mit den anschließenden Anpassungen als Bedienentwurf akzeptiert. Eine produktive Umsetzung ist damit noch nicht erfolgt; zunächst wird das Daten-/Vorlagenmodell besprochen.

## Fester Referenzstand

- [Akzeptierter Prototyp](accepted/2026-11-20-v1/document-editor.html)
- [Freigabeumfang und SHA-256](accepted/2026-11-20-v1/acceptance.json)
- [Datenmodell und offene Entscheidungen](../../docs/cv-datenmodell.md)

Der Referenzstand ist eine eigenständige Kopie. `node prototypes/cv-kompakt/generate.mjs` erzeugt nur die drei Arbeitsentwürfe im übergeordneten Verzeichnis und überschreibt ihn nicht. Weitere akzeptierte Änderungen erhalten einen neuen Referenzstand; den bestehenden nicht stillschweigend ersetzen.

Akzeptiert sind direktes Bearbeiten im Dokument, „Hinzufügen“, zusätzliche Stichpunkte links unter der Liste, Entfernen neu angelegter Einträge sowie Lesen/Bearbeiten. Der zusätzliche Hinweistext unter dem Dokument ist entfernt; Esc bleibt funktionsfähig.

**Nicht festgelegt** sind das PDF-Layout, die konkreten Abschnitte oder Beispieldaten. Insbesondere ist „Profil/Kurzprofil“ kein Pflichtabschnitt. Der spätere Editor muss mit der eigenen LaTeX-Vorlage und den tatsächlich vorhandenen CV-Abschnitten arbeiten.

## Arbeitsentwürfe

`1-kompaktliste.html`, `2-fokus-editor.html` und `3-dokument-editor.html` bleiben editierbare, eigenständige Prototypen. Alle enthalten nur fiktive Daten und lokalen Demozustand. „Speichern“ schreibt nicht in die App oder eine dauerhafte CV-Datenbank; die Darstellung ist kein echter LaTeX-/PDF-Build.
