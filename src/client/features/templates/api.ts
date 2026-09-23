import {
  browserTimeZone,
  createPageFromTemplateRequestSchema,
  createTemplateRequestSchema,
  dailyNoteResponseSchema,
  localDateForTimeZone,
  templateDeleteResponseSchema,
  templateResponseSchema,
  templatesListResponseSchema,
  updateTemplateRequestSchema,
  type CreatePageFromTemplateRequest,
  type CreateTemplateRequest,
  type DailyNoteResponse,
  type DeleteTemplateRequest,
  type TemplateDeleteResponse,
  type TemplateDetail,
  type TemplatesListResponse,
  type UpdateTemplateRequest,
} from '../../../shared/templates';
import { pageResponseSchema, type PageDetail } from '../../../shared/pages';
import { PageApiError, request } from '../pages/api';

export function fetchTemplates(signal?: AbortSignal) {
  return request<TemplatesListResponse>('/api/private/templates', templatesListResponseSchema, {
    signal,
  });
}

export function fetchTemplate(id: string, signal?: AbortSignal) {
  return request<{ template: TemplateDetail }>(
    `/api/private/templates/${encodeURIComponent(id)}`,
    templateResponseSchema,
    { signal },
  );
}

export function createTemplate(input: CreateTemplateRequest) {
  const parsed = createTemplateRequestSchema.parse(input);
  return request<{ template: TemplateDetail }>('/api/private/templates', templateResponseSchema, {
    body: JSON.stringify(parsed),
    method: 'POST',
  });
}

export function updateTemplate(id: string, input: UpdateTemplateRequest) {
  const parsed = updateTemplateRequestSchema.parse(input);
  return request<{ template: TemplateDetail }>(
    `/api/private/templates/${encodeURIComponent(id)}`,
    templateResponseSchema,
    { body: JSON.stringify(parsed), method: 'PATCH' },
  );
}

export function deleteTemplate(id: string, input: DeleteTemplateRequest) {
  return request<TemplateDeleteResponse>(
    `/api/private/templates/${encodeURIComponent(id)}`,
    templateDeleteResponseSchema,
    { body: JSON.stringify(input), method: 'DELETE' },
  );
}

export function createPageFromTemplate(input: CreatePageFromTemplateRequest) {
  const parsed = createPageFromTemplateRequestSchema.parse(input);
  return request<{ page: PageDetail }>('/api/private/pages/from-template', pageResponseSchema, {
    body: JSON.stringify(parsed),
    method: 'POST',
  });
}

export function openDailyNote(timeZone = browserTimeZone()): Promise<DailyNoteResponse> {
  const localDate = localDateForTimeZone(new Date(), timeZone);
  return request<DailyNoteResponse>(
    `/api/private/daily-notes/${encodeURIComponent(localDate)}`,
    dailyNoteResponseSchema,
    { body: JSON.stringify({ timeZone }), method: 'PUT' },
  );
}

export function templateErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof PageApiError)) {
    return error instanceof TypeError
      ? 'Dovari could not reach the server. Check your connection and try again.'
      : fallback;
  }

  switch (error.code) {
    case 'TEMPLATE_CONFLICT':
      return 'This template changed elsewhere. Reload it before trying again.';
    case 'TEMPLATE_TITLE_CONFLICT':
      return 'A template with that title already exists.';
    case 'DAILY_NOTE_TEMPLATE_CONFLICT':
      return 'Only one template can be used for daily notes.';
    case 'DAILY_NOTE_DATE_MISMATCH':
      return 'The daily note date no longer matches this time zone. Try again.';
    default:
      return error.message || fallback;
  }
}
