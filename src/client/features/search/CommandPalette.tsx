import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';

import {
  normalizeSearchQuery,
  parseSearchSnippet,
  type SearchResult,
} from '../../../shared/search';
import type { TagSummary } from '../../../shared/tags';
import { pageErrorMessage } from '../pages/api';
import { searchPages } from './api';

const SEARCH_DEBOUNCE_MS = 200;

interface PaletteCommand {
  description: string;
  id: string;
  keywords: string[];
  label: string;
  onSelect: () => void;
  shortcut?: string;
}

type PaletteEntry =
  { command: PaletteCommand; kind: 'command' } | { kind: 'result'; result: SearchResult };

type SearchState =
  | { error: null; results: SearchResult[]; status: 'idle' | 'waiting' | 'loading' | 'ready' }
  | { error: string; results: SearchResult[]; status: 'error' };

export interface CommandPaletteProps {
  canCreatePage: boolean;
  isCreating: boolean;
  onClose: () => void;
  onCreatePage: () => void;
  onOpenPage: (url: string) => void;
  onOpenDailyNote?: () => void;
  onThemeToggle?: () => void;
  onFilterChange?: (filter: { favorite?: boolean; tagId?: string }) => void;
  availableTags?: TagSummary[];
  searchFilters?: { favorite?: boolean; tagId?: string };
}

function entryId(entry: PaletteEntry) {
  if (entry.kind === 'command') {
    return `command-palette-command-${entry.command.id}`;
  }

  return `command-palette-result-${entry.result.id}`;
}

function getFocusableElements(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hasAttribute('aria-hidden'));
}

function SearchSnippet({ snippet }: { snippet: string }) {
  const segments = parseSearchSnippet(snippet);

  if (segments.length === 0) {
    return <span className="command-palette-snippet-empty">No matching excerpt.</span>;
  }

  return (
    <>
      {segments.map((segment, index) =>
        segment.highlighted ? (
          <mark key={`${index}-${segment.text}`}>{segment.text}</mark>
        ) : (
          <span key={`${index}-${segment.text}`}>{segment.text}</span>
        ),
      )}
    </>
  );
}

function SearchResultOption({ result }: { result: SearchResult }) {
  return (
    <>
      <span className="command-palette-option-main">
        <strong>{result.title}</strong>
        {result.breadcrumb.length > 0 ? (
          <span className="command-palette-breadcrumb">
            {result.breadcrumb.map((crumb) => crumb.title).join(' / ')}
          </span>
        ) : null}
        <span className="command-palette-snippet">
          <SearchSnippet snippet={result.snippet} />
        </span>
      </span>
      <span aria-hidden="true" className="command-palette-option-arrow">
        ↵
      </span>
    </>
  );
}

function CommandOption({ command }: { command: PaletteCommand }) {
  return (
    <>
      <span className="command-palette-option-main">
        <strong>{command.label}</strong>
        <span className="command-palette-command-description">{command.description}</span>
      </span>
      {command.shortcut ? <kbd>{command.shortcut}</kbd> : null}
    </>
  );
}

