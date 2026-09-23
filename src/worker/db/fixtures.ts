import type { NewAsset, NewPage, NewPageAsset, NewPageLink } from './schema';

const fixtureTimestamp = '2026-09-12T00:00:00.000Z';

export function createPageFixture(overrides: Partial<NewPage> = {}): NewPage {
  const id = overrides.id ?? crypto.randomUUID();

  return {
    id,
    title: `Fixture page ${id.slice(0, 8)}`,
    slug: `fixture-${id}`,
    contentJson: '{"type":"doc","content":[]}',
    contentText: 'Fixture page content',
    parentId: null,
    position: 0,
    revision: 1,
    createdAt: fixtureTimestamp,
    updatedAt: fixtureTimestamp,
    deletedAt: null,
    ...overrides,
  };
}

export function createAssetFixture(overrides: Partial<NewAsset> = {}): NewAsset {
  const id = overrides.id ?? crypto.randomUUID();

  return {
    id,
    objectKey: `fixtures/${id}.txt`,
    originalFilename: 'fixture.txt',
    mimeType: 'text/plain',
    sizeBytes: 16,
    width: null,
    height: null,
    sha256: null,
    uploadedForPageId: null,
    createdAt: fixtureTimestamp,
    deletedAt: null,
    ...overrides,
  };
}

export function createPageAssetFixture(
  pageId: string,
  assetId: string,
  overrides: Partial<NewPageAsset> = {},
): NewPageAsset {
  return {
    pageId,
    assetId,
    ...overrides,
  };
}

export function createPageLinkFixture(
  sourcePageId: string,
  overrides: Partial<NewPageLink> = {},
): NewPageLink {
  const targetTitle = overrides.targetTitle ?? 'Fixture target';

  return {
    id: crypto.randomUUID(),
    sourcePageId,
    targetPageId: null,
    targetTitle,
    targetTitleNormalized: targetTitle.toLocaleLowerCase('en-US'),
    createdAt: fixtureTimestamp,
    ...overrides,
  };
}
