export type TemplateErrorStatus = 400 | 404 | 409 | 413 | 422 | 500;

export class TemplateError extends Error {
  constructor(
    readonly status: TemplateErrorStatus,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'TemplateError';
  }
}
