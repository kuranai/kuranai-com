# Dovari – Implementierungsstatus und Phasenplan

**Dieses Dokument ist die kanonische Quelle für den aktuellen Implementierungsstand.**  
**Letzte Aktualisierung:** 22. September 2026
**Gesamtstatus:** P00–P28 abgeschlossen, P29 geplant
**Aktuelle Phase:** P28 – Templates und Daily Notes (`DONE`)
**Nächste Phase:** P29 – Markdown- und Obsidian-Import (`NEXT`)

## 1. Zweck

Jede Phase wird in einem frischen Chat mit begrenztem Kontext bearbeitet. Dieses Dokument sorgt dafür, dass trotzdem jederzeit eindeutig ist:

- was bereits fertig ist,
- was als Nächstes umgesetzt wird,
- welche Entscheidungen verbindlich sind,
- welche Prüfungen eine Phase abschließen,
- wo eine unterbrochene Arbeit fortgesetzt werden muss.

Produktanforderungen stehen in [`PLAN.md`](./PLAN.md). Verbindliche Architektur-, Datenmodell-, API- und Sicherheitsentscheidungen stehen in [`TECHNICAL_SPEC.md`](./TECHNICAL_SPEC.md). Dieses Dokument steuert ausschließlich die Umsetzung und hat für den **Arbeitsstand** Vorrang.

## 2. Standardprompt für jeden neuen Chat

Der folgende kurze Prompt genügt:

> Implementiere die nächste Phase.

Optional präziser:

> Lies `IMPLEMENTATION.md` und implementiere die nächste noch offene Phase vollständig. Aktualisiere danach den Status und dokumentiere die Verifikation.

Ein Agent muss bei diesem Prompt das Arbeitsprotokoll aus Abschnitt 3 befolgen. Es darf nicht nötig sein, dem Agenten den bisherigen Chatverlauf mitzugeben.

## 3. Verbindliches Arbeitsprotokoll

### 3.1 Beginn einer Phase

Der ausführende Agent muss:

1. `IMPLEMENTATION.md` vollständig lesen.
2. ausschließlich die im „Kontext-Routing“ in Abschnitt 6 für diese Phase genannten Teile aus `TECHNICAL_SPEC.md` und `PLAN.md` lesen; weitere Abschnitte nur bei einer konkret festgestellten Abhängigkeit.
3. vorhandene Repository-Anweisungen und den tatsächlichen Codezustand prüfen.
4. lokale Änderungen respektieren und nicht zusammenhangslos überschreiben.
5. die zu bearbeitende Phase nach dieser Priorität auswählen:
   1. eine Phase mit Status `IN PROGRESS`,
   2. eine Phase mit Status `BLOCKED`, falls der Blocker inzwischen lösbar ist,
   3. andernfalls die einzige Phase mit Status `NEXT`.
6. vor den ersten Implementierungsänderungen die Phase auf `IN PROGRESS` setzen und den Kopf dieses Dokuments aktualisieren.

Es wird immer genau **eine** Phase bearbeitet. Aufgaben späterer Phasen werden nicht vorgezogen, außer sie sind eine zwingende technische Voraussetzung. Eine solche Ausnahme muss im Statusprotokoll begründet werden.

### 3.2 Während der Phase

- Der Scope und die Nicht-Ziele der Phase sind verbindlich.
- Neue Architekturentscheidungen werden in `docs/adr/` dokumentiert, wenn sie von `TECHNICAL_SPEC.md` abweichen oder eine dort bewusst vertagte Entscheidung festlegen.
- Entdeckte Folgearbeit wird in Abschnitt 7 notiert und nicht still in den aktuellen Scope aufgenommen.
- Relevante Tests werden zusammen mit der Implementierung geschrieben.
- Der Agent hält dieses Dokument aktuell, falls die Arbeit unterbrochen wird.

### 3.3 Abschluss einer Phase

Eine Phase darf nur auf `DONE` gesetzt werden, wenn:

- alle Akzeptanzkriterien erfüllt sind,
- die für die Phase vorgeschriebenen Prüfungen erfolgreich gelaufen sind,
- relevante Dokumentation aktualisiert wurde,
- keine bekannte Regression im bearbeiteten Bereich verbleibt.

Danach muss der Agent in **derselben Änderung**:

1. die Phase in der Statustabelle auf `DONE` setzen,
2. die nächste geplante Phase auf `NEXT` setzen,
3. Kopfzeile, Kurzprotokoll und Datum aktualisieren,
4. die tatsächlich ausgeführten Prüfkommandos mit Ergebnis eintragen,
5. nach dieser Phase stoppen und keine weitere Phase beginnen.

Ist die Phase nicht fertig, bleibt sie `IN PROGRESS`. Bei einem echten externen Blocker erhält sie
`BLOCKED`; Ursache und benötigte Aktion werden konkret dokumentiert. Die nächste Phase wird dann
nicht automatisch begonnen.

## 4. Statuswerte

| Status | Bedeutung |
|---|---|
| `PLANNED` | Noch nicht an der Reihe |
| `NEXT` | Nächste zu beginnende Phase; davon darf es höchstens eine geben |
| `IN PROGRESS` | Begonnen und noch nicht vollständig abgeschlossen |
| `BLOCKED` | Begonnen, aber durch einen konkret dokumentierten externen Grund blockiert |
| `DONE` | Alle Akzeptanzkriterien erfüllt und verifiziert |

## 5. Gesamtfortschritt

| Phase | Meilenstein | Titel | Status | Ergebnis/Evidenz |
|---|---|---|---|---|
| P00 | Grundlage | Projekt-Scaffold | `DONE` | `npm ci`, Dev-Smoke-Test, Build, Typecheck, Lint und Format-Check erfolgreich |
| P01 | Grundlage | Cloudflare-Laufzeit und Bindings | `DONE` | Vite-/Cloudflare-Worker, Hono-Routing, lokale D1-/R2-Bindings, SPA-Fallback, Health-Smoke und generierte Binding-Typen umgesetzt und verifiziert |
| P02 | Grundlage | Authentifizierung und Security-Basis | `DONE` | Fail-Closed-Routing, Origin-Schutz, Security-Header und Worker-Sicherheitstests umgesetzt; Auth-Verfahren in P24 durch Instanz-Passwort ersetzt |
| P03 | Grundlage | Testsystem vervollständigen und CI-Qualitätsgates | `DONE` | Vitest-Worker-/Clienttests, lokale D1-/R2-Binding-Tests, Playwright-Smoke und CI-Gates umgesetzt und verifiziert |
| P04 | Seiten | D1-Schema und Migrationen | `DONE` | Drizzle-Schema, D1-Migrationen, FTS5-Synchronisation und Integrity-Tests umgesetzt und verifiziert |
| P05 | Seiten | Pages Domain und HTTP-API | `DONE` | Pages-Repository/-Service, Zod-Verträge, CRUD, Slugs, Plaintext, Konflikte, Limits und Soft Delete umgesetzt und verifiziert |
| P06 | Seiten | App-Shell, Sidebar und Page CRUD | `DONE` | React-Router-App-Shell, Sidebar, Page-URLs und browserseitiger Page-CRUD umgesetzt und verifiziert |
| P07 | Navigation | Seitenhierarchie und Sortierung | `DONE` | Move-API mit rekursiver Zyklusprüfung, atomare Geschwisternormalisierung, einklappbarer Baum, Child-Erstellung, Inline-Rename, Pointer-DnD und Tastaturalternative umgesetzt und verifiziert |
| P08 | Editor | Tiptap-Grundeditor | `DONE` | Tiptap-3-Grundeditor mit Allowlist, Toolbar, Placeholder, sicherem Link-Dialog, lokalem JSON-Roundtrip und fokussierten Editor-Tests umgesetzt und verifiziert |
| P09 | Editor | Inhaltsableitungen und Markdown | `DONE` | Serverseitige Tiptap-Schema-Validierung, deterministische Plaintext-/Markdown-Ableitung und Roundtrip-/Snapshot-Tests umgesetzt und verifiziert |
| P10 | Editor | Autosave, Konflikte und Draft Recovery | `DONE` | Autosave-Queue, Retry/Backoff, Konfliktoberfläche, IndexedDB-Drafts und Recovery umgesetzt und verifiziert |
| P11 | Assets | R2 Asset API | `DONE` | Streaming-Upload, R2-/D1-Rollback, sichere Auslieferung, Conditional Requests, Range und Soft Delete umgesetzt und verifiziert |
| P12 | Assets | Screenshot Paste und Drag & Drop | `DONE` | Tiptap FileHandler, gemeinsame XHR-Uploadpipeline mit Fortschritt, Retry/Remove, maximal drei parallelen Uploads, Asset-Nodes und positionsstabile Einfügung umgesetzt und verifiziert |
| P13 | Assets | Asset-Referenzen und robuste Fehlerpfade | `DONE` | Atomare `page_assets`-Synchronisation, robuste Darstellung fehlender Assets, R2-Erhalt und Race-Tests umgesetzt und verifiziert |
| P14 | Suche | D1 FTS5 und Search API | `DONE` | Sichere FTS5-Tokenisierung, Prefixsuche, BM25-Titelgewichtung, Snippets, Breadcrumbs, Search API und FTS-Wartungswerkzeuge umgesetzt und verifiziert |
| P15 | Suche | Command Palette und Tastenkürzel | `DONE` | Zugängliche Command Palette mit Search-Debounce, Tastaturnavigation, stale-response-Schutz, Ergebnisöffnung, Fokuswiederherstellung, Create-New-Page-/Theme-/Settings-Aktionen und Ctrl/Cmd-Shortcuts umgesetzt und verifiziert |
| P16 | Wiki Links | Wiki Links und Backlinks | `DONE` | Wiki-Link-Node, `[[`-Autocomplete, Page-Erstellung, atomare `page_links`, Navigation und Backlinks umgesetzt und verifiziert |
| P17 | Export | Markdown- und ZIP-Export | `DONE` | Deterministischer Markdown-/ZIP-Export mit lokalen Wiki-/Asset-Links, Manifest, R2-Streaming, kollisionssicheren Pfaden, Missing-Asset-Platzhaltern und Download-UI umgesetzt und verifiziert |
| P18 | Produktreife | Responsive UI, Dark Mode und Accessibility | `DONE` | Theme-Provider, responsive Drawer, Skip-Link, Accessibility-Styles/-Tests und finale Zustände umgesetzt und verifiziert |
| P19 | Editor-Polish | Dokumentnahe Editoroberfläche | `DONE` | Direkt bearbeitbarer Titel mit revisionsgeschütztem Save, ruhige Dokumentfläche, integrierte Toolbar-/Save-Status- und Backlink-Anordnung, Debug-JSON entfernt und responsive A11y abgesichert |
| P20 | Editor-Polish | Link-Erlebnis und Wiki-Link-Auffindbarkeit | `DONE` | Sichere Autolinks/Paste, Link-Popover, sichtbarer Wiki-Link-Picker und Maus-/Tastaturabläufe umgesetzt und verifiziert |
| P21 | Datensicherheit | Papierkorb und Versionshistorie | `DONE` | `page_revisions`, atomare Snapshots/Retention, Trash-/Revision-APIs, Restore-/Permanent-Delete-Flows, Undo, UI und Accessibility umgesetzt und verifiziert |
| P22 | Datensicherheit | Verlustfreies Backup und Restore | `DONE` | Versioniertes, verlustfreies Backup/Restore mit Manifest, Streaming-ZIP, resumierbaren Restore-Sessions, atomarer Finalisierung, lokaler Validierung und Settings-UI umgesetzt und verifiziert |
| P23 | Produktreife | Settings, Slash Commands und Alltagsnavigation | `DONE` | Settings-Landing, Recent Pages, Slash-Command-Palette und Upload-/Wiki-Link-Abläufe umgesetzt und verifiziert |
| P24 | Deployment | Deploy-to-Cloudflare und Version-1-Abnahme | `DONE` | Instanz-Passwort, eigene versionsgebundene D1-Sessions, Login/Logout, Dokumentation, lokale Abnahme und produktiver authentifizierter Deploy-Smoke sind umgesetzt und verifiziert |
| P25 | Public | Öffentliche Knowledge Base und Veröffentlichungen | `DONE` | Publication-Migration, Snapshot-/Asset-Allowlist, private/public API, Read-only-UI, automatische Synchronisierung bestehender Publications bei Titel-/Inhaltsänderungen, Backup-v2/v1-Restore-Kompatibilität, Soft-Delete-Rückzug und vollständige Verifikation umgesetzt |
| P26 | Public | Öffentliche Suche, Navigation und Auffindbarkeit | `DONE` | Öffentlicher Snapshot-FTS5-Index, Public Search, snapshotbasierte Hierarchie-Navigation, sichere Metadaten, Robots/Sitemap und revalidierbare Public-Caches umgesetzt und verifiziert |
| P27 | Organisation | Tags und Favoriten | `DONE` | Normalisierte Tags, atomare Zuordnung, Favoriten, private Filter-/Suche, optionale Snapshot-Tags, Backup-/Restore und UI umgesetzt und verifiziert |
| P28 | Workflows | Templates und Daily Notes | `DONE` | Private Templates, Create-from-Template, konfigurierbare Daily Notes, Slash-/Command-Palette, Backup-v2 und responsive Accessibility umgesetzt und verifiziert |
| P29 | Datenportabilität | Markdown- und Obsidian-Import | `NEXT` | – |

