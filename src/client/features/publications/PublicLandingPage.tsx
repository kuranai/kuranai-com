import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import type { PublicPublicationSummary } from '../../../shared/publications';
import { fetchPublicPublications, publicationErrorMessage } from './api';
import { PublicSearch } from './PublicSearch';

type LandingState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; publications: PublicPublicationSummary[]; loadingMore: boolean };

function PublicHeader() {
  return (
    <header className="public-header">
      <Link className="brand" to="/">
        <span aria-hidden="true" className="brand-mark">
          D
        </span>
        <span>Dovari</span>
      </Link>
      <a className="button button-secondary" href="/app">
        Edit privately
      </a>
    </header>
  );
}

export function PublicLandingPage() {
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<LandingState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    const publications: PublicPublicationSummary[] = [];
    setState({ status: 'loading' });

    async function load() {
      try {
        let cursor: string | null = null;
        do {
          const response = await fetchPublicPublications(cursor, controller.signal);
          publications.push(...response.publications);
          if (!controller.signal.aborted) {
            setState({
              status: 'ready',
              publications: [...publications],
              loadingMore: response.nextCursor !== null,
            });
          }
          cursor = response.nextCursor;
        } while (cursor !== null && !controller.signal.aborted);
        if (!controller.signal.aborted) {
          setState({ status: 'ready', publications: [...publications], loadingMore: false });
        }
      } catch (error: unknown) {
        if (!controller.signal.aborted) {
          setState({
            status: 'error',
            message: publicationErrorMessage(
              error,
              'The public knowledge base could not be loaded.',
            ),
          });
        }
      }
    }

    void load();
    return () => controller.abort();
  }, [reloadKey]);

  return (
    <div className="public-shell">
      <PublicHeader />
      <main className="public-main" id="main-content" tabIndex={-1}>
        <section aria-labelledby="public-home-title" className="public-landing-intro">
          <span className="state-kicker">A shared knowledge base</span>
          <h1 id="public-home-title">Useful things, made public.</h1>
          <p>Browse the pages the owner has chosen to publish.</p>
        </section>

        <PublicSearch />

        {state.status === 'loading' ? (
          <section aria-busy="true" aria-live="polite" className="public-state">
            <h2>Loading public pages…</h2>
            <p>Preparing the latest published knowledge.</p>
          </section>
        ) : null}
        {state.status === 'error' ? (
          <section aria-live="assertive" className="public-state public-state-error" role="alert">
            <h2>Public pages are unavailable.</h2>
            <p>{state.message}</p>
            <button
              className="button button-secondary"
              onClick={() => setReloadKey((value) => value + 1)}
              type="button"
            >
              Retry
            </button>
          </section>
        ) : null}
        {state.status === 'ready' && state.publications.length === 0 ? (
          <section aria-live="polite" className="public-state public-state-empty">
            <h2>No public pages yet.</h2>
            <p>The owner can publish pages from the private workspace when they are ready.</p>
            <a className="button button-secondary" href="/app">
              Edit privately
            </a>
          </section>
        ) : null}
        {state.status === 'ready' && state.publications.length > 0 ? (
          <section aria-labelledby="public-pages-title" className="public-publications">
            <div className="public-section-heading">
              <div>
                <span className="state-kicker">Published pages</span>
                <h2 id="public-pages-title">Knowledge worth sharing</h2>
              </div>
              <span className="page-count">{state.publications.length}</span>
            </div>
            <div className="public-publication-grid">
              {state.publications.map((publication) => (
                <Link
                  className="public-publication-card"
                  key={publication.publicId}
                  to={`/p/${encodeURIComponent(publication.publicId)}`}
                >
                  <h3>{publication.publishedTitle}</h3>
                  <time dateTime={publication.updatedAt}>
                    Updated {new Date(publication.updatedAt).toLocaleDateString()}
                  </time>
                  {publication.tags.length > 0 ? (
                    <div aria-label="Published tags" className="public-tag-list">
                      {publication.tags.map((tag) => (
                        <span className="tag-chip" key={tag}>
                          #{tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </Link>
              ))}
            </div>
            {state.loadingMore ? (
              <p aria-live="polite" className="public-loading-more">
                Loading more published pages…
              </p>
            ) : null}
          </section>
        ) : null}
      </main>
    </div>
  );
}
