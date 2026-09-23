# Dovari – Technische Spezifikation

**Status:** freigegeben als technische Grundlage  
**Stand:** 12. September 2026  
**Bezug:** `PLAN.md`, insbesondere Punkt 54

## 1. Ziel und Geltungsbereich

Diese Spezifikation übersetzt den Produktplan in eine umsetzbare technische Grundlage. Sie entscheidet den Stack, die Laufzeitarchitektur, das Datenmodell, die API, die Such- und Upload-Strategie sowie Entwicklung, Tests und Deployment.

Die Spezifikation gilt für Version 1 als Single-User-Installation mit einer expliziten Liste berechtigter Editoren. Sie beschreibt bewusst keine Teams, Rollen, Echtzeit-Kollaboration, AI-Funktionen, Plugins, native Apps oder vollständige Offline-Fähigkeit. Öffentliche Seiten sind nach dem MVP vorgesehen; die Authentifizierungsgrenze wird bereits so angelegt, dass sie später ohne grundlegenden Umbau ergänzt werden können.

Der wichtigste Qualitätsmaßstab bleibt:

```text
Seite öffnen → schreiben → Screenshot einfügen → automatisch gespeichert → später sofort gefunden
```

## 2. Verbindliche Architekturentscheidungen

| Thema | Entscheidung | Begründung |
|---|---|---|
| Anwendung | Eine clientseitig gerenderte React-SPA und ein API-Worker in einem Projekt | Dovari benötigt für Version 1 kein SSR. Ein einzelnes Projekt minimiert Deployment- und Betriebsaufwand. |
| Cloudflare-Integration | Offizielles `@cloudflare/vite-plugin` | Lokale Worker-Laufzeit über `workerd`, Bindings in der Entwicklung und gemeinsamer Build von SPA und Worker. |
| API | Hono | Kleine, typisierte Routing- und Middleware-Schicht ohne separates Server-Framework. |
| Datenbank | Cloudflare D1 | Passt zum Single-User-Modell und unterstützt das benötigte SQLite FTS5. |
| Objektspeicher | Privater Cloudflare-R2-Bucket | Binärdaten gehören nicht nach D1; Zugriff erfolgt ausschließlich über den authentifizierten Worker. |
| ORM | Drizzle ORM für normale Tabellen und CRUD; rohes, gebundenes SQL für FTS5 | Drizzle liefert Typen und lesbare Queries. FTS5, Trigger und Ranking bleiben in SQL klarer und vollständiger. |
| Migrationen | Versionierte SQL-Dateien, angewendet durch Wrangler | Derselbe Mechanismus funktioniert lokal, in CI und beim Deploy-to-Cloudflare. Keine Schemaänderung per `push` in Produktion. |
| Paketmanager | npm mit committed `package-lock.json` | Niedrigste Einstiegshürde und keine zusätzliche Corepack-/pnpm-Voraussetzung für Nutzer des Deploy-Buttons. |
| IDs | UUID v4 über `crypto.randomUUID()` | In Workers eingebaut, kollisionsarm und ohne zusätzliche Bibliothek. Sortierung erfolgt explizit über Zeit und Position. |
| Primärformat einer Seite | Tiptap/ProseMirror JSON | Verlustfreie Editor-Repräsentation. Plaintext wird beim Speichern abgeleitet; Markdown erst beim Export. |
| Suche | D1 FTS5 mit `unicode61` und Prefix-Indizes | Ausreichend für eine persönliche Knowledge Base; keine externe Suchinfrastruktur. |
| Authentifizierung | Instanz-Passwort plus opake D1-Session | Eine Installation besitzt genau einen Besitzerzugang. Explizite Public-Read-Routes können später ohne Login arbeiten; sämtliche Schreibzugriffe bleiben fail-closed. |
| Tests | Vitest 4 mit `@cloudflare/vitest-plugin`, React Testing Library und Playwright | Worker-Tests laufen in der produktionsnahen Laufzeit; die Kernabläufe werden zusätzlich im Browser geprüft. |

Abweichungen von diesen Entscheidungen benötigen später ein Architecture Decision Record unter `docs/adr/`.

## 3. Zielstack

### 3.1 Laufzeit und Build

- TypeScript im Strict Mode
- React
- Vite
- `@cloudflare/vite-plugin`
- Cloudflare Workers Static Assets
- Wrangler
- Hono
- Cloudflare D1
- Cloudflare R2

Es werden beim Start von Phase 0 aktuelle, miteinander kompatible stabile Versionen installiert und im Lockfile fixiert. Die Spezifikation pinnt bewusst keine Patch-Versionen, da Cloudflare-, Vite- und Tiptap-Integrationen unabhängig vom Produktentwurf aktualisiert werden.

### 3.2 Frontend

- React Router für clientseitige URLs
- Tiptap 3 mit StarterKit und gezielt ergänzten Extensions
- Tailwind CSS
- Lucide Icons
- Zod für gemeinsame Ein- und Ausgabeschemas
- kein globaler State-Store, solange React Context und lokale Hooks ausreichen

Eine zusätzliche Server-State-Bibliothek wird erst aufgenommen, wenn Cache-Invalidierung und Mutation Coordination im echten Code damit nachweislich einfacher werden. Autosave selbst bleibt ein expliziter, domänenspezifischer Hook.

### 3.3 Nicht verwenden

- Cloudflare Pages als Deploymentziel
- SSR oder React Server Components
- separates Backend-Repository
- Node-spezifische Server-APIs, wenn eine Web-API existiert
- öffentliche R2-URLs
- externe Suche
- eigene Passwort- oder Sessionverwaltung

## 4. Systemarchitektur

```text
Browser
  │
  │ HTTPS
  ▼
Cloudflare Worker (Hono)
  ├── /app/* und /api/private/*
  │     └── Dovari-Session prüfen
  ├── /, /p/* und /api/public/*
  │     └── explizit öffentliche Read-only-Routes
  ├── /api/health
  │     └── generische öffentliche Liveness
  └── erlaubte Static Assets an STATIC_ASSETS weitergeben
          │
          ├── D1 binding DB
          ├── R2 binding ASSETS
          └── Static Assets binding STATIC_ASSETS
```

Die Wrangler-Konfiguration setzt für Static Assets:

```jsonc
{
  "main": "./src/worker/index.ts",
  "assets": {
    "binding": "STATIC_ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": true
  }
}
```

`run_worker_first` ist absichtlich global aktiviert, damit der Worker jede Route zuerst klassifiziert. Private Pfade werden nur nach erfolgreicher Dovari-Sessionprüfung verarbeitet; öffentliche Pfade sind eine kleine, explizite Allowlist. Unbekannte API-Pfade liefern `404` und fallen niemals auf die SPA zurück.

Für das MVP gilt:

```text
/                         öffentliche Knowledge-Base-Landingpage ab Phase 14; zuvor Redirect auf /app
/app/*                    geschützte Anwendungshülle
/api/private/*            geschützte API einschließlich Assets
/api/health               öffentliche, inhaltsfreie Liveness
/assets/*                 gebaute, inhaltsfreie Frontend-Dateien
```

Für die spätere Veröffentlichung werden reserviert:

```text
/                         öffentliche Liste aller aktiven Publications
/p/:publicId              öffentliche, schreibgeschützte Seite
/api/public/*             ausschließlich öffentliche GET-/HEAD-Endpunkte
```

Dass JavaScript- und CSS-Bundles öffentlich abrufbar sind, gibt keinen Zugriff auf D1 oder R2. Alle Inhaltszugriffe werden weiterhin im Worker autorisiert. Erfolgreiche App-Shell- und Static-Asset-Requests reicht der Worker mit `env.STATIC_ASSETS.fetch(request)` weiter.

Die Namen der Bindings sind fest:

```text
DB             D1-Datenbank
ASSETS         privater R2-Bucket
STATIC_ASSETS  gebautes React-Frontend
```

## 5. Repository-Struktur

Das Repository bleibt ein einzelnes npm-Paket und kein Monorepo:

```text
dovari/
├── src/
│   ├── client/
│   │   ├── app/
│   │   ├── components/
│   │   ├── editor/
│   │   │   ├── extensions/
│   │   │   ├── uploads/
│   │   │   └── markdown/
│   │   ├── features/
│   │   │   ├── pages/
│   │   │   ├── navigation/
│   │   │   ├── search/
│   │   │   └── assets/
│   │   ├── hooks/
│   │   ├── lib/
│   │   └── main.tsx
│   ├── worker/
│   │   ├── index.ts
│   │   ├── auth/
│   │   ├── db/
│   │   │   ├── schema.ts
│   │   │   └── queries/
│   │   ├── middleware/
│   │   ├── repositories/
│   │   ├── routes/
│   │   └── services/
│   └── shared/
│       ├── api/
│       ├── schemas/
│       └── types/
├── migrations/
├── public/
├── tests/
│   ├── unit/
│   ├── worker/
│   └── e2e/
├── docs/
│   └── adr/
├── index.html
├── package.json
├── package-lock.json
├── tsconfig.json
├── tsconfig.client.json
├── tsconfig.worker.json
├── vite.config.ts
├── vitest.config.ts
├── playwright.config.ts
└── wrangler.jsonc
```