## 6. Phasendefinitionen

### Kontext-Routing

Damit ein frischer Chat nicht erneut die gesamte Planung laden muss, gelten diese Lesebereiche:

| Phase | `TECHNICAL_SPEC.md` | `PLAN.md` |
|---|---|---|
| P00 | §§ 2, 3 und 5 | §§ 4, 6 und Phase 0 in § 45 |
| P01 | §§ 3, 4, 12.1 und 13 | §§ 5, 31 und 32 |
| P02 | §§ 4 und 11 | §§ 23, 34, 35 und 37 |
| P03 | § 14 | § 46 |
| P04 | §§ 6 und 12.2 | §§ 7, 11, 12, 17 und 19 |
| P05 | §§ 6.1, 6.4, 7.1, 7.2 und 8.1 | §§ 7, 33–35 und 39 |
| P06 | §§ 5 und 7.2 | §§ 14, 15 und 41 |
| P07 | §§ 6.4 und 7.2 | §§ 7, 14 und Phase 4 in § 45 |
| P08 | § 8.1 | §§ 8, 21, 22 und Phase 2 in § 45 |
| P09 | §§ 6.1 und 8.1 | §§ 7 und 27 |
| P10 | §§ 7.2 und 8.2 | §§ 8, 35 und 36 |
| P11 | §§ 6.2, 7.3, 9.1 und 11.3 | §§ 9–13 und 37–38 |
| P12 | § 9.2 | §§ 9, 10 und Phase 3 in § 45 |
| P13 | §§ 6.2, 8.2 und 9 | §§ 12, 13 und 38 |
| P14 | §§ 6.3, 7.4 und 10 | § 19 und Phase 5 in § 45 |
| P15 | § 10 | §§ 20 und 15 |
| P16 | §§ 6.2 und 17 | §§ 16, 17 und Phase 6 in § 45 |
| P17 | §§ 8.1, 12.2 und 17 | § 27 und Phase 7 in § 45 |
| P18 | §§ 3.2, 14.3 und 16 | §§ 25, 26, 41 und 48 |
| P19 | §§ 3.2, 8.2, 8.3, 14.3 und 16 | §§ 8, 14, 26, 43, 47, 48 und Phase 8 in § 45 |
| P20 | §§ 8.1, 8.3 und 14.3 | §§ 8, 15, 16, 43, 46 und Phase 9 in § 45 |
| P21 | §§ 6.1, 6.3, 6.5, 7.1, 7.2, 7.5, 8.2 und 14 | §§ 38–40, 43, 46, 53 und Phase 10 in § 45 |
| P22 | §§ 6.1, 6.2, 6.6, 7.1, 7.3, 7.5, 9.1, 11.3 und 14 | §§ 27–29, 37–38, 43, 46, 53 und Phase 11 in § 45 |
| P23 | §§ 3.2, 7.5, 8.1, 8.4, 9.2, 10, 14.3 und 16 | §§ 14, 20–21, 26, 41, 43, 46, 48 und Phase 12 in § 45 |
| P24 | §§ 11.2, 12, 14 und 17 | §§ 30, 43, 46, 53 und Phase 13 in § 45 |
| P25 | §§ 4, 6.6, 6.8, 7.1, 7.5, 7.6, 8.5, 11 und 17 | §§ 14–16, 23, 27–29, 44, Public Sharing in § 50 und Phase 14 in § 45 |
| P26 | §§ 6.9, 7.7, 10, 11, 14.3 und 16 | §§ 19–20, 25–26, 47–48, Public Sharing und Custom Domains in § 50 sowie Phase 15 in § 45 |
| P27 | §§ 6.6, 6.10, 7.5, 7.8, 10 und 14 | §§ 14–15, 19–20, 26–29, 38–39 und Phase 16 in § 45 |
| P28 | §§ 6.6, 6.11, 7.5, 7.9, 8.1, 8.4 und 14.3 | §§ 7–8, 14–15, 21, 26–29, Templates und Daily Notes in § 50 sowie Phase 17 in § 45 |
| P29 | §§ 6.1, 6.2, 7.10, 8.1, 9.1, 11.3 und 14 | §§ 27–29, 37–39, 46 und Phase 18 in § 45 |

Zusätzlich wird nur der für die Phase relevante bestehende Code gelesen. Falls eine referenzierte Entscheidung widersprüchlich oder unvollständig ist, wird die Abweichung vor der Implementierung dokumentiert.

### P00 – Projekt-Scaffold

**Ziel:** Ein minimales, lokal startbares npm-/TypeScript-/React-Projekt als belastbare Basis.

**Scope:**

- npm-Projekt mit `package-lock.json`
- React, Vite und TypeScript im Strict Mode
- Verzeichnisstruktur aus der technischen Spezifikation
- minimale App-Shell ohne Produktfeatures
- ESLint und Formatter
- Basis-Skripte für `dev`, `build`, `typecheck`, `lint` und `format:check`
- `.gitignore`, `.editorconfig` und kurze lokale Startanleitung

**Akzeptanzkriterien:**

- `npm ci` funktioniert auf einem frischen Checkout.
- `npm run dev` zeigt eine minimale Dovari-App.
- `npm run build`, `npm run typecheck`, `npm run lint` und `npm run format:check` sind erfolgreich.
- Client-, Worker- und Shared-Grenzen sind in der Struktur vorbereitet; P01-Inhalte werden noch nicht implementiert.

**Nicht Teil dieser Phase:** Cloudflare-Bindings, Hono-Routen, D1-Schema, Tiptap, Produk UI.

### P01 – Cloudflare-Laufzeit und Bindings

**Ziel:** SPA und Worker laufen gemeinsam in der offiziellen Cloudflare-Vite-Umgebung.

**Scope:**

- `@cloudflare/vite-plugin`, Wrangler und Hono
- Worker-Entrypoint unter `src/worker/`
- Static-Assets-Binding `STATIC_ASSETS`
- D1-Binding `DB` und R2-Binding `ASSETS`
- SPA-Fallback, Worker-first-Routing und zentrale Klassifikation privater, öffentlicher und unbekannter Pfade
- typisierte, von Wrangler erzeugte Bindings
- `/api/health` mit generischem Liveness-Response
- lokale `.dev.vars.example`

**Akzeptanzkriterien:**

- SPA und `/api/health` laufen über denselben lokalen Worker.
- D1 und R2 sind lokal gebunden und über einen nicht-sensitiven Smoke-Test erreichbar.
- `vite build` erzeugt ein deploybares Worker-/Asset-Artefakt.
- Produktion greift nicht versehentlich auf lokale oder Remote-Entwicklungsdaten zu.

**Nicht Teil dieser Phase:** fachliches D1-Schema, Authentifizierungslogik, CRUD.

### P02 – Authentifizierung und Security-Basis

**Ziel:** Die Anwendung ist in Produktion fail-closed und besitzt zentrale Sicherheitsmiddleware.

**Scope:**

- Instanz-Passwort und opake D1-Sessions für `/app/*` und `/api/private/*`
- keine globale Login-Pflicht für reservierte Public-Read-Routes
- `SETUP_REQUIRED` bei fehlender Passwortkonfiguration
- Origin-Prüfung für Mutationen
- Request-ID und einheitliches API-Fehlerformat
- Basis-Sicherheitsheader und keine sensiblen Standardlogs
- Dokumentation des Passwort-Setups
- minimale Worker-Vitest-Konfiguration für die Sicherheitsfälle dieser Phase

**Akzeptanzkriterien:**

- fehlende, ungültige und abgelaufene Sessions werden abgelehnt.
- eine gültige Session erreicht die privaten Routes.
- ohne Passwortkonfiguration werden weder private App-Shell noch Bindungsdaten ausgegeben.
- `/api/health` und inhaltsfreie statische Dateien bleiben erreichbar, geben aber keine privaten Daten preis.
- unbekannte und öffentliche API-Pfade können keine Mutationsservices erreichen.
- lokale Entwicklung verwendet dieselbe Passwortgrenze wie Produktion.

**Nicht Teil dieser Phase:** eigene Benutzerkonten, Rollen, OAuth oder MFA.

### P03 – Testsystem vervollständigen und CI-Qualitätsgates

**Ziel:** Der in P02 begonnene Worker-Testaufbau wird zu einem vollständigen, produktionsnahen Prüfsystem für alle weiteren Phasen ausgebaut.

**Scope:**

- Vitest 4 und `@cloudflare/vitest-plugin` konsolidieren
- React Testing Library
- Playwright-Grundkonfiguration
- Worker-Test mit lokalen D1-/R2-Bindings
- minimale Client- und E2E-Smoke-Tests
- CI für Format, Lint, Typen, Tests und Produktionsbuild

**Akzeptanzkriterien:**

- `npm test` läuft reproduzierbar in der Workers-Laufzeit.
- ein Test liest/schreibt die lokalen Test-Bindings isoliert.
- ein Browser-Smoke-Test lädt die App.
- sämtliche CI-Gates laufen lokal und in CI erfolgreich.

**Nicht Teil dieser Phase:** fachliche Testfälle späterer Features.

### P04 – D1-Schema und Migrationen

**Ziel:** Das freigegebene relationale Datenmodell ist lokal und remote reproduzierbar.

**Scope:**

- Drizzle ORM und Drizzle Kit
- Tabellen `pages`, `assets`, `page_assets` und `page_links`
- Indizes, Foreign Keys und Constraints aus `TECHNICAL_SPEC.md`
- FTS5-Tabelle und Synchronisationstrigger als Custom SQL
- lokale und Remote-Migrationsskripte
- Fixtures für Tests

**Akzeptanzkriterien:**

- eine leere lokale D1 wird vollständig migriert.
- eine zweite Ausführung ist ohne Schemafehler möglich.
- Foreign-Key- und FTS-Integrity-Tests bestehen.
- Drizzle-Typen stimmen mit den normalen SQL-Tabellen überein.

