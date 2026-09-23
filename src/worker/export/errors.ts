export class ExportError extends Error {
  readonly status = 500 as const;
  readonly code = 'EXPORT_FAILED' as const;

  constructor(message = 'The export could not be prepared.') {
    super(message);
    this.name = 'ExportError';
  }
}
