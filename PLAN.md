# Dovari

**Domain:** `dovari.dev`

**Kurzbeschreibung:**  
Dovari ist ein minimalistisches, selbst hostbares persönliches Wiki bzw. Knowledge-Base-System, das vollständig auf Cloudflare läuft.

Der wichtigste Unterschied zu klassischen Markdown-Wikis oder komplexen Knowledge-Management-Systemen ist die Bedienung:

> Öffnen, schreiben, Screenshot einfügen, fertig.

Dovari soll sich ungefähr so bequem wie Notion anfühlen, dabei aber vollständig im eigenen Cloudflare-Account laufen und keinen klassischen Server benötigen.

Das Projekt soll langfristig als Open-Source-Projekt veröffentlicht werden und so gebaut sein, dass andere Anwender es möglichst mit einem einzigen Klick in ihrem eigenen Cloudflare-Account deployen können.

---

# 1. Produktvision

Dovari soll eine sehr einfache persönliche Wissensdatenbank sein.

Das System soll nicht versuchen, Notion vollständig nachzubauen und auch kein Enterprise-Wiki werden.

Der Fokus liegt auf:

- sehr schneller Bedienung
- möglichst wenig Konfiguration
- WYSIWYG-Editor
- Screenshots direkt aus der Zwischenablage einfügen
- Dateien per Drag & Drop einfügen
- schnelle Volltextsuche
- Seiten untereinander verlinken
- übersichtliche Navigation
- eigener Datenbesitz
- günstiges Hosting
- kein eigener Server
- One-Click-Deployment

Das zentrale Nutzungserlebnis soll sein:

1. Dovari öffnen
2. neue Seite erstellen
3. schreiben
4. `Ctrl+V` drücken und einen Screenshot einfügen
5. Dovari speichert automatisch
6. später über Suche oder Wiki-Link wiederfinden

---

# 2. Zielgruppe

Primäre Zielgruppe:

- Entwickler
- technisch interessierte Anwender
- Self-Hosting-Nutzer
- Menschen mit persönlicher Knowledge Base
- Nutzer von Obsidian, Notion, Wiki.js, MkDocs oder ähnlichen Tools
- kleine Teams eventuell später

Für Version 1 wird Dovari allerdings konsequent als **Single-User-Anwendung** entwickelt.

Multi-User-Funktionen sind zunächst ausdrücklich nicht notwendig.

---

# 3. Grundprinzipien

Bei jeder Produktentscheidung sollen folgende Regeln gelten.

## 3.1 Einfachheit vor Features

Dovari soll lieber zehn Funktionen extrem gut beherrschen als hundert Funktionen halbherzig.

Neue Funktionen dürfen die grundlegende Bedienung nicht komplizierter machen.

---

## 3.2 Kein eigener Server notwendig

Das komplette System soll auf Cloudflare laufen.

Geplante Infrastruktur:

- Cloudflare Workers
- Cloudflare D1
- Cloudflare R2
- ein beim Deployment gesetztes Instanz-Passwort mit eigener Dovari-Session
- optional Cloudflare Queues später
- optional Workers AI später

Keine VM.

Kein Docker.

Kein PostgreSQL.

Kein Redis.

Kein Kubernetes.

---

## 3.3 Nutzer besitzt seine Daten

Der Nutzer muss jederzeit seine Inhalte exportieren können.

Mindestens:

- Markdown
- Bilder
- Anhänge

Später eventuell zusätzlich:

- JSON
- vollständiges Dovari-Backup
- Import aus Obsidian

Dovari darf kein geschlossenes Datenformat werden.

---

## 3.4 Browser-first

Dovari wird primär über den Browser verwendet.

Desktop- oder Mobile-Apps sind für den MVP nicht geplant.

Die Website soll aber responsive sein und auf mobilen Geräten vernünftig funktionieren.

---

# 4. Technischer Stack

Empfohlener Stack:

## Sprache

**TypeScript**

Dovari soll bewusst TypeScript verwenden, weil Cloudflare Workers damit sehr gut funktionieren und das Ökosystem für Editor, React und Cloudflare umfangreich ist.

---

## Frontend

- React
- Vite
- TypeScript
- Tailwind CSS
- shadcn/ui optional
- Lucide Icons

---

## Editor

**Tiptap**

Tiptap basiert auf ProseMirror und eignet sich sehr gut für einen modernen WYSIWYG-Editor.

Benötigte Extensions:

- Document
- Paragraph
- Text
- Heading
- Bold
- Italic
- Strike
- Code
- CodeBlock
- BulletList
- OrderedList
- TaskList
- TaskItem
- Blockquote
- HorizontalRule
- Link
- Image
- Placeholder
- History

Tabellen-Extensions sind bewusst erst nach Version 1 vorgesehen.

Eigene Extensions werden wahrscheinlich benötigt für:

- Wiki Links
- File Attachments
- Image Upload
- Slash Commands

Die Seitenansicht ist zugleich die Bearbeitungsoberfläche. Es gibt keinen separaten Lese- und
Editiermodus und keine visuell abgesetzte „Editor-Box“. Titel und Inhalt sollen sich wie ein
zusammenhängendes Dokument anfühlen, das nach dem Öffnen unmittelbar bearbeitet werden kann.

Für die Version-1-Abnahme gilt deshalb zusätzlich:

- Die Dokumentfläche nutzt den verfügbaren Platz auf Desktop und Mobile deutlich besser aus.
- Technische oder erklärende Zwischenüberschriften wie „Content“ und „Write in context.“ entfallen.
- Der Seitentitel wird dokumentnah bearbeitet; Rename bleibt als robuste Alternative erhalten,
  darf aber die normale Schreiboberfläche nicht dominieren.
- Toolbar, Save-Status und Seitenaktionen bleiben erreichbar, treten im Ruhezustand aber visuell
  hinter den Inhalt zurück.
- Interne Debug-Ausgaben wie das aktuelle Tiptap-JSON gehören nicht in die normale Seitenansicht.
- Backlinks bleiben erreichbar, werden aber als nachgeordnete Dokumentinformation dargestellt.

Normale Web- und E-Mail-Adressen werden beim Tippen oder Einfügen automatisch als sichere Links
erkannt. Links müssen aus dem Editor heraus bewusst geöffnet sowie weiterhin bearbeitet und
entfernt werden können, ohne die Textbearbeitung zu blockieren.

---

## Backend

**Cloudflare Worker**

API-Framework:

**Hono**

Alternativ könnte zunächst komplett ohne Framework gearbeitet werden, aber Hono ist wahrscheinlich die sinnvollste Wahl.

