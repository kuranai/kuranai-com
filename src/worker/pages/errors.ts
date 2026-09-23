export type PageErrorStatus = 400 | 404 | 409 | 413 | 422 | 500;

export class PageError extends Error {
  constructor(
    readonly status: PageErrorStatus,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'PageError';
  }
}
