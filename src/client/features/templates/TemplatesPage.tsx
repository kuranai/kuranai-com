import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import {
  emptyTemplateDocument,
  type TemplateDetail,
  type TemplateSummary,
} from '../../../shared/templates';
import {
  createPageFromTemplate,
  createTemplate,
  deleteTemplate,
  fetchTemplate,
  fetchTemplates,
  openDailyNote,
  templateErrorMessage,
  updateTemplate,
} from './api';

type TemplateListState = 'loading' | 'ready' | 'error';

const PageEditor = lazy(async () => {
  const module = await import('../pages/editor/PageEditor');
  return { default: module.PageEditor };
});

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function TemplatesPage() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [listState, setListState] = useState<TemplateListState>('loading');
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateDetail | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState(emptyTemplateDocument);
  const [isDailyNote, setIsDailyNote] = useState(false);
  const [isLoadingTemplate, setIsLoadingTemplate] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isOpeningPage, setIsOpeningPage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setListState('loading');
    fetchTemplates(controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) {
          setTemplates(response.templates);
          setListState('ready');
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted && !isAbortError(cause)) {
          setListState('error');
          setError(templateErrorMessage(cause, 'The templates could not be loaded.'));
        }
      });

    return () => controller.abort();
  }, []);

  function clearFeedback() {
    setError(null);
    setNotice(null);
  }

  function startNewTemplate() {
    clearFeedback();
    setSelectedTemplate(null);
    setTitle('');
    setContent(emptyTemplateDocument());
    setIsDailyNote(false);
  }

  async function selectTemplate(id: string) {
    if (isLoadingTemplate || isSaving || isDeleting) return;
    clearFeedback();
    setIsLoadingTemplate(true);
    try {
      const response = await fetchTemplate(id);
      setSelectedTemplate(response.template);
      setTitle(response.template.title);
      setContent(response.template.content);
      setIsDailyNote(response.template.isDailyNote);
    } catch (cause: unknown) {
      setError(templateErrorMessage(cause, 'The template could not be loaded.'));
    } finally {
      setIsLoadingTemplate(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving || isDeleting || isLoadingTemplate) return;
    const nextTitle = title.trim();
    if (nextTitle.length === 0) {
      setError('A template title is required.');
      return;
    }

    setIsSaving(true);
    clearFeedback();
    try {
      if (selectedTemplate === null) {
        const response = await createTemplate({
          content,
          isDailyNote,
          title: nextTitle,
        });
        setSelectedTemplate(response.template);
        setTitle(response.template.title);
        setContent(response.template.content);
        setIsDailyNote(response.template.isDailyNote);
        setTemplates((current) => [
          ...current.filter((template) => template.id !== response.template.id),
          response.template,
        ]);
        setNotice('Template created.');
      } else {
        const response = await updateTemplate(selectedTemplate.id, {
          baseRevision: selectedTemplate.revision,
          content,
          isDailyNote,
          title: nextTitle,
        });
        setSelectedTemplate(response.template);
        setTitle(response.template.title);
        setContent(response.template.content);
        setIsDailyNote(response.template.isDailyNote);
        setTemplates((current) =>
          current.map((template) =>
            template.id === response.template.id ? response.template : template,
          ),
        );
        setNotice('Template saved.');
      }
    } catch (cause: unknown) {
      setError(templateErrorMessage(cause, 'The template could not be saved.'));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (selectedTemplate === null || isDeleting || isSaving) return;
    if (!window.confirm(`Delete the template “${selectedTemplate.title}”?`)) return;

    setIsDeleting(true);
    clearFeedback();
    try {
      await deleteTemplate(selectedTemplate.id, { baseRevision: selectedTemplate.revision });
      setTemplates((current) => current.filter((template) => template.id !== selectedTemplate.id));
      startNewTemplate();
      setNotice('Template deleted.');
    } catch (cause: unknown) {
      setError(templateErrorMessage(cause, 'The template could not be deleted.'));
    } finally {
      setIsDeleting(false);
    }
  }

  async function handleCreatePage() {
    if (selectedTemplate === null || isOpeningPage) return;
    setIsOpeningPage(true);
    clearFeedback();
    try {
      const response = await createPageFromTemplate({
        parentId: null,
        templateId: selectedTemplate.id,
        title: selectedTemplate.title,
      });
      navigate(`/app/pages/${encodeURIComponent(response.page.id)}`);
    } catch (cause: unknown) {
      setError(templateErrorMessage(cause, 'The page could not be created from this template.'));
    } finally {
      setIsOpeningPage(false);
    }
  }

  async function handleOpenDailyNote() {
    if (isOpeningPage) return;
    setIsOpeningPage(true);
    clearFeedback();
    try {
      const response = await openDailyNote();
      navigate(`/app/pages/${encodeURIComponent(response.page.id)}`);
    } catch (cause: unknown) {
      setError(templateErrorMessage(cause, 'The daily note could not be opened.'));
    } finally {
      setIsOpeningPage(false);
    }
  }

  return (
    <section aria-labelledby="templates-title" className="settings-page templates-page">
      <header className="settings-header">
        <div>
          <span className="state-kicker">Workspace</span>
          <h1 id="templates-title">Templates</h1>
          <p>Create reusable starting points and choose one template for your daily notes.</p>
        </div>
        <div className="settings-header-actions">
          <button
            className="button button-secondary"
            disabled={isOpeningPage}
            onClick={() => void handleOpenDailyNote()}
            type="button"
          >
            Open today’s note
          </button>
          <Link className="button button-secondary" to="/app/settings">
            Settings
          </Link>
        </div>
      </header>

      {error ? (
        <p aria-live="assertive" className="settings-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p aria-live="polite" className="templates-notice" role="status">
          {notice}
        </p>
      ) : null}

      <div className="template-layout">
        <aside aria-label="Template list" className="template-list-card">
          <div className="template-list-header">
            <div>
              <span className="state-kicker">Reusable blocks</span>
              <h2>My templates</h2>
            </div>
            <button className="button button-primary" onClick={startNewTemplate} type="button">
              New
            </button>
          </div>
          {listState === 'loading' ? <p className="settings-state">Loading templates…</p> : null}
          {listState === 'error' ? (
            <p className="settings-state">Try refreshing this page.</p>
          ) : null}
          {listState === 'ready' && templates.length === 0 ? (
            <p className="settings-state">No templates yet. Start with a blank one.</p>
          ) : null}
          {templates.length > 0 ? (
            <ul className="template-list">
              {templates.map((template) => (
                <li key={template.id}>
                  <button
                    aria-current={selectedTemplate?.id === template.id ? 'page' : undefined}
                    className={`template-list-item${selectedTemplate?.id === template.id ? ' is-selected' : ''}`}
                    disabled={isLoadingTemplate || isSaving || isDeleting}
                    onClick={() => void selectTemplate(template.id)}
                    type="button"
                  >
                    <span>
                      <strong>{template.title}</strong>
                      <small>
                        {template.isDailyNote ? 'Daily note template' : 'Page template'}
                      </small>
                    </span>
                    <span aria-hidden="true">›</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </aside>

        <section aria-labelledby="template-editor-title" className="template-editor-card">
          <div className="template-editor-heading">
            <div>
              <span className="state-kicker">
                {selectedTemplate ? 'Edit template' : 'New template'}
              </span>
              <h2 id="template-editor-title">
                {selectedTemplate ? selectedTemplate.title : 'Untitled template'}
              </h2>
            </div>
            {selectedTemplate ? (
              <span className="template-revision">Revision {selectedTemplate.revision}</span>
            ) : null}
          </div>
          <form className="template-form" onSubmit={(event) => void handleSubmit(event)}>
            <label htmlFor="template-title">Template title</label>
            <input
              id="template-title"
              maxLength={200}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="e.g. Weekly review"
              required
              type="text"
              value={title}
            />
            <label className="template-daily-toggle">
              <input
                checked={isDailyNote}
                onChange={(event) => setIsDailyNote(event.target.checked)}
                type="checkbox"
              />
              <span>
                <strong>Use for daily notes</strong>
                <small>Only one template can be selected for daily notes.</small>
              </span>
            </label>
            <div className="template-editor-shell">
              <Suspense
                fallback={
                  <p className="page-editor-loading" role="status">
                    Loading editor…
                  </p>
                }
              >
                <PageEditor
                  content={content}
                  key={selectedTemplate?.id ?? 'new-template'}
                  onChange={setContent}
                />
              </Suspense>
            </div>
            <div className="template-form-actions">
              <button
                className="button button-primary"
                disabled={isSaving || isDeleting}
                type="submit"
              >
                {isSaving ? 'Saving…' : selectedTemplate ? 'Save template' : 'Create template'}
              </button>
              {selectedTemplate ? (
                <>
                  <button
                    className="button button-secondary"
                    disabled={isOpeningPage || isSaving || isDeleting}
                    onClick={() => void handleCreatePage()}
                    type="button"
                  >
                    {isOpeningPage ? 'Opening…' : 'Create page from template'}
                  </button>
                  <button
                    className="button button-danger"
                    disabled={isSaving || isDeleting}
                    onClick={() => void handleDelete()}
                    type="button"
                  >
                    {isDeleting ? 'Deleting…' : 'Delete template'}
                  </button>
                </>
              ) : null}
            </div>
          </form>
        </section>
      </div>
    </section>
  );
}