Regeln:

- `shared/` darf keine React-, D1- oder R2-Abhängigkeiten importieren.
- Routes validieren HTTP und delegieren; Geschäftslogik liegt in Services.
- Repositories kapseln D1-Zugriffe.
- Kein generischer `utils.ts`-Sammelordner; Hilfen liegen bei ihrer Domäne.
- API-Verträge werden einmal in Zod definiert und von Client und Worker verwendet.

## 6. Datenmodell

### 6.1 Grundregeln

- Zeitstempel sind UTC als RFC-3339-Text mit Millisekunden.
- Öffentliche IDs sind UUIDs als `TEXT`.
- `slug` ist lesbar, aber niemals Identität oder Foreign Key.
- Inhalte und Dateinamen werden nicht als HTML gespeichert.
- Foreign Keys sind aktiv; Migrationen und Tests prüfen ihre Integrität.
- `content_markdown` wird nicht gespeichert. Markdown wird beim Export deterministisch aus `content_json` erzeugt. So gibt es keine dritte, potenziell inkonsistente Inhaltskopie.
- `content_text` wird serverseitig aus validiertem Tiptap JSON erzeugt und nie vom Client als vertrauenswürdig übernommen.

### 6.2 Initiales SQL-Schema

`src/worker/db/schema.ts` beschreibt die normalen Tabellen für Drizzles Typsystem. `drizzle-kit generate` erzeugt daraus eine neue SQL-Migration, die vor dem Commit geprüft wird. FTS5-Tabellen und Trigger kommen als explizite Custom-SQL-Migration hinzu. Die eingecheckten SQL-Dateien sind die einzige Quelle dafür, was Wrangler tatsächlich ausrollt; `drizzle-kit push` und `drizzle-kit migrate` werden nicht gegen Produktion verwendet.

```sql
CREATE TABLE pages (
  search_id INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  slug TEXT NOT NULL,
  content_json TEXT NOT NULL DEFAULT '{"type":"doc","content":[]}',
  content_text TEXT NOT NULL DEFAULT '',
  parent_id TEXT REFERENCES pages(id) ON DELETE SET NULL,
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE UNIQUE INDEX pages_slug_unique
  ON pages (slug COLLATE NOCASE);
CREATE INDEX pages_parent_position
  ON pages (parent_id, position, title);
CREATE INDEX pages_updated_at
  ON pages (updated_at DESC);
CREATE INDEX pages_deleted_at
  ON pages (deleted_at);

CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  object_key TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  width INTEGER CHECK (width IS NULL OR width > 0),
  height INTEGER CHECK (height IS NULL OR height > 0),
  sha256 TEXT,
  uploaded_for_page_id TEXT REFERENCES pages(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX assets_uploaded_for_page
  ON assets (uploaded_for_page_id, created_at);

CREATE TABLE page_assets (
  page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  PRIMARY KEY (page_id, asset_id)
);

CREATE INDEX page_assets_asset
  ON page_assets (asset_id);

CREATE TABLE page_links (
  id TEXT PRIMARY KEY,
  source_page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  target_page_id TEXT REFERENCES pages(id) ON DELETE SET NULL,
  target_title TEXT NOT NULL,
  target_title_normalized TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX page_links_source
  ON page_links (source_page_id);
CREATE INDEX page_links_target
  ON page_links (target_page_id);
CREATE UNIQUE INDEX page_links_source_title
  ON page_links (source_page_id, target_title_normalized);
```

`page_links` wird bereits im finalen Schema reserviert, aber erst in Phase 6 befüllt. Tag-Tabellen werden nicht vorab angelegt, weil Tags kein bestätigter MVP-Bestandteil sind.

### 6.3 FTS5-Schema

Die `search_id` ist ausschließlich die stabile Integer-Verknüpfung zwischen `pages` und der externen FTS5-Tabelle. Die öffentliche Page-ID bleibt die UUID.

```sql
CREATE VIRTUAL TABLE pages_fts USING fts5(
  title,
  content_text,
  content='pages',
  content_rowid='search_id',
  tokenize='unicode61 remove_diacritics 2',
  prefix='2 3 4'
);

CREATE TRIGGER pages_fts_insert
AFTER INSERT ON pages
WHEN new.deleted_at IS NULL
BEGIN
  INSERT INTO pages_fts(rowid, title, content_text)
  VALUES (new.search_id, new.title, new.content_text);
END;

CREATE TRIGGER pages_fts_delete
AFTER DELETE ON pages
WHEN old.deleted_at IS NULL
BEGIN
  INSERT INTO pages_fts(pages_fts, rowid, title, content_text)
  VALUES ('delete', old.search_id, old.title, old.content_text);
END;

CREATE TRIGGER pages_fts_update_delete
AFTER UPDATE OF title, content_text, deleted_at ON pages
WHEN old.deleted_at IS NULL
BEGIN
  INSERT INTO pages_fts(pages_fts, rowid, title, content_text)
  VALUES ('delete', old.search_id, old.title, old.content_text);
END;

CREATE TRIGGER pages_fts_update_insert
AFTER UPDATE OF title, content_text, deleted_at ON pages
WHEN new.deleted_at IS NULL
BEGIN
  INSERT INTO pages_fts(rowid, title, content_text)
  VALUES (new.search_id, new.title, new.content_text);
END;
```

Nach dem erstmaligen Anlegen über bereits vorhandenen Daten wird einmalig ausgeführt:

```sql
INSERT INTO pages_fts(pages_fts) VALUES ('rebuild');
```

CI prüft mit dem FTS5-`integrity-check`, dass Inhaltstabelle und Index synchron sind.

### 6.4 Größen- und Konsistenzgrenzen

D1 begrenzt einen String beziehungsweise eine Tabellenzeile auf 2 MB. Deshalb lehnt die API einen Seitenspeicherstand ab, wenn die gesamte kodierte Zeile voraussichtlich 1,8 MB überschreitet. Die UI fordert dann zum Aufteilen der Seite auf. Binärdaten werden niemals in `content_json` eingebettet.

Hierarchiezyklen, die ein einfacher SQL-Check nicht erkennen kann, verhindert der Move-Service durch eine rekursive Vorfahrenabfrage. Geschwisterpositionen werden innerhalb eines D1-Batches lückenlos neu nummeriert.

### 6.5 Papierkorb und Seitenrevisionen

Das bestehende `pages.deleted_at` bleibt die einzige Kennzeichnung für den Papierkorb. Soft
Delete verändert weder `parent_id` noch `position`, entfernt die Seite aber über die bestehenden
Filter und FTS-Trigger aus Navigation, Wiki-Link-Suche und Volltextsuche.

Die Versionshistorie speichert begrenzte, serverseitig erzeugte Snapshots:

```sql
CREATE TABLE page_revisions (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  source_revision INTEGER NOT NULL CHECK (source_revision > 0),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  content_json TEXT NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('interval', 'delete', 'restore')),
  created_at TEXT NOT NULL
);

CREATE INDEX page_revisions_page_created
  ON page_revisions (page_id, created_at DESC, id DESC);
```

`content_text`, `page_assets` und `page_links` werden nicht im Snapshot dupliziert. Bei einer
Wiederherstellung validiert der Service `content_json` mit derselben Allowlist wie einen normalen
Save und leitet diese Werte und Beziehungen neu ab.

Snapshot-Regeln:

- Vor der ersten erfolgreichen Titel- oder Inhaltsmutation einer Seite, deren jüngster
  `interval`-Snapshot mindestens zehn Minuten alt ist, wird der vorherige persistierte Zustand im
  selben atomaren D1-Ablauf gespeichert.
- Existiert noch kein Snapshot, wird der vorherige Zustand vor der ersten Mutation gespeichert.
- Soft Delete erzeugt immer unmittelbar vor der Mutation einen Snapshot mit Trigger `delete`.
- Das Wiederherstellen einer Seitenrevision erzeugt immer zuerst einen Snapshot des aktuellen
  Zustands mit Trigger `restore`.
- Fehlgeschlagene oder konfliktbehaftete Mutationen dürfen keinen Snapshot hinterlassen.
- Nach einem neuen Snapshot werden alle bis auf die 50 neuesten Snapshots der Seite gelöscht.

Ein Versions-Restore überschreibt Titel und Inhalt der aktiven Seite als neue Revision. Die
aktuelle Revisionsnummer wird erhöht und niemals auf `source_revision` zurückgesetzt. Slugs werden
mit den normalen Kollisionsregeln aus dem wiederhergestellten Titel erzeugt. Ein Snapshot ändert
Hierarchie und Position nicht.

Ein Trash-Restore erhöht ebenfalls die Revision und setzt `deleted_at` auf `NULL`. Ist der
gespeicherte Parent aktiv, wird die Seite am Ende seiner aktiven Kinder einsortiert; andernfalls
wird sie am Ende der Root-Seiten einsortiert. Geschwisterpositionen werden atomar normalisiert.