**Nicht Teil dieser Phase:** API und UI.

### P05 – Pages Domain und HTTP-API

**Ziel:** Seiten können über die spezifizierte API sicher verwaltet werden.

**Scope:**

- Repositories und Services für Pages
- Zod-Verträge unter `src/shared/`
- Listen, Erstellen, Laden, Metadatenänderung, Inhaltsänderung und Soft Delete
- eindeutige Slugs
- serverseitige Plaintext-Ableitung
- optimistische Revisionen und `409 PAGE_CONFLICT`
- Größenlimits und standardisierte Fehler

**Akzeptanzkriterien:**

- Page CRUD ist durch Worker-Integrationstests abgedeckt.
- veraltete Revisionen überschreiben keine Daten.
- ungültiges Tiptap JSON und zu große Inhalte werden verständlich abgewiesen.
- gelöschte Seiten fehlen in normalen Listen und Details.

**Nicht Teil dieser Phase:** Seitenbaum-UI, vollständiger Editor, Move-API.

### P06 – App-Shell, Sidebar und Page CRUD

**Ziel:** Das grundlegende Wiki ist ohne Rich-Text-Editor im Browser bedienbar.

**Scope:**

- React Router und kanonische Page-URLs
- App-Shell und Sidebar
- Seitenliste laden
- Seite erstellen, auswählen, umbenennen und löschen
- verständliche Loading-, Empty- und Error-States
- einfacher Text-/JSON-Platzhalter für Inhalt, kein Tiptap

**Akzeptanzkriterien:**

- der vollständige CRUD-Ablauf funktioniert im Browser.
- Navigation verursacht keinen Full Reload.
- die aktuelle Seite bleibt über Reload adressierbar.
- Client- und E2E-Tests decken den Kernablauf ab.

**Nicht Teil dieser Phase:** Drag & Drop im Baum, Tiptap, Autosave.

### P07 – Seitenhierarchie und Sortierung

**Ziel:** Seiten bilden einen robusten, bedienbaren Baum.

**Scope:**

- Move-API und Zyklusprüfung
- lückenlose Geschwisterpositionen
- einklappbarer Seitenbaum
- Create Child
- Inline Rename
- Drag & Drop für Hierarchie und Reihenfolge

**Akzeptanzkriterien:**

- Seiten lassen sich vor, nach und in andere Seiten verschieben.
- Selbst- und Nachfahrenzyklen werden serverseitig verhindert.
- Reihenfolge bleibt nach Reload stabil.
- Tastaturzugang besitzt eine nutzbare Alternative zum Pointer-Drop.

**Nicht Teil dieser Phase:** Wiki Links und Suche.

### P08 – Tiptap-Grundeditor

**Ziel:** Seiten können mit dem festgelegten WYSIWYG-Grundumfang bearbeitet werden.

**Scope:**

- Tiptap 3 und Extension-Allowlist
- Überschriften, Marks, Listen, Checklisten, Quote, Divider, Links und Codeblöcke
- Placeholder und Editor-Toolbar
- Laden und lokales Bearbeiten von `content_json`
- dokumentnahe Komponentenstruktur

**Akzeptanzkriterien:**

- erlaubte Formatierungen über Tastatur und UI funktionieren.
- vorhandenes JSON wird verlustfrei geladen und wieder serialisiert.
- unbekannte Nodes führen nicht zu Script-/HTML-Ausführung.
- grundlegende Tastatur- und Fokusbedienung ist getestet.

**Nicht Teil dieser Phase:** Autosave, Bilder, Wiki Links, Slash Commands.

### P09 – Inhaltsableitungen und Markdown

**Ziel:** Aus dem kanonischen Editorformat entstehen deterministische Such- und Exportrepräsentationen.

**Scope:**

- serverseitige Tiptap-Schema-Validierung vervollständigen
- deterministische `content_text`-Ableitung
- Tiptap-zu-Markdown-Konverter für alle bisher erlaubten Nodes
- Roundtrip-/Snapshot-Tests
- keine Speicherung von `content_markdown`

**Akzeptanzkriterien:**

- gleiche Eingabe erzeugt immer identischen Plaintext und Markdown.
- Listen, Tasks, Links und Codeblöcke bleiben semantisch erhalten.
- schädliche oder unbekannte Strukturen werden abgewiesen.

**Nicht Teil dieser Phase:** ZIP-Export und Asset-Umschreibung.

### P10 – Autosave, Konflikte und Draft Recovery

**Ziel:** Schreiben funktioniert ohne Speichern-Knopf und ohne stillen Datenverlust.

**Scope:**

- Autosave-Zustandsautomat und 750-ms-Debounce
- genau ein laufender Save pro Seite
- Retry mit Backoff für transiente Fehler
- sichtbare Saving-/Saved-/Failed-/Conflict-States
- `409`-Konfliktoberfläche
- IndexedDB-Drafts und Recovery nach Reload
- Warnung bei unbestätigten Änderungen

**Akzeptanzkriterien:**

- schnelles Tippen verliert keine Zwischenänderung.
- Netzwerkfehler können automatisch und manuell wiederholt werden.
- zwei Tabs überschreiben einander nicht unbemerkt.
- ein Reload mit unbestätigtem Draft bietet Wiederherstellung an.

**Nicht Teil dieser Phase:** echtes Offline Editing oder automatisches Merge.

### P11 – R2 Asset API

**Ziel:** Dateien können sicher in R2 gespeichert und authentifiziert ausgeliefert werden.

**Scope:**

- Streaming-Upload bis 25 MiB
- serverseitige Dateinamen-, Größen-, MIME- und Magic-Byte-Prüfung
- UUID-basierte R2-Keys
- D1-Metadaten und Rollback bei Teilfehlern
- Metadaten-, Content- und Soft-Delete-Endpunkte
- ETag, Conditional Requests, Range und sichere Content-Disposition

**Akzeptanzkriterien:**

- erlaubte Dateien überstehen Upload und Download bytegenau.
- zu große, SVG-/HTML- und falsch deklarierte Dateien werden abgewiesen.
- R2-Objekte besitzen keine öffentliche URL.
- Teilfehler hinterlassen keinen bekannten permanenten inkonsistenten Zustand.

**Nicht Teil dieser Phase:** Editorintegration und physische Garbage Collection.

### P12 – Screenshot Paste und Drag & Drop

**Ziel:** Der zentrale Dovari-Workflow funktioniert im Editor.

**Scope:**

- Tiptap FileHandler für Paste und Drop
- gemeinsame Client-Uploadpipeline
- Upload-Decorations mit Progress, Retry und Remove
- maximal drei parallele Uploads pro Tab
- eigene `assetImage`- und `attachment`-Nodes mit `assetId`
- positionsstabile Einfügung nach asynchronem Upload

**Akzeptanzkriterien:**

- Screenshot erstellen und `Ctrl+V` fügt genau ein Bild ein.
- Drop fügt das Asset an der Zielposition ein.
- Reload zeigt erfolgreiche Bilder über die persistierte Asset-ID.
- Blob-URLs und temporärer Uploadstatus landen nie im gespeicherten JSON.
- Fehler können ohne Inhaltsverlust erneut versucht werden.

**Nicht Teil dieser Phase:** Thumbnails, Bildbearbeitung und Multipart Uploads.

### P13 – Asset-Referenzen und robuste Fehlerpfade

**Ziel:** Dokumente und Assets bleiben bei Änderungen, Export und Fehlern konsistent.

**Scope:**

- `page_assets` beim Speichern atomar ableiten
- entfernte Assets als unreferenziert erkennen, aber nicht physisch löschen
- kaputte oder gelöschte Asset-Referenzen verständlich darstellen
- Upload-/Save-Rennen und Seitenwechsel testen
- Grundlage für spätere Garbage Collection

**Akzeptanzkriterien:**

- Referenztabelle entspricht nach jedem bestätigten Save dem Dokument.
- Entfernen eines Bildes löscht nicht sofort das R2-Objekt.
- fehlende Assets zerstören weder Editor noch Exportvorbereitung.
- kritische Race Conditions besitzen Integration- oder E2E-Tests.

**Nicht Teil dieser Phase:** zeitgesteuerte Garbage Collection.

### P14 – D1 FTS5 und Search API

**Ziel:** Titel und Seiteninhalt werden schnell und sicher gefunden.

**Scope:**

- sichere Tokenisierung und Escaping der Nutzereingabe
- Prefixsuche für das letzte Token
- BM25-Ranking mit Titelgewichtung
- Snippets und Breadcrumb-Daten
- Limitierung und leere Suchzustände
- FTS-Rebuild-/Integrity-Werkzeug

**Akzeptanzkriterien:**

- Insert, Update, Rename und Soft Delete erscheinen korrekt in der Suche.
- Sonderzeichen und FTS-Operatoren verursachen keine SQL-/Syntaxfehler.
- Titeltreffer werden nachvollziehbar bevorzugt.
- typische lokale Suchanfragen erfüllen das Ziel von deutlich unter 100 ms Datenbankzeit.

**Nicht Teil dieser Phase:** Fuzzy oder semantische Suche und Attachment-OCR.

### P15 – Command Palette und Tastenkürzel

**Ziel:** `Ctrl/Cmd+K` ist der schnelle Einstieg für Suche und Navigation.

**Scope:**

- zugänglicher Command-Dialog
- debounced Search-API-Aufrufe
- Tastaturnavigation und Ergebnisöffnung
- Aktionen für neue Seite, Theme und Einstellungen-Platzhalter
- `Ctrl/Cmd+N` für neue Seite

**Akzeptanzkriterien:**

- Palette öffnet plattformgerecht und schließt zuverlässig.
- Suche und Navigation sind vollständig per Tastatur möglich.
- veraltete Netzwerkantworten überschreiben keine neueren Ergebnisse.
- Fokus wird nach dem Schließen sinnvoll wiederhergestellt.

**Nicht Teil dieser Phase:** komplexes Command- oder Plugin-System.

### P16 – Wiki Links und Backlinks

**Ziel:** Seiten können direkt im Editor miteinander verknüpft werden.

**Scope:**

- eigener Wiki-Link-Node
- `[[`-Autocomplete
- vorhandene Seite auswählen oder neue Seite erstellen
- `page_links` atomar aus gespeichertem Inhalt ableiten
- Navigation über Wiki Links
- einfache Backlink-Anzeige

**Akzeptanzkriterien:**

- Wiki Links bleiben bei Umbenennung über die Page-ID stabil.
- ungelöste Links sind sichtbar und können eine Seite erzeugen.
- Backlinks entsprechen nach Änderungen dem gespeicherten Dokument.
- Tastaturbedienung des Autocomplete ist getestet.

**Nicht Teil dieser Phase:** Transclusion oder Graph View.

### P17 – Markdown- und ZIP-Export

**Ziel:** Nutzer können ihre vollständige Knowledge Base in einem offenen Format mitnehmen.

**Scope:**

- deterministische Ordner- und Dateinamen
- Markdown für alle Seiten
- lokale Wiki- und Asset-Links
- Assets aus R2 in ein ZIP streamen
- manifestierte Exportmetadaten
- verständlicher Download- und Fehlerzustand

**Akzeptanzkriterien:**

- ein Export enthält jede aktive Seite und jedes referenzierte Asset.
- Markdown-Links funktionieren nach dem Entpacken lokal.
- Dateinamenskollisionen werden deterministisch gelöst.
- ein Import ist nicht nötig, um die Daten manuell lesen zu können.

**Nicht Teil dieser Phase:** Import, geplante Backups und inkrementelle Exporte.

### P18 – Responsive UI, Dark Mode und Accessibility

**Ziel:** Der vollständige MVP ist auf Desktop und Mobile konsistent und zugänglich.