---

## Datenbank

**Cloudflare D1**

D1 speichert:

- Seiten
- Inhaltsstruktur
- Tags
- Verlinkungen
- Dateimetadaten
- Einstellungen
- Suchindex

---

## Dateispeicher

**Cloudflare R2**

Nicht „R3“.

R2 speichert:

- Screenshots
- Bilder
- PDFs
- ZIP-Dateien
- Dokumente
- sonstige Anhänge

---

## ORM

Bevorzugt:

**Drizzle ORM**

Alternativ kann D1 direkt per SQL angesprochen werden.

Da Dovari bewusst klein bleiben soll, sollte geprüft werden, ob Drizzle wirklich einen Vorteil bringt.

---

# 5. Architektur

Grundaufbau:

```text
Browser
   |
   v
React Application
   |
   v
Cloudflare Worker / Hono
   |
   +----------------------+
   |                      |
   v                      v
Cloudflare D1          Cloudflare R2
   |                      |
Pages                  Images
Metadata               Screenshots
Links                  PDFs
Tags                   Attachments
Search Index
```

Frontend und Backend sollen möglichst gemeinsam als Cloudflare-Worker-Projekt deployed werden.

---

# 6. Repository

Vorgeschlagene Struktur:

```text
dovari/
│
├── src/
│   ├── app/
│   │   ├── components/
│   │   ├── editor/
│   │   ├── pages/
│   │   ├── hooks/
│   │   └── lib/
│   │
│   ├── worker/
│   │   ├── routes/
│   │   ├── services/
│   │   ├── db/
│   │   ├── storage/
│   │   └── auth/
│   │
│   └── shared/
│       ├── types/
│       └── schemas/
│
├── migrations/
│   ├── 0001_initial.sql
│   ├── 0002_search.sql
│   └── ...
│
├── public/
│
├── tests/
│
├── wrangler.jsonc
├── package.json
├── vite.config.ts
├── tsconfig.json
└── README.md
```

Falls die Worker/Vite-Integration eine andere Struktur sinnvoller macht, darf davon abgewichen werden.

---

# 7. Seitenmodell

Eine Seite soll mindestens folgende Felder besitzen:

```text
pages

id
title
slug
content_json
content_text
content_markdown
parent_id
position
created_at
updated_at
```

Bedeutung:

### id

UUID oder ULID.

ULID wäre interessant, weil IDs sortierbar sind.

---

### title

Name der Seite.

Beispiel:

```text
Cloudflare Workers
```

---

### slug

URL-freundliche Variante.

Beispiel:

```text
cloudflare-workers
```

URL:

```text
/pages/cloudflare-workers
```

Die Seite sollte intern aber nicht ausschließlich über den Slug identifiziert werden, da sich Titel und Slug ändern können.

---

### content_json

Primäres Tiptap-Dokument.

Beispiel:

```json
{
  "type": "doc",
  "content": []
}
```

---

### content_text

Plaintext-Repräsentation.

Verwendung:

- Volltextsuche
- Snippets
- zukünftige AI-Funktionen

---

### content_markdown

Automatisch erzeugte Markdown-Version.

Damit bleibt das System exportierbar.

Es muss entschieden werden, ob diese Version bei jedem Speichern erzeugt oder nur beim Export generiert wird.

Für den MVP ist das Generieren beim Speichern wahrscheinlich sinnvoll.

---

### parent_id

Ermöglicht hierarchische Seiten.

Beispiel:

```text
Programming
   Cloudflare
      Workers
      D1
      R2
```

---

### position

Reihenfolge innerhalb eines Ordners.

---

# 8. Auto-Save

Dovari soll keinen klassischen „Speichern“-Knopf benötigen.

Beim Schreiben:

```text
Editor verändert sich
      ↓
Debounce
      ↓
ca. 500–1000 ms
      ↓
PUT /api/private/pages/:id
```

In der UI:

```text
Saving...
```

danach:

```text
Saved
```

Bei Netzwerkfehler:

```text
Not saved
Retry
```

Das Speichern muss robust funktionieren.

---

# 9. Screenshot Copy & Paste

Dies ist eines der wichtigsten Features des gesamten Projekts.

Der Nutzer erstellt beispielsweise mit:

```text
Win + Shift + S
```

einen Screenshot.

Danach:

```text
Ctrl + V
```

im Editor.

Dovari erkennt ein Bild in der Zwischenablage.

Workflow:

```text
Clipboard
   ↓
Tiptap Paste Handler
   ↓
File/Blob
   ↓
POST /api/private/assets
   ↓
Cloudflare Worker
   ↓
R2
   ↓
Asset Metadata → D1
   ↓
URL zurückgeben
   ↓
Bild in Editor einsetzen
```

Während Upload:

```text
[ Uploading image... ]
```

Nach Upload:

```text
<Image>
```

Fehler müssen sauber dargestellt werden.

---

# 10. Drag & Drop

Der gleiche Upload-Mechanismus soll auch für Drag & Drop verwendet werden.

Unterstützte Dateien zunächst:

- PNG
- JPEG
- WebP
- GIF
- SVG möglicherweise
- PDF
- TXT
- Markdown
- ZIP
- allgemeine Binärdateien

Für nicht darstellbare Dateien erscheint ein Attachment-Block.

Beispiel:

```text
📎 invoice.pdf
   342 KB
```

---

# 11. R2-Struktur

Objekte in R2 könnten beispielsweise so organisiert werden:

```text
assets/
  2026/
    09/
      01JABCXYZ.png
      01JDEFXYZ.pdf
```

Nicht den ursprünglichen Dateinamen als alleinigen Key verwenden.

Dateinamen bleiben aber als Metadaten erhalten.

---

# 12. Asset-Datenbank

```text
assets

id
page_id
object_key
filename
mime_type
size
width
height
created_at
```

Optional später:

```text
sha256
```

Damit könnten doppelte Dateien erkannt werden.

---

# 13. Bildauslieferung

Bilder sollten über Dovari ausgeliefert werden.

Beispiel:

```text
/assets/:id
```

Der Worker liest das Objekt aus R2 und liefert es aus.

Vorteile:

- Bucket muss nicht öffentlich sein
- Authentifizierung bleibt erhalten
- später Thumbnailing möglich
- Storage kann verändert werden
- URLs bleiben stabil

Caching sollte verwendet werden.

---

# 14. Navigation

Desktop-Layout:

