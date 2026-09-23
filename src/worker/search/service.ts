import {
  buildFtsMatchQuery,
  normalizeSearchQuery,
  pageSearchUrl,
  type SearchBreadcrumb,
  type SearchRequest,
  type SearchResponse,
  type SearchResult,
} from '../../shared/search';
import { normalizeTagNameForComparison } from '../../shared/tags';
import { TagRepository } from '../tags/repository';
import { SearchRepository, type SearchPageMatch, type SearchTreePage } from './repository';

function toBreadcrumb(page: SearchPageMatch, pages: Map<string, SearchTreePage>) {
  const breadcrumb: SearchBreadcrumb[] = [];
  const visited = new Set([page.id]);
  let parentId = page.parentId;

  while (parentId !== null) {
    if (visited.has(parentId)) {
      break;
    }

    const parent = pages.get(parentId);
    if (!parent) {
      break;
    }

    visited.add(parent.id);
    breadcrumb.unshift({
      id: parent.id,
      title: parent.title,
      slug: parent.slug,
      url: pageSearchUrl(parent.id),
    });
    parentId = parent.parentId;
  }

  return breadcrumb;
}

function toSearchResult(page: SearchPageMatch, pages: Map<string, SearchTreePage>): SearchResult {
  return {
    id: page.id,
    title: page.title,
    slug: page.slug,
    url: pageSearchUrl(page.id),
    breadcrumb: toBreadcrumb(page, pages),
    isFavorite: page.isFavorite,
    snippet: page.snippet,
    tags: page.tags,
  };
}

export class SearchService {
  constructor(
    private readonly repository: SearchRepository,
    private readonly tags = new TagRepository(repository.db),
  ) {}

  async search(request: SearchRequest): Promise<SearchResponse> {
    const normalizedRequest = {
      ...request,
      query: normalizeSearchQuery(request.query),
    };
    if (normalizedRequest.tagId === undefined && normalizedRequest.tagName !== undefined) {
      normalizedRequest.tagId =
        (
          await this.tags.findByNameNormalized(
            normalizeTagNameForComparison(normalizedRequest.tagName),
          )
        )?.id ?? '__missing_tag__';
    }
    const matchQuery = buildFtsMatchQuery(normalizedRequest.query);
    if (matchQuery.length === 0) {
      return { results: [] };
    }

    const [matches, treePages] = await Promise.all([
      this.repository.findMatches(matchQuery, normalizedRequest),
      this.repository.listActiveTreePages(),
    ]);
    const pages = new Map(treePages.map((page) => [page.id, page]));

    return {
      results: matches.map((page) => toSearchResult(page, pages)),
    };
  }
}
