import type { PublicPublicationSummary } from '../../../shared/publications';

export interface PublicNavigationItem extends PublicPublicationSummary {
  depth: number;
}

function compareNavigationItems(left: PublicPublicationSummary, right: PublicPublicationSummary) {
  return (
    left.position - right.position ||
    left.publishedTitle.localeCompare(right.publishedTitle, undefined, { sensitivity: 'base' }) ||
    left.publicId.localeCompare(right.publicId)
  );
}

export function flattenPublicNavigation(publications: PublicPublicationSummary[]) {
  const byId = new Map(publications.map((publication) => [publication.publicId, publication]));
  const children = new Map<string | null, PublicPublicationSummary[]>();

  for (const publication of publications) {
    const parentId =
      publication.parentPublicId !== null && byId.has(publication.parentPublicId)
        ? publication.parentPublicId
        : null;
    const siblings = children.get(parentId) ?? [];
    siblings.push(publication);
    children.set(parentId, siblings);
  }

  for (const siblings of children.values()) {
    siblings.sort(compareNavigationItems);
  }

  const flattened: PublicNavigationItem[] = [];
  const visited = new Set<string>();
  const visit = (parentId: string | null, depth: number) => {
    for (const publication of children.get(parentId) ?? []) {
      if (visited.has(publication.publicId)) continue;
      visited.add(publication.publicId);
      flattened.push({ ...publication, depth });
      visit(publication.publicId, depth + 1);
    }
  };
  visit(null, 0);

  for (const publication of publications) {
    if (visited.has(publication.publicId)) continue;
    visited.add(publication.publicId);
    flattened.push({ ...publication, depth: 0 });
  }

  return flattened;
}