**Scope:**

- Light, Dark und System Theme
- mobile Sidebar als Drawer
- Fokuszustände, ARIA-Namen und Kontrastprüfung
- Skip Links und logische Tab-Reihenfolge
- Reduced-Motion-Verhalten
- finale Empty-, Loading- und Error-States

**Akzeptanzkriterien:**

- Kernabläufe funktionieren bei Desktop- und Smartphone-Breite.
- automatische Accessibility-Prüfungen melden keine kritischen Fehler.
- alle interaktiven Kernfunktionen sind per Tastatur erreichbar.
- Theme bleibt über Reload stabil und respektiert das System.

**Nicht Teil dieser Phase:** native App oder vollwertige mobile Editing-Optimierung.

### P19 – Dokumentnahe Editoroberfläche

**Ziel:** Eine geöffnete Seite fühlt sich ohne sichtbaren Moduswechsel wie ein großzügiges,
unmittelbar bearbeitbares Dokument an.

**Scope:**

- Seitenlayout und Content-Spalte nutzen den verfügbaren App-Bereich besser, bei weiterhin
  lesbarer maximaler Textzeilenlänge
- Seitentitel dokumentnah direkt bearbeiten und über die vorhandene revisionsgeschützte API
  speichern
- „Page“-, „Content“- und „Write in context.“-Zwischenebenen sowie die prominente Slug-Anzeige
  aus dem normalen Schreibfluss entfernen
- Editorrahmen, Kartenwirkung und unnötige Abstände zugunsten einer zusammenhängenden
  Dokumentfläche reduzieren
- Toolbar, Save-Status und Seitenaktionen kompakt integrieren; Delete bleibt bewusst bestätigt
  und Recovery-, Save-Fehler- sowie Konfliktzustände bleiben prominent
- Tiptap-Dokument-JSON aus der normalen UI entfernen
- Backlinks visuell nachordnen, ohne Navigation oder Lade-/Fehlerzustände zu verlieren
- responsive, Tastatur-, Fokus- und Accessibility-Tests für die neue Seitenoberfläche

**Akzeptanzkriterien:**

- nach dem Laden kann ohne Aktivierung eines Edit-Modus unmittelbar in Titel oder Inhalt
  geschrieben werden.
- Titeländerungen bleiben nach Reload erhalten; Inhalts-Autosave, Draft Recovery und Konflikte
  funktionieren unverändert.
- bei Desktopbreite steht dem Dokument sichtbar mehr Raum als die bisherige 820-Pixel-Seitenkarte
  zur Verfügung; auf Smartphonebreite nutzt es die verfügbare Breite ohne horizontales Scrollen.
- im normalen Erfolgszustand erscheinen weder die Texte „Content“ und „Write in context.“ noch
  Editor-Kartenrahmen oder Dokument-JSON.
- Toolbar, Save-Zustand, Rename-Fallback, Delete und Backlinks sind per Maus und Tastatur
  erreichbar; automatische Accessibility-Prüfungen melden keine kritischen Fehler.
- bestehende Editor-, Autosave-, Asset- und Wiki-Link-Tests bleiben grün.

**Nicht Teil dieser Phase:** Autolink und neue Link-Picker aus P20, Slash Commands, Block-Drag-
Handles, Tabellen, API- oder Datenmodelländerungen.

### P20 – Link-Erlebnis und Wiki-Link-Auffindbarkeit

**Ziel:** Externe URLs und interne Seitenlinks lassen sich ohne Vorwissen erstellen, erkennen,
bearbeiten und öffnen.

**Scope:**

- erlaubte `http`-, `https`- und E-Mail-Adressen beim Tippen nach einem Abschlusszeichen sowie
  beim Einfügen automatisch als Link markieren
- bestehende URL-Allowlist auch für Autolink verwenden; unsichere Schemes und Kontrollzeichen
  weiterhin ablehnen
- fokussiertes Link-Popover mit Zielanzeige sowie Aktionen für Öffnen, Bearbeiten und Entfernen
- externe Ziele sicher mit `noopener`/`noreferrer` öffnen, ohne die normale Cursorplatzierung im
  editierbaren Text unbrauchbar zu machen
- sichtbarer, beschrifteter „Wiki link“-Einstieg in der Editor-Toolbar
- gemeinsamer Wiki-Link-Picker für Toolbar und vorhandenes `[[`-Autocomplete mit Suche,
  Tastaturnavigation, Auswahl und optionaler Seitenerstellung
- kurze kontextuelle Hilfe zur `[[`-Syntax im Wiki-Link-Picker
- fokussierte Unit-/Komponententests und Browser-E2E für Tippen, Paste, Öffnen und interne
  Navigation per Maus und Tastatur

**Akzeptanzkriterien:**

- `http://example.com` und `https://example.com` werden nach Tippen oder Paste ohne Toolbar-Schritt
  zu gespeicherten, nach Reload weiterhin anklickbaren Links.
- unsichere oder nicht erlaubte Ziele werden weder automatisch noch manuell als Link gespeichert.
- ein normaler Link kann im Editor geöffnet, geändert und entfernt werden; Tastaturnutzer
  erreichen dieselben Aktionen.
- eine Person ohne Kenntnis der `[[`-Syntax kann über den sichtbaren Toolbar-Einstieg eine
  vorhandene Wiki-Seite suchen und verlinken oder eine neue Zielseite erstellen.
- `[[` plus Enter funktioniert weiterhin, Wiki-Links navigieren über stabile Page-IDs und
  `page_links`/Backlinks bleiben nach Autosave korrekt.
- Link-Erstellung, Popover und Picker funktionieren bei Desktop- und Smartphonebreite ohne
  kritische Accessibility-Fehler.

**Nicht Teil dieser Phase:** Vorschaukarten, Link-Metadatenabruf, Transclusion, Graph View oder
automatische Seitenerstellung allein durch ausgeschriebene `[[Titel]]`-Texte ohne Auswahl.

### P21 – Papierkorb und Versionshistorie

**Ziel:** Versehentlich gelöschte oder überschriebene Inhalte lassen sich ohne Datenbankzugriff
sicher wiederherstellen.

**Scope:**

- Migration und Drizzle-Schema für `page_revisions` exakt nach `TECHNICAL_SPEC.md` § 6.5
- atomarer Snapshot des vorherigen Titel-/Inhaltsstands vor der ersten erfolgreichen Mutation
  eines Zehn-Minuten-Fensters sowie garantiert vor Delete und Revisions-Restore
- Retention der 50 jüngsten Snapshots pro Seite ohne Snapshots fehlgeschlagener oder
  konfliktbehafteter Mutationen
- cursorbasierte Trash-, Revisionslisten- und Revisionsdetail-APIs sowie Restore- und
  Permanent-Delete-APIs aus § 7.5 mit gemeinsamen Zod-Verträgen
- Revisions-Restore als neue aktuelle Revision mit erneuter Dokumentvalidierung und atomarer
  Synchronisation von Plaintext, FTS, `page_assets` und `page_links`
- Trash-Restore zum aktiven früheren Parent oder andernfalls ans Ende der Root-Ebene, jeweils mit
  normalisierten Geschwisterpositionen
- permanentes Löschen nur für bereits gelöschte Seiten mit aktueller `baseRevision` und exakter
  Titelbestätigung; R2-Objekte bleiben erhalten
- minimale `/app/settings/trash`-Oberfläche, Seitenmenü für Delete und Version History,
  Revisionsvorschau, Restore-Aktionen und unmittelbares Undo nach Soft Delete
- verständliche Lade-, Leer-, Konflikt- und Fehlerzustände sowie Tastatur- und Fokusführung

**Akzeptanzkriterien:**

- gelöschte Seiten fehlen weiterhin in Baum, Suche und Wiki-Link-Picker, erscheinen aber im Trash.
- Restore erhält die Seite samt Inhalt; fehlt der frühere Parent, wird sie als Root-Seite sichtbar.
- ein wiederhergestellter Snapshot wird als neue höhere Revision gespeichert und erzeugt korrekte
  Asset-, Link- und Suchableitungen.
- pro Seite existieren höchstens 50 Snapshots; ein Konflikt verändert weder Seite noch Historie.
- dauerhaftes Löschen ist außerhalb des Trash und ohne passende Revision plus Titel unmöglich;
  abhängige D1-Datensätze verschwinden, R2-Objekte nicht.
- Delete, Undo, Trash und History sind auf Desktop und Smartphone per Maus und Tastatur bedienbar.

**Verifikation:**

- Schema-/Migrationstest einschließlich Foreign Keys und FTS nach Delete/Restore
- Worker-Integrationstests für Zeitfenster, Retention, alle Konflikte, Parent-Fallback,
  Referenzableitung und Permanent Delete
- Clienttests für Menü, Undo, Trash, Vorschau, Restore und Fehlerzustände
- Browser-E2E für Delete → Undo, Delete → Trash → Restore und Revision → Restore einschließlich Axe
- vollständiges `npm run ci`, `npm run test:e2e` und `git diff --check`

**Nicht Teil dieser Phase:** Dovari-Backup, Restore einer Installation, Asset-Garbage-Collection,
automatische zeitgesteuerte Snapshots ohne Mutation oder eine Diff-Ansicht zwischen Revisionen.

### P22 – Verlustfreies Backup und Restore

**Ziel:** Eine leere Dovari-Installation kann aus einem geprüften eigenen Backup ohne Verlust von
Inhalt, Hierarchie, Historie, Wiki-Links oder Assets wiederhergestellt werden.

**Scope:**

- separates, versioniertes `dovari-backup-v1.zip` nach `TECHNICAL_SPEC.md` § 6.6; der vorhandene
  menschenlesbare Markdown-Export bleibt unverändert erhalten
- `backup.json` mit aktiven und gelöschten Pages, stabilen IDs, Tiptap-JSON, Hierarchie,
  Positionen, Revisionen, Zeitstempeln, `page_revisions` und allen Asset-Metadaten einschließlich
  unreferenzierter oder soft-gelöschter Assets
- Streaming der Asset-Dateien mit kanonischen ZIP-Pfaden, Byte-Größen und SHA-256-Prüfsummen;
  unvollständige oder abweichende R2-Objekte verhindern ein vollständiges Backup
- Migration und Repository-/Service-Schicht für `restore_sessions`, `restore_session_records` und
  `restore_session_assets`
- private Backup- und Restore-Session-APIs aus § 7.5 einschließlich idempotenter Record-/Asset-
  Uploads, Statusabfrage, Finalisierung und Abbruch
- Restore ausschließlich in einen leeren Workspace; erneute Empty-Workspace-Prüfung direkt vor
  dem Commit und höchstens eine aktive Session
- lokale ZIP-Validierung im Browser, einzelne Uploads mit Fortschritt, Wiederaufnahme und bewusstem
  Abbruch; keine vollständige Archivpufferung im Worker
- serverseitige Validierung aller Records, Referenzen, Größen, MIME-Typen, Pfade und Prüfsummen;
  produktive D1-Daten erst nach erfolgreichen R2-Kopien atomar anlegen
- Backup-/Restore-Bedienung zunächst im mit P21 eingeführten Settings-Bereich

**Akzeptanzkriterien:**

- ein vollständiges Backup enthält weder Secrets noch Cloudflare-Konfiguration und ist durch
  Format- und Versionsfelder eindeutig erkennbar.
- fehlende oder veränderte Assets führen vor dem Download zu `BACKUP_INCOMPLETE`.
- wiederholte identische Uploads setzen eine Session fort; abweichende Records oder Prüfsummen
  werden abgelehnt.
