import { useEffect, useMemo, useState, type FormEvent } from 'react';

import type { PageDetail } from '../../../shared/pages';
import type { TagSummary } from '../../../shared/tags';
import { pageErrorMessage } from '../pages/api';
import {
  createTag,
  deleteTag,
  fetchTags,
  renameTag,
  updatePageFavorite,
  updatePageTags,
} from './api';

interface PageOrganizationProps {
  onPageUpdated: (page: PageDetail) => void;
  page: PageDetail;
}

function tagIdsForPage(page: PageDetail) {
  return new Set(page.tags.map((tag) => tag.id));
}

export function PageOrganization({ onPageUpdated, page }: PageOrganizationProps) {
  const [isTagManagerOpen, setIsTagManagerOpen] = useState(false);
  const [tags, setTags] = useState<TagSummary[]>(page.tags);
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(() => tagIdsForPage(page));
  const [isFavoriteSaving, setIsFavoriteSaving] = useState(false);
  const [isTagsLoading, setIsTagsLoading] = useState(false);
  const [isTagsSaving, setIsTagsSaving] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [renamingTagId, setRenamingTagId] = useState<string | null>(null);
  const [renamedTagName, setRenamedTagName] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setSelectedTagIds(tagIdsForPage(page));
    setTags((currentTags) => {
      const currentById = new Map(currentTags.map((tag) => [tag.id, tag]));
      page.tags.forEach((tag) => currentById.set(tag.id, tag));
      return [...currentById.values()].sort((left, right) => left.name.localeCompare(right.name));
    });
  }, [page]);

  useEffect(() => {
    if (!isTagManagerOpen) return;
    const controller = new AbortController();
    setIsTagsLoading(true);
    fetchTags(controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) setTags(response.tags);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setActionError(pageErrorMessage(error, 'The tags could not be loaded.'));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsTagsLoading(false);
      });
    return () => controller.abort();
  }, [isTagManagerOpen]);

  const selectedTags = useMemo(
    () => tags.filter((tag) => selectedTagIds.has(tag.id)),
    [selectedTagIds, tags],
  );

  async function handleFavoriteToggle() {
    if (isFavoriteSaving) return;
    setIsFavoriteSaving(true);
    setActionError(null);
    try {
      const response = await updatePageFavorite(page.id, { isFavorite: !page.isFavorite });
      onPageUpdated(response.page);
    } catch (error: unknown) {
      setActionError(pageErrorMessage(error, 'The favorite status could not be saved.'));
    } finally {
      setIsFavoriteSaving(false);
    }
  }

  function toggleTag(tagId: string) {
    setSelectedTagIds((current) => {
      const next = new Set(current);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  }

  async function handleSaveTags() {
    if (isTagsSaving) return;
    setIsTagsSaving(true);
    setActionError(null);
    try {
      const response = await updatePageTags(page.id, { tagIds: [...selectedTagIds] });
      onPageUpdated(response.page);
    } catch (error: unknown) {
      setActionError(pageErrorMessage(error, 'The page tags could not be saved.'));
    } finally {
      setIsTagsSaving(false);
    }
  }

  async function handleCreateTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newTagName.trim().length === 0) return;
    setActionError(null);
    try {
      const response = await createTag({ name: newTagName });
      setTags((current) =>
        [...current, response.tag].sort((left, right) => left.name.localeCompare(right.name)),
      );
      setSelectedTagIds((current) => new Set(current).add(response.tag.id));
      setNewTagName('');
    } catch (error: unknown) {
      setActionError(pageErrorMessage(error, 'The tag could not be created.'));
    }
  }

  function startRename(tag: TagSummary) {
    setRenamingTagId(tag.id);
    setRenamedTagName(tag.name);
    setActionError(null);
  }

  async function handleRenameTag(event: FormEvent<HTMLFormElement>, tagId: string) {
    event.preventDefault();
    if (renamedTagName.trim().length === 0) return;
    setActionError(null);
    try {
      const response = await renameTag(tagId, { name: renamedTagName });
      setTags((current) =>
        current
          .map((tag) => (tag.id === tagId ? response.tag : tag))
          .sort((left, right) => left.name.localeCompare(right.name)),
      );
      if (page.tags.some((tag) => tag.id === tagId)) {
        const pageResponse = await updatePageTags(page.id, {
          tagIds: page.tags.map((tag) => tag.id),
        });
        onPageUpdated(pageResponse.page);
      }
      setRenamingTagId(null);
      setRenamedTagName('');
    } catch (error: unknown) {
      setActionError(pageErrorMessage(error, 'The tag could not be renamed.'));
    }
  }

  async function handleDeleteTag(tag: TagSummary) {
    if (!window.confirm(`Delete the tag “${tag.name}”?`)) return;
    setActionError(null);
    try {
      await deleteTag(tag.id);
      const nextTagIds = new Set(selectedTagIds);
      nextTagIds.delete(tag.id);
      setTags((current) => current.filter((candidate) => candidate.id !== tag.id));
      setSelectedTagIds(nextTagIds);
      if (page.tags.some((candidate) => candidate.id === tag.id)) {
        const response = await updatePageTags(page.id, { tagIds: [...nextTagIds] });
        onPageUpdated(response.page);
      }
    } catch (error: unknown) {
      setActionError(pageErrorMessage(error, 'The tag could not be deleted.'));
    }
  }

  return (
    <section aria-labelledby="page-organization-title" className="page-organization">
      <div className="page-organization-heading">
        <div>
          <span className="state-kicker">Organization</span>
          <h2 id="page-organization-title">Tags and favorite</h2>
        </div>
        <button
          aria-pressed={page.isFavorite}
          className={`favorite-button${page.isFavorite ? ' is-active' : ''}`}
          disabled={isFavoriteSaving}
          onClick={() => void handleFavoriteToggle()}
          type="button"
        >
          <svg aria-hidden="true" className="favorite-icon" focusable="false" viewBox="0 0 16 16">
            <path d="m8 1.75 1.73 3.51 3.87.56-2.8 2.73.66 3.85L8 10.58l-3.46 1.82.66-3.85-2.8-2.73 3.87-.56L8 1.75Z" />
          </svg>
          {page.isFavorite ? 'Favorited' : 'Add to favorites'}
        </button>
      </div>
      <div className="page-organization-footer">
        <div className="page-tag-list" aria-label="Page tags">
          {selectedTags.length > 0 ? (
            selectedTags.map((tag) => (
              <span className="tag-chip" key={tag.id}>
                {tag.name}
              </span>
            ))
          ) : (
            <span className="page-organization-empty">No tags assigned.</span>
          )}
        </div>
        <button
          aria-expanded={isTagManagerOpen}
          className="button button-quiet page-tag-manager-toggle"
          onClick={() => {
            setActionError(null);
            setIsTagManagerOpen((open) => !open);
          }}
          type="button"
        >
          {isTagManagerOpen ? 'Close tag manager' : 'Manage tags'}
        </button>
      </div>
      {isTagManagerOpen ? (
        <div className="page-tag-manager">
          <form className="page-tag-create" onSubmit={(event) => void handleCreateTag(event)}>
            <label htmlFor="new-page-tag">Create a tag</label>
            <div className="page-tag-create-row">
              <input
                id="new-page-tag"
                maxLength={50}
                onChange={(event) => setNewTagName(event.target.value)}
                placeholder="e.g. project"
                value={newTagName}
              />
              <button className="button button-secondary" type="submit">
                Add tag
              </button>
            </div>
          </form>
          {isTagsLoading ? <p className="page-organization-state">Loading tags…</p> : null}
          {!isTagsLoading && tags.length === 0 ? (
            <p className="page-organization-state">Create your first tag above.</p>
          ) : null}
          {!isTagsLoading && tags.length > 0 ? (
            <fieldset className="page-tag-options">
              <legend>Assign tags to this page</legend>
              {tags.map((tag) => (
                <div className="page-tag-option" key={tag.id}>
                  {renamingTagId === tag.id ? (
                    <form onSubmit={(event) => void handleRenameTag(event, tag.id)}>
                      <label className="sr-only" htmlFor={`rename-tag-${tag.id}`}>
                        Rename {tag.name}
                      </label>
                      <input
                        autoFocus
                        id={`rename-tag-${tag.id}`}
                        maxLength={50}
                        onChange={(event) => setRenamedTagName(event.target.value)}
                        value={renamedTagName}
                      />
                      <button className="button button-quiet" type="submit">
                        Save
                      </button>
                      <button
                        className="button button-quiet"
                        onClick={() => setRenamingTagId(null)}
                        type="button"
                      >
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <>
                      <label>
                        <input
                          checked={selectedTagIds.has(tag.id)}
                          onChange={() => toggleTag(tag.id)}
                          type="checkbox"
                        />
                        <span>{tag.name}</span>
                      </label>
                      <button
                        aria-label={`Rename tag ${tag.name}`}
                        className="button button-quiet"
                        onClick={() => startRename(tag)}
                        type="button"
                      >
                        Rename
                      </button>
                      <button
                        aria-label={`Delete tag ${tag.name}`}
                        className="button button-quiet tag-delete-button"
                        onClick={() => void handleDeleteTag(tag)}
                        type="button"
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              ))}
            </fieldset>
          ) : null}
          <button
            className="button button-primary"
            disabled={isTagsSaving || isTagsLoading}
            onClick={() => void handleSaveTags()}
            type="button"
          >
            {isTagsSaving ? 'Saving tags…' : 'Save page tags'}
          </button>
        </div>
      ) : null}
      {actionError ? (
        <p className="page-action-error" role="alert">
          {actionError}
        </p>
      ) : null}
    </section>
  );
}