Dauerhaftes Löschen ist nur für bereits soft-gelöschte Seiten zulässig. Die Anfrage muss aktuelle
Revision und exakten Titel enthalten. Der Foreign Key von `page_revisions` sowie die bestehenden
Foreign Keys entfernen abhängige Revisionen, Links und Seiten-Asset-Referenzen. Asset-Metadaten und
R2-Objekte werden nicht physisch gelöscht.

### 6.6 Backup- und Restore-Daten

Der menschenlesbare Export aus Phase 7 bleibt unverändert `dovari-export` Version 1. Das
verlustfreie Backup verwendet ein separates ZIP-Format mit `format: "dovari-backup"` und wird in
P25 als Version 2 mit `dovari-backup-v2.zip` heruntergeladen. Version-1-Archive bleiben als
Importformat kompatibel.

`backup.json` enthält mindestens:

- `format`, `version` und `exportedAt`,
- alle aktiven und gelöschten Page-Zeilen einschließlich IDs, Slugs, Hierarchie, Positionen,
  Revisionen und Zeitstempeln,
- alle `page_revisions`,
- alle Asset-Zeilen einschließlich unreferenzierter oder soft-gelöschter Einträge mit stabiler ID,
  relativem ZIP-Pfad, Byte-Größe und SHA-256-Prüfsumme sowie jedes dazu vorhandene R2-Objekt.
- In Version 2 zusätzlich alle aktiven `page_publications` mit ihrem Public-Snapshot, stabiler
  `public_id`, Indexierungsoption und den zugehörigen `publication_assets`.

`page_assets`, `page_links`, `content_text` und der FTS-Index werden beim Restore deterministisch
aus den validierten Dokumenten rekonstruiert. Das Backup enthält keine Worker-Variablen, Secrets,
Authentifizierungskonfiguration, Cloudflare-Account- oder Resource-IDs. Vor dem Download prüft der Service
Existenz, Größe und Prüfsumme aller erwarteten R2-Objekte. Bei Abweichungen bricht das vollständige
Backup mit einer Liste neutraler Asset-IDs ab.

Restore ist in Version 1 und 2 nur erlaubt, wenn keine Page- oder Asset-Datensätze existieren und
keine andere aktive Restore-Session läuft. Der Client liest das ZIP lokal, validiert Format, Pfade,
Anzahlen und deklarierte Größen und überträgt Datensätze, Publications und Assets einzeln. Dadurch
muss weder das gesamte Archiv noch die gesamte Datenbankrepräsentation in einen Worker-Request
passen.

Für wiederaufnehmbare Sessions werden temporäre Verwaltungsdaten persistiert:

```text
restore_sessions
  id
  owner_identity
  status              uploading | finalizing | failed
  backup_version
  expected_pages
  expected_revisions
  expected_assets
  created_at
  updated_at
  expires_at

restore_session_records
  session_id
  record_type         page | revision
  record_id
  payload_json
  sha256
  uploaded_at

restore_session_assets
  session_id
  asset_id
  object_key
  metadata_json
  size_bytes
  sha256
  uploaded_at
```

Session-Datensätze referenzieren noch keine produktiven Pages oder Assets. Asset-Uploads verwenden
einen nur aus Session- und Asset-UUID gebildeten temporären R2-Key. Wiederholte identische Uploads
sind idempotent; abweichende Prüfsummen werden abgelehnt. `finalize` prüft Vollständigkeit und
Prüfsummen erneut, validiert jedes Tiptap-Dokument und sämtliche Referenzen und schreibt dann alle
endgültigen R2-Keys. Weil noch keine produktiven Asset-Metadaten existieren, sind diese Objekte
über keine private Asset-Route erreichbar. Erst nachdem alle Kopien erfolgreich sind, werden alle
produktiven D1-Datensätze atomar geschrieben. Schlägt der D1-Schritt fehl, bleiben die kopierten
Objekte der Session zugeordnet, sind weiterhin nicht auslieferbar und können bei einem Retry
wiederverwendet oder beim Abbruch entfernt werden. Nach erfolgreichem Abschluss werden temporäre
Objekte und Session-Daten entfernt.

Ein bewusster Session-Abbruch löscht ausschließlich die der Session zugeordneten temporären
Objekte und Datensätze. Abgelaufene Sessions dürfen später durch ein separates Wartungswerkzeug
bereinigt werden; ein automatischer Scheduler ist nicht Teil der Version 1.

### 6.7 Authentifizierungstabellen

`auth_sessions` speichert ausschließlich SHA-256-Token-Hashes, Worker-Version, Erstellungs- und
Ablaufzeit. `auth_login_attempts` speichert pro gehashter Quell-IP den Beginn des 15-Minuten-
Fensters und die Anzahl fehlgeschlagener Versuche. Beide Tabellen enthalten weder Passwort noch
einen wiederverwendbaren Passwort-Verifier und sind nicht Teil von Backup oder Export.

### 6.8 Veröffentlichungsmodell

Öffentliche Seiten verwenden keine `visibility`-Spalte mit Live-Zugriff auf den aktuellen Entwurf.
Beim Veröffentlichen entsteht ein eigener, serverseitig bereinigter Snapshot:

```sql
CREATE TABLE page_publications (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL UNIQUE REFERENCES pages(id) ON DELETE CASCADE,
  public_id TEXT NOT NULL UNIQUE,
  source_revision INTEGER NOT NULL CHECK (source_revision > 0),
  published_content_json TEXT NOT NULL,
  published_title TEXT NOT NULL CHECK (length(published_title) BETWEEN 1 AND 200),
  allow_indexing INTEGER NOT NULL DEFAULT 0 CHECK (allow_indexing IN (0, 1)),
  published_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX page_publications_updated
  ON page_publications (updated_at DESC, public_id DESC);

CREATE TABLE publication_assets (
  publication_id TEXT NOT NULL REFERENCES page_publications(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  PRIMARY KEY (publication_id, asset_id)
);

CREATE INDEX publication_assets_asset
  ON publication_assets (asset_id);
```

Es existiert höchstens eine aktive Publication pro privater Seite. `public_id` ist eine zufällige
UUID und bleibt beim Aktualisieren der Publication stabil. Unpublish löscht Publication und
Zuordnungen atomar; ein späteres neues Publish erzeugt eine neue `public_id`, damit eine bewusst
zurückgezogene URL nicht unerwartet wiederverwendet wird.

`published_content_json` folgt einer eigenen Public-Allowlist. Normale Text- und Format-Nodes
bleiben erhalten. Asset-Nodes bleiben nur erhalten, wenn das Asset existiert, nicht gelöscht ist
und in `publication_assets` aufgenommen wird. Ein Wiki Link auf eine zu diesem Zeitpunkt aktive
Publication wird auf deren `public_id` umgeschrieben; andernfalls wird er zu normalem Text. Der
Snapshot enthält niemals private Page-IDs, Slugs, Parent-IDs, Revisionen oder Backlinks. Eine
spätere Veröffentlichung oder Zurücknahme eines Linkziels verändert bestehende Snapshots nicht.
Nach einer erfolgreichen Titel-, Inhalts- oder Revisionswiederherstellung einer bereits
veröffentlichten Quellseite wird deren bestehender Snapshot jedoch automatisch neu berechnet;
`public_id` und die explizite Unpublish-Grenze bleiben dabei unverändert. Neu angelegte oder in
einen veröffentlichten Seitenbaum verschobene Seiten werden automatisch mit der
Freigabeeinstellung ihres nächsten veröffentlichten Vorfahren veröffentlicht. Eine erstmals
veröffentlichte Seite und eine Änderung der Freigabeeinstellungen benötigen weiterhin den privaten
Publish-Endpunkt.

`publication_assets` enthält ausschließlich Assets, die der Snapshot tatsächlich referenziert.
Öffentliche Asset-Auslieferung verlangt Publication-ID und Asset-ID und prüft diese Beziehung vor
jedem R2-Zugriff. Die Kenntnis einer privaten Asset-ID allein gewährt keinen Zugriff.

Das verlustfreie Backup wird mit P25 auf `dovari-backup-v2` erweitert. Version 2 enthält
`page_publications` und `publication_assets` einschließlich stabiler IDs und Snapshotdaten;
Restore akzeptiert weiterhin Version 1. Version-2-Restore validiert die Public-Allowlist und alle
Assetbeziehungen, bevor der Gesamtzustand atomar sichtbar wird.

Die P25-Migration baut die Restore-Verwaltungstabellen unter Erhalt eventuell vorhandener
Sessiondaten so um, dass `backup_version IN (1, 2)` erlaubt ist, `restore_sessions` ein
`expected_publications` mit Default `0` besitzt und `restore_session_records.record_type` zusätzlich
`publication` akzeptiert. Publication-Records enthalten die Zeile aus `page_publications`; die
Zuordnung in `publication_assets` wird beim Finalisieren deterministisch aus dem validierten
Public-Dokument rekonstruiert. Ein v1-Restore erzeugt keine Publications.