- Finalisierung in einem nicht leeren Workspace oder mit fehlenden Records/Assets verändert keine
  produktiven Daten.
- nach erfolgreichem Roundtrip stimmen Page-/Asset-IDs, Inhalte, Hierarchie, Papierkorb,
  Revisionen, Wiki-Links, FTS-Treffer und Asset-Prüfsummen mit der Quelle überein.
- Abbruch entfernt ausschließlich Sessiondaten und zugehörige temporäre R2-Objekte.

**Verifikation:**

- Unit-Tests für Manifest, kanonisches JSON, ZIP-Pfade und Prüfsummen
- Worker-Integrationstests für Session-Lebenszyklus, Idempotenz, Auth-/Origin-Grenzen, Empty-
  Workspace-Rennen, unvollständige Finalisierung und Rollback
- Clienttests für Auswahl, Validierung, Fortschritt, Reload-Wiederaufnahme und Abbruch
- E2E-Roundtrip in eine zweite leere lokale Installation mit Seiten, Hierarchie, gelöschter Seite,
  Revision, Wiki-Link, Bild und Attachment
- vollständiges `npm run ci`, `npm run test:e2e` und `git diff --check`

**Nicht Teil dieser Phase:** Markdown-/ZIP-/Obsidian-Fremdimport, Merge in einen nicht leeren
Workspace, automatische Backups, Cloudflare-Konfigurationsbackup oder Asset-Garbage-Collection.

### P23 – Settings, Slash Commands und Alltagsnavigation

**Ziel:** Die tägliche Bedienung wirkt vollständig und schnell, ohne den kleinen Produktkern mit
zusätzlichen Organisationssystemen zu überladen.

**Scope:**

- vollständige `/app/settings`-Route statt des P15-Platzhalters mit Navigation zu Theme, Trash,
  Versionszugriff, Backup und Restore; bestehende Theme-Persistenz bleibt maßgeblich
- Command-Palette-Aktion „Go to settings“ öffnet die reale Settings-Route
- Sidebar-Abschnitt mit höchstens fünf aktiven, nach `updatedAt` sortierten zuletzt bearbeiteten
  Seiten aus den vorhandenen Metadaten, ohne Duplikat der aktuell geöffneten Seite
- Slash-Command-Palette in einem leeren Absatz mit Filterung, Pfeiltasten, Enter und Escape für
  Text, Heading 1–3, Bullet List, Ordered List, Checklist, Quote, Inline Code, Code Block, Divider,
  Wiki Link, Image und File
- Wiki Link verwendet den bestehenden Picker; Image und File verwenden die bestehende Upload-
  Pipeline samt Parallelitätsgrenze, Progress, Retry und Remove
- sichtbare Toolbar als zugänglicher Fallback beibehalten und destruktive Seitenaktionen im
  Seitenmenü belassen
- README-Aussagen zum bereits vorhandenen Editor- und Browserworkflow aktualisieren; vollständige
  Produktions- und Installationsanleitung bleibt P24

**Akzeptanzkriterien:**

- Settings ist direkt, über Command Palette und auf Smartphonebreite erreichbar; keine Aktion ist
  mehr als „später verfügbar“ gekennzeichnet.
- Recent Pages aktualisiert sich nach Titel- oder Content-Save, zeigt nur aktive Seiten und öffnet
  stabile Page-ID-URLs.
- alle Slash Commands erzeugen ausschließlich bereits erlaubte Tiptap-Nodes beziehungsweise öffnen
  die bestehenden Wiki-/Asset-Abläufe.
- Escape hinterlässt das Dokument unverändert; erfolgreicher Befehl entfernt den Slash-Querytext.
- Toolbar, Autosave, Draft Recovery, Link-Picker und Uploads funktionieren unverändert.

**Verifikation:**

- Clienttests für Settings-Routing, Recent-Sortierung/-Filterung und alle Slash-Command-Zustände
- bestehende Editor- und Uploadtests plus fokussierte Tests für Wiki-, Bild- und Datei-Kommandos
- Browser-E2E für Settings, Recent Pages und Slash Commands auf Desktop/Mobile einschließlich Axe
- vollständiges `npm run ci`, `npm run test:e2e` und `git diff --check`

**Nicht Teil dieser Phase:** Tags, Favoriten, Tabellen, Templates, Daily Notes, Graph View,
Block-Drag-Handles oder neue persistierte Editor-Nodes.

### P24 – Deploy-to-Cloudflare und Version-1-Abnahme

**Ziel:** Eine neue Person kann die vertrauenswürdige Dovari-Version 1 aus dem öffentlichen
Repository sicher installieren und die vollständigen Kern- und Recovery-Abläufe verwenden.

**Scope:**

- finaler Deploy-Button
- automatische D1-/R2-Provisionierung und Migration im Deploy-Skript
- vollständige README für lokale Entwicklung und Produktion
- Instanz-Passwort im Deploy-Dialog sowie integrierte Login-/Session-Schicht
- Custom-Domain-Hinweise
- frischer Installations-Smoke-Test einschließlich aller committed Migrationen
- vollständiger kritischer E2E-Durchlauf aus `PLAN.md`, erweitert um Trash, Revisionen, Settings,
  Slash Commands und Backup-Roundtrip

**Akzeptanzkriterien:**

- Installation aus einem frischen Cloudflare-Account ist dokumentiert und getestet.
- ohne gültige Passwortkonfiguration bleiben alle privaten Pfade und Schreiboperationen fail-closed.
- nach Setup funktionieren Create, dokumentnahes Editieren, Autolink, Wiki Link, Screenshot Paste,
  Autosave, Search, Export, Trash, Revision-Restore, Settings und Slash Commands.
- ein erzeugtes Dovari-Backup lässt sich in einer zweiten leeren Installation vollständig
  wiederherstellen und anhand der P22-Kriterien vergleichen.
- alle CI-Gates und kritischen E2E-Tests sind grün; bekannte Einschränkungen sind dokumentiert.

**Verifikation:**

- frischer Checkout und Installation mit den dokumentierten Mindestversionen
- Wrangler-Dry-Run sowie tatsächlicher Test-Deploy in einen frischen Cloudflare-Testaccount
- Fail-Closed-Prüfung ohne Session und vollständiger Passwort-Smoke danach
- vollständiges `npm run ci`, kritisches `npm run test:e2e` und `git diff --check`

**Nicht Teil dieser Phase:** Funktionen aus „Nicht Teil des MVP“ in `PLAN.md`, öffentliche Seiten
oder die automatische Migration bestehender Fremdsysteme.

### P25 – Öffentliche Knowledge Base und Veröffentlichungen

**Ziel:** Ohne Anmeldung ist unter `/` eine vollständige, schreibgeschützte Knowledge Base aus
allen bewusst veröffentlichten Seiten sichtbar. Erst der Wechsel zu „Bearbeiten“ öffnet die
Passwort-Anmeldung und danach den geschützten Workspace, in dem zusätzlich Entwürfe und
unveröffentlichte Seiten sichtbar sind.

**Scope:**

- Tabellen `page_publications` und `publication_assets` als neue Migration; genau eine aktive
  Publication pro Seite, zufällige stabile `public_id` bei erneutem Publish und eine neue URL nach
  Unpublish und späterer Neuveröffentlichung
- private Publish-/Freigabeeinstellungs- und Unpublish-Endpunkte ausschließlich unter
  `/api/private/*`, mit optimistischer Prüfung der Seitenrevision beziehungsweise des erwarteten
  Publication-Zeitstempels; bestehende Publications werden nach erfolgreicher Titel-, Inhalts- oder
  Revisionsänderung automatisch synchronisiert, neu angelegte oder verschobene Unterseiten erben
  die Veröffentlichung eines veröffentlichten Vorfahren
- expliziter, serverseitig validierter und bereinigter Snapshot aus Titel und Tiptap-Dokument statt
  Live-Zugriff auf `pages`; Wiki Links werden nur auf bereits veröffentlichte Ziele umgeschrieben,
  sonst zu normalem Text ohne private Ziel-ID
- `/` wird eine öffentliche Landingpage mit allen aktiven Publications; die Public-API ist
  cursorbasiert und liefert ausschließlich `publicId`, veröffentlichten Titel sowie öffentliche
  Zeitstempel, nie private Page-IDs, Slugs, Parent-IDs, Revisionen oder Backlinks
- öffentliche, responsive Read-only-Seite unter `/p/:publicId` mit Navigation durch die komplette
  Liste veröffentlichter Seiten, verständlichen Empty-/404-/Fehlerzuständen und ohne Editor- oder
  Mutationsbedienung
- sichtbarer „Bearbeiten“-Einstieg über eine private `/app/publications/:publicId/edit`-Route; erst
  nach Passwort-Anmeldung wird die Publication serverseitig zur privaten Seite aufgelöst und der
  normale Editor geöffnet
- strikt getrennte Public-Read-Router unter `/api/public/*`; ausschließlich `GET`, `HEAD` und
  erforderliche `OPTIONS`, alle Mutationen liefern `405`
- öffentliche Asset-Auslieferung nur mit Kombination aus gültiger Publication und tatsächlich im
  Snapshot referenziertem Asset; private Asset-Endpunkte und R2 bleiben unverändert geschützt
- Publish-Bedienung in der privaten Seitenansicht mit Status „nicht veröffentlicht“/„wird
  synchronisiert“/„aktuell“, URL kopieren, Sharing-Einstellungen, öffentlich öffnen und bestätigtem
  Unpublish; ein manuelles Aktualisieren der Publication ist nicht erforderlich
- standardmäßig `noindex`; die bereits vorgesehene Option `allow_indexing` wird gespeichert und in
  der öffentlichen Antwort berücksichtigt, die vollständige Crawler-/Metadaten-Unterstützung folgt
  in P26
- Public-Listen, -Details und -Assets verwenden in P25 `Cache-Control: no-store`, damit automatische
  Snapshot-Synchronisierung und Unpublish ohne veraltete Edge-/Browserantworten wirksam werden;
  gezieltes Caching folgt P26
- Backupformat `dovari-backup-v2` einschließlich Publications und Publication-Asset-Zuordnung;
  Restore akzeptiert weiterhin v1, erweitert Restore-Sessions migrationssicher um Publication-
  Records und erhält bei v2 die öffentlichen URLs verlustfrei
- Soft Delete einer privaten Seite entfernt ihre aktive Publication im selben atomaren Vorgang;
  Restore der Seite veröffentlicht sie nicht automatisch erneut
- vollständige Private-/Public-Routing-, Datenleck-, Cache-, Accessibility- und
  Snapshot-Isolations-Tests

**Akzeptanzkriterien:**

- `GET /` und jede gültige `/p/:publicId`-URL funktionieren in Produktion ohne Dovari-Session und
  zeigen ausschließlich aktive Veröffentlichungen; bei null Publications erklärt `/` den leeren
  öffentlichen Zustand und bietet nur den geschützten Bearbeiten-Einstieg an.
- alle veröffentlichten Seiten sind von der öffentlichen Navigation aus erreichbar; Titel oder
  Existenz unveröffentlichter Seiten lassen sich dort und über API-Fehler nicht ableiten.
- nur ein berechtigter Editor kann veröffentlichen, aktualisieren oder zurückziehen; der
  Bearbeiten-Link löst ohne Session die normale Dovari-Passwort-Anmeldung aus.
- private Titel-, Wiki-Link-, Inhalts- und Asset-Änderungen einer bereits veröffentlichten Seite
  werden nach erfolgreichem Save automatisch im bestehenden öffentlichen Snapshot sichtbar; der
  Snapshot bleibt weiterhin von Live-Zugriffen auf private Seitendaten isoliert.
