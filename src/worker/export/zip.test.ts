import { describe, expect, it } from 'vitest';

import { createZipStream, textZipEntry, type ZipEntrySource } from './zip';

async function readAll(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  for (;;) {
    const result = await reader.read();
    if (result.done) {
      break;
    }
    chunks.push(result.value);
    size += result.value.byteLength;
  }

  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function uint16(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true);
}

function uint32(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

function parseEntries(bytes: Uint8Array) {
  const endOffset = bytes.length - 22;
  expect(uint32(bytes, endOffset)).toBe(0x06054b50);
  const centralDirectoryOffset = uint32(bytes, endOffset + 16);
  const entryCount = uint16(bytes, endOffset + 10);
  const entries = new Map<string, Uint8Array>();
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    expect(uint32(bytes, offset)).toBe(0x02014b50);
    const compressedSize = uint32(bytes, offset + 20);
    const nameLength = uint16(bytes, offset + 28);
    const localOffset = uint32(bytes, offset + 42);
    const name = new TextDecoder().decode(bytes.slice(offset + 46, offset + 46 + nameLength));
    const localNameLength = uint16(bytes, localOffset + 26);
    const localExtraLength = uint16(bytes, localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    entries.set(name, bytes.slice(dataOffset, dataOffset + compressedSize));
    offset += 46 + nameLength;
  }

  return entries;
}

function binaryEntry(name: string, bytes: Uint8Array): ZipEntrySource {
  return {
    name,
    open: () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
  };
}

describe('ZIP streaming writer', () => {
  it('streams entries, writes a valid central directory, and stays deterministic', async () => {
    const entries = [
      textZipEntry('pages/hello.md', '# Hello\n'),
      binaryEntry('assets/image.bin', new Uint8Array([0, 1, 2, 255, 254])),
    ];

    const first = await readAll(createZipStream(entries));
    const second = await readAll(createZipStream(entries));

    expect([...first]).toEqual([...second]);
    const parsed = parseEntries(first);
    expect([...parsed.keys()]).toEqual(['pages/hello.md', 'assets/image.bin']);
    expect(new TextDecoder().decode(parsed.get('pages/hello.md'))).toBe('# Hello\n');
    expect([...parsed.get('assets/image.bin')!]).toEqual([0, 1, 2, 255, 254]);
  });

  it('rejects unsafe and duplicate entry names before streaming', () => {
    expect(() => createZipStream([textZipEntry('../escape.txt', 'nope')])).toThrow(
      'A ZIP entry name is invalid.',
    );
    expect(() =>
      createZipStream([textZipEntry('same.txt', 'one'), textZipEntry('same.txt', 'two')]),
    ).toThrow('A ZIP archive contains duplicate entry names.');
  });
});
