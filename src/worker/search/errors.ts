export type SearchErrorStatus = 400 | 500;

export class SearchError extends Error {
  constructor(
    readonly status: SearchErrorStatus,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'SearchError';
  }
}