- Public JSON und öffentlich gerendertes HTML enthalten keine private Page-ID, Parent-ID, Revision,
  Backlinks, unveröffentlichte Linkziele oder nicht referenzierte Asset-Metadaten.
- `POST`, `PUT`, `PATCH` und `DELETE` unter `/api/public/*` liefern immer `405`; private
  Mutationsendpunkte bleiben ohne gültige Passwort-Session fail-closed.
- Unpublish macht Snapshot und zugehörige öffentliche Asset-Routen unmittelbar unerreichbar und
  entfernt die Seite aus `/`; ein anschließendes neues Publish verwendet eine neue öffentliche URL.
- Soft Delete hat denselben unmittelbaren öffentlichen Rückzugseffekt; Restore stellt nur die
  private Seite wieder her. Ein Unpublish aus einem veralteten Tab löscht keine zwischenzeitlich
  erneuerte Publication.
- ein v2-Backup/Restore erhält aktive Publications, Snapshot-Inhalte und öffentliche IDs; v1-Backups
  bleiben importierbar.
- alle bisherigen privaten Authentifizierungs-, Editor-, Export- und Recovery-Abläufe bleiben
  unverändert geschützt.

**Verifikation:**

- Schema-/Migrationstests für Publication-Snapshots, Eindeutigkeit und referenzierte Assets
- Worker-Integrationstests der vollständigen Private-/Public-Routing-, Auth-, Method-,
  Snapshot-, Cache- und Asset-Matrix einschließlich negativer Enumerationstests
- Backup-v1-Kompatibilitäts- und Backup-v2-Roundtrip-Tests
- Clienttests für Public Landing, Read-only-Renderer, Publish-Zustände und privaten Edit-Resolver
- Browser-E2E ohne Login für Landing/Leseseite sowie mit lokalem Auth-Bypass für initiales Publish,
  automatische Inhalts-/Titel-Synchronisierung, unveröffentlichten Draft, Bearbeiten-Einstieg und
  Unpublish; Desktop/Mobile-Axe
- vollständiges `npm run ci`, `npm run test:e2e` und `git diff --check`

**Nicht Teil dieser Phase:** öffentliche Volltextsuche, SEO-/Open-Graph-Metadaten, Sitemap,
öffentliche Hierarchie, öffentliche Bearbeitung, Kommentare, Teams, Rollen, Custom Sharing ACLs
oder passwortgeschützte Links.

### P26 – Öffentliche Suche, Navigation und Auffindbarkeit

**Ziel:** Eine größere öffentliche Knowledge Base lässt sich schnell durchsuchen, sinnvoll
navigieren und – nur nach ausdrücklicher Freigabe – von Suchmaschinen korrekt erfassen.

**Scope:**

- separater öffentlicher Suchindex ausschließlich aus Publication-Snapshots; keine Abfrage oder
  Filterung des privaten FTS-Indexes
- Suche auf `/` und der öffentlichen Seitenleiste mit Titelgewichtung, Snippets und Tastaturbedienung
- öffentliche Hierarchie ausschließlich aus veröffentlichten Beziehungen; unveröffentlichte
  Zwischeneltern werden übersprungen und niemals namentlich offengelegt
- kanonische URLs, sichere serverseitige Title-/Description-/Open-Graph-Metadaten für `/p/*`
- `robots.txt` und `sitemap.xml` enthalten nur Publications mit `allow_indexing = true`
- Cache-Strategie mit sofortiger Invalidierung bei automatischer Snapshot-Synchronisierung und
  Unpublish

**Akzeptanzkriterien:** Öffentliche Suche, Navigation, Sitemap und Metadaten verwenden nachweislich
nur Snapshotdaten; `noindex` ist der Default; Unpublish verschwindet unmittelbar aus Suche,
Navigation und Sitemap; Tastatur-, Mobile- und Axe-Tests sind grün.

**Verifikation:** Schema-/Index- und Worker-Tests, Search-Leakage-Tests, Metadaten-/Crawler-Smokes,
Clienttests, Desktop-/Mobile-E2E, `npm run ci`, `npm run test:e2e`, `git diff --check`.

**Nicht Teil dieser Phase:** Analytics, Kommentare, öffentliche Bearbeitung oder eigener
Crawler/Indexer.

### P27 – Tags und Favoriten

**Ziel:** Private Seiten lassen sich leicht gruppieren und häufig benötigte Seiten schneller
erreichen, ohne die einfache Baumstruktur zu ersetzen.

**Scope:** normalisierte Tags mit eindeutigen Namen, atomare Page-Tag-Zuordnung, Favoritenstatus,
Filter in Sidebar und Command Palette, tagbasierte private Suche, Backup-/Restore-Erweiterung und
optionale explizite Veröffentlichung von Snapshot-Tags ohne automatische Offenlegung privater Tags.

**Akzeptanzkriterien:** Tags und Favoriten funktionieren mit Create/Rename/Delete/Restore,
erscheinen in Suche und Backup konsistent und werden öffentlich nur als Bestandteil eines bewusst
erneuerten Snapshots sichtbar.

**Verifikation:** Migrations-/Repository-/Search-/Backup-Tests, Client- und Accessibility-Tests,
E2E für Tagging/Favoriten/Restore, vollständige Qualitätsgates.

**Nicht Teil dieser Phase:** AI-Tags, verschachtelte Tags oder tagbasierte ACLs.

### P28 – Templates und Daily Notes

**Ziel:** Wiederkehrende Seiten entstehen mit einem Schritt, ohne den Editor um ein komplexes
Datenbanksystem zu erweitern.

**Scope:** private, wiederverwendbare Seitentemplates aus gültigem Tiptap-JSON; Create-from-Template;
konfigurierbares Daily-Note-Template; idempotentes „Heutige Notiz öffnen“ in lokaler Zeitzone;
Slash-/Command-Palette-Integration; revisionssicheres Speichern und Backup/Restore.

**Akzeptanzkriterien:** Mehrfaches Öffnen desselben Tages erzeugt keine Duplikate, Template-Inhalte
werden kopiert statt live verknüpft, ungültige Templates werden abgewiesen und alle Abläufe sind
per Tastatur und mobil nutzbar.

**Verifikation:** Zeit-/DST-, Validierungs-, Backup-, Client-, E2E- und Accessibility-Tests sowie
vollständige Qualitätsgates.

**Nicht Teil dieser Phase:** Kalenderansicht, Automationen, Datenbank-Properties oder geteilte
Template-Marktplätze.

### P29 – Markdown- und Obsidian-Import

**Ziel:** Nutzer können vorhandene Markdown-Wissensbestände kontrolliert nach Dovari übernehmen,
ohne bestehende Daten oder Dateien zu verlieren.

**Scope:** lokaler ZIP-Preflight vor Upload; Markdown-zu-Tiptap-Konvertierung für die unterstützte
Allowlist; Verzeichnisstruktur, Wiki Links und sichere lokale Assets; Konfliktvorschau; resumierbare
Import-Session; atomare Finalisierung; Import nur als explizites Hinzufügen, niemals stilles
Überschreiben; Importbericht für nicht unterstützte Inhalte.

**Akzeptanzkriterien:** Ein dokumentierter Obsidian-Beispieltresor importiert Seiten, Hierarchie,
Links und Assets deterministisch; Pfadtraversal, HTML/SVG und Größenüberschreitungen werden
abgewiesen; ein Fehler vor Finalisierung verändert den Workspace nicht.

**Verifikation:** Parser-Fixtures, Security-/Pfadtests, Session-/Rollback-Tests,
Roundtrip-Stichproben, Client-/E2E-/Accessibility-Tests und vollständige Qualitätsgates.

**Nicht Teil dieser Phase:** Notion-API-Import, proprietäre Plugin-Syntax, bidirektionale
Synchronisation oder automatischer Hintergrundimport.

## 7. Entdeckte Folgearbeit

Hier werden während einer Phase gefundene Aufgaben notiert, die nicht zu ihrem Scope gehören. Beim Abschluss einer Phase muss jeder Eintrag entweder einer späteren Phase zugeordnet oder ausdrücklich verworfen werden.

| ID | Entdeckt in | Beschreibung | Zielphase | Status |
|---|---|---|---|---|
| P12-1 | P12 | Ein Upload, dessen Decoration vor Abschluss durch eine Dokumentänderung verloren geht, kann bis zur Referenzsynchronisation unreferenziert bleiben | P13 | ERLEDIGT |

## 8. Kurzprotokoll

Das Kurzprotokoll bleibt bewusst knapp. Pro abgeschlossener oder blockierter Phase gibt es höchstens einen Eintrag; ausführliche Begründungen gehören in Code, Tests oder ADRs.

