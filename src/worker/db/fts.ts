export const REBUILD_PAGES_FTS_STATEMENT = "INSERT INTO pages_fts(pages_fts) VALUES ('rebuild')";
export const CHECK_PAGES_FTS_STATEMENT =
  "INSERT INTO pages_fts(pages_fts) VALUES ('integrity-check')";
export const REBUILD_PUBLICATIONS_FTS_STATEMENT =
  "INSERT INTO publications_fts(publications_fts) VALUES ('rebuild')";
export const CHECK_PUBLICATIONS_FTS_STATEMENT =
  "INSERT INTO publications_fts(publications_fts) VALUES ('integrity-check')";

export async function rebuildPagesFts(db: D1Database) {
  return db.prepare(REBUILD_PAGES_FTS_STATEMENT).run();
}

export async function checkPagesFtsIntegrity(db: D1Database) {
  await db.prepare(CHECK_PAGES_FTS_STATEMENT).run();
}

export async function rebuildPublicationsFts(db: D1Database) {
  return db.prepare(REBUILD_PUBLICATIONS_FTS_STATEMENT).run();
}

export async function checkPublicationsFtsIntegrity(db: D1Database) {
  await db.prepare(CHECK_PUBLICATIONS_FTS_STATEMENT).run();
}
