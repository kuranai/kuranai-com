import { useEffect, useMemo, useState } from 'react';

import type { PageDetail } from '../../../shared/pages';
import { normalizeTagNameForComparison } from '../../../shared/tags';
import {
  fetchPrivatePublication,
  publicationErrorMessage,
  publishPrivatePublication,
  unpublishPrivatePublication,
} from './api';
import type { PrivatePublication } from '../../../shared/publications';

type PublicationState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; publication: PrivatePublication | null };

function publicationStatus(
  page: PageDetail,
  publication: PrivatePublication | null,
  allowIndexing: boolean,
  selectedTagIds: ReadonlySet<string>,
) {
  if (publication === null) return 'Not published';
  const selectedTagNames = page.tags
    .filter((tag) => selectedTagIds.has(tag.id))
    .map((tag) => normalizeTagNameForComparison(tag.name));
  const publicationTagNames = publication.tags.map(normalizeTagNameForComparison);
  if (
    publication.sourceRevision !== page.revision ||
    publication.allowIndexing !== allowIndexing ||
    selectedTagNames.length !== publicationTagNames.length ||
    selectedTagNames.some((name, index) => name !== publicationTagNames[index])
  ) {
    return 'Syncing…';
  }
  return 'Published';
}

export function PublicationPanel({ page }: { page: PageDetail }) {
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<PublicationState>({ status: 'loading' });
  const [allowIndexing, setAllowIndexing] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isUnpublishing, setIsUnpublishing] = useState(false);
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(() => new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    setActionError(null);
    fetchPrivatePublication(page.id, controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) {
          setAllowIndexing(response.publication?.allowIndexing ?? false);
          const publishedNames = new Set(
            response.publication?.tags.map(normalizeTagNameForComparison) ?? [],
          );
          setSelectedTagIds(
            new Set(
              page.tags
                .filter((tag) => publishedNames.has(normalizeTagNameForComparison(tag.name)))
                .map((tag) => tag.id),
            ),
          );
          setState({ status: 'ready', publication: response.publication });
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setState({
            status: 'error',
            message: publicationErrorMessage(error, 'The publication status could not be loaded.'),
          });
        }
      });
    return () => controller.abort();
  }, [page.id, page.revision, page.updatedAt, reloadKey]);

  useEffect(() => {
    const pageTagIds = new Set(page.tags.map((tag) => tag.id));
    setSelectedTagIds((current) => new Set([...current].filter((tagId) => pageTagIds.has(tagId))));
  }, [page.tags]);

  const selectedTagIdList = useMemo(() => [...selectedTagIds], [selectedTagIds]);

  async function handlePublish() {
    if (state.status !== 'ready' || isPublishing || isUnpublishing) return;
    setIsPublishing(true);
    setActionError(null);
    setCopyNotice(null);
    try {
      const response = await publishPrivatePublication(page.id, {
        allowIndexing,
        baseRevision: page.revision,
        tagIds: selectedTagIdList,
      });
      setAllowIndexing(response.publication.allowIndexing);
      setState({ status: 'ready', publication: response.publication });
    } catch (error: unknown) {
      setActionError(publicationErrorMessage(error, 'The page could not be published.'));
    } finally {
      setIsPublishing(false);
    }
  }

  async function syncPublicationSettings(nextAllowIndexing: boolean, nextTagIds: string[]) {
    if (state.status !== 'ready' || state.publication === null || isPublishing || isUnpublishing) {
      return;
    }

    setIsPublishing(true);
    setActionError(null);
    setCopyNotice(null);
    try {
      const response = await publishPrivatePublication(page.id, {
        allowIndexing: nextAllowIndexing,
        baseRevision: page.revision,
        tagIds: nextTagIds,
      });
      setAllowIndexing(response.publication.allowIndexing);
      setState({ status: 'ready', publication: response.publication });
    } catch (error: unknown) {
      setActionError(
        publicationErrorMessage(error, 'The sharing settings could not be synchronized.'),
      );
    } finally {
      setIsPublishing(false);
    }
  }

  function handleAllowIndexingChange(nextAllowIndexing: boolean) {
    setAllowIndexing(nextAllowIndexing);
    void syncPublicationSettings(nextAllowIndexing, selectedTagIdList);
  }

  function handleTagToggle(tagId: string) {
    const next = new Set(selectedTagIds);
    if (next.has(tagId)) next.delete(tagId);
    else next.add(tagId);
    setSelectedTagIds(next);
    void syncPublicationSettings(allowIndexing, [...next]);
  }

  async function handleUnpublish() {
    if (state.status !== 'ready' || state.publication === null || isPublishing || isUnpublishing) {
      return;
    }
    if (!window.confirm('Remove this page from the public knowledge base?')) return;
    setIsUnpublishing(true);
    setActionError(null);
    setCopyNotice(null);
    try {
      await unpublishPrivatePublication(page.id, {
        expectedUpdatedAt: state.publication.updatedAt,
        publicId: state.publication.publicId,
      });
      setAllowIndexing(false);
      setSelectedTagIds(new Set());
      setState({ status: 'ready', publication: null });
    } catch (error: unknown) {
      setActionError(publicationErrorMessage(error, 'The page could not be unpublished.'));
    } finally {
      setIsUnpublishing(false);
    }
  }

  async function handleCopyUrl() {
    if (state.status !== 'ready' || state.publication === null) return;
    try {
      if (!navigator.clipboard) throw new Error('Clipboard access is unavailable.');
      await navigator.clipboard.writeText(
        `${window.location.origin}${state.publication.publicUrl}`,
      );
      setCopyNotice('Public URL copied.');
    } catch {
      setCopyNotice('The public URL could not be copied automatically.');
    }
  }

  return (
    <section aria-labelledby="publication-panel-title" className="publication-panel">
      <div className="publication-panel-summary">
        <div className="publication-panel-heading">
          <span className="state-kicker">Sharing</span>
          <div className="publication-panel-title-row">
            <h2 id="publication-panel-title">Public page</h2>
            {state.status === 'ready' ? (
              <span aria-live="polite" className="publication-status">
                {publicationStatus(page, state.publication, allowIndexing, selectedTagIds)}
              </span>
            ) : null}
          </div>
          <p className="publication-scope">This page and all subpages</p>
        </div>
        {state.status === 'ready' ? (
          <div className="publication-actions publication-actions-summary">
            {state.publication === null ? (
              <button
                className="button button-primary"
                disabled={isPublishing || isUnpublishing}
                onClick={() => void handlePublish()}
                type="button"
              >
                {isPublishing ? 'Publishing…' : 'Publish page'}
              </button>
            ) : null}
            {state.publication ? (
              <>
                <a
                  className="button button-secondary"
                  href={state.publication.publicUrl}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  Open public page
                </a>
                <button
                  className="button button-danger"
                  disabled={isPublishing || isUnpublishing}
                  onClick={() => void handleUnpublish()}
                  type="button"
                >
                  {isUnpublishing ? 'Unpublishing…' : 'Unpublish'}
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      {state.status === 'loading' ? (
        <p aria-live="polite" className="publication-state">
          Loading publication status…
        </p>
      ) : null}
      {state.status === 'error' ? (
        <div className="publication-state publication-state-error" role="alert">
          <p>{state.message}</p>
          <button
            className="button button-quiet"
            onClick={() => setReloadKey((value) => value + 1)}
            type="button"
          >
            Retry
          </button>
        </div>
      ) : null}
      {state.status === 'ready' ? (
        <>
          <button
            aria-controls="publication-settings"
            aria-expanded={isSettingsOpen}
            className="publication-settings-toggle"
            onClick={() => setIsSettingsOpen((open) => !open)}
            type="button"
          >
            <span>Sharing settings</span>
            <span aria-hidden="true">{isSettingsOpen ? '−' : '+'}</span>
          </button>
          {isSettingsOpen ? (
            <div className="publication-settings" id="publication-settings">
              <p className="publication-description">
                Publish this page once to make it public. Later title and content edits sync to the
                public snapshot automatically. Publishing also includes every active subpage.
              </p>
              <label className="publication-indexing-option">
                <input
                  checked={allowIndexing}
                  disabled={isPublishing || isUnpublishing}
                  onChange={(event) => handleAllowIndexingChange(event.target.checked)}
                  type="checkbox"
                />
                <span>Allow search engine indexing</span>
              </label>
              <fieldset className="publication-tags">
                <legend>Include tags in the public snapshot</legend>
                {page.tags.length > 0 ? (
                  page.tags.map((tag) => (
                    <label className="publication-tag-option" key={tag.id}>
                      <input
                        checked={selectedTagIds.has(tag.id)}
                        disabled={isPublishing || isUnpublishing}
                        onChange={() => handleTagToggle(tag.id)}
                        type="checkbox"
                      />
                      <span>{tag.name}</span>
                    </label>
                  ))
                ) : (
                  <p className="publication-state">
                    Assign private tags above to include them here.
                  </p>
                )}
              </fieldset>
              {state.publication ? (
                <button
                  className="button button-quiet"
                  disabled={isPublishing || isUnpublishing}
                  onClick={() => void handleCopyUrl()}
                  type="button"
                >
                  Copy public URL
                </button>
              ) : null}
            </div>
          ) : null}
          {copyNotice ? (
            <p aria-live="polite" className="publication-copy-notice" role="status">
              {copyNotice}
            </p>
          ) : null}
          {actionError ? (
            <p className="publication-action-error" role="alert">
              {actionError}
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
