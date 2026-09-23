export type BackupErrorStatus = 400 | 404 | 409 | 413 | 422 | 500;

export class BackupError extends Error {
  constructor(
    readonly status: BackupErrorStatus,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'BackupError';
  }
}