```text
┌───────────────────────────────────────────┐
│ Dovari                            Search  │
├──────────────┬────────────────────────────┤
│              │                            │
│ Sidebar      │ Page                       │
│              │                            │
│ Programming  │ # Cloudflare Workers       │
│ ├ Cloudflare │                            │
│ │ ├ Workers  │ Text ...                   │
│ │ └ R2       │                            │
│ └ Elixir     │                            │
│              │                            │
│ + New Page   │                            │
│              │                            │
└──────────────┴────────────────────────────┘
```

Sidebar:

- Seitenbaum
- einklappbare Bereiche
- Drag & Drop
- neue Seite
- Suchknopf
- Einstellungen

Ab Phase 14 besitzt Dovari zusätzlich eine bewusst einfachere öffentliche Navigation:

- `/` zeigt ohne Login alle aktuell veröffentlichten Seiten.
- `/p/:publicId` zeigt eine veröffentlichte Seite schreibgeschützt.
- Entwürfe, unveröffentlichte Seiten und private Hierarchieeinträge fehlen vollständig.
- „Bearbeiten“ wechselt in `/app` und löst erst dort die Dovari-Passwort-Anmeldung aus.
- Nach der Anmeldung bleibt die bestehende private Sidebar die vollständige Sicht auf alle Seiten.

---

# 15. Neue Seite

Möglichkeiten:

### Button

```text
+ New Page
```

---

### Tastenkombination

Beispielsweise:

```text
Ctrl + N
```

---

### Wiki-Link

Wenn der Nutzer schreibt:

```text
[[Meine neue Seite]]
```

und diese Seite noch nicht existiert, kann sie direkt erstellt werden.

---

# 16. Wiki Links

Syntax:

```text
[[Cloudflare Workers]]
```

Beim Eingeben von:

```text
[[
```

öffnet sich eine Autocomplete-Liste.

Beispiel:

```text
Cloudflare Workers
Cloudflare R2
Cloudflare D1
```

Enter fügt den Link ein.

Die `[[`-Syntax bleibt der schnelle Tastaturweg. Zusätzlich braucht der Editor einen sichtbaren,
beschrifteten Einstieg für interne Seitenlinks, der dieselbe Suche und Seitenerstellung öffnet.
Damit ist die Funktion auch ohne Kenntnis der Wiki-Syntax auffindbar. Ein eingefügter Wiki-Link
muss aus dem Editor geöffnet, erneut ausgewählt oder entfernt werden können.

Nicht existierende Seiten können dargestellt werden als:

```text
Create "Cloudflare Queues"
```

---

# 17. Backlinks

Später bzw. nach dem MVP sollte jede Seite sehen können:

```text
Referenced by

- Cloudflare Overview
- Dovari Architecture
```

Dafür könnte eine Tabelle existieren:

```text
page_links

source_page_id
target_page_id
```

Sie kann beim Speichern automatisch aktualisiert werden.

---

# 18. Tags

Optional für MVP oder direkt danach.

Syntax eventuell:

```text
#cloudflare
#typescript
#linux
```

Tabelle:

```text
tags

id
name
```

```text
page_tags

page_id
tag_id
```

Tags dürfen die einfache Seitenstruktur aber nicht komplizierter machen.

---

# 19. Suche

Dovari soll keine externe Suchmaschine benötigen.

Keine Abhängigkeit von:

- Algolia
- Elasticsearch
- Meilisearch
- Typesense

D1 bzw. SQLite Full Text Search verwenden.

Durchsucht werden:

- Titel
- Inhalt
- Tags
- optional Dateinamen

UI:

```text
Ctrl + K
```

öffnet eine Command Palette.

Beispiel:

```text
Search Dovari...

cloudflare work
```

Ergebnis:

```text
Cloudflare Workers
Programming / Cloudflare

Cloudflare Worker Deployment
Projects / Dovari
```

---

# 20. Command Palette

`Ctrl + K`

Die Palette ist gleichzeitig:

- Suche
- Navigation
- Aktionsmenü

Mögliche Aktionen:

```text
Create new page
Go to settings
Toggle dark mode
Export wiki
```

---

# 21. Slash Commands

Slash Commands gehören zum abschließenden Alltags-Polish vor Version 1. Gibt der Nutzer in einem
leeren Absatz `/` ein, öffnet sich eine per Tastatur bedienbare Befehlspalette.

```text
Text
Heading 1
Heading 2
Heading 3
Bullet List
Numbered List
Checklist
Code
Quote
Wiki Link
Image
File
Divider
```

Die Palette filtert während der Eingabe, wird mit Escape geschlossen und führt den gewählten
Befehl mit Enter aus. Bild und Datei verwenden dieselbe validierte Upload-Pipeline wie Paste und
Drag & Drop. Die sichtbare Toolbar bleibt als zugänglicher Fallback erhalten. Tabellen sind nicht
Teil der Version 1.

---

# 22. Code-Blöcke

Dovari wird wahrscheinlich überdurchschnittlich viel von Entwicklern verwendet.

Codeblöcke sollen daher sehr gut funktionieren.

Features:

- Syntax Highlighting
- Sprache auswählen
- Copy Button
- optional Dateiname
- optional Zeilennummern

Beispiel:

```text
config.ts

export default {
  ...
}
```

---

# 23. Authentication

Für den MVP gibt es keine Benutzerverwaltung. Eine Installation wird mit genau einem
`DOVARI_PASSWORD` als verschlüsseltem Cloudflare-Worker-Secret geschützt. Dovari stellt die
Login-Seite bereit und verwaltet zeitlich begrenzte, opake Sessions in D1.

Vorgesehene Trennung:

```text
/                       öffentliche Liste veröffentlichter Seiten ab Phase 14
/app/*                  private Anwendung
/api/private/*          private API und alle Schreibzugriffe
/p/*                    später öffentliche Seiten
/api/public/*           später ausschließlich öffentliche Lesezugriffe
```

Das Passwort bleibt ausschließlich im Worker-Secret. D1 enthält nur SHA-256-Hashes zufälliger
Session-Tokens. Sessions sind 30 Tage gültig, an die aktuelle Worker-Version gebunden und werden
bei einem neuen Deployment ungültig. Fehlversuche werden pro gehashter Quell-IP begrenzt.

Nicht Teil von Version 1 sind Passwort-Reset, individuelle Konten, Rollen, MFA und GitHub OAuth.
Öffentliche Routen dürfen niemals Mutationen anbieten oder auf private Seiten beziehungsweise
private Assets zugreifen.

Beispiel für den privaten Bereich:

```text
wiki.example.com
```

