import { Buffer } from 'node:buffer';

interface ZipEntry {
  name: string;
  content: Buffer;
}

export function createStoredZip(files: Array<{ name: string; content: string | Buffer }>): Buffer {
  const entries: ZipEntry[] = files.map((file) => ({
    name: file.name.replace(/\\/g, '/'),
    content: Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content, 'utf-8'),
  }));

  const localParts: Buffer[] = [], centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf-8');
    const crc = crc32(entry.content);
    const localHeader = createLocalHeader(entry, name, crc);
    localParts.push(localHeader, name, entry.content);
    const centralHeader = createCentralHeader(entry, name, crc, offset);
    centralParts.push(centralHeader, name);
    offset += localHeader.length + name.length + entry.content.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  return Buffer.concat([...localParts, centralDirectory, createEndRecord(entries.length, centralDirectory.length, offset)]);
}

function createLocalHeader(entry: ZipEntry, name: Buffer, crc: number): Buffer {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4);
  for (const offset of [6, 8, 10, 12, 28]) header.writeUInt16LE(0, offset);
  header.writeUInt32LE(crc, 14); header.writeUInt32LE(entry.content.length, 18);
  header.writeUInt32LE(entry.content.length, 22); header.writeUInt16LE(name.length, 26);
  return header;
}

function createCentralHeader(entry: ZipEntry, name: Buffer, crc: number, offset: number): Buffer {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(20, 6);
  for (const position of [8, 10, 12, 14, 30, 32, 34, 36]) header.writeUInt16LE(0, position);
  header.writeUInt32LE(crc, 16); header.writeUInt32LE(entry.content.length, 20);
  header.writeUInt32LE(entry.content.length, 24); header.writeUInt16LE(name.length, 28);
  header.writeUInt32LE(0, 38); header.writeUInt32LE(offset, 42);
  return header;
}

function createEndRecord(count: number, directoryLength: number, offset: number): Buffer {
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(directoryLength, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return end;
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff]!;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let c = index;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

