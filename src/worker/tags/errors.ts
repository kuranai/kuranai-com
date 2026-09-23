export type TagErrorStatus = 400 | 404 | 409 | 413 | 422 | 500;

export class TagError extends Error {
  constructor(
    readonly status: TagErrorStatus,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'TagError';
  }
}