| Datum | Phase | Ergebnis | Verifikation | Hinweise |
|---|---|---|---|---|
| 2026-09-12 | P00 | React-/Vite-/TypeScript-Scaffold mit minimaler Dovari-App-Shell und vorbereiteten Client-/Worker-/Shared-Grenzen umgesetzt | `npm ci --ignore-scripts --no-audit --no-fund`, Dev-Server plus HTTP-Smoke-Test, `npm run build`, `npm run typecheck`, `npm run lint` und `npm run format:check` erfolgreich | Cloudflare-Bindings, Hono-Routing und Produktfeatures bleiben P01 bzw. späteren Phasen vorbehalten; P01 ist `NEXT` |
| 2026-09-12 | P01 | Cloudflare-Vite-Worker mit Hono, zentraler Pfadklassifikation, `STATIC_ASSETS`, lokalen D1-/R2-Bindings, `/api/health`, SPA-Fallback und Wrangler-Typgenerierung umgesetzt | `npm ci --ignore-scripts --no-audit --no-fund`, `npm run types:generate`, `npm run db:migrate:local`, `npm run build`, `npm run typecheck`, `npx tsc -p tsconfig.worker.json --noEmit`, `npm run lint`, `npm run format:check`, Dev-/Preview-HTTP-Smokes und `npx wrangler deploy --dry-run` erfolgreich | `/api/health` meldet nur `{status:"ok"}` nach nicht-sensitiver D1-/R2-Probe; Konfiguration enthält keine Remote-/Preview-IDs und setzt lokale Entwicklung explizit auf `remote: false`; P02 ist `DONE`, P03 ist `NEXT` |
| 2026-09-12 | P02 | Zentrale private/public API-Grenze, Authentifizierungs-Middleware, Origin-Prüfung, Request-ID, Security-Header, standardisierte API-Fehler und bereinigte Static-Asset-Weiterleitung umgesetzt | `npm ci --ignore-scripts --no-audit --no-fund`, `npm run typecheck`, `npx tsc -p tsconfig.worker.json --noEmit`, `npm test` (8 Tests), `npm run build`, `npm run lint`, `npm run format:check`, `git diff --check`, lokaler Dev-/Preview-HTTP-Smoke für `/app`, `/api/health`, Static Assets und unbekannte API-Pfade erfolgreich | Die ursprüngliche Authentifizierungsentscheidung wurde in P24 durch ADR 0001 ersetzt; P03 ist `NEXT` |
| 2026-09-12 | P03 | Vitest-4-Workers-Integration mit lokalen D1-/R2-Bindings, React-Testing-Library-Clienttest, Playwright-Chromium-Smoke und CI-Qualitätsworkflow umgesetzt | `npm ci --ignore-scripts --no-audit --no-fund`, `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test` (11 Tests in 3 Testdateien), `npm run build`, `npm run test:e2e` (1 Browser-Smoke), `git diff --check` erfolgreich | `npm test` läuft in Workers- und JSDOM-Projekten; P04 ist `NEXT` |
| 2026-09-12 | P04 | Drizzle-Schema für `pages`, `assets`, `page_assets` und `page_links`, reproduzierbare D1-Migrationen, externe FTS5-Tabelle mit Synchronisationstriggern, Testfixtures und Worker-Integrity-Tests umgesetzt | `npm run db:migrate:local` (3 Migrationen), erneutes `npm run db:migrate:local` ohne offene Migrationen, `npm run db:generate`, `npx drizzle-kit check --config drizzle.config.ts`, `npm run ci` (15 Tests) und `git diff --check` erfolgreich | `content_markdown` wird nicht gespeichert; P05 ist `NEXT` |
| 2026-09-12 | P05 | Pages-Domain mit Raw-D1-Repository, Service- und Zod-Verträgen, sicherer Pages-HTTP-API, eindeutigen Slugs, serverseitigem Plaintext, optimistischen Revisionen, Größenlimit und Soft Delete umgesetzt | `npm run db:generate` (keine Schemaänderung), `npm run ci` (19 Tests), `npm run test:e2e` (1 Browser-Smoke) und `git diff --check` erfolgreich | Move-API bleibt gemäß Scope P07 vorbehalten; P06 ist `NEXT` |
| 2026-09-12 | P06 | React-Router-App-Shell mit stabilen `/app/pages/:id`-URLs, Sidebar aus Page-Metadaten, getrenntem Detail-Laden, Create/Rename/Delete, Ctrl/Cmd+N, Loading-/Empty-/Error-States und sicherem Text-/JSON-Platzhalter umgesetzt | `npm run ci` (Format-Check, Lint, Typecheck, 21 Vitest-Tests und Produktionsbuild) sowie `npm run test:e2e` (1 Browser-CRUD-Smoke) erfolgreich | Die Seitenbaum-Bewegung und Sortier-API bleiben gemäß Scope P07 vorbehalten; P07 ist `NEXT` |
| 2026-09-12 | P07 | Move-API mit rekursiver Zyklusprüfung, atomarer Hierarchie-/Geschwisternormalisierung, einklappbarem Seitenbaum, Create Child, Inline Rename, Pointer-Drag-and-Drop und Tastaturalternative umgesetzt | `npm run ci` (Format-Check, Lint, Typecheck, 26 Vitest-Tests und Produktionsbuild), `npm run test:e2e` (2 Browser-Smokes) und `git diff --check` erfolgreich | Child-Erstellung korrigiert zusätzlich die bestehende Parent-Binding-Reihenfolge; P08 ist `NEXT` |
| 2026-09-12 | P08 | Tiptap-3-Grundeditor mit dokumentnaher Komponentenstruktur, sicherer Extension-Allowlist, Toolbar für Grundformatierungen, Placeholder, Link-Dialog und lokalem `content_json`-Bearbeiten umgesetzt; der Editor wird als eigener Bundle-Chunk geladen | `npm run ci` (Format-Check, Lint, Typecheck, 31 Vitest-Tests und Produktionsbuild), `npm run test:e2e` (2 Browser-Smokes) und `git diff --check` erfolgreich | Autosave, Bilder, Wiki Links und Slash Commands bleiben gemäß Scope späteren Phasen vorbehalten; P09 ist `NEXT` |
| 2026-09-12 | P09 | Serverseitige Tiptap-Schema-Validierung um Root-, Listen-, Task-, Link- und Strukturgrenzen erweitert; deterministische Plaintext- und Markdown-Ableitung für alle erlaubten Nodes umgesetzt; `content_markdown` bleibt ungespeichert | `npm run ci` (Format-Check, Lint, Typecheck, 34 Vitest-Tests und Produktionsbuild), `npm run test:e2e` (2 Browser-Smokes) und `git diff --check` erfolgreich | Markdown nutzt bis zur späteren Exportphase deterministische `assets/<assetId>`-Referenzen; P10 ist `NEXT` |
| 2026-09-12 | P10 | Seitenbezogener Autosave-Zustandsautomat mit 750-ms-Debounce, genau einer laufenden Anfrage, Retry/Backoff für transiente Fehler, sichtbaren Save-/Fehler-/Konfliktzuständen, IndexedDB-Drafts, Reload-Recovery und `beforeunload`-Warnung umgesetzt | `npm run typecheck`, `npm test` (39 Tests), `npm run lint`, `npm run format:check`, `npm run build`, `npm run test:e2e` (2 Browser-Smokes) und `git diff --check` erfolgreich | Content-Saves verwenden weiterhin optimistische Revisionen; automatisches Merge und echtes Offline Editing bleiben außerhalb des Scopes; P11 ist `NEXT` |
| 2026-09-12 | P11 | Private R2-Asset-API mit 25-MiB-Streaming-Upload, Dateinamen-/MIME-/Magic-Byte-Prüfung, UUID-Keys, D1-Metadaten-Rollback, ETag-/Range-Download und Soft Delete umgesetzt | `npm run ci` (44 Tests und Produktionsbuild), `npm run test:e2e` (2 Browser-Smokes) und `git diff --check` erfolgreich | R2 bleibt privat; SVG/HTML werden abgewiesen und physische Garbage Collection sowie Editorintegration bleiben gemäß Scope P13 bzw. P12 vorbehalten; P12 ist `NEXT` |
| 2026-09-12 | P12 | Tiptap FileHandler für Screenshot-Paste und Drop mit gemeinsamer XHR-Uploadpipeline, Fortschritt, Retry/Remove, maximal drei parallelen Uploads sowie `assetImage`-/`attachment`-Nodes umgesetzt | `npm run ci` (53 Tests und Produktionsbuild), `npm run test:e2e` (2 Browser-Smokes) und `git diff --check` erfolgreich | Blob-URLs und Uploadstatus bleiben außerhalb von `content_json`; Referenz- und Race-Aufräumung aus P12-1 ist P13-Scope; P13 ist `NEXT` |
| 2026-09-13 | P13 | Content-Saves synchronisieren `page_assets` atomar aus dem validierten Tiptap-Dokument; entfernte Assets bleiben in D1/R2 erhalten; fehlende oder gelöschte Referenzen werden im Editor verständlich dargestellt; Upload-/Save-/Seitenwechsel-Rennen sind abgesichert | `npm run ci` (Format-Check, Lint, Typecheck, 59 Vitest-Tests und Produktionsbuild), `npm run test:e2e` (2 Browser-Smokes) und `git diff --check` erfolgreich | Physische Garbage Collection bleibt bewusst späterer Folgearbeit vorbehalten; P14 ist `NEXT` |
| 2026-09-13 | P14 | D1-FTS5-Search mit sicherem Token-Quoting, Prefixsuche für das letzte Token, BM25-Titelgewichtung, markierten Snippets, kanonischen URLs, Breadcrumbs, Limits/Leerzuständen und neuer Search API umgesetzt; ein kombinierter Update-Trigger hält den Index auch bei atomaren D1-Batches synchron; Rebuild-/Integrity-Werkzeuge ergänzt | `npm run db:generate`, `npx drizzle-kit check --config drizzle.config.ts`, `npm run db:migrate:local` (Migration und wiederholter Lauf), `npm run db:fts:integrity`, `npm run db:fts:rebuild`, `npm run ci` (66 Vitest-Tests und Produktionsbuild), `npm run test:e2e` (2 Browser-Smokes) und `git diff --check` erfolgreich | Die Command Palette und Tastenkürzel bleiben gemäß Scope P15 vorbehalten; P15 ist `NEXT` |
| 2026-09-13 | P15 | Zugängliche Command Palette mit Search-Debounce, stale-response-sicherer Ergebnisliste, Snippet-Segmenten, Tastaturnavigation, Ergebnisöffnung, Fokuswiederherstellung, Create-New-Page-/Theme-/Settings-Aktionen und Ctrl/Cmd-Kürzeln umgesetzt | `npm run ci` (Format-Check, Lint, Typecheck, 69 Vitest-Tests und Produktionsbuild), `npm run test:e2e` (2 Browser-Smokes) und `git diff --check` erfolgreich | Theme und Einstellungen bleiben als bewusst gekennzeichnete Platzhalter im P15-Scope; P16 ist `NEXT` |
| 2026-09-13 | P16 | Wiki-Link-Node mit stabilen Page-IDs, `[[`-Autocomplete für Auswahl und Seitenerstellung, Navigation, atomare `page_links`-Ableitung und einfache Backlink-Anzeige umgesetzt | `npm run ci` (Format-Check, Lint, Typecheck, 75 Vitest-Tests und Produktionsbuild), `npm run test:e2e` (2 Browser-Smokes) und `git diff --check` erfolgreich | Ungelöste Links bleiben sichtbar; Umbenennungen ändern die Zielidentität nicht; P17 ist `NEXT` |
| 2026-09-13 | P17 | Vollständiger Markdown-/ZIP-Export aktiver Seiten mit deterministischen Hierarchiepfaden, lokalen Wiki-/Asset-Links, Manifest, R2-Streaming, Dateinamenskollisionen, Missing-Asset-Platzhaltern und sichtbarem Download-/Fehlerzustand umgesetzt | `npm run ci` (Format-Check, Lint, Typecheck, 81 Vitest-Tests und Produktionsbuild), `npm run test:e2e` (2 Browser-Smokes) und `git diff --check` erfolgreich | `content_markdown` bleibt ungespeichert; P18 ist `NEXT` |
| 2026-09-13 | P18 | Light-/Dark-/System-Theme mit Persistenz und Systemreaktion, mobiler Sidebar-Drawer mit Fokusfalle und Fokuswiederherstellung, Skip-Link, kontrastfähige Design-Tokens, Reduced-Motion-Regeln und finale Zustands-/ARIA-Anpassungen umgesetzt; Axe-Prüfung ergänzt | `npm run ci` (Format-Check, Lint, Typecheck, 84 Vitest-Tests und Produktionsbuild), `npm run test:e2e` (4 Browser-Tests einschließlich Desktop-/Mobile-Axe-Prüfung) und `git diff --check` erfolgreich | P19 ist nach der priorisierten Editor-Planung `NEXT` |
| 2026-09-13 | P19 | Dokumentnahe Seitenansicht mit direkt bearbeitbarem Seitentitel, revisionsgeschütztem debounced Title-Save, zugänglichem Rename-Fallback, kompakter Toolbar-/Save-Status-Topbar, reduzierter Dokumentfläche, entferntem Slug-/Debug-JSON und nachgeordneten Backlinks umgesetzt | `npx --yes -p node@26 node /usr/bin/npm run ci` (Format-Check, Lint, Typecheck, 86 Vitest-Tests und Produktionsbuild), `npx --yes -p node@26 node /usr/bin/npm run test:e2e` (4 Browser-Tests einschließlich Desktopbreite, Mobile-Overflow und Dokument-Axe) sowie `git diff --check` erfolgreich | Inhalts-Autosave, Draft Recovery, Konfliktaktionen, Asset-/Wiki-Link-Integration und Delete-Aktion bleiben erhalten; P20 ist `NEXT` |
| 2026-09-13 | P20 | Sichere Web-/E-Mail-Autolinks beim Tippen und Einfügen, revisionssicheres Link-Popover mit Öffnen/Bearbeiten/Entfernen, sichtbarer Wiki-Link-Toolbar-Einstieg mit gemeinsamem Such-/Erstellungs-Picker sowie Maus-/Tastatur-Navigation umgesetzt | `npx --yes -p node@26 node /usr/bin/npm run ci` (Format-Check, Lint, Typecheck, 91 Vitest-Tests und Produktionsbuild), `npx --yes -p node@26 node /usr/bin/npm run test:e2e` (5 Browser-Tests einschließlich P20-Link-/Wiki-Link-Smoke) sowie `git diff --check` erfolgreich | Tiptap-Link-Attribute an den bestehenden Dokumentvertrag angeglichen; P21 ist `NEXT` |
| 2026-09-13 | P21 | Papierkorb und Versionshistorie mit `page_revisions`, atomaren Zeitfenster-/Delete-/Restore-Snapshots, 50er-Retention, cursorbasierten APIs, konfliktgeschütztem Restore/Permanent Delete, Parent-Fallback, Referenz-/FTS-Synchronisation, Undo sowie Trash-/History-UI umgesetzt | `npx --yes -p node@26 node /usr/bin/npm run ci` (Format-Check, Lint, Typecheck, 98 Vitest-Tests und Produktionsbuild), `npx --yes -p node@26 node /usr/bin/npm run test:e2e` (6 Browser-Tests einschließlich Delete → Undo, Trash → Restore, Revision → Restore und Axe), `npx --yes -p node@26 node /usr/bin/npm run db:migrate:local`, `npx --yes -p node@26 node /usr/bin/npm run db:fts:integrity`, `npx --yes -p node@26 node /usr/bin/npx drizzle-kit check --config drizzle.config.ts` sowie `git diff --check` erfolgreich | R2-Objekte bleiben beim permanenten Löschen erhalten; P22 ist `NEXT` |
| 2026-09-13 | P22 | Versioniertes, vollständiges `dovari-backup-v1.zip` mit kanonischem Manifest, Seiten-/Revisions-/Asset-Roundtrip, R2-Prüfsummen, resumierbaren und idempotenten Restore-Sessions, Empty-Workspace-Commit, lokaler ZIP-Validierung, Fortschritt/Abbruch und Backup-&-Restore-UI umgesetzt | `npx --yes -p node@26 node /usr/bin/npm run ci` (Format-Check, Lint, Typecheck, 108 Tests in 26 Testdateien und Produktionsbuild), `npx --yes -p node@26 node /usr/bin/npm run test:e2e` (7 isolierte Browser-Tests einschließlich Download, lokaler Validierung und Restore), `npx --yes -p node@26 node /usr/bin/npm run db:migrate:local` (keine offenen Migrationen), `npx --yes -p node@26 node /usr/bin/npm run db:fts:integrity`, `npx --yes -p node@26 node /usr/bin/npx drizzle-kit check --config drizzle.config.ts` sowie `git diff --check` erfolgreich | Der bestehende Markdown-Export bleibt unverändert; P23 ist `NEXT` |
| 2026-09-14 | P23 | Vollständige Settings-Landing-Route mit Theme-, Trash-, Versions-, Backup- und Restore-Navigation, direkte Command-Palette-Navigation, nach Aktualisierung sortierte Recent Pages sowie zugängliche Slash Commands für Textblöcke, Wiki Links, Bilder und Dateien umgesetzt; bestehende Wiki-Link- und Upload-Pipelines wiederverwendet und README aktualisiert | `npx --yes -p node@26 node /usr/bin/npm run ci` (Format-Check, Lint, Typecheck, 119 Tests in 28 Testdateien und Produktionsbuild), `npx --yes -p node@26 node /usr/bin/npm run test:e2e` (8 isolierte Browser-Tests einschließlich Settings-/Recent-/Slash-Desktop-/Mobile-Axe-Smoke), `git diff --check` erfolgreich | Slash Commands verändern das persistierte Dokumentformat nicht; P24 ist `NEXT` |
| 2026-09-14 | P24 | Die externe Authentifizierung wurde gemäß ADR 0001 durch ein erforderliches Instanz-Passwort ersetzt: eigene Login-/Logout-/Session-Routen und UI, 30-Tage-Cookie, gehashte versionsgebundene D1-Sessions, IP-gehashtes Login-Limit, lokale Passwortentwicklung, Settings-Logout sowie angepasste Deploy-/Smoke-Dokumentation sind umgesetzt | `npm run ci` (Format-Check, Lint, Typecheck, 126 Tests in 30 Testdateien und Produktionsbuild), `npm run test:e2e` (10 Browser-Tests), `npm run release:install-smoke` (frischer Checkout, sieben Migrationen plus idempotenter Zweitlauf, FK-/FTS-Prüfung und Wrangler-Dry-Run), `npm run db:migrate:local`, `npx drizzle-kit check --config drizzle.config.ts`, direkter Wrangler-FTS-Integrity-Check, `npm run deploy:dry-run`, produktives `npm run deploy` und authentifiziertes sowie abschließend fail-closed `npm run release:smoke -- https://dovari.kuranai.workers.dev` erfolgreich | Remote-Migration 0006 und Worker-Version `82494200-5605-46a7-8358-b5e29945eb8e` wurden ausgerollt. Das zufällige Testpasswort wurde danach entfernt; die Testinstanz bleibt bis zum Setzen eines Betreiberpassworts mit `503 SETUP_REQUIRED` geschlossen. P25 ist `NEXT` |
| 2026-09-14 | Planung | P25 als öffentliche Knowledge Base mit Login erst beim Bearbeiten detailliert; P26–P29 für Public Discovery, Tags/Favoriten, Templates/Daily Notes und Import ergänzt | Dokumente und tatsächliche Routing-/Auth-/Datenmodell-Grenzen abgeglichen; `npx prettier --write IMPLEMENTATION.md PLAN.md TECHNICAL_SPEC.md` und `git diff --check` erfolgreich; Implementierungstests nicht ausgeführt | P24 ist abgeschlossen; P25 ist regulär `NEXT` |
| 2026-09-14 | P25 | Öffentliche Knowledge Base und Veröffentlichungen mit isolierten Snapshots, Public-API, Read-only-UI, Publish-Workflow und v2-Backup/Restore umgesetzt; bestehende Publications synchronisieren Titel- und Inhaltsänderungen automatisch | `npx --yes -p node@26 node /usr/bin/npm run ci` (Format-Check, Lint, Typecheck, 136 Tests in 32 Testdateien und Produktionsbuild), `npx --yes -p node@26 node /usr/bin/npm run test:e2e` (11 Browser-Tests einschließlich anonymem Public-Landing-/Read-only-/Edit-/Unpublish-Flow mit Desktop-/Mobile-Axe), `npx --yes -p node@26 node /usr/bin/npm run db:migrate:local` (0006 und 0007 angewendet), `npx --yes -p node@26 node /usr/bin/npm run db:fts:integrity`, `npx --yes -p node@26 node /usr/bin/npx drizzle-kit check --config drizzle.config.ts` sowie `git diff --check` erfolgreich | Public-Search, Sitemap, Robots und gezieltes Caching bleiben gemäß Scope P26 vorbehalten; die automatische Synchronisierung wurde später ergänzt; P26 ist `NEXT` |
| 2026-09-14 | P26 | Öffentlicher Snapshot-FTS5-Index mit Titelgewichtung und Snippets, debounced/zugängliche Public Search, snapshotbasierte Navigation mit übersprungenen unveröffentlichten Zwischeneltern, sichere serverseitige Title-/Description-/Open-Graph-Metadaten, Robots/Sitemap und sofort revalidierbare Public-Caches umgesetzt | `npx --yes -p node@26 node /usr/bin/npm run ci` (Format-Check, Lint, Typecheck, 142 Tests in 34 Testdateien und Produktionsbuild), `npx --yes -p node@26 node /usr/bin/npm run test:e2e` (11 Browser-Tests einschließlich Public-Search-/Metadata-/Robots-/Sitemap-Flow mit Desktop-/Mobile-Axe), `npx --yes -p node@26 node /usr/bin/npm run db:migrate:local` (0008 angewendet), `npx --yes -p node@26 node /usr/bin/npm run db:fts:public-integrity`, `npx --yes -p node@26 node /usr/bin/npm run db:fts:public-rebuild`, `npx --yes -p node@26 node /usr/bin/npx drizzle-kit check --config drizzle.config.ts` sowie `git diff --check` erfolgreich | Standardmäßig bleiben öffentliche Seiten `noindex`; P27 ist `NEXT` |
| 2026-09-14 | P27 | Tags und Favoriten mit normalisierten eindeutigen Tag-Namen, atomarer Page-Tag-Zuordnung, Favoritenstatus, Sidebar-/Command-Palette-Filtern, privater Tag-Suche, expliziten Snapshot-Tags, Backup-/Restore-Erweiterung, Migration 0009 sowie Client-/Accessibility-/E2E-Abdeckung umgesetzt | `npx --yes -p node@26 node /usr/bin/npm test -- --run` (143 Tests in 35 Testdateien), `npx --yes -p node@26 node /usr/bin/npm run typecheck`, `npx --yes -p node@26 node /usr/bin/npm run lint`, `npx --yes -p node@26 node /usr/bin/npm run build`, `npx --yes -p node@26 node /usr/bin/npx drizzle-kit check --config drizzle.config.ts`, `npx --yes -p node@26 node /usr/bin/npm run test:e2e` (12 Playwright-Tests einschließlich Tag-/Favorit-/Trash-Restore-Flow mit Desktop-/Mobile-Axe), `git diff --check` sowie gezielter Backup-Roundtrip-Test erfolgreich | `npm run format:check` meldet ausschließlich die bereits vorhandene, bewusst unveränderte Formatierung in `wrangler.jsonc`; alle P27-Dateien sind formatiert. P28 ist `NEXT` |
| 2026-09-15 | P28 | Private Templates mit validiertem Tiptap-Inhalt, atomisches Create-from-Template, konfigurierbares und idempotentes Daily-Note-Öffnen mit lokaler Zeitzone/DST-Prüfung, Slash-/Command-Palette-Integration, responsive Templates-UI sowie Backup-v2 für Templates und Daily Notes umgesetzt | `npx --yes -p node@26 node /usr/bin/npm test` (150 Tests in 37 Testdateien), `npx --yes -p node@26 node /usr/bin/npm run typecheck`, `npx --yes -p node@26 node /usr/bin/npm run lint`, `npx --yes -p node@26 node /usr/bin/npm run build`, `npx --yes -p node@26 node /usr/bin/npx drizzle-kit check --config drizzle.config.ts`, `npx --yes -p node@26 node /usr/bin/npm run test:e2e` (13 Playwright-Tests einschließlich Template-/Daily-Note-Flow sowie Desktop-/Mobile-Axe), `git diff --check` und erfolgreiche Anwendung der Migration 0010 im E2E-Lauf | `npm run format:check` meldet ausschließlich die bereits vorhandene, bewusst unveränderte Formatierung in `wrangler.jsonc`; alle P28-Dateien sind formatiert. P29 ist `NEXT` |

## 9. Regeln zur Pflege dieses Dokuments

- Der Kopf und die Statustabelle müssen immer denselben Stand zeigen.
- Es darf höchstens eine `IN PROGRESS`-Phase und höchstens eine `NEXT`-Phase geben.
- Solange eine Phase `IN PROGRESS` oder `BLOCKED` ist, wird keine spätere Phase als `NEXT` markiert.
- Akzeptanzkriterien werden nicht nachträglich abgeschwächt, nur um eine Phase abzuschließen.
- Wird der Plan fachlich geändert, werden zuerst `PLAN.md` oder `TECHNICAL_SPEC.md` angepasst und anschließend die betroffenen Phasen hier aktualisiert.
- Datumsangaben verwenden `YYYY-MM-DD`.
- Das Dokument wird mit jeder Phase committed beziehungsweise zusammen mit deren Änderungen
  gespeichert. Eine reine Roadmap-Änderung darf `PLANNED` zu `NEXT` machen, wenn keine
  Implementierung aktiv ist und dies als Planung im Kurzprotokoll dokumentiert wird; begonnene oder
  abgeschlossene Implementierungsstatus dürfen nie ohne die zugehörige Arbeit geändert werden.