Soft Delete einer privaten Seite löscht eine aktive Publication und ihre Assetzuordnungen im
selben atomaren Ablauf. Ein Page-Restore veröffentlicht sie nicht erneut. Normale Titel-, Inhalts-
und Revisions-Restores synchronisieren eine bestehende Publication dagegen automatisch, ohne deren
`public_id` zu ändern.

### 6.9 Öffentlicher Suchindex

P26 verwendet einen separaten externen FTS5-Index, dessen Content-Tabelle ausschließlich
`page_publications` ist. Er wird nur aus `published_title` und dem aus
`published_content_json` abgeleiteten öffentlichen Plaintext gespeist. Public Search darf weder
den privaten `pages_fts`-Index abfragen noch private Treffer nachträglich herausfiltern.

### 6.10 Tags und Favoriten

P27 ergänzt `tags`, `page_tags` und einen booleschen Favoritenstatus an der privaten Page-Domäne.
Tagnamen werden Unicode-getrimmt, besitzen eine normalisierte eindeutige Vergleichsform und sind
1–50 Zeichen lang. Private Tags werden nicht automatisch Teil einer Publication; veröffentlichte
Snapshot-Tags müssen beim Publish explizit ausgewählt und im Snapshot dupliziert werden.

### 6.11 Templates und Daily Notes

P28 speichert Templates als eigene Datensätze mit Titel und validiertem Tiptap-JSON. Eine daraus
erzeugte Seite erhält eine Kopie und keine Live-Referenz. Daily Notes besitzen zusätzlich einen
eindeutigen lokalen Datumsschlüssel `YYYY-MM-DD`; der Server akzeptiert IANA-Zeitzone und Datum,
prüft deren Konsistenz und erzeugt je Installation und Datum höchstens eine Daily Note.

## 7. HTTP-API

### 7.1 Konventionen

- Private Basis: `/api/private`
- Für spätere öffentliche Lesezugriffe reserviert: `/api/public`
- JSON: `application/json; charset=utf-8`
- Zeitstempel: RFC 3339 UTC
- IDs: UUID-Strings
- Mutationen liefern den aktuellen Serverzustand oder mindestens `revision` und `updatedAt` zurück.
- Jeder Response enthält `X-Request-Id`.
- Listen sind für Version 1 auf höchstens 100 Einträge pro Response begrenzt und cursorbasiert, sofern sie wachsen können.

Fehlerformat:

```json
{
  "error": {
    "code": "PAGE_CONFLICT",
    "message": "The page changed in another tab.",
    "requestId": "...",
    "details": {}
  }
}
```

Interne Exceptions, SQL und Stacktraces werden nicht an den Browser gegeben.

### 7.1a Authentifizierung

```text
GET  /api/auth/session
POST /api/auth/login
POST /api/auth/logout
```

`GET /api/auth/session` liefert `{ "authenticated": false }` oder bei einer gültigen Session
zusätzlich deren `expiresAt`. Login akzeptiert ausschließlich ein kleines
`application/json`-Objekt `{ "password": "..." }`; unbekannte Felder, mehr als 1 KiB,
fremde Origins und andere Content-Types werden abgewiesen. Logout ist idempotent und löscht
Cookie sowie serverseitige Session. Auth-Antworten verwenden immer `Cache-Control: no-store`.

Unauthentifizierte `GET`-/`HEAD`-Aufrufe unter `/app/*` werden mit einem ausschließlich lokalen,
auf `/app` begrenzten `next`-Ziel zu `/login` umgeleitet. Private APIs antworten mit `401`.

### 7.2 Seiten

```text
GET    /api/private/pages
POST   /api/private/pages
GET    /api/private/pages/:id
PATCH  /api/private/pages/:id
PUT    /api/private/pages/:id/content
POST   /api/private/pages/:id/move
DELETE /api/private/pages/:id
```

`GET /api/private/pages` liefert für die Sidebar nur Metadaten, flach sortiert: `id`, `title`, `slug`, `parentId`, `position`, `revision`, `updatedAt`. Der Client baut daraus den Baum. Seiteninhalt wird nur über den Detail-Endpunkt geladen.

`POST /api/private/pages` akzeptiert:

```json
{
  "title": "Untitled",
  "parentId": null
}
```

Der Server erzeugt ID, eindeutigen Slug, leeres Dokument, Position und Zeitstempel.

`PATCH /api/private/pages/:id` ändert ausschließlich Metadaten und enthält `baseRevision`.

`PUT /api/private/pages/:id/content` akzeptiert:

```json
{
  "baseRevision": 7,
  "content": {
    "type": "doc",
    "content": []
  }
}
```

Der Server validiert das Dokument, leitet `content_text` sowie Asset-Referenzen ab und führt ein optimistisches Update aus:

```sql
UPDATE pages
SET content_json = ?, content_text = ?, revision = revision + 1, updated_at = ?
WHERE id = ? AND revision = ? AND deleted_at IS NULL;
```

Bei null geänderten Zeilen antwortet er mit `409 PAGE_CONFLICT`. Es gibt kein stilles Last-Write-Wins.

`POST /api/private/pages/:id/move` akzeptiert `parentId` und entweder `beforeId`, `afterId` oder keines von beiden. Der Server verhindert Zyklen und normalisiert die Geschwisterpositionen.

`DELETE` setzt `deleted_at`, erzeugt gemäß Abschnitt 6.5 einen Snapshot und erhöht die Revision. Die
Seite verschwindet aus Navigation und Suche. Wiederherstellung und dauerhaftes Löschen verwenden
die getrennten Recovery-Endpunkte aus Abschnitt 7.5.

### 7.3 Assets

```text
POST   /api/private/assets
GET    /api/private/assets/:id
GET    /api/private/assets/:id/content
DELETE /api/private/assets/:id
```

Uploads verwenden im MVP einen einzelnen Request mit dem Dateiinhalt als Body:

```http
POST /api/private/assets
Content-Type: image/png
Content-Length: 123456
X-Dovari-Filename: screenshot.png
X-Dovari-Page-Id: <uuid>
```

`X-Dovari-Filename` enthält einen percent-encoded UTF-8-Dateinamen. Der Worker streamt den Body nach R2, zählt Bytes, ermittelt die Dateisignatur und speichert erst danach die D1-Metadaten. Fehlschlägt der D1-Schritt, wird das neue R2-Objekt best-effort wieder gelöscht und der Fehler protokolliert.

Erfolgsantwort:

```json
{
  "asset": {
    "id": "...",
    "filename": "screenshot.png",
    "mimeType": "image/png",
    "sizeBytes": 123456,
    "contentUrl": "/api/private/assets/.../content"
  }
}
```

`GET /content` streamt aus R2 und unterstützt `ETag`, `If-None-Match`, `Range` und `Content-Length`. Sichere Rasterbilder werden `inline` ausgeliefert; alle anderen Typen als `attachment`. `X-Content-Type-Options: nosniff` ist immer gesetzt.

`DELETE` markiert zunächst nur die Metadaten als gelöscht. Physische Garbage Collection ist nicht Teil des MVP.

### 7.4 Suche und System

```text
GET /api/private/search?q=<query>&limit=20
GET /api/health
GET /api/private/export          Phase 7
```

`/api/health` gibt keine Inhalte, Bindungsnamen oder Secrets preis. Ohne erfolgreiche Authentifizierung ist nur ein generischer Liveness-Status zulässig; Readiness von D1/R2 bleibt geschützt.

`/api/public/*` existiert im MVP noch nicht. Wenn öffentliche Seiten implementiert werden, sind dort ausschließlich schema-validierte `GET`, `HEAD` und gegebenenfalls `OPTIONS` erlaubt. Jede Mutation unter diesem Präfix wird unabhängig von ihrer Nutzlast mit `405` abgewiesen.

### 7.5 Papierkorb, Revisionen, Backup und Restore

Alle Endpunkte dieses Abschnitts liegen hinter derselben Session- und Origin-Prüfung wie andere
private Mutationen.

```text
GET    /api/private/trash?cursor=<cursor>&limit=50
POST   /api/private/pages/:id/restore
DELETE /api/private/pages/:id/permanent

GET    /api/private/pages/:id/revisions?cursor=<cursor>&limit=50
GET    /api/private/pages/:id/revisions/:revisionId
POST   /api/private/pages/:id/revisions/:revisionId/restore

GET    /api/private/backup

POST   /api/private/restore/sessions
GET    /api/private/restore/sessions/:id
PUT    /api/private/restore/sessions/:id/records/:recordType/:recordId
PUT    /api/private/restore/sessions/:id/assets/:assetId
POST   /api/private/restore/sessions/:id/finalize
DELETE /api/private/restore/sessions/:id
```

Trash und Revisionslisten sind cursorbasiert nach Zeitstempel und ID sortiert. Die Trash-Antwort
enthält Page-ID, Titel, frühere Parent-ID, Revision, `updatedAt` und `deletedAt`. Die
Revisionsliste enthält nur ID, Quellrevision, Titel, Trigger und `createdAt`; vollständiges
`content_json` wird ausschließlich vom Revisionsdetail-Endpunkt geliefert.

Restore einer gelöschten Seite akzeptiert:

