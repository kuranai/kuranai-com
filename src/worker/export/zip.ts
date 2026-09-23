const ZIP_LOCAL_FILE_SIGNATURE = 0x04034b50;
const ZIP_DATA_DESCRIPTOR_SIGNATURE = 0x08074b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP_UTF8_DATA_DESCRIPTOR_FLAGS = 0x0808;
const ZIP_MAX_UINT32 = 0xffffffff;

export interface ZipEntrySource {
  name: string;
  open: () => Promise<ReadableStream<Uint8Array>> | ReadableStream<Uint8Array>;
}

interface CentralDirectoryEntry {
  checksum: number;
  compressedSize: number;
  name: Uint8Array;
  offset: number;
  size: number;
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function updateCrc32(checksum: number, value: Uint8Array) {
  let next = checksum;
  for (const byte of value) {
    next = crcTable[(next ^ byte) & 0xff]! ^ (next >>> 8);
  }
  return next >>> 0;
}

function finalCrc32(checksum: number) {
  return (checksum ^ 0xffffffff) >>> 0;
}

function uint32(value: number) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
  return bytes;
}

function writeUint16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, true);
}

function writeUint32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value >>> 0, true);
}

function concatBytes(...parts: Uint8Array[]) {
  const size = parts.reduce((total, part) => total + part.byteLength, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function localFileHeader(name: Uint8Array) {
  const header = new Uint8Array(30 + name.byteLength);
  const view = new DataView(header.buffer);
  writeUint32(view, 0, ZIP_LOCAL_FILE_SIGNATURE);
  writeUint16(view, 4, 20);
  writeUint16(view, 6, ZIP_UTF8_DATA_DESCRIPTOR_FLAGS);
  writeUint16(view, 8, 0);
  writeUint16(view, 10, 0);
  writeUint16(view, 12, 0);
  writeUint32(view, 14, 0);
  writeUint32(view, 18, 0);
  writeUint32(view, 22, 0);
  writeUint16(view, 26, name.byteLength);
  writeUint16(view, 28, 0);
  header.set(name, 30);
  return header;
}

function dataDescriptor(checksum: number, size: number) {
  return concatBytes(
    uint32(ZIP_DATA_DESCRIPTOR_SIGNATURE),
    uint32(checksum),
    uint32(size),
    uint32(size),
  );
}

function centralDirectoryHeader(entry: CentralDirectoryEntry) {
  const header = new Uint8Array(46 + entry.name.byteLength);
  const view = new DataView(header.buffer);
  writeUint32(view, 0, ZIP_CENTRAL_DIRECTORY_SIGNATURE);
  writeUint16(view, 4, 20);
  writeUint16(view, 6, 20);
  writeUint16(view, 8, ZIP_UTF8_DATA_DESCRIPTOR_FLAGS);
  writeUint16(view, 10, 0);
  writeUint16(view, 12, 0);
  writeUint16(view, 14, 0);
  writeUint32(view, 16, entry.checksum);
  writeUint32(view, 20, entry.compressedSize);
  writeUint32(view, 24, entry.size);
  writeUint16(view, 28, entry.name.byteLength);
  writeUint16(view, 30, 0);
  writeUint16(view, 32, 0);
  writeUint16(view, 34, 0);
  writeUint16(view, 36, 0);
  writeUint32(view, 38, 0);
  writeUint32(view, 42, entry.offset);
  header.set(entry.name, 46);
  return header;
}

function endOfCentralDirectory(entryCount: number, size: number, offset: number) {
  const end = new Uint8Array(22);
  const view = new DataView(end.buffer);
  writeUint32(view, 0, ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE);
  writeUint16(view, 4, 0);
  writeUint16(view, 6, 0);
  writeUint16(view, 8, entryCount);
  writeUint16(view, 10, entryCount);
  writeUint32(view, 12, size);
  writeUint32(view, 16, offset);
  writeUint16(view, 20, 0);
  return end;
}

function validateEntryName(name: string, encodedLength: number) {
  if (
    name.length === 0 ||
    encodedLength > 65_535 ||
    name.startsWith('/') ||
    name.includes('\\') ||
    name.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error('A ZIP entry name is invalid.');
  }
}

async function* zipChunks(entries: ZipEntrySource[]) {
  const encoder = new TextEncoder();
  const centralDirectory: CentralDirectoryEntry[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const localHeader = localFileHeader(name);
    const entryOffset = offset;
    yield localHeader;
    offset += localHeader.byteLength;

    let checksum = 0xffffffff;
    let size = 0;
    const stream = await entry.open();
    const reader = stream.getReader();
    let completed = false;
    try {
      for (;;) {
        const result = await reader.read();
        if (result.done) {
          completed = true;
          break;
        }

        const chunk = new Uint8Array(result.value);
        if (chunk.byteLength === 0) {
          continue;
        }
        size += chunk.byteLength;
        if (size > ZIP_MAX_UINT32) {
          throw new Error('A ZIP entry is too large.');
        }
        checksum = updateCrc32(checksum, chunk);
        yield chunk;
        offset += chunk.byteLength;
      }
    } finally {
      if (!completed) {
        await reader.cancel();
      }
      reader.releaseLock();
    }

    const finalChecksum = finalCrc32(checksum);
    const descriptor = dataDescriptor(finalChecksum, size);
    yield descriptor;
    offset += descriptor.byteLength;
    centralDirectory.push({
      checksum: finalChecksum,
      compressedSize: size,
      name,
      offset: entryOffset,
      size,
    });
  }

  const centralDirectoryOffset = offset;
  for (const entry of centralDirectory) {
    const header = centralDirectoryHeader(entry);
    yield header;
    offset += header.byteLength;
  }

  yield endOfCentralDirectory(
    centralDirectory.length,
    offset - centralDirectoryOffset,
    centralDirectoryOffset,
  );
}

export function createZipStream(entries: ZipEntrySource[]) {
  if (entries.length > 65_535) {
    throw new Error('A ZIP archive contains too many entries.');
  }

  const names = new Set<string>();
  const encoder = new TextEncoder();
  for (const entry of entries) {
    validateEntryName(entry.name, encoder.encode(entry.name).byteLength);
    if (names.has(entry.name)) {
      throw new Error('A ZIP archive contains duplicate entry names.');
    }
    names.add(entry.name);
  }

  const iterator = zipChunks(entries)[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await iterator.next();
        if (result.done) {
          controller.close();
        } else {
          controller.enqueue(result.value);
        }
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel(reason) {
      await iterator.return?.(reason);
    },
  });
}

export function textZipEntry(name: string, value: string): ZipEntrySource {
  const bytes = new TextEncoder().encode(value);
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
