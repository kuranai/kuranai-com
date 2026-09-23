import { describe, expect, it } from 'vitest';

import { normalizeSha256, objectSha256 } from './format';

function checksumBytes() {
  return Uint8Array.from({ length: 32 }, (_, index) => index);
}

function base64(value: Uint8Array) {
  let binary = '';
  for (const byte of value) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

describe('backup checksum normalization', () => {
  it('normalizes R2 base64 checksum strings to lowercase hex', () => {
    const bytes = checksumBytes();
    const expected = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');

    expect(normalizeSha256(base64(bytes))).toBe(expected);
    expect(normalizeSha256(expected.toUpperCase())).toBe(expected);
  });

  it('reads the native R2 checksum ArrayBuffer', async () => {
    const bytes = checksumBytes();
    const object = {
      checksums: {
        sha256: bytes.buffer,
        toJSON: () => ({}),
      },
    } as unknown as R2Object;

    await expect(objectSha256(object)).resolves.toBe(
      [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
    );
  });
});