```json
{ "baseRevision": 12 }
```

Permanentes Löschen akzeptiert:

```json
{ "baseRevision": 12, "confirmationTitle": "Cloudflare Workers" }
```

Revisions-Restore akzeptiert ebenfalls `baseRevision`. Alle drei Operationen liefern bei einer
veralteten Revision `409 PAGE_CONFLICT`. Nicht gelöschte Seiten können nicht über den Trash-
Restore wiederhergestellt werden; aktive Seiten können nicht permanent gelöscht werden.

`GET /api/private/backup` streamt das in Abschnitt 6.6 definierte ZIP. Der Request wird vor Beginn
des Response-Bodys abgelehnt, wenn referenzierte Assets fehlen oder ihre Metadaten nicht stimmen.

`POST /api/private/restore/sessions` akzeptiert ausschließlich Backupversion, erwartete Anzahlen
und eine Gesamtsummenübersicht. Es antwortet mit Session-ID, Ablaufzeit und Status. Page- und
Revisionsdatensätze werden einzeln als kanonisches JSON unter `records` hochgeladen; `recordType`
ist ausschließlich `page` oder `revision`. Assets verwenden wie die vorhandene Asset-API den
rohen Body mit deklariertem Dateinamen, MIME-Typ, Größe und SHA-256 aus dem Backupmanifest.

`GET` auf die Session liefert nur Anzahlen und die IDs bereits vollständig empfangener Records und
Assets, sodass der Browser nach einem Verbindungsabbruch fortsetzen kann. `finalize` akzeptiert
keine weiteren Daten. Es prüft allein den vollständig gestagten Zustand und startet den in
Abschnitt 6.6 beschriebenen Abschluss. `DELETE` ist nur vor erfolgreichem Abschluss möglich.

Zusätzliche stabile Fehlercodes:

```text
PAGE_NOT_DELETED
PAGE_ALREADY_DELETED
CONFIRMATION_MISMATCH
REVISION_NOT_FOUND
BACKUP_INCOMPLETE
RESTORE_WORKSPACE_NOT_EMPTY
RESTORE_SESSION_CONFLICT
RESTORE_RECORD_MISMATCH
RESTORE_INCOMPLETE
RESTORE_FINALIZE_FAILED
```

Fehlerantworten enthalten keine Seitentitel, Dateinamen oder Inhalte. Zulässige Detailfelder sind
betroffene UUIDs, erwartete und empfangene Byte-Größen sowie erwartete und berechnete Prüfsummen.

### 7.6 Veröffentlichungen und öffentliche Lesezugriffe

Private Publication-Endpunkte:

```text
GET    /api/private/pages/:pageId/publication
PUT    /api/private/pages/:pageId/publication
DELETE /api/private/pages/:pageId/publication
GET    /api/private/publications/:publicId/editor-target
```

`PUT` akzeptiert `{ "baseRevision": 12, "allowIndexing": false }`. Es erzeugt oder ersetzt den
bereinigten Snapshot atomar und liefert Public URL, Quellrevision und Zeitstempel. Der Endpunkt wird
für das erstmalige Veröffentlichen und Änderungen an den Freigabeeinstellungen verwendet; Titel-,
Inhalts- und Revisionsmutationen synchronisieren eine vorhandene Publication serverseitig nach
erfolgreichem Save. Eine abweichende Seitenrevision liefert `409 PAGE_CONFLICT`; gelöschte Seiten
sind nicht veröffentlichbar.
`DELETE` akzeptiert `{ "publicId": "…", "expectedUpdatedAt": "…" }` und entfernt nur genau
diese aktive Version atomar; ein veralteter Tab erhält `409 PUBLICATION_CONFLICT`. `editor-target`
liegt bewusst privat: Erst nach gültiger Dovari-Passwort-Session wird `publicId` zur privaten
Page-ID aufgelöst.

Public-Endpunkte:

```text
GET|HEAD /api/public/publications?cursor=<cursor>&limit=100
GET|HEAD /api/public/publications/:publicId
GET|HEAD /api/public/publications/:publicId/assets/:assetId/content
```

Die Liste ist nach `updated_at DESC, public_id DESC` cursorbasiert und gibt nur `publicId`,
`publishedTitle`, `publishedAt`, `updatedAt` und `allowIndexing` zurück. Das Detail ergänzt allein
das bereinigte Public-Dokument. Assets unterstützen die sicheren ETag-, Conditional- und
Range-Regeln der privaten Asset-Auslieferung, werden aber nur nach Prüfung der konkreten
Publication-Zuordnung gelesen. Fehlende, zurückgezogene und unbekannte Publications antworten
gleichförmig mit `404 PUBLICATION_NOT_FOUND` und ohne unterscheidbare Details. Jede nicht explizit
erlaubte Methode unter `/api/public/*` liefert `405 METHOD_NOT_ALLOWED` mit `Allow: GET, HEAD` vor
jeglichem D1-/R2-Mutationszugriff. Bis zur expliziten Cache-Strategie in P26 senden alle Public-
Listen-, Detail- und Assetantworten `Cache-Control: no-store`, damit automatische Snapshot-
Synchronisierung und Unpublish nicht durch veraltete Browser- oder Edge-Antworten verzögert werden.

### 7.7 Öffentliche Suche und Discovery

P26 ergänzt `GET /api/public/search`, `GET /sitemap.xml` und `GET /robots.txt`. Search liest nur
den Index aus Abschnitt 6.9. Sitemap und indexierbare Metadaten enthalten ausschließlich aktive
Publications mit `allow_indexing = 1`; alle anderen öffentlichen Seiten senden `noindex`.

### 7.8 Tags und Favoriten

P27 ergänzt private CRUD-Endpunkte für Tags, atomare Page-Tag-Zuordnung und eine idempotente
Favorite-Mutation. Listen- und Search-Verträge erhalten optionale Tag-/Favorite-Filter. Kein
Public-Endpunkt liest die privaten Zuordnungstabellen.

### 7.9 Templates und Daily Notes

P28 ergänzt private CRUD-Endpunkte für Templates, `POST /api/private/pages/from-template` und
`PUT /api/private/daily-notes/:localDate`. Die Daily-Note-Operation ist idempotent und liefert bei
wiederholtem Aufruf dieselbe Seite.

### 7.10 Markdown- und Obsidian-Import

P29 verwendet resumierbare, an den authentifizierten Dovari-Betreiber gebundene Import-Sessions
nach dem Muster des Restore-Protokolls. Vor Finalisierung bleiben Records und Assets unerreichbar. Die Finalisierung
fügt ausschließlich neue IDs ein, validiert normalisierte ZIP-Pfade, die Tiptap-Allowlist,
Größenlimits und Asset-Prüfsummen und wird bei Konflikten vollständig zurückgerollt.

## 8. Editor und Autosave

### 8.1 Tiptap-Dokument

Die serverseitige Allowlist entspricht den installierten Extensions. Unbekannte Node- und Mark-Typen führen zu `422 INVALID_DOCUMENT`; beliebiges HTML wird nicht gespeichert.

Version 1 erlaubt mindestens:

- Document, Paragraph, Text
- Heading 1–3
- Bold, Italic, Strike, Inline Code
- Bullet List, Ordered List, Task List
- Blockquote, Horizontal Rule
- Link
- Code Block
- Asset Image
- Attachment

Tabellen bleiben nach Version 1 vertagt. Slash Commands verändern das persistierte Dokumentformat
nicht und dürfen ausschließlich Nodes und Marks aus dieser Allowlist erzeugen.

### 8.2 Autosave-Zustandsautomat

```text
clean → dirty → waiting (750 ms) → saving → saved
                  ▲                 │
                  └── new change ───┘

saving → failed → retrying
saving → conflict
```

Regeln:

- Debounce: 750 ms nach der letzten Änderung.
- Maximal ein Save-Request pro Seite gleichzeitig.
- Änderungen während eines laufenden Requests erzeugen danach genau einen weiteren Save.
- Retries nur bei Netzwerkfehlern, `429` und `5xx`, mit exponentiellem Backoff und Jitter; maximal 30 Sekunden zwischen Versuchen.
- `4xx` außer `409` werden nicht automatisch wiederholt.
- Bei `409` stoppt Autosave. Die UI bietet „Serverversion laden“ und „Meine Version kopieren“; ein automatisches Merge ist nicht Teil des MVP.
- Seitenwechsel wartet nicht blockierend auf den Save. Der Zustand bleibt in der Save-Queue erhalten.
- `beforeunload` zeigt nur dann eine Browserwarnung, wenn unbestätigte Änderungen existieren.

Zusätzlich wird pro Seite der letzte unbestätigte Tiptap-State in IndexedDB gehalten. Er wird nach einem bestätigten Save entfernt. Nach Reload bietet Dovari eine Wiederherstellung an, wenn der lokale Stand neuer als der bestätigte Serverstand ist. Das ist Verlustschutz, kein Offline-Synchronisationssystem.

### 8.3 Dokumentoberfläche und Link-Interaktion