Zugriff auf `/app/*` nur nach Login. Der öffentliche Einstieg und veröffentlichte Seiten bleiben
ohne Login erreichbar. „Passwort eingeben“ bedeutet im Produkt weiterhin die Anmeldung über die
eingebaute Dovari-Login-Seite mit dem `DOVARI_PASSWORD`. Dovari speichert das Passwort nur als
Worker-Secret und hält in D1 ausschließlich Hashes zufälliger Session-Tokens.

---

# 24. Single User

Version 1 geht davon aus:

```text
eine Installation
=
eine persönliche Knowledge Base
```

Keine:

- Teams
- Rollen
- Berechtigungen
- Sharing-Rechte
- Kommentare

Das reduziert die Komplexität enorm.

---

# 25. Dark Mode

Von Anfang an:

- Light
- Dark
- System

Design soll minimalistisch sein.

Kein visuell überladenes Interface.

---

# 26. Responsive Design

Desktop ist primär.

Mobile soll dennoch funktionieren.

Auf Smartphones:

```text
Sidebar → Drawer
Editor → volle Breite
```

Das Schreiben umfangreicher Inhalte auf Smartphones ist sekundär.

Lesen und kleine Änderungen sollen gut funktionieren.

---

# 27. Markdown Export

Sehr wichtig.

Der Nutzer muss sein gesamtes Wiki exportieren können.

Export:

```text
dovari-export.zip

pages/
  programming/
    cloudflare-workers.md
    cloudflare-r2.md

assets/
  image1.png
  screenshot2.png
```

Markdown enthält lokale Links auf Assets.

Dieser Export ist bewusst menschenlesbar und für den Wechsel zu anderen Werkzeugen gedacht. Er
ist kein verlustfreies Dovari-Backup: Editorstruktur, Papierkorb und Versionshistorie müssen nicht
vollständig aus Markdown rekonstruierbar sein.

Beispiel:

```markdown
# Cloudflare Workers

Text...

![Screenshot](../assets/image1.png)
```

---

# 28. Import

Fremdimporte sind nicht Teil der Version 1. Das in Abschnitt 29 definierte Wiederherstellen eines
eigenen Dovari-Backups ist davon getrennt und gehört zur Version 1.

Später:

### Markdown Import

Einzelne `.md`-Datei.

### ZIP Import

Markdown + Bilder.

### Obsidian Vault

Ein kompletter Vault könnte importiert werden.

Unterstützung möglichst für:

```text
[[Wiki Links]]
```

und:

```text
![[image.png]]
```

---

# 29. Backup

Dovari benötigt vor dem ersten Deployment neben dem Markdown-Export ein verlustfreies,
versioniertes Backupformat.

```text
dovari-backup-v1.zip

backup.json
assets/
```

Das Backup enthält:

- aktive und gelöschte Seiten mit IDs, Hierarchie, Positionen, Revisionen und Zeitstempeln
- vollständiges validiertes Tiptap-JSON
- die Versionshistorie
- alle Asset-Metadaten einschließlich unreferenzierter oder soft-gelöschter Einträge, ihre
  Prüfsummen und die vorhandenen R2-Dateien

Secrets, Cloudflare-Accountdaten, Authentifizierungskonfiguration und Resource-IDs werden nicht exportiert.
Fehlt ein erwartetes Asset in R2, darf das Ergebnis nicht als vollständiges Backup angeboten
werden; die betroffenen Assets werden konkret gemeldet.

Version 1 stellt ein solches Backup ausschließlich in eine leere Dovari-Installation wieder her.
Dadurch bleiben Page- und Asset-IDs stabil und Wiki-Links verlustfrei. Das Backup wird vor dem
Import vollständig validiert. Assets werden einzeln über eine wiederaufnehmbare Restore-Session
übertragen; die Seitendaten werden erst nach erfolgreicher Übertragung finalisiert. Eine
abgebrochene Session kann fortgesetzt oder samt ihren hochgeladenen Objekten verworfen werden.

Automatische oder zeitgesteuerte Backups nach R2 bleiben eine spätere Funktion.

Mögliche spätere Option:

```text
Scheduled Worker
      ↓
D1 Export
      ↓
R2 Backup
```

---

# 30. Deploy-to-Cloudflare

Ein sehr wichtiges Projektziel.

README:

```text
Deploy to Cloudflare
```

Der Nutzer klickt.

Idealer Ablauf:

```text
GitHub Repository
      ↓
Deploy to Cloudflare
      ↓
Cloudflare Account wählen
      ↓
D1 erstellen
      ↓
R2 erstellen
      ↓
Bindings konfigurieren
      ↓
Migrationen durchführen
      ↓
Worker deployen
      ↓
Dovari läuft
```

Ziel:

Keine manuelle Cloudflare-Konfiguration für Standardinstallationen.

Falls dies technisch nicht komplett automatisierbar ist, sollen die verbleibenden Schritte extrem gut dokumentiert werden.

---

# 31. Lokale Entwicklung

Entwickler sollen einfach starten können:

```bash
git clone ...
cd dovari
npm install
npm run dev
```

oder bevorzugt:

```bash
pnpm install
pnpm dev
```

Es sollte geprüft werden, ob pnpm oder npm verwendet werden soll.

Für ein Open-Source-Projekt wäre pnpm wahrscheinlich eine gute Wahl.

---

# 32. Wrangler

Cloudflare-Ressourcen:

```text
D1 binding:
DB

R2 binding:
ASSETS
```

Beispiel:

```text
env.DB
env.ASSETS
```

Secrets und Umgebungsvariablen sollen möglichst gering gehalten werden.

---

# 33. API

Mögliche API-Struktur:

## Pages

```text
GET /api/private/pages
```

Seitenbaum.

```text
POST /api/private/pages
```

Seite erstellen.

```text
GET /api/private/pages/:id
```

Seite laden.

```text
PUT /api/private/pages/:id
```

Seite speichern.

```text
DELETE /api/private/pages/:id
```

Seite löschen.

---

## Assets

```text
POST /api/private/assets
```

Upload.

```text
GET /api/private/assets/:id
```

Datei herunterladen.

```text
DELETE /api/private/assets/:id
```

Datei löschen.

---

## Search

```text
GET /api/private/search?q=cloudflare
```

---

## Export

```text
POST /api/private/export
```

oder:

```text
GET /api/private/export
```

---

# 34. Validierung

API-Eingaben sollen validiert werden.

Geeignet:

**Zod**

Gemeinsame Schemas können zwischen Frontend und Backend verwendet werden.

---

# 35. Fehlerbehandlung

Dovari soll Fehler verständlich darstellen.

Nicht:

```text
HTTP 500
```

sondern:

```text
We couldn't save this page.
Retry
```

Uploads:

```text
Upload failed
Retry
```

---

# 36. Offline-Verhalten

Kein vollständiger Offline-Modus im MVP.

Aber Änderungen sollten möglichst nicht sofort verloren gehen.

Mögliche erste Absicherung:

- Editor State im Browser
- IndexedDB oder LocalStorage
- Wiederherstellung nach Reload

Später eventuell vollständige PWA-Unterstützung.

---

# 37. Sicherheit

Mindestens:

- alle privaten Seiten authentifiziert
- R2 Bucket nicht öffentlich
- Dateiupload-MIME-Typ prüfen
- maximale Uploadgröße
- Dateinamen sanitizen
- keine beliebigen HTML-Skripte
- Tiptap-Inhalt sanitizen
- CSRF-Thema prüfen
- Security Headers
- Content Security Policy
- Rate Limiting optional

SVG verdient besondere Aufmerksamkeit, da SVG JavaScript enthalten kann.

Für MVP könnte SVG Upload zunächst deaktiviert werden.

---

# 38. Löschen von Assets

Problem:

Ein Nutzer löscht ein Bild aus einer Seite.

Soll das Objekt sofort aus R2 gelöscht werden?

Empfehlung:

Nein.

Stattdessen zunächst Assets behalten.

Später kann eine Garbage Collection prüfen:

```text
Asset wird von keiner Seite mehr verwendet
AND
älter als beispielsweise 30 Tage
```

Dann löschen.

Das verhindert versehentlichen Datenverlust.

---

# 39. Papierkorb

Seiten werden in Version 1 nicht unmittelbar dauerhaft gelöscht. Das vorhandene Feld
`deleted_at` markiert eine Seite als gelöscht; sie verschwindet aus Navigation, Wiki-Link-Suche
und Volltextsuche und erscheint unter `Settings → Trash`.

```text
Restore
Delete permanently
```

Restore erhöht die aktuelle Seitenrevision. Existiert der frühere Parent weiterhin aktiv, wird
die ursprüngliche Position in dessen Hierarchie wiederhergestellt; andernfalls wird die Seite auf
Root-Ebene einsortiert. Nach dem normalen Löschen bietet die Seitenansicht zusätzlich eine direkte
Undo-Aktion an.

Dauerhaftes Löschen ist ausschließlich im Papierkorb möglich und verlangt zur Bestätigung die
Eingabe des Seitentitels. Abhängige Seitenlinks, Asset-Referenzen und Versionsstände werden dabei
entfernt. Die binären R2-Objekte bleiben bis zu einer späteren Garbage Collection erhalten.

Die Delete-Aktion der normalen Seitenansicht liegt in einem Seitenmenü und dominiert nicht die
Schreiboberfläche.

---

# 40. Versionshistorie

Eine begrenzte Versionshistorie ist Teil der vertrauenswürdigen Version 1.

```text
page_revisions

id
page_id
source_revision
title
content_json
trigger
created_at
```

Der Server speichert den vorherigen persistierten Zustand vor der ersten Titel- oder
Inhaltsänderung eines Zehn-Minuten-Fensters. Vor dem Löschen und vor jeder Wiederherstellung wird
unabhängig vom Zeitfenster ein Snapshot angelegt. Unveränderte Zustände erzeugen keinen Snapshot.

Pro Seite bleiben höchstens die jüngsten 50 Snapshots erhalten. Beim Wiederherstellen wird der
Snapshot validiert und als neue aktuelle Revision gespeichert; die Revisionsnummer wird niemals
zurückgesetzt und bestehende Historie nicht überschrieben. `content_text`, Asset-Referenzen und
Wiki-Links werden wie bei einem normalen Content-Save erneut serverseitig abgeleitet.

---

# 41. Design

Dovari soll sehr ruhig und minimalistisch wirken.

Orientierung:

- Linear
- Notion
- Vercel
- GitHub
- moderne Developer Tools

Keine starken Verläufe.

Keine unnötigen Animationen.

Keine übermäßig großen Karten.

Dovari soll sich eher wie ein Werkzeug als wie eine Marketing-SaaS-App anfühlen.

---

# 42. Branding

Projekt:

```text
Dovari
```

Domain:

```text
dovari.dev
```

Arbeitsslogan:

```text
Your knowledge. Your cloud.
```

Alternativen:

```text
Knowledge without the server.
```

```text
Your personal knowledge base, deployed in minutes.
```

```text
A tiny knowledge base built for Cloudflare.
```

Branding ist noch nicht final.

---

# 43. MVP

Der erste wirklich nutzbare Release soll bewusst klein bleiben.

## Muss enthalten

### Infrastruktur

- Cloudflare Worker
- D1
- R2

### Seiten

- Seite erstellen
- Seite umbenennen
- Seite bearbeiten
- Seite löschen
- Seitenhierarchie

### Editor

- Tiptap
- Überschriften
- Bold
- Italic
- Listen
- Checklisten
- Links
- Code
- Codeblöcke
- Bilder
- dokumentnahe, immer bearbeitbare Seitenansicht
- automatische Erkennung sicherer Web- und E-Mail-Links
- auffindbare Erstellung interner Wiki-Links zusätzlich zur `[[`-Syntax

### Bilder

- Screenshot Copy & Paste
- Drag & Drop
- Upload nach R2

### Speicherung

- Auto-Save
- D1
- Papierkorb und Wiederherstellung
- begrenzte Versionshistorie
- verlustfreies, versioniertes Dovari-Backup
- Restore in eine leere Installation

### Suche

- Volltextsuche
- Ctrl+K

### UI

- Sidebar
- zuletzt bearbeitete Seiten
- Settings-Bereich für Theme, Papierkorb, Backup und Restore
- Slash Commands für die unterstützten Editorblöcke
- Light Mode
- Dark Mode
- responsive

### Export

- menschenlesbarer Markdown-/ZIP-Export
- verlustfreies Dovari-Backup einschließlich Assets

### Deployment

- Dokumentation
- möglichst Deploy-to-Cloudflare

---

# 44. Nicht Teil des MVP

Bewusst nicht implementieren:

- AI
- Teams
- Rollen
- Kommentare
- öffentliche Pages
- Echtzeit-Collaboration
- mobile App
- Desktop App
- Plugin-System
- komplexe Themes
- Web Clipper
- Calendar
- Kanban
- Whiteboard
- Datenbanken wie Notion
- Tabellenkalkulation
- Tabellen im Editor
- End-to-End-Verschlüsselung
- Tags
- Favoriten
- Fremd-, Markdown- und Obsidian-Import
- automatische oder zeitgesteuerte Backups
- automatische Asset-Garbage-Collection

