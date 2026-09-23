import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { parseSearchSnippet } from '../../../shared/search';
import type { PublicSearchResult } from '../../../shared/public-search';
import { publicationErrorMessage, searchPublicPages } from './api';

type SearchState =
  | { status: 'idle' }
  | { status: 'loading'; results: PublicSearchResult[] }
  | { status: 'ready'; results: PublicSearchResult[] }
  | { status: 'error'; message: string };

function SearchSnippet({ value }: { value: string }) {
  return (
    <span className="public-search-snippet">
      {parseSearchSnippet(value).map((segment, index) =>
        segment.highlighted ? (
          <mark key={`${segment.text}-${index}`}>{segment.text}</mark>
        ) : (
          <span key={`${segment.text}-${index}`}>{segment.text}</span>
        ),
      )}
    </span>
  );
}

export function PublicSearch({ compact = false }: { compact?: boolean }) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const [state, setState] = useState<SearchState>({ status: 'idle' });
  const results: PublicSearchResult[] =
    state.status === 'idle' || state.status === 'error' ? [] : state.results;
  const listId = compact ? 'public-sidebar-search-results' : 'public-search-results';

  useEffect(() => {
    const normalized = query.trim();
    if (normalized.length === 0) {
      setState({ status: 'idle' });
      setActiveIndex(-1);
      return;
    }

    const controller = new AbortController();
    const currentRequestId = ++requestId.current;
    setState((current) => ({
      status: 'loading',
      results: current.status === 'ready' || current.status === 'loading' ? current.results : [],
    }));
    setActiveIndex(-1);
    const timeout = window.setTimeout(() => {
      searchPublicPages(normalized, controller.signal)
        .then((response) => {
          if (controller.signal.aborted || currentRequestId !== requestId.current) return;
          setState({ status: 'ready', results: response.results });
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted || currentRequestId !== requestId.current) return;
          setState({
            status: 'error',
            message: publicationErrorMessage(error, 'Public search is temporarily unavailable.'),
          });
        });
    }, 180);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [query]);

  function selectResult(result: PublicSearchResult) {
    setQuery('');
    setState({ status: 'idle' });
    setActiveIndex(-1);
    navigate(result.url);
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    setQuery(event.target.value);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => (results.length === 0 ? -1 : (current + 1) % results.length));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) =>
        results.length === 0 ? -1 : (current - 1 + results.length) % results.length,
      );
    } else if (event.key === 'Enter' && activeIndex >= 0 && results[activeIndex]) {
      event.preventDefault();
      selectResult(results[activeIndex]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setQuery('');
      inputRef.current?.blur();
    }
  }

  return (
    <section className={`public-search${compact ? ' public-search-compact' : ''}`}>
      <label className="sr-only" htmlFor={compact ? 'public-sidebar-search' : 'public-search'}>
        Search public pages
      </label>
      <div className="public-search-field">
        <svg
          aria-hidden="true"
          className="public-search-icon"
          focusable="false"
          viewBox="0 0 24 24"
        >
          <circle cx="10.8" cy="10.8" r="6.4" />
          <path d="m15.6 15.6 4.2 4.2" />
        </svg>
        <input
          aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
          aria-controls={results.length > 0 ? listId : undefined}
          aria-label="Search public pages"
          autoComplete="off"
          className="public-search-input"
          id={compact ? 'public-sidebar-search' : 'public-search'}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Search titles and content…"
          ref={inputRef}
          role="searchbox"
          type="search"
          value={query}
        />
      </div>
      {state.status === 'loading' ? (
        <p aria-live="polite" className="public-search-status">
          Searching…
        </p>
      ) : null}
      {state.status === 'error' ? (
        <p aria-live="assertive" className="public-search-status public-search-error" role="alert">
          {state.message}
        </p>
      ) : null}
      {state.status === 'ready' && query.trim().length > 0 && results.length === 0 ? (
        <p aria-live="polite" className="public-search-status">
          No public pages found.
        </p>
      ) : null}
      {results.length > 0 ? (
        <ul className="public-search-results" id={listId} role="listbox">
          {results.map((result, index) => (
            <li
              aria-selected={index === activeIndex}
              className={index === activeIndex ? 'is-active' : ''}
              id={`${listId}-${index}`}
              key={result.publicId}
              role="option"
            >
              <Link
                onClick={(event) => {
                  event.preventDefault();
                  selectResult(result);
                }}
                onMouseEnter={() => setActiveIndex(index)}
                to={result.url}
              >
                <strong>{result.publishedTitle}</strong>
                {result.breadcrumb.length > 0 ? (
                  <span className="public-search-breadcrumb">
                    {result.breadcrumb.map((item) => item.publishedTitle).join(' / ')}
                  </span>
                ) : null}
                <SearchSnippet value={result.snippet} />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