function PaletteOption({
  entry,
  index,
  onFocus,
  onSelect,
  isActive,
}: {
  entry: PaletteEntry;
  index: number;
  isActive: boolean;
  onFocus: (index: number) => void;
  onSelect: (entry: PaletteEntry) => void;
}) {
  const label = entry.kind === 'command' ? entry.command.label : entry.result.title;

  return (
    <li className="command-palette-option-item">
      <button
        aria-selected={isActive}
        className={`command-palette-option${isActive ? ' is-active' : ''}`}
        id={entryId(entry)}
        onClick={() => onSelect(entry)}
        onFocus={() => onFocus(index)}
        role="option"
        type="button"
      >
        {entry.kind === 'command' ? (
          <CommandOption command={entry.command} />
        ) : (
          <SearchResultOption result={entry.result} />
        )}
        <span className="sr-only">Open {label}</span>
      </button>
    </li>
  );
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function CommandPalette({
  canCreatePage,
  isCreating,
  onClose,
  onCreatePage,
  onOpenDailyNote,
  onOpenPage,
  onThemeToggle,
  onFilterChange,
  availableTags = [],
  searchFilters = {},
}: CommandPaletteProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [retryNonce, setRetryNonce] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [searchState, setSearchState] = useState<SearchState>({
    error: null,
    results: [],
    status: 'idle',
  });
  const requestVersionRef = useRef(0);
  const titleId = useId();
  const hintId = useId();
  const resultsId = useId();

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const normalizedQuery = normalizeSearchQuery(query);
    const requestVersion = ++requestVersionRef.current;

    if (normalizedQuery.length === 0) {
      setSearchState({ error: null, results: [], status: 'idle' });
      return;
    }

    setSearchState({ error: null, results: [], status: 'waiting' });
    let controller: AbortController | null = null;
    const timeoutId = window.setTimeout(() => {
      const requestController = new AbortController();
      controller = requestController;
      setSearchState({ error: null, results: [], status: 'loading' });

      void searchPages(normalizedQuery, requestController.signal, searchFilters)
        .then((response) => {
          if (requestVersion !== requestVersionRef.current || requestController.signal.aborted) {
            return;
          }

          setSearchState({ error: null, results: response.results, status: 'ready' });
        })
        .catch((error: unknown) => {
          if (
            requestVersion !== requestVersionRef.current ||
            requestController.signal.aborted ||
            isAbortError(error)
          ) {
            return;
          }

          setSearchState({
            error: pageErrorMessage(error, 'Search is unavailable. Try again.'),
            results: [],
            status: 'error',
          });
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
      controller?.abort();
    };
  }, [query, retryNonce, searchFilters.favorite, searchFilters.tagId]);

  const commands = useMemo<PaletteCommand[]>(
    () => [
      {
        description: 'Open a fresh page in your workspace.',
        id: 'new-page',
        keywords: ['create', 'new', 'page'],
        label: 'Create new page',
        onSelect: () => {
          if (!canCreatePage || isCreating) {
            return;
          }
          onCreatePage();
          onClose();
        },
        shortcut: '⌘N',
      },
      {
        description: 'Search across the full workspace.',
        id: 'all-pages',
        keywords: ['all', 'pages', 'reset', 'filter'],
        label: 'Search all pages',
        onSelect: () => {
          onFilterChange?.({});
          onClose();
        },
      },
      {
        description: 'Limit command-palette search to favorite pages.',
        id: 'favorite-pages',
        keywords: ['favorite', 'starred', 'important'],
        label: 'Search favorite pages',
        onSelect: () => {
          onFilterChange?.({ favorite: true });
          onClose();
        },
      },
      ...availableTags.map((tag) => ({
        description: `Search pages tagged ${tag.name}.`,
        id: `tag-${tag.id}`,
        keywords: ['tag', tag.name],
        label: `Search #${tag.name}`,
        onSelect: () => {
          onFilterChange?.({ tagId: tag.id });
          onClose();
        },
      })),
      {
        description: 'Switch between light and dark themes.',
        id: 'theme',
        keywords: ['dark', 'light', 'appearance', 'theme'],
        label: 'Toggle theme',
        onSelect: () => {
          onThemeToggle?.();
          onClose();
        },
      },
      {
        description: 'Create a page from a reusable template.',
        id: 'templates',
        keywords: ['template', 'templates', 'reusable', 'page'],
        label: 'Create from template',
        onSelect: () => {
          onOpenPage('/app/settings/templates');
          onClose();
        },
      },
      {
        description: 'Open or create today’s note in your local time zone.',
        id: 'daily-note',
        keywords: ['daily', 'today', 'journal', 'note'],
        label: 'Open today’s note',
        onSelect: () => {
          onOpenDailyNote?.();
          onClose();
        },
      },
      {
        description: 'Review deleted pages and recovery options.',
        id: 'settings',
        keywords: ['preferences', 'settings', 'configuration'],
        label: 'Go to settings',
        onSelect: () => {
          onOpenPage('/app/settings');
          onClose();
        },
      },
    ],
    [
      availableTags,
      canCreatePage,
      isCreating,
      onClose,
      onCreatePage,
      onFilterChange,
      onOpenPage,
      onOpenDailyNote,
      onThemeToggle,
    ],
  );

  const normalizedQuery = normalizeSearchQuery(query).toLocaleLowerCase();
  const filteredCommands = commands.filter((command) => {
    if (normalizedQuery.length === 0) {
      return true;
    }

    return [command.label, command.description, ...command.keywords].some((value) =>
      value.toLocaleLowerCase().includes(normalizedQuery),
    );
  });
  const entries = useMemo<PaletteEntry[]>(
    () => [
      ...filteredCommands.map((command): PaletteEntry => ({ command, kind: 'command' })),
      ...searchState.results.map((result): PaletteEntry => ({ kind: 'result', result })),
    ],
    [filteredCommands, searchState.results],
  );
  const activeEntry = activeIndex >= 0 ? entries[activeIndex] : undefined;

  useEffect(() => {
    setActiveIndex(entries.length > 0 ? 0 : -1);
  }, [entries.length, query, searchState.status]);

  useEffect(() => {
    const activeId = activeEntry ? entryId(activeEntry) : null;
    if (!activeId) {
      return;
    }

    const activeElement = document.getElementById(activeId);
    activeElement?.scrollIntoView?.({ block: 'nearest' });
  }, [activeEntry]);

  function moveActive(delta: number) {
    setActiveIndex((currentIndex) => {
      if (entries.length === 0) {
        return -1;
      }

      const startIndex = currentIndex < 0 ? (delta > 0 ? 0 : entries.length - 1) : currentIndex;
      return (startIndex + delta + entries.length) % entries.length;
    });
  }

  function selectEntry(entry: PaletteEntry | undefined) {
    if (!entry) {
      return;
    }

    if (entry.kind === 'command') {
      entry.command.onSelect();
      return;
    }

    onOpenPage(entry.result.url);
    onClose();
  }

  function handleInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        moveActive(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        moveActive(-1);
        break;
      case 'Home':
        if (entries.length > 0) {
          event.preventDefault();
          setActiveIndex(0);
        }
        break;
      case 'End':
        if (entries.length > 0) {
          event.preventDefault();
          setActiveIndex(entries.length - 1);
        }
        break;
      case 'Enter':
        event.preventDefault();
        selectEntry(activeEntry);
        break;
      case 'Escape':
        event.preventDefault();
        onClose();
        break;
      default:
        break;
    }
  }

  function handleDialogKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key !== 'Tab' || !dialogRef.current) {
      return;
    }

    const focusableElements = getFocusableElements(dialogRef.current);
    if (focusableElements.length === 0) {
      event.preventDefault();
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    const currentElement = document.activeElement;

    if (event.shiftKey && currentElement === firstElement) {
      event.preventDefault();
      lastElement?.focus();
    } else if (!event.shiftKey && currentElement === lastElement) {
      event.preventDefault();
      firstElement?.focus();
    }
  }

  function handleBackdropMouseDown(event: React.MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) {
      onClose();
    }
  }

  return (
    <div className="command-palette-backdrop" onMouseDown={handleBackdropMouseDown}>
      <div
        aria-describedby={hintId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="command-palette-dialog"
        onKeyDown={handleDialogKeyDown}
        ref={dialogRef}
        role="dialog"
      >
        <div className="command-palette-heading">
          <div>
            <span className="state-kicker">Quick access</span>
            <h2 id={titleId}>Search or run a command</h2>
          </div>
          <button
            aria-label="Close command palette"
            className="command-palette-close"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>
        <div className="command-palette-search-row">
          <span aria-hidden="true" className="command-palette-search-icon">
            ⌕
          </span>
          <input
            aria-activedescendant={activeEntry ? entryId(activeEntry) : undefined}
            aria-autocomplete="list"
            aria-busy={searchState.status === 'loading' || searchState.status === 'waiting'}
            aria-controls={resultsId}
            aria-describedby={hintId}
            aria-label="Search pages or commands"
            autoComplete="off"
            className="command-palette-input"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="Search pages or commands…"
            ref={inputRef}
            role="searchbox"
            type="search"
            value={query}
          />
          <kbd>Esc</kbd>
        </div>
        <p className="sr-only" id={hintId}>
          Use the arrow keys to move, Enter to open, and Escape to close.
        </p>
        <div className="command-palette-body">
          <div
            aria-label="Command palette options"
            className="command-palette-results"
            id={resultsId}
            role="listbox"
          >
            {filteredCommands.length > 0 ? (
              <div aria-label="Actions" className="command-palette-group" role="group">
                <p className="command-palette-group-label">Actions</p>
                <ul className="command-palette-list">
                  {filteredCommands.map((command, index) => (
                    <PaletteOption
                      entry={{ command, kind: 'command' }}
                      index={index}
                      isActive={activeIndex === index}
                      key={command.id}
                      onFocus={setActiveIndex}
                      onSelect={selectEntry}
                    />
                  ))}
                </ul>
              </div>
            ) : null}

            {searchState.results.length > 0 ? (
              <div
                aria-label="Pages"
                className="command-palette-group command-palette-page-group"
                role="group"
              >
                <p className="command-palette-group-label">Pages</p>
                <ul className="command-palette-list">
                  {searchState.results.map((result, resultIndex) => {
                    const index = filteredCommands.length + resultIndex;
                    return (
                      <PaletteOption
                        entry={{ kind: 'result', result }}
                        index={index}
                        isActive={activeIndex === index}
                        key={result.id}
                        onFocus={setActiveIndex}
                        onSelect={selectEntry}
                      />
                    );
                  })}
                </ul>
              </div>
            ) : null}

            {searchState.status === 'waiting' || searchState.status === 'loading' ? (
              <p aria-live="polite" className="command-palette-status">
                {searchState.status === 'waiting' ? 'Preparing search…' : 'Searching…'}
              </p>
            ) : null}
            {searchState.status === 'error' ? (
              <div className="command-palette-error" role="alert">
                <p>{searchState.error}</p>
                <button
                  className="button button-secondary"
                  onClick={() => setRetryNonce((value) => value + 1)}
                  type="button"
                >
                  Retry search
                </button>
              </div>
            ) : null}
            {normalizedQuery.length > 0 &&
            searchState.status === 'ready' &&
            filteredCommands.length === 0 &&
            searchState.results.length === 0 ? (
              <p className="command-palette-empty">No pages or commands match “{query}”.</p>
            ) : null}
          </div>
        </div>
        <div className="command-palette-footer" aria-hidden="true">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> Navigate
          </span>
          <span>
            <kbd>↵</kbd> Open
          </span>
          <span>
            <kbd>Esc</kbd> Close
          </span>
        </div>
      </div>
    </div>
  );
}