Diese Dinge können später kommen.

---

# 45. Entwicklungsphasen

## Phase 0 – Projektgrundlage

Ziel:

Leeres System läuft auf Cloudflare.

Aufgaben:

- Repository erstellen
- TypeScript
- React
- Vite
- Worker
- Hono
- Wrangler
- D1 Binding
- R2 Binding
- Development Environment
- ESLint
- Formatter
- Tests

Ergebnis:

```text
dovari.dev
```

zeigt die Grundanwendung.

---

## Phase 1 – Seiten

Aufgaben:

- D1 Schema
- Migrationen
- Pages API
- Seiten erstellen
- Seiten laden
- Seiten speichern
- Seiten löschen
- Sidebar

Noch kein komplexer Editor erforderlich.

Ergebnis:

Grundlegendes Wiki funktioniert.

---

## Phase 2 – Tiptap

Aufgaben:

- Editor integrieren
- content_json
- Autosave
- Markdown-Konvertierung
- grundlegende Formatierung
- Codeblocks

Ergebnis:

Dovari kann produktiv zum Schreiben benutzt werden.

---

## Phase 3 – Bilder und Dateien

Wichtigste Phase.

Aufgaben:

- R2 Upload API
- Clipboard Handler
- Screenshot Paste
- Drag & Drop
- Image Node
- Attachment Node
- Upload Progress
- Fehlermeldungen
- Asset API

Ergebnis:

```text
Win + Shift + S
Ctrl + V
```

funktioniert.

Das ist der erste echte „Dovari-Moment“.

---

## Phase 4 – Navigation

Aufgaben:

- Seitenbaum
- Parent/Child
- Sortierung
- Drag & Drop
- Rename inline
- Create child

---

## Phase 5 – Suche

Aufgaben:

- content_text erzeugen
- FTS
- Search API
- Command Palette
- Tastenkürzel

---

## Phase 6 – Wiki Links

Aufgaben:

- `[[`
- Autocomplete
- Link Node
- nicht existierende Seite erstellen
- Page Links Tabelle
- Backlinks

---

## Phase 7 – Export

Aufgaben:

- Tiptap → Markdown
- ZIP
- Assets
- Links umschreiben
- Download

---

## Phase 8 – Dokumentnahe Bearbeitungsoberfläche

Aufgaben:

- Seite und Editor zu einer ruhigen Dokumentfläche zusammenführen
- verfügbare Breite und Höhe besser nutzen
- Titel dokumentnah bearbeitbar machen
- unnötige Labels, Editor-Rahmen und Debug-JSON aus der normalen Ansicht entfernen
- Toolbar, Save-Status, Seitenaktionen und Backlinks dezent und weiterhin zugänglich anordnen
- Desktop-, Mobile-, Tastatur- und Accessibility-Verhalten absichern

Ziel:

Nach dem Öffnen einer Seite fühlt sich Dovari unmittelbar wie ein bearbeitbares Dokument und nicht
wie eine Verwaltungsseite mit eingebettetem Editor an.

---

## Phase 9 – Link-Erlebnis und Auffindbarkeit

Aufgaben:

- sichere `http`, `https`- und E-Mail-Adressen beim Tippen und Einfügen automatisch verlinken
- externe Links eindeutig und sicher aus dem Editor öffnen
- Link-Ziel anzeigen, bearbeiten und entfernen
- sichtbaren Einstieg für Wiki-Links mit Seitensuche und Seitenerstellung ergänzen
- bestehende `[[`-Autocomplete-Bedienung beibehalten und erklären
- Maus-, Touch- und Tastaturabläufe testen

Ziel:

Externe und interne Links lassen sich ohne Vorwissen erstellen, erkennen und aufrufen.

---

## Phase 10 – Datensicherheit

Aufgaben:

- Papierkorb unter Settings
- Restore mit Hierarchie-Fallback
- bestätigtes permanentes Löschen
- Undo nach normalem Löschen
- begrenzte automatische Versionshistorie
- Vorschau und Wiederherstellung eines Versionsstands als neue Revision
- Revision-, Foreign-Key-, Suchindex- und Accessibility-Tests

Ziel:

Versehentliches Löschen oder Überschreiben lässt sich ohne direkten Datenbankzugriff sicher
rückgängig machen.

---

## Phase 11 – Backup und Restore

Aufgaben:

- `dovari-backup-v1` als verlustfreies ZIP-Format
- aktive und gelöschte Seiten, Hierarchie, Tiptap-JSON und Versionshistorie exportieren
- alle Asset-Metadaten einschließlich unreferenzierter oder soft-gelöschter Einträge,
  Prüfsummen und vorhandene R2-Dateien einbeziehen
- fehlende Assets vor einem vollständigen Backup erkennen
- Restore-Session mit Fortschritt, Wiederaufnahme und Abbruch
- Restore ausschließlich in eine leere Installation
- vollständigen Export-/Restore-Roundtrip testen

Ziel:

Eine frische Dovari-Installation kann ohne Inhalts-, Link- oder Assetverlust aus einem eigenen
Backup wiederhergestellt werden.

---

## Phase 12 – Alltags-Polish

Aufgaben:

- echten Settings-Bereich statt Platzhalter anbieten
- Theme, Papierkorb, Backup und Restore dort bündeln
- zuletzt bearbeitete Seiten in der Sidebar anzeigen
- Slash-Command-Palette für die bereits unterstützten Blöcke ergänzen
- Bild und Datei aus der Slash-Palette über die vorhandene Upload-Pipeline einfügen
- destruktive Seitenaktionen visuell nachordnen
- Command-Palette-Platzhalter und veraltete README-Aussagen bereinigen
- Desktop-, Mobile-, Tastatur- und Accessibility-Verhalten testen

Ziel:

Die tägliche Nutzung wirkt vollständig, ohne Dovari mit Tags, Tabellen oder komplexen
Organisationsfunktionen zu überladen.

---

## Phase 13 – Deployment Experience und Version-1-Abnahme

Aufgaben:

- README
- Setup Script
- Cloudflare-Ressourcen automatisieren
- Deploy Button
- Initial Migration
- Domain Setup dokumentieren
- Instanz-Passwort im Deploy-Flow abfragen und Login-/Session-Ablauf absichern
- frische Installation vollständig prüfen
- Papierkorb, Versions-Restore und Backup-Roundtrip in die Release-Abnahme aufnehmen

