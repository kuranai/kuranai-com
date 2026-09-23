import { z } from 'zod';

import { pageIdSchema } from '../../shared/pages';
import { recoveryCursorSchema } from '../../shared/recovery';
import { type RecoveryCursor } from './repository';

const cursorPayloadSchema = z
  .object({
    timestamp: z.string().datetime({ offset: true }),
    id: pageIdSchema,
  })
  .strict();

function encodeBase64Url(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function decodeBase64Url(value: string) {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  const binary = atob(`${normalized}${padding}`);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeRecoveryCursor(cursor: RecoveryCursor) {
  return encodeBase64Url(JSON.stringify(cursor));
}

export function decodeRecoveryCursor(value: string): RecoveryCursor | null {
  if (!recoveryCursorSchema.safeParse(value).success) {
    return null;
  }

  try {
    const parsed = cursorPayloadSchema.safeParse(JSON.parse(decodeBase64Url(value)) as unknown);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