Die private Seitenroute besitzt keinen getrennten Lese- und Editiermodus. Nach dem Laden bilden
Seitentitel und Tiptap-Inhalt eine zusammenhängende, unmittelbar bearbeitbare Dokumentoberfläche.
Die Content-Spalte bleibt für lesbare Zeilenlängen begrenzt, darf aber innerhalb des verfügbaren
App-Bereichs deutlich breiter als die bisherige 820-Pixel-Seitenkarte werden. Editorrahmen,
erklärende Zwischenüberschriften und Debug-JSON sind kein Bestandteil der normalen Produktansicht.

Toolbar, Save-Zustand und destruktive Seitenaktionen bleiben per Maus, Touch und Tastatur
erreichbar. Sie werden platzsparend in die Dokumentoberfläche integriert; Fehler-, Konflikt- und
Recovery-Zustände bleiben dagegen deutlich sichtbar. Backlinks erscheinen nachgeordnet unter dem
Dokument. Der Seitentitel wird dokumentnah bearbeitet und verwendet weiterhin die vorhandene
revisionsgeschützte Title-API; Inhalts- und Titelspeicherung werden nicht zu einem neuen
Serververtrag zusammengelegt.

Die Tiptap-Link-Extension erkennt beim Tippen und Einfügen ausschließlich bereits erlaubte `http`,
`https`- und `mailto`-Ziele automatisch. Die bestehende URI-Allowlist bleibt die gemeinsame
Sicherheitsgrenze für automatische und manuelle Links. Das Editor-UI bietet für einen Link eine
eindeutige Aktion zum Öffnen sowie Aktionen zum Bearbeiten und Entfernen; das Öffnen externer Ziele
verwendet `noopener` und `noreferrer`.

Wiki-Links bleiben eigenständige Nodes mit stabiler Zielseiten-ID und werden nicht in normale
URL-Marks umgewandelt. Neben dem `[[`-Autocomplete stellt die Toolbar einen beschrifteten Einstieg
bereit, der dieselbe Seitensuche, Auswahl und optionale Seitenerstellung verwendet. Das Link-UI
darf weder Autosave noch die bestehende Tastaturnavigation des Autocomplete umgehen.

### 8.4 Slash Commands und Alltagsnavigation

In einem leeren Absatz öffnet `/` eine zugängliche, filterbare Befehlspalette. Unterstützt werden
Text, Heading 1–3, Bullet List, Ordered List, Checklist, Quote, Inline Code, Code Block, Divider,
Wiki Link, Image und File. Enter führt die aktive Auswahl aus, Pfeiltasten ändern sie und Escape
schließt die Palette ohne Dokumentänderung. Der Slash-Text wird nur entfernt, wenn ein Befehl
erfolgreich ausgeführt wird.

Wiki Link öffnet den bestehenden Wiki-Link-Picker. Image und File öffnen eine Dateiauswahl und
verwenden unverändert die gemeinsame, auf drei parallele Uploads begrenzte Asset-Pipeline. Fehler,
Retry und Remove entsprechen Paste und Drag & Drop. Die Toolbar bleibt vollständig per Tastatur
erreichbar und ist der Fallback, falls die Slash-Palette geschlossen wird.

Der Settings-Bereich liegt unter `/app/settings` und bündelt Theme, Trash, Revisionszugriff,
Backup und Restore. Der bisherige Command-Palette-Platzhalter navigiert auf diese echte Route.
Die Sidebar zeigt höchstens fünf aktive, zuletzt bearbeitete Seiten aus den bereits geladenen
Page-Metadaten, sortiert nach `updatedAt` absteigend und ohne Duplikate zur aktuell geöffneten
Seite. Favoriten und Tags werden daraus nicht abgeleitet.

### 8.5 Öffentliche Anwendung

Ab P25 ist `/` keine private Weiterleitung mehr, sondern die öffentliche Landingpage. Sie lädt
alle Cursor-Seiten der Publication-Liste progressiv und macht jede aktive Publication erreichbar.
`/p/:publicId` verwendet einen eigenständigen Read-only-Renderer und bietet keine Editorbefehle,
Autosave-, Backlink-, Revisions- oder private Suchfunktion. Der öffentliche Bereich funktioniert
ohne Dovari-Session und wird auch durch eine fehlende Passwortkonfiguration nicht gesperrt; er
besitzt Loading-, Empty-, 404- und Retry-Zustände.

Ein sichtbarer „Bearbeiten“-Link zeigt auf `/app/publications/:publicId/edit`. Diese Route bleibt
Teil der privaten App-Klassifikation. Nach erfolgreicher Passwort-Anmeldung löst sie die
Publication über den privaten `editor-target`-Endpunkt auf und navigiert nach
`/app/pages/:pageId`. Dadurch erscheint keine private Page-ID im öffentlichen HTML oder Public
JSON. `/app` behält die gesamte
private Navigation und zeigt aktive, unveröffentlichte und geänderte Seiten.

## 9. Screenshot-, Bild- und Datei-Upload

### 9.1 Erlaubte Typen und Grenzen

Initial inline darstellbar:

- PNG
- JPEG
- WebP
- GIF

Initial als Attachment:

- PDF
- Plain Text
- Markdown
- ZIP
- sonstige Binärdateien mit `application/octet-stream`

SVG ist im MVP deaktiviert. HTML wird nicht als inline darstellbares Asset akzeptiert.

Maximale Dateigröße: **25 MiB pro Datei**. Das liegt deutlich unter den aktuellen Worker-Requestgrenzen und begrenzt Speicher- und Missbrauchsrisiko. Größere Dateien benötigen später einen separaten Multipart-Uploadentwurf.

Der Server vertraut weder Dateiendung noch Client-MIME allein. Für bekannte Typen wird eine Magic-Byte-Prüfung vorgenommen. Der ursprüngliche Dateiname wird auf 255 Unicode-Zeichen begrenzt, Steuerzeichen und Pfadbestandteile werden entfernt.

R2-Key:

```text
assets/YYYY/MM/<uuid>.<server-derived-extension>
```

### 9.2 Tiptap-Integration

Tiptaps freie `FileHandler`-Extension verarbeitet `onPaste` und `onDrop` mit einer gemeinsamen Upload-Pipeline. `consumePasteEvent: true` verhindert doppelte Bild-Nodes, wenn die Zwischenablage zugleich Datei- und HTML-Daten enthält.

Eine Upload-Decoration markiert die gemappte Dokumentposition und zeigt Fortschritt beziehungsweise Fehler. Blob-URLs und Uploadstatus werden nie in `content_json` gespeichert.

Nach erfolgreichem Upload ersetzt die Pipeline die Decoration durch einen eigenen `assetImage`- oder `attachment`-Node. Der persistierte Bild-Node enthält:

```json
{
  "type": "assetImage",
  "attrs": {
    "assetId": "uuid",
    "alt": "",
    "title": null,
    "width": null
  }
}
```

Die URL wird beim Rendern aus `assetId` abgeleitet. Dadurch bleiben Dokumente unabhängig von Domain und Speicherbackend.

Bei Uploadfehler bleibt eine nicht persistierte Fehler-Decoration mit „Retry“ und „Remove“. Mehrere Uploads dürfen parallel laufen, initial jedoch höchstens drei pro Browser-Tab.

## 10. Suche

D1 FTS5 ist für Version 1 geeignet, weil D1 das FTS5-Modul unterstützt, die erwartete Datenmenge klein ist und Titel/Inhalt ohne externe Synchronisation gemeinsam gespeichert werden können.

Die API interpretiert Nutzereingaben nicht als rohe FTS-Syntax. Sie:

1. normalisiert Whitespace,
2. begrenzt die Eingabe auf 200 Zeichen und 12 Tokens,
3. escaped beziehungsweise quotet jedes Token,
4. hängt für das letzte Token `*` als Prefixsuche an.

Ranking verwendet `bm25(pages_fts, 8.0, 1.0)`, sodass Titeltreffer deutlich stärker gewichtet werden. Ein exakter, case-insensitiver Titeltreffer erhält zusätzlich Vorrang. Ergebnisse enthalten Titel, kanonische URL, Breadcrumb und ein kurzes `snippet()`-Fragment. Markierungen werden im React-Client als strukturierte Segmente gerendert, nicht als ungeprüftes HTML.

Grenzen der ersten Version:

- keine semantische Suche,
- kein Fuzzy Matching für Tippfehler,
- keine sprachabhängige Stemming-Konfiguration,
- keine Suche im Binärinhalt von Anhängen.

Diese Grenzen gefährden den primären `Ctrl+K`-Workflow nicht. Erst echte Nutzungsdaten rechtfertigen eine komplexere Suchkomponente.

## 11. Authentifizierung und Sicherheit

### 11.1 Instanz-Passwort und Sessions

`/app/*` und `/api/private/*` werden durch ein einziges, beim Deployment gesetztes
`DOVARI_PASSWORD` geschützt. Das Secret darf höchstens 256 UTF-8-Bytes enthalten. Es wird exakt
verglichen und weder normalisiert noch getrimmt. Fehlt eine
gültige Konfiguration, antworten private Pfade fail-closed mit `503 SETUP_REQUIRED`, ohne private
D1- oder R2-Daten zu lesen.

