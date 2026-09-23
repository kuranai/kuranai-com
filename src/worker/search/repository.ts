import { SEARCH_SNIPPET_MAX_TOKENS, type SearchRequest } from '../../shared/search';
import type { TagSummary } from '../../shared/tags';

export interface SearchPageMatch {
  id: string;
  title: string;
  slug: string;
  parentId: string | null;
  snippet: string;
  isFavorite: boolean;
  tags: TagSummary[];
}

export interface SearchTreePage {
  id: string;
  title: string;
  slug: string;
  parentId: string | null;
}

interface SearchPageDatabaseRow {
  id: string;
  title: string;
  slug: string;
  parent_id: string | null;
  snippet: string;
  is_favorite: number;
  tags_json: string;
}

interface SearchTreeDatabaseRow {
  id: string;
  title: string;
  slug: string;
  parent_id: string | null;
}

function toSearchPageMatch(row: SearchPageDatabaseRow): SearchPageMatch {
  let tags: TagSummary[] = [];
  try {
    const parsed = JSON.parse(row.tags_json) as unknown;
    if (Array.isArray(parsed)) {
      tags = parsed.filter(
        (tag): tag is TagSummary =>
          typeof tag === 'object' &&
          tag !== null &&
          !Array.isArray(tag) &&
          typeof (tag as { id?: unknown }).id === 'string' &&
          typeof (tag as { name?: unknown }).name === 'string',
      );
    }
  } catch {
    tags = [];
  }

  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    parentId: row.parent_id,
    snippet: row.snippet,
    isFavorite: row.is_favorite === 1,
    tags,
  };
}

function toSearchTreePage(row: SearchTreeDatabaseRow): SearchTreePage {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    parentId: row.parent_id,
  };
}

export class SearchRepository {
  constructor(readonly db: D1Database) {}

  async findMatches(matchQuery: string, request: SearchRequest) {
    const clauses = [
      'pages.deleted_at IS NULL',
      `(text_matches.search_id IS NOT NULL OR EXISTS (
         SELECT 1
         FROM page_tags AS searched_page_tags
         INNER JOIN tags AS searched_tags ON searched_tags.id = searched_page_tags.tag_id
         WHERE searched_page_tags.page_id = pages.id
           AND searched_tags.name_normalized LIKE ? ESCAPE '\\'
       ))`,
    ];
    const escapedTagQuery = request.query.replace(/[\\%_]/gu, (character) => `\\${character}`);
    const bindings: unknown[] = [matchQuery, `%${escapedTagQuery.toLocaleLowerCase('en-US')}%`];
    if (request.favorite !== undefined) {
      clauses.push('pages.is_favorite = ?');
      bindings.push(request.favorite ? 1 : 0);
    }
    if (request.tagId !== undefined) {
      clauses.push(
        'EXISTS (SELECT 1 FROM page_tags AS filtered_page_tags WHERE filtered_page_tags.page_id = pages.id AND filtered_page_tags.tag_id = ?)',
      );
      bindings.push(request.tagId);
    }

    const result = await this.db
      .prepare(
        `WITH text_matches AS (
           SELECT
             rowid AS search_id,
             snippet(pages_fts, -1, '<mark>', '</mark>', '…', ${SEARCH_SNIPPET_MAX_TOKENS}) AS snippet,
             bm25(pages_fts, 8.0, 1.0) AS rank
           FROM pages_fts
           WHERE pages_fts MATCH ?
         )
         SELECT
           pages.id,
           pages.title,
           pages.slug,
           pages.parent_id,
           COALESCE(text_matches.snippet, '') AS snippet,
           pages.is_favorite,
           (
             SELECT COALESCE(json_group_array(json_object('id', ordered_tags.id, 'name', ordered_tags.name)), '[]')
             FROM (
               SELECT tags.id, tags.name
               FROM page_tags
               INNER JOIN tags ON tags.id = page_tags.tag_id
               WHERE page_tags.page_id = pages.id
               ORDER BY tags.name_normalized, tags.id
             ) AS ordered_tags
           ) AS tags_json
         FROM pages
         LEFT JOIN text_matches ON text_matches.search_id = pages.search_id
         WHERE ${clauses.join(' AND ')}
         ORDER BY
           CASE WHEN pages.title COLLATE NOCASE = ? THEN 0 ELSE 1 END,
           COALESCE(text_matches.rank, 1000000),
           pages.title COLLATE NOCASE,
           pages.id
         LIMIT ?`,
      )
      .bind(...bindings, request.query, request.limit)
      .all<SearchPageDatabaseRow>();

    return result.results.map(toSearchPageMatch);
  }

  async listActiveTreePages() {
    const result = await this.db
      .prepare(
        `SELECT id, title, slug, parent_id
         FROM pages
         WHERE deleted_at IS NULL`,
      )
      .all<SearchTreeDatabaseRow>();

    return result.results.map(toSearchTreePage);
  }
}
