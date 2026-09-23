export type PublicationErrorStatus = 400 | 404 | 409 | 413 | 422 | 500;

export class PublicationError extends Error {
  constructor(
    readonly status: PublicationErrorStatus,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'PublicationError';
  }
}