Nach erfolgreichem Login erzeugt der Worker einen kryptografisch zufälligen 256-Bit-Token. Nur
sein SHA-256-Hash wird in `auth_sessions` gespeichert. Das Cookie
`__Host-dovari_session` ist `HttpOnly`, `Secure`, `SameSite=Strict`, gilt für `/` und läuft nach
30 Tagen fest ab. Sessions sind an die aktuelle Worker-Version gebunden; jeder neue Deploy
invalidiert bestehende Sitzungen.

Fehlgeschlagene Anmeldungen werden pro SHA-256-gehashter `CF-Connecting-IP` auf fünf Versuche je
15 Minuten begrenzt. Login und Logout benötigen denselben Same-Origin-Schutz wie andere
Mutationen. Lokale Entwicklung verwendet ebenfalls ein Passwort aus `.dev.vars`; es gibt keinen
Authentifizierungs-Bypass. GitHub OAuth, Benutzerkonten, Rollen, MFA und Passwort-Reset sind nicht
Teil von Version 1.

### 11.2 Deploy-Einschränkung

Der Deploy-to-Cloudflare-Flow provisioniert D1 und R2 aus `wrangler.jsonc` und fragt
`DOVARI_PASSWORD` als verschlüsseltes Secret ab. Es gibt keinen verpflichtenden Post-Deploy-Schritt.
Bis ein gültiges Passwort konfiguriert ist, gibt Dovari keine privaten Inhalte aus und erlaubt
keine Schreiboperationen.

### 11.3 Weitere Maßnahmen

- Same-Origin-Architektur, kein allgemeines CORS.
- Private und öffentliche Handler sind getrennte Hono-Router; öffentliche Handler importieren keine Mutationsservices.
- Zustandsändernde Browserrequests benötigen einen passenden `Origin`-Header; fremde Origins werden mit `403` abgewiesen.
- Strikte Zod-Validierung mit Größenlimits vor Domänenlogik.
- Nur gebundene SQL-Parameter; keine Nutzereingabe in SQL-Strings.
- Keine Ausführung von HTML aus Tiptap oder Assets.
- Content Security Policy ohne `unsafe-eval`; `unsafe-inline` nur falls der gebaute Style-Stack es zwingend benötigt und dann mit dokumentierter Begründung.
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, restriktive `Permissions-Policy`, Frame-Schutz per CSP `frame-ancestors 'none'`.
- Sensible Inhalte, Tokens und Dokumentkörper werden nicht geloggt.
- R2 bleibt privat; es gibt keine S3-Credentials im Browser.
- Backup und Restore sind vollständig privat und dürfen keine Secrets oder Cloudflare-Konfiguration
  serialisieren.
- ZIP-Pfade werden normalisiert und dürfen weder absolute Pfade noch `..`, Backslashes,
  Steuerzeichen oder doppelte Zielpfade enthalten.
- Der Restore vertraut weder Manifest, Dateiname, MIME-Typ, Größe noch Prüfsumme ohne eigene
  Validierung. Page- und Revisionsrecords unterliegen dem vorhandenen 1,8-MB-Seitenlimit, Assets
  dem vorhandenen 25-MiB-Dateilimit. Summen müssen sichere nichtnegative Ganzzahlen sein;
  Dovari führt für Version 1 kein zusätzliches kleineres Gesamtlimit unterhalb der gebundenen
  Cloudflare-Ressourcen ein.
- Eine Restore-Session gehört zur validierten Besitzeridentität und kann ohne gültige
  Dovari-Session nicht gelesen, fortgesetzt, finalisiert oder verworfen werden.
- Restore-Finalisierung prüft unmittelbar vor dem Commit erneut, dass der Workspace leer ist.

## 12. Deployment

### 12.1 Wrangler

`wrangler.jsonc` enthält mindestens:

- Worker-Name `dovari`,
- aktuelles `compatibility_date`,
- Worker-Entrypoint,
- D1-Binding `DB` mit `migrations_dir`,
- R2-Binding `ASSETS`,
- Static-Assets-Konfiguration,
- Observability-Grundkonfiguration.
- Version-Metadata-Binding `CF_VERSION_METADATA`.

Für lokal und Produktion werden dieselben Binding-Namen verwendet. IDs und Ressourcennamen dürfen durch den Deploy-Flow ersetzt werden.

