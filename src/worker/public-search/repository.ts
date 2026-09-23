import { SEARCH_SNIPPET_MAX_TOKENS } from '../../shared/search';

export interface PublicSearchMatch {
  publicId: string;
  publishedTitle: string;
  parentPublicId: string | null;
  snippet: string;
}

interface PublicSearchDatabaseRow {
  public_id: string;
  published_title: string;
  published_parent_public_id: string | null;
  snippet: string;
}

function toPublicSearchMatch(row: PublicSearchDatabaseRow): PublicSearchMatch {
  return {
    parentPublicId: row.published_parent_public_id,
    publicId: row.public_id,
    publishedTitle: row.published_title,
    snippet: row.snippet,
  };
}

export class PublicSearchRepository {
  constructor(private readonly db: D1Database) {}

  async findMatches(matchQuery: string, query: string, limit: number) {
    const result = await this.db
      .prepare(
        `SELECT
           page_publications.public_id,
           page_publications.published_title,
           page_publications.published_parent_public_id,
           snippet(publications_fts, -1, '<mark>', '</mark>', '…', ${SEARCH_SNIPPET_MAX_TOKENS}) AS snippet
         FROM publications_fts
         INNER JOIN page_publications ON page_publications.rowid = publications_fts.rowid
         WHERE publications_fts MATCH ?
         ORDER BY
           CASE WHEN page_publications.published_title COLLATE NOCASE = ? THEN 0 ELSE 1 END,
           bm25(publications_fts, 8.0, 1.0),
           page_publications.published_title COLLATE NOCASE,
           page_publications.public_id
         LIMIT ?`,
      )
      .bind(matchQuery, query, limit)
      .all<PublicSearchDatabaseRow>();

    return result.results.map(toPublicSearchMatch);
  }
}
