export type AssetErrorStatus = 400 | 404 | 413 | 415 | 416 | 422 | 500;

export class AssetError extends Error {
  constructor(
    readonly status: AssetErrorStatus,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AssetError';
  }
}