Ziel:

Ein neuer Nutzer soll Dovari ohne Cloudflare-Expertenwissen installieren können.

---

## Phase 14 – Öffentliche Veröffentlichungen

Aufgaben:

- explizite, bereinigte Publication-Snapshots
- `/` als öffentliche Landingpage mit vollständiger Liste aller aktiven Publications
- öffentliche Read-only-Seite unter `/p/:publicId`
- privates erstmaliges Publish und Unpublish; bestehende Publications synchronisieren Titel- und
  Inhaltsänderungen automatisch bei erfolgreichem Save, und neu angelegte oder verschobene
  Unterseiten erben die Veröffentlichung eines veröffentlichten Vorfahren
- Publish-Status und Sharing-Aktionen in der privaten Seitenansicht
- Bearbeiten-Link, der erst beim Wechsel nach `/app` die Passwort-Anmeldung verlangt
- öffentliche Asset-Auslieferung nur für Assets des konkreten Snapshots
- private Wiki-Links werden nur auf bereits veröffentlichte Ziele umgeschrieben, sonst zu Text
- private IDs, Hierarchie, Backlinks, Revisionen und unveröffentlichte Inhalte bleiben verborgen
- Backup v2 erhält Publications und öffentliche URLs; Restore bleibt mit Backup v1 kompatibel
- vollständige Private-/Public-Routing- und Security-Tests

Ziel:

Besucher sehen ohne Login alle bewusst veröffentlichten Seiten. Erst wenn jemand „Bearbeiten“
wählt, schützt die Dovari-Passwort-Session den vollständigen Workspace einschließlich aller
Entwürfe und unveröffentlichten Seiten.

---

## Phase 15 – Öffentliche Suche und Auffindbarkeit

Aufgaben:

- eigener Volltextindex nur für Publication-Snapshots
- öffentliche Suche und veröffentlichte Navigation
- kanonische URLs sowie sichere Title-, Description- und Open-Graph-Metadaten
- `robots.txt` und `sitemap.xml` nur für explizit indexierbare Publications
- Cache-Invalidierung bei automatischer Snapshot-Synchronisierung und Unpublish

Ziel:

Auch eine größere öffentliche Knowledge Base bleibt gut navigierbar, ohne dass Suche oder
Suchmaschinen private Inhalte ableiten können.

---

## Phase 16 – Tags und Favoriten

Aufgaben:

- private Tags mit Rename, Filter und Search-Integration
- Favoriten in Sidebar und Command Palette
- konsistentes Verhalten bei Papierkorb, Restore und Backup
- Tags nur nach ausdrücklicher Aufnahme in einen Publication-Snapshot öffentlich zeigen

Ziel:

Häufige und thematisch zusammengehörige Seiten sind schneller erreichbar, ohne die einfache
Seitenhierarchie zu ersetzen.

---

## Phase 17 – Templates und Daily Notes

Aufgaben:

- wiederverwendbare Seitentemplates
- Seite aus Template erstellen
- idempotente tägliche Notiz in der konfigurierten Zeitzone
- Integration in Slash Commands und Command Palette
- Backup-/Restore-Unterstützung

Ziel:

Wiederkehrende Notizen benötigen weniger Handarbeit, ohne ein komplexes Datenbanksystem
einzuführen.

---

## Phase 18 – Markdown- und Obsidian-Import

Aufgaben:

- lokaler ZIP-Preflight und Konfliktvorschau
- unterstütztes Markdown sicher nach Tiptap konvertieren
- Ordnerhierarchie, Wiki Links und sichere lokale Assets übernehmen
- resumierbare Import-Session und atomare Finalisierung
- verständlicher Bericht für nicht unterstützte Inhalte

Ziel:

Bestehende Markdown- und Obsidian-Wissensbestände können sicher übernommen werden, ohne vorhandene
Dovari-Inhalte still zu überschreiben.

---

# 46. Teststrategie

Mindestens folgende Dinge automatisiert testen:

### Backend

- Page CRUD
- Assets
- Search
- Slugs
- Markdown Conversion

### Frontend

- Seite erstellen
- Seite speichern
- Seite wechseln

### Kritische E2E Tests

- Screenshot Paste
- Datei Upload
- Autosave
- Search
- Export

Playwright wäre wahrscheinlich sinnvoll.

---

# 47. Performance

Dovari sollte extrem schnell wirken.

Ziele:

- initiale Seite schnell laden
- Navigation ohne Full Reload
- Editor sofort verfügbar
- Suche unter ungefähr 100 ms wahrgenommen
- Bilder lazy laden
- Assets cachen

Da Dovari auf Cloudflare Edge läuft, sollte die Basis bereits sehr schnell sein.

---

# 48. Accessibility

Nicht ignorieren.

Mindestens:

- Tastaturnavigation
- Fokus-Zustände
- sinnvolle ARIA Labels
- ausreichender Kontrast
- Buttons nicht nur über Farbe unterscheiden

---

# 49. Open-Source

Dovari soll perspektivisch öffentlich auf GitHub liegen.

Mögliche Lizenz:

**MIT**

Alternativ:

**Apache 2.0**

MIT wäre für dieses Projekt wahrscheinlich vollkommen ausreichend.

---

# 50. Zukunftsideen

Erst nach einem stabilen MVP.

## AI

Optional:

```text
Ask Dovari
```

Beispiel:

```text
Wie habe ich meinen Cloudflare Tunnel eingerichtet?
```

Dovari durchsucht die eigenen Seiten.

Cloudflare Workers AI könnte dafür interessant sein.

---

## Semantic Search

Embeddings für semantische Suche.

---

## Web Clipper

Browser Extension:

```text
Save to Dovari
```

Webseite oder Text markieren und speichern.

---

## OCR

Screenshots durchsuchen.

---

## AI Tags

Tags automatisch vorschlagen.

---

## Related Pages

Automatisch ähnliche Seiten anzeigen.

---

## Public Sharing

Alle bewusst veröffentlichten Seiten ohne Login lesen; einzelne Seiten über stabile URLs teilen.

Beispiel:

```text
dovari.dev/p/abc123
```

Öffentlichkeit soll eine bewusste Veröffentlichung und keine bloße Freigabe des aktuellen Entwurfs sein.

Empfohlenes Modell:

```text
Private Seite
   ↓ Publish
bereinigter Publication Snapshot
   ↓
öffentliche Read-only URL
```

