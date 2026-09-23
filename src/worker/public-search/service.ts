import {
  buildFtsMatchQuery,
  normalizeSearchQuery,
  publicSearchUrl,
  type PublicSearchResponse,
  type PublicSearchResult,
} from '../../shared/public-search';
import { PublicationRepository } from '../publications/repository';
import { PublicSearchRepository, type PublicSearchMatch } from './repository';

function breadcrumbFor(
  match: PublicSearchMatch,
  publications: ReadonlyMap<
    string,
    { publicId: string; publishedTitle: string; parentPublicId: string | null }
  >,
) {
  const breadcrumb: PublicSearchResult['breadcrumb'] = [];
  const visited = new Set([match.publicId]);
  let parentPublicId = match.parentPublicId;

  while (parentPublicId !== null) {
    if (visited.has(parentPublicId)) break;
    const parent = publications.get(parentPublicId);
    if (!parent) break;
    visited.add(parent.publicId);
    breadcrumb.unshift({
      publicId: parent.publicId,
      publishedTitle: parent.publishedTitle,
      url: publicSearchUrl(parent.publicId),
    });
    parentPublicId = parent.parentPublicId;
  }

  return breadcrumb;
}

export class PublicSearchService {
  constructor(
    private readonly repository: PublicSearchRepository,
    private readonly publications: PublicationRepository,
  ) {}

  async search(input: { query: string; limit: number }): Promise<PublicSearchResponse> {
    const query = normalizeSearchQuery(input.query);
    const matchQuery = buildFtsMatchQuery(query);
    if (matchQuery.length === 0) return { results: [] };

    const [matches, records] = await Promise.all([
      this.repository.findMatches(matchQuery, query, input.limit),
      this.publications.listActivePublications(),
    ]);
    const publications = new Map(
      records.map((record) => [
        record.publicId,
        {
          parentPublicId: record.publishedParentPublicId,
          publicId: record.publicId,
          publishedTitle: record.publishedTitle,
        },
      ]),
    );

    return {
      results: matches.map((match) => ({
        breadcrumb: breadcrumbFor(match, publications),
        publicId: match.publicId,
        publishedTitle: match.publishedTitle,
        snippet: match.snippet,
        url: publicSearchUrl(match.publicId),
      })),
    };
  }
}