### 12.2 npm-Skripte

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "typecheck": "tsc -b --pretty false",
    "lint": "eslint .",
    "test": "vitest run",
    "test:e2e": "playwright test",
    "db:migrate:local": "wrangler d1 migrations apply DB --local",
    "db:migrate:remote": "wrangler d1 migrations apply DB --remote",
    "deploy": "npm run db:migrate:remote && npm run build && wrangler deploy"
  }
}
```

Der Remote-Migrationsbefehl referenziert absichtlich den Binding-Namen `DB`, damit vom Deploy-Button umbenannte Datenbanken funktionieren.

Migrationen müssen vor einem Deployment rückwärtskompatibel mit der aktuell laufenden Version sein. Destruktive Schemaänderungen erfolgen später nach dem Expand/Migrate/Contract-Prinzip und nie zusammen mit Code, der alte Spalten sofort voraussetzungslos entfernt.

### 12.3 Deploy-to-Cloudflare

Die README erhält den offiziellen Button mit der öffentlichen GitHub-Repository-URL. Erwarteter Ablauf:

1. Repository in den Account des Nutzers klonen.
2. D1-Datenbank und R2-Bucket automatisch erstellen und binden.
3. Build- und Deploy-Skripte erkennen.
4. D1-Migrationen anwenden.
5. Worker und Static Assets deployen.
6. Nutzer setzt im Deploy-Dialog das erforderliche `DOVARI_PASSWORD`.
7. Ein Smoke-Test meldet sich an und bestätigt geschützte App, D1 und R2.

Das Repository bleibt deshalb ein einzelnes, öffentliches GitHub- oder GitLab-Projekt; Deploy-Buttons unterstützen keine frei verteilte Multi-Worker-Monorepo-Installation.

## 13. Lokale Entwicklung

Voraussetzungen werden in der README als unterstützte Node-LTS-Version und npm-Version festgehalten. Der Standardablauf lautet:

```bash
npm ci
npm run dev
```

Ab Phase 1 wird vor dem ersten Start zusätzlich `npm run db:migrate:local` ausgeführt. Phase 0 stellt das Skript und den leeren Migrationspfad bereit; das fachliche Schema bleibt Aufgabe von Phase 1.

Wrangler hält lokale D1- und R2-Daten getrennt von Produktion. Remote-Bindings sind nicht der Standard und dürfen nicht in committed Konfiguration aktiviert werden.

Beispieldateien:

```text
.dev.vars.example     dokumentiert das lokal zu setzende Passwort
.dev.vars             gitignoriert
```

Generierte Worker-Typen werden über Wrangler erzeugt und committed oder in CI reproduzierbar geprüft. Manuell gepflegte Dubletten der Binding-Typen sind zu vermeiden.

## 14. Tests und Qualitätsgrenzen

### 14.1 Unit-Tests

- Slug-Erzeugung und Kollisionen
- Tiptap-JSON-Validierung
- Plaintext-Ableitung
- Markdown-Konvertierung
- Suchquery-Escaping
- Hierarchie-/Zyklusprüfung
- Uploadtyp- und Dateinamenvalidierung
- Autosave-Zustandsautomat
- Snapshot-Zeitfenster und Retention auf 50 Revisionen
- Backupmanifest, kanonische Prüfsummen und sichere ZIP-Pfade
- Slash-Command-Filterung und Befehlsausführung

### 14.2 Worker-Integrationstests

Die Tests laufen mit `@cloudflare/vitest-plugin` in der Workers-Laufzeit und echten lokalen Bindings:

- Page CRUD und Revision-Konflikt
- D1-Migrationen und Foreign Keys
- FTS-Insert, Update, Soft Delete und Integrity Check
- R2-Upload, Download, ETag und Range
- Passwort- und Session-Middleware: fehlende Konfiguration, falsches/richtiges Passwort,
  Login-Limit, Ablauf, manipuliertes Cookie und Worker-Versionswechsel
- Routing-Matrix: private Pfade geschützt, öffentliche Allowlist ohne private Daten erreichbar, unbekannte API-Pfade geschlossen
- Origin-Prüfung
- einheitliches Fehlerformat
- atomare Snapshots bei Mutation, Delete und Restore einschließlich Konfliktfällen
- Trash-Restore mit aktivem Parent und Root-Fallback
- permanentes Löschen mit Revision und Titelbestätigung
- Restore-Session: idempotente Records und Assets, Wiederaufnahme, Abbruch und erneute
  Empty-Workspace-Prüfung
- vollständiger Backup-/Restore-Roundtrip einschließlich FTS-, Wiki-Link- und Asset-Referenzen

### 14.3 Browser-E2E

- Seite erstellen, tippen, Save-Indikator erreicht „Saved“
- zwei schnelle Änderungen erzeugen keinen verlorenen Stand
- Screenshot aus Clipboard einfügen und nach Reload anzeigen
- Bild per Drag & Drop an der korrekten Position einfügen
- Uploadfehler erneut versuchen
- `Ctrl+K`, suchen und Ergebnis öffnen
- Navigation und Editor vollständig per Tastatur bedienen
- Dark Mode und mobiles Sidebar-Verhalten
- Export einschließlich lokaler Asset-Links in Phase 7
- Seite löschen, Undo und aus dem Papierkorb wiederherstellen
- Revision anzeigen und als neue aktuelle Revision wiederherstellen
- Dovari-Backup erstellen und in einer zweiten leeren Installation verlustfrei wiederherstellen
- Slash Commands für Textblöcke, Wiki Link, Bild und Datei per Tastatur bedienen
- Settings und zuletzt bearbeitete Seiten bei Desktop- und Smartphonebreite verwenden

### 14.4 CI-Gates

Jeder Pull Request muss bestehen:

```text
format check
lint
typecheck
unit + worker integration tests
production build
```

Die kritischen E2E-Tests laufen mindestens auf der Hauptbranch und vor Releases; bei vertretbarer Laufzeit auch auf jedem Pull Request.

## 15. Fehlerbehandlung und Beobachtbarkeit

- Der Worker erzeugt pro Request eine Request-ID oder übernimmt eine gültige Cloudflare-Ray-ID als Korrelation.
- Logs sind strukturierte JSON-Ereignisse mit Route, Methode, Status, Dauer und stabiler Fehlerkennung.
- Keine Seitentitel, Inhalte, Suchbegriffe, Dateinamen, Passwörter oder Session-Tokens in Standardlogs.
- Erwartete Benutzerfehler sind `4xx`, unerwartete Fehler `500` mit neutraler Meldung.
- Die UI übersetzt Fehlercodes in konkrete Aktionen: Retry, Reload, Copy oder Remove.
- Upload- und Save-Fehler bleiben sichtbar, bis sie behoben oder bewusst verworfen wurden.

## 16. Performanceziele

- Navigation aus bereits geladenen Metadaten ohne Full Reload.
- Seiteninhalte werden einzeln geladen, nicht mit dem gesamten Baum.
- Suche liefert serverseitig höchstens 20 Ergebnisse und soll bei typischer persönlicher Datenmenge deutlich unter 100 ms Datenbankzeit bleiben.
- Editor-Updates lösen keine React-Neurender des gesamten Seitenbaums aus.
- R2-Inhalte werden gestreamt und über ETag/Conditional Requests browserseitig wiederverwendet.
- Kein Edge-Cache für private R2-Inhalte in Phase 0–3; korrekte Authentifizierung und Invalidierung haben Vorrang. Ein Cache kann später mit eigenem ADR ergänzt werden.

## 17. Umsetzungsreihenfolge

Diese Spezifikation ändert die Produktphasen nicht, konkretisiert aber ihre technischen Abhängigkeiten:

1. **Phase 0:** ein npm-Projekt, Cloudflare-Vite-Plugin, React-SPA, Hono-Worker, D1/R2/Static-Asset-Bindings, sichere Auth-Middleware, Lint/Typecheck/Vitest/Build und lokale Dokumentation.
2. **Phase 1:** Migrationen, Drizzle-Schema, Page API, Revisionen, Sidebar und Hierarchie.
3. **Phase 2:** Tiptap-Dokument, serverseitige Ableitungen, Autosave und lokaler Draft-Schutz.
4. **Phase 3:** gemeinsame Streaming-Uploadpipeline, R2, Asset-Nodes, Clipboard und Drop.
5. **Phase 4:** vollständige Bauminteraktionen und Moves.
6. **Phase 5:** FTS5-Suche und Command Palette.
7. **Phase 6:** Wiki-Link-Node und `page_links`.
8. **Phase 7:** Markdown-/ZIP-Export ohne persistiertes `content_markdown`.
9. **Phase 8:** dokumentnahe, platzsparende Seiten- und Editoroberfläche ohne separaten Editiermodus.
10. **Phase 9:** automatische sichere URL-Erkennung sowie auffindbare externe und interne Link-Bedienung.
11. **Phase 10:** Papierkorb, permanentes Löschen und begrenzte Seitenrevisionen gemäß Abschnitt 6.5.
12. **Phase 11:** verlustfreies Backup und Restore-Sessions gemäß Abschnitten 6.6 und 7.5.
13. **Phase 12:** Settings, zuletzt bearbeitete Seiten und Slash Commands gemäß Abschnitt 8.4.
14. **Phase 13:** Deploy-Button, integrierte Passwort-Anmeldung, Dokumentation, frischer
    Installations-Smoke und vollständige Version-1-Abnahme.
15. **Phase 14 nach Version 1:** öffentliche Landingpage, explizite Publication-Snapshots,
    öffentliche Read-only-Routes und privater Bearbeiten-Einstieg gemäß Abschnitten 6.8, 7.6 und 8.5.
16. **Phase 15:** separater Public-Suchindex, veröffentlichte Navigation und indexierungsabhängige
    Discovery-Metadaten gemäß Abschnitten 6.9 und 7.7.
17. **Phase 16:** private Tags und Favoriten mit expliziter Snapshot-Grenze gemäß Abschnitt 6.10.
18. **Phase 17:** kopierte Templates und idempotente Daily Notes gemäß Abschnitt 6.11.
19. **Phase 18:** sicherer, resumierbarer Markdown-/Obsidian-Import gemäß Abschnitt 7.10.

### Definition of Done für Phase 0

Phase 0 ist abgeschlossen, wenn:

- `npm ci` und `npm run dev` auf einem frischen Checkout funktionieren,
- die React-SPA durch denselben Worker erreichbar ist wie `/api/health`,
- D1 und R2 lokal über typisierte Bindings erreichbar sind,
- private Pfade ohne gültige Passwortkonfiguration fail-closed sind,
- Tests in der Workers-Laufzeit laufen,
- `npm run lint`, `npm run typecheck`, `npm test` und `npm run build` erfolgreich sind,
- ein manueller Wrangler-Deploy auf eine Testumgebung erfolgreich war,
- keine Produktfunktion aus späteren Phasen vorgezogen werden musste.

## 18. Bewusst vertagte Entscheidungen

Diese Punkte blockieren Phase 0 nicht und werden erst mit ihrer Produktphase entschieden:

- konkrete Markdown-Serialisierungsbibliothek,
- Syntax-Highlighting-Engine und Sprachenpaket,
- Tabellen im Editor,
- Garbage-Collection-Zeitplan für Assets,
- Exporterzeugung im Request versus asynchroner Workflow bei sehr großen Wikis,
- Fuzzy Search oder Trigram-Index nach realen Suchmetriken,
- Thumbnailing und Bildtransformation,
- Detailentscheidungen für Tags und Favoriten jenseits des in P27 festgelegten Minimalmodells,
- Fremdimportformate jenseits von Markdown und dem in P29 festgelegten Obsidian-Subset,
- automatische beziehungsweise zeitgesteuerte Backups,
- öffentliche Bearbeitung, passwortgeschützte Einzellinks und Sharing-ACLs.

## 19. Geprüfte Primärquellen

Stand der Prüfung: 12. September 2026.

- [Cloudflare: React + Vite](https://developers.cloudflare.com/workers/framework-guides/web-apps/react/)
- [Cloudflare Workers: Vite plugin](https://developers.cloudflare.com/workers/vite-plugin/)
- [Cloudflare Workers: Static Assets](https://developers.cloudflare.com/workers/vite-plugin/reference/static-assets/)
- [Cloudflare Workers: Static Assets binding and routing](https://developers.cloudflare.com/workers/static-assets/binding/)
- [Cloudflare Workers: Deploy to Cloudflare buttons](https://developers.cloudflare.com/workers/platform/deploy-buttons/)
- [Cloudflare D1: supported SQL statements and FTS5](https://developers.cloudflare.com/d1/sql-api/sql-statements/)
- [Cloudflare D1: limits](https://developers.cloudflare.com/d1/platform/limits/)
- [Cloudflare D1: migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [SQLite: FTS5](https://www.sqlite.org/fts5.html)
- [Cloudflare R2: Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
- [Cloudflare Workers: platform limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Cloudflare Deploy Buttons](https://developers.cloudflare.com/workers/platform/deploy-buttons/)
- [Cloudflare Worker Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Cloudflare Version Metadata](https://developers.cloudflare.com/workers/runtime-apis/bindings/version-metadata/)
- [Cloudflare Workers: Vitest integration](https://developers.cloudflare.com/workers/testing/)
- [Tiptap: FileHandler extension](https://tiptap.dev/docs/editor/extensions/functionality/filehandler)
- [Tiptap: Image extension](https://tiptap.dev/docs/editor/extensions/nodes/image)
- [Drizzle ORM: Cloudflare D1](https://orm.drizzle.team/docs/sqlite/connect-cloudflare-d1)
- [Hono: Getting Started](https://hono.dev/docs/getting-started/basic)