Nur Assets, die der veröffentlichte Snapshot tatsächlich referenziert, dürfen über die öffentliche Route ausgeliefert werden. Eine erstmalige Veröffentlichung bleibt bewusst, aber Titel- und Inhaltsänderungen einer bereits veröffentlichten Seite aktualisieren ihren bereinigten Snapshot automatisch. Private Wiki Links und nicht veröffentlichte eingebettete Inhalte dürfen durch eine öffentliche Seite nicht offengelegt werden.

Die Domain-Wurzel zeigt eine öffentliche Übersicht aller aktiven Publications. Diese Übersicht ist
keine gefilterte private Seitenliste, sondern wird ausschließlich aus Publication-Snapshots
gebildet. Sie enthält weder unveröffentlichte Titel noch private Seiten-IDs, Hierarchie,
Backlinks oder Revisionen.

Eine öffentliche Seite bietet einen klaren „Bearbeiten“-Einstieg. Dieser führt in den privaten
`/app`-Bereich und verlangt dort die Dovari-Passwort-Anmeldung. Erst nach erfolgreicher Anmeldung
darf Dovari die öffentliche ID zur privaten Seite auflösen. Ein
öffentlicher Besucher erhält dadurch keinerlei zusätzliche Metadaten.

Unpublish entfernt eine Seite sofort aus Übersicht und Public API und macht ihre öffentlichen
Assets unerreichbar. Ein späteres neues Publish erhält eine neue URL. Suchmaschinenindexierung ist
pro Publication opt-in; Standard ist `noindex`.

---

## Custom Domains

Für andere Installationen:

```text
wiki.example.com
```

---

## Templates

Seitenvorlagen:

- Meeting
- Projekt
- Dokumentation
- How-To
- Daily Note

---

## Daily Notes

Beispiel:

```text
2026-09-12
```

---

## Browser Extension

Ein Klick:

```text
Save page to Dovari
```

---

## API

Externe Programme könnten Inhalte schreiben.

Beispiel:

```bash
curl ...
```

---

## CLI

Beispiel:

```bash
dovari search cloudflare
```

oder:

```bash
dovari create
```

---

## MCP Server

Sehr interessant für später.

Dovari könnte einen MCP-Endpunkt anbieten.

Dann könnten Coding Agents bzw. LLMs Dovari verwenden.

Beispiele:

```text
search_pages
read_page
create_page
update_page
```

Damit könnte Dovari langfristig nicht nur Knowledge Base für Menschen, sondern auch Wissensspeicher für AI-Agenten werden.

---

# 51. Langfristige Positionierung

Dovari soll nicht versuchen:

> Better Notion

zu sein.

Sondern:

> The easiest personal knowledge base you can own.

oder:

> A personal knowledge base that lives in your Cloudflare account.

Das ist eine wesentlich klarere Positionierung.

---

# 52. Wichtigster USP

Der wichtigste USP ist nicht Cloudflare.

Der wichtigste USP ist:

> extrem niedrige Reibung beim Speichern von Wissen.

Beispiel:

```text
Screenshot
Ctrl+V
Done.
```

Cloudflare ist die technische Grundlage, die dafür sorgt, dass Dovari:

- günstig
- wartungsarm
- schnell
- selbst hostbar

ist.

---

# 53. Erfolgskriterium für Version 1

Version 1 gilt als erfolgreich, wenn folgende Nutzung angenehm funktioniert:

Steve findet im Internet etwas Interessantes.

Er öffnet Dovari.

Er drückt:

```text
Ctrl + N
```

schreibt:

```text
Cloudflare Workers Deployment
```

kopiert zwei Screenshots hinein und schreibt einige Sätze.

Dann schließt er den Tab.

Einige Wochen später drückt er:

```text
Ctrl + K
```

tippt:

```text
worker deployment
```

und findet die Seite sofort wieder.

Zusätzlich löscht Steve eine Seite versehentlich und stellt sie aus dem Papierkorb wieder her. Er
kann einen älteren Stand als neue Revision zurückholen und ein vollständiges Backup in einer
leeren Installation wiederherstellen. Seitenhierarchie, Wiki-Links, Bilder und Anhänge bleiben
dabei erhalten.

Wenn dieser Workflow schneller und angenehmer ist als Obsidian + Markdown oder ein klassisches
Wiki und zugleich ohne Angst vor Datenverlust benutzt werden kann, erfüllt Dovari seinen Zweck.

---

# 54. Erster Auftrag im nächsten Chat

Im nächsten Chat soll NICHT sofort das komplette Projekt programmiert werden.

Zuerst soll die technische Grundlage noch einmal kritisch geprüft werden.

Der nächste Chat soll folgende Aufgaben durchführen:

1. aktuellen Cloudflare-Stack überprüfen
2. prüfen, wie Vite + React + Workers aktuell am sinnvollsten strukturiert werden
3. prüfen, wie Deploy-to-Cloudflare aktuell funktioniert
4. prüfen, ob D1 FTS für unsere Anforderungen geeignet ist
5. prüfen, wie Tiptap-Bilder und Clipboard Upload am saubersten implementiert werden
6. entscheiden, ob Drizzle verwendet wird
7. entscheiden, ob pnpm oder npm verwendet wird
8. finales Datenbankschema definieren
9. finale Repo-Struktur definieren
10. danach Phase 0 implementieren

Das Ziel des nächsten Chats ist also:

> aus diesem Produktplan eine konkrete technische Spezifikation und anschließend ein funktionierendes Dovari-Grundprojekt zu erstellen.

---

# 55. Zusammenfassung für einen neuen Chat

Wir bauen **Dovari**, erreichbar unter `dovari.dev`.

Dovari ist ein minimalistisches, selbst hostbares persönliches Wiki mit WYSIWYG-Editor.

Technische Basis:

```text
TypeScript
React
Vite
Tiptap
Hono
Cloudflare Workers
Cloudflare D1
Cloudflare R2
```

Die Anwendung soll komplett ohne klassischen Server funktionieren.

Der wichtigste Workflow:

```text
Create Page
   ↓
Write
   ↓
Ctrl+V Screenshot
   ↓
Auto Upload to R2
   ↓
Auto Save to D1
   ↓
Search later with Ctrl+K
```

Das System soll langfristig Open Source werden und möglichst über einen einzigen **Deploy to Cloudflare** Button installierbar sein.

Die erste Version bleibt bewusst minimal.

Priorität:

```text
1. Schreiben
2. Screenshot Paste
3. Autosave
4. Navigation
5. Suche
6. Wiki Links
7. Export
8. One-Click Deployment
```

Alles andere kommt später.

Das zentrale Produktprinzip lautet:

> **Dovari should make saving knowledge almost effortless.**
