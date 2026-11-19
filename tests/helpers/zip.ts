import { deflateRawSync } from "node:zlib";

// A zip, written by hand so a test can put in it what a well-behaved tool wouldn't.
export type ZipFile = { path: string; data?: string | Buffer; mode?: number; deflate?: boolean; claim?: number };
export function zip(files: ZipFile[]): Buffer {
  const locals: Buffer[] = [], central: Buffer[] = [];
  let at = 0;
  for (const f of files) {
    const name = Buffer.from(f.path), data = Buffer.from(f.data ?? "");
    const packed = f.deflate ? deflateRawSync(data) : data;
    const size = f.claim ?? data.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(f.deflate ? 8 : 0, 8);
    local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(size, 22); local.writeUInt16LE(name.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE((3 << 8) | 20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(f.deflate ? 8 : 0, 10);
    dir.writeUInt32LE(packed.length, 20); dir.writeUInt32LE(size, 24); dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(((f.mode ?? 0o100644) << 16) >>> 0, 38); dir.writeUInt32LE(at, 42);
    locals.push(local, name, packed);
    central.push(dir, name);
    at += 30 + name.length + packed.length;
  }
  const dirBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dirBytes.length, 12); end.writeUInt32LE(at, 16);
  return Buffer.concat([...locals, dirBytes, end]);
}
