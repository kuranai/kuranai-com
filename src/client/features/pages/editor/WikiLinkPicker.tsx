import { useEffect, useId, useRef } from 'react';
import type { KeyboardEventHandler } from 'react';

import type { PageSummary } from '../../../../shared/pages';

export type WikiLinkPickerSource = 'autocomplete' | 'slash' | 'toolbar';

export type WikiLinkPickerOption =
  { kind: 'page'; page: PageSummary } | { kind: 'create'; title: string };

export interface WikiLinkPickerProps {
  activeIndex: number;
  error: string | null;
  isCreating: boolean;
  isSearching: boolean;
  onCreatePage: (title: string) => void;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  onQueryChange?: (query: string) => void;
  onSelectPage: (page: PageSummary) => void;
  options: WikiLinkPickerOption[];
  position: { left: number; top: number };
  query: string;
  source: WikiLinkPickerSource;
}

export function WikiLinkPicker({
  activeIndex,
  error,
  isCreating,
  isSearching,
  onCreatePage,
  onKeyDown,
  onQueryChange,
  onSelectPage,
  options,
  position,
  query,
  source,
}: WikiLinkPickerProps) {
  const searchInputId = `wiki-link-search-${useId()}`;
  const listboxId = `wiki-link-options-${useId()}`;
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (source === 'toolbar' || source === 'slash') {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }
  }, [source]);

  return (
    <div
      aria-label="Wiki link picker"
      className="wiki-link-picker"
      data-dovari-wiki-link-picker={source}
      onKeyDown={onKeyDown}
      role="dialog"
      style={{ left: position.left, top: position.top }}
    >
      {source === 'toolbar' || source === 'slash' ? (
        <label className="wiki-link-search-label" htmlFor={searchInputId}>
          Search pages to link
          <input
            aria-controls={listboxId}
            autoComplete="off"
            id={searchInputId}
            onChange={(event) => onQueryChange?.(event.target.value)}
            placeholder="Search pages…"
            ref={searchInputRef}
            type="search"
            value={query}
          />
        </label>
      ) : null}
      <p className="wiki-link-help">
        Type <code>[[</code> in the editor to search internal pages, then press Enter to insert a
        link.
      </p>
      <div
        aria-label="Wiki link suggestions"
        aria-busy={isSearching}
        className="wiki-link-options"
        id={listboxId}
        role="listbox"
      >
        {isSearching ? <p className="wiki-link-autocomplete-state">Searching pages…</p> : null}
        {!isSearching && options.length === 0 && !error ? (
          <p className="wiki-link-autocomplete-state">No matching pages.</p>
        ) : null}
        {options.map((option, index) =>
          option.kind === 'page' ? (
            <button
              aria-selected={index === activeIndex}
              className={index === activeIndex ? 'wiki-link-option is-active' : 'wiki-link-option'}
              key={option.page.id}
              onClick={() => onSelectPage(option.page)}
              onMouseDown={(event) => event.preventDefault()}
              role="option"
              type="button"
            >
              <span>{option.page.title}</span>
              <small>/{option.page.slug}</small>
            </button>
          ) : (
            <button
              aria-selected={index === activeIndex}
              className={
                index === activeIndex
                  ? 'wiki-link-option is-active wiki-link-create-option'
                  : 'wiki-link-option wiki-link-create-option'
              }
              disabled={isCreating}
              key="create-page"
              onClick={() => onCreatePage(option.title)}
              onMouseDown={(event) => event.preventDefault()}
              role="option"
              type="button"
            >
              <span>{isCreating ? `Creating “${option.title}”…` : `Create “${option.title}”`}</span>
            </button>
          ),
        )}
      </div>
      {error ? (
        <p className="wiki-link-autocomplete-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
