// Reading a zip archive in memory, entry by entry, rather than handing it to an unzip program:
// every file comes out as bytes the caller writes itself, so an archive can't plant a link, and
// the limits hold while the files are still being inflated. Used for packaged skills
// (skillpacks.ts) and for folders attached to a message as a .zip (attachments.ts).

import { inflateRawSync } from "node:zlib";

export type Entry = { path: string; data: Buffer };
const LITTER = /(^|\/)(__MACOSX|\.DS_Store|\._[^/]*|Thumbs\.db)(\/|$)/;
const bad = (message: string) => Object.assign(new Error(message), { fixable: true });

// The limits a reader holds to, and the words its complaints use. A skill's are in skillpacks.ts;
// a zipped folder attached to a message (attachments.ts) has its own, roomier ones.
export type ArchiveLimits = { archive: number; entries: number; file: number; total: number; what: string; notOne: string };
const amount = (n: number) => (n > 1024 * 1024 ? `${Math.round(n / 1024 / 1024)} MB` : `${Math.round(n / 1024)} KB`);

export function readArchive(buf: Buffer, limits: ArchiveLimits): Entry[] {
  const L = limits;
  if (buf.length > L.archive) throw bad(`That file is over ${amount(L.archive)}, which is more than ${L.what} needs.`);
  if (buf.length < 22 || buf.readUInt32LE(0) !== 0x04034b50) throw bad(L.notOne);
  // The archive's directory is found from the record at its end (within the last 64 KB, allowing for a comment).
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw bad("That archive has no directory: it may be cut short.");
  const count = buf.readUInt16LE(end + 10), dirSize = buf.readUInt32LE(end + 12), dirAt = buf.readUInt32LE(end + 16);
  if (count > L.entries) throw bad(`That archive has more than ${L.entries} entries.`);
  if (dirAt + dirSize > buf.length) throw bad("That archive is cut short.");
  const out: Entry[] = [];
  let p = dirAt, total = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw bad("That archive's directory is damaged.");
    const madeBy = buf.readUInt16LE(p + 4) >> 8, flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10);
    const packed = buf.readUInt32LE(p + 20), size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const mode = buf.readUInt32LE(p + 38) >>> 16, localAt = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/") || LITTER.test(name)) continue;
    if (flags & 1) throw bad("That archive is password-protected.");
    // A link inside an archive is how one reaches outside its folder. Unix archives say so in the file's mode.
    if (madeBy === 3 && (mode & 0o170000) === 0o120000) throw bad(`${name} is a link, which ${L.what} can't contain.`);
    if (size > L.file) throw bad(`${name} is over ${amount(L.file)}.`);
    total += size;
    if (total > L.total) throw bad(`The files in it add up to more than ${amount(L.total)}.`);
    if (localAt + 30 > buf.length || buf.readUInt32LE(localAt) !== 0x04034b50) throw bad(`${name} is damaged in the archive.`);
    const start = localAt + 30 + buf.readUInt16LE(localAt + 26) + buf.readUInt16LE(localAt + 28);
    const raw = buf.subarray(start, start + packed);
    if (raw.length !== packed) throw bad(`${name} is cut short in the archive.`);
    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) { try { data = inflateRawSync(raw, { maxOutputLength: L.file + 1 }); } catch { throw bad(`${name} couldn't be unpacked.`); } }
    else throw bad(`${name} is packed in a way this can't read (method ${method}).`);
    if (data.length !== size) throw bad(`${name} isn't the size the archive says it is.`);
    out.push({ path: name, data });
  }
  return out;
}
