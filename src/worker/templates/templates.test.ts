/// <reference types="@cloudflare/vitest-plugin/types" />

import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { localDateForTimeZone, type TemplateDetail } from '../../shared/templates';
import type { PageDetail, TiptapDocument } from '../../shared/pages';
import { app } from '../index';
import { authenticatedTestBindings, createTestSession } from '../test-auth';

const testEnv = env as typeof env & { DOVARI_TEST_D1_MIGRATIONS: string };
const localEnv = authenticatedTestBindings(env);
let authCookie = '';
const createdPageIds = new Set<string>();
const createdTemplateIds = new Set<string>();

beforeAll(async () => {
  const migrations = JSON.parse(testEnv.DOVARI_TEST_D1_MIGRATIONS) as Array<{
    name: string;
    queries: string[];
  }>;
  await applyD1Migrations(env.DB, migrations);
  authCookie = await createTestSession(localEnv);
});

afterEach(async () => {
  for (const pageId of createdPageIds) {
    await env.DB.prepare('DELETE FROM pages WHERE id = ?').bind(pageId).run();
  }
  for (const templateId of createdTemplateIds) {
    await env.DB.prepare('DELETE FROM templates WHERE id = ?').bind(templateId).run();
  }
  createdPageIds.clear();
  createdTemplateIds.clear();
});

async function request(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('Cookie', authCookie);
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (init.method !== undefined && !['GET', 'HEAD'].includes(init.method.toUpperCase())) {
    headers.set('Origin', 'http://localhost');
  }

  return app.fetch(new Request(`http://localhost${path}`, { ...init, headers }), localEnv);
}

const templateContent: TiptapDocument = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Review' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Capture the important details.' }] },
  ],
};

async function createTemplate(isDailyNote = false) {
  const response = await request('/api/private/templates', {
    body: JSON.stringify({
      content: templateContent,
      isDailyNote,
      title: `${isDailyNote ? 'Daily' : 'Page'} template ${crypto.randomUUID()}`,
    }),
    method: 'POST',
  });
  expect(response.status).toBe(201);
  const template = ((await response.json()) as { template: TemplateDetail }).template;
  createdTemplateIds.add(template.id);
  return template;
}

describe('Templates and daily notes HTTP API', () => {
  it('validates templates, creates independent page copies, and protects revisions', async () => {
    const template = await createTemplate();

    const createdPageResponse = await request('/api/private/pages/from-template', {
      body: JSON.stringify({ parentId: null, templateId: template.id, title: 'Copied review' }),
      method: 'POST',
    });
    expect(createdPageResponse.status).toBe(201);
    const createdPage = ((await createdPageResponse.json()) as { page: PageDetail }).page;
    createdPageIds.add(createdPage.id);
    expect(createdPage.content).toEqual(templateContent);

    const changedContent: TiptapDocument = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Changed later.' }] }],
    };
    const updatedTemplateResponse = await request(`/api/private/templates/${template.id}`, {
      body: JSON.stringify({ baseRevision: template.revision, content: changedContent }),
      method: 'PATCH',
    });
    expect(updatedTemplateResponse.status).toBe(200);
    const updatedTemplate = ((await updatedTemplateResponse.json()) as { template: TemplateDetail })
      .template;
    expect(updatedTemplate.revision).toBe(template.revision + 1);

    const unchangedPageResponse = await request(`/api/private/pages/${createdPage.id}`);
    expect(((await unchangedPageResponse.json()) as { page: PageDetail }).page.content).toEqual(
      templateContent,
    );

    const conflictResponse = await request(`/api/private/templates/${template.id}`, {
      body: JSON.stringify({ baseRevision: template.revision, title: 'Stale edit' }),
      method: 'PATCH',
    });
    expect(conflictResponse.status).toBe(409);

    const invalidResponse = await request('/api/private/templates', {
      body: JSON.stringify({
        content: { content: [{ type: 'not-a-tiptap-node' }], type: 'doc' },
        title: 'Invalid template',
      }),
      method: 'POST',
    });
    expect(invalidResponse.status).toBe(400);
  });

  it('opens one local-date note repeatedly and applies the configured template', async () => {
    const dailyTemplate = await createTemplate(true);
    const localDate = localDateForTimeZone(new Date(), 'UTC');

    const firstResponse = await request(`/api/private/daily-notes/${localDate}`, {
      body: JSON.stringify({ timeZone: 'UTC' }),
      method: 'PUT',
    });
    expect(firstResponse.status).toBe(200);
    const first = (await firstResponse.json()) as {
      dailyNote: {
        createdAt: string;
        id: string;
        localDate: string;
        pageId: string;
        templateId: string;
        updatedAt: string;
      };
      page: PageDetail;
    };
    createdPageIds.add(first.page.id);
    expect(first.dailyNote).toMatchObject({
      localDate,
      pageId: first.page.id,
      templateId: dailyTemplate.id,
    });
    expect(first.page.title).toBe(localDate);
    expect(first.page.content).toEqual(templateContent);

    const secondResponse = await request(`/api/private/daily-notes/${localDate}`, {
      body: JSON.stringify({ timeZone: 'UTC' }),
      method: 'PUT',
    });
    expect(secondResponse.status).toBe(200);
    const second = (await secondResponse.json()) as {
      dailyNote: { id: string; pageId: string };
      page: PageDetail;
    };
    expect(second.dailyNote).toEqual({
      id: first.dailyNote.id,
      localDate,
      pageId: first.page.id,
      templateId: dailyTemplate.id,
      timeZone: 'UTC',
      createdAt: first.dailyNote.createdAt,
      updatedAt: first.dailyNote.updatedAt,
    });
    expect(second.page.id).toBe(first.page.id);

    const mismatchResponse = await request(`/api/private/daily-notes/${localDate}`, {
      body: JSON.stringify({ localDate: '2000-01-01', timeZone: 'UTC' }),
      method: 'PUT',
    });
    expect(mismatchResponse.status).toBe(422);

    const count = await env.DB.prepare(
      'SELECT COUNT(*) AS count FROM daily_notes WHERE local_date = ?',
    )
      .bind(localDate)
      .first<{ count: number }>();
    expect(count?.count).toBe(1);
  });
});
