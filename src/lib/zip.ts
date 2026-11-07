// Minimal random-access ZIP reader for Blobs. Reads the central directory, then extracts
// individual entries on demand (stored or deflate) with fflate. Supports ZIP64 and
// UTF-8 / CP437 names and extended-timestamp mtimes. Runs in a worker.
import { inflateSync } from 'fflate';

export interface ZipEntry {
  name: string;
  dir: boolean;
  method: number;
  compSize: number;
  size: number;
  localOffset: number;
  flags: number;
  mtime?: number; // ms epoch
  mtimeUTC: boolean;
}

const readBuf = async (b: Blob, start: number, end: number) => new Uint8Array(await b.slice(start, end).arrayBuffer());

const CP437 =
  '\u0000☺☻♥♦♣♠•◘○◙♂♀♪♫☼►◄↕‼¶§▬↨↑↓→←∟↔▲▼ !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~⌂ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

function decodeName(bytes: Uint8Array, utf8: boolean): string {
  if (utf8) return new TextDecoder('utf-8').decode(bytes);
  // Many Android/Windows zippers write UTF-8 without setting the flag; try strict UTF-8 first.
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    let s = '';
    for (const c of bytes) s += CP437[c];
    return s;
  }
}

function dosToMs(time: number, date: number): number | undefined {
  if (!date) return undefined;
  const d = new Date(1980 + (date >> 9), ((date >> 5) & 15) - 1, date & 31, time >> 11, (time >> 5) & 63, (time & 31) * 2);
  const t = d.getTime();
  return Number.isFinite(t) ? t : undefined;
}

export async function readZipDirectory(blob: Blob): Promise<ZipEntry[]> {
  const size = blob.size;
  const tailLen = Math.min(size, 65557 + 20);
  const tail = await readBuf(blob, size - tailLen, size);
  const tv = new DataView(tail.buffer);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('This file does not look like a ZIP archive (no end-of-directory record).');
  let total = tv.getUint16(eocd + 10, true);
  let cdSize = tv.getUint32(eocd + 12, true);
  let cdOffset = tv.getUint32(eocd + 16, true);
  if (cdOffset === 0xffffffff || total === 0xffff || cdSize === 0xffffffff) {
    const loc = eocd - 20;
    if (loc >= 0 && tv.getUint32(loc, true) === 0x07064b50) {
      const z64Off = Number(tv.getBigUint64(loc + 8, true));
      const z = await readBuf(blob, z64Off, z64Off + 56);
      const zv = new DataView(z.buffer);
      if (zv.getUint32(0, true) !== 0x06064b50) throw new Error('Corrupt ZIP64 directory');
      total = Number(zv.getBigUint64(32, true));
      cdSize = Number(zv.getBigUint64(40, true));
      cdOffset = Number(zv.getBigUint64(48, true));
    }
  }
  const cd = await readBuf(blob, cdOffset, cdOffset + cdSize);
  const v = new DataView(cd.buffer);
  const entries: ZipEntry[] = [];
  let p = 0;
  for (let i = 0; i < total && p + 46 <= cd.length; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('Corrupt ZIP central directory');
    const flags = v.getUint16(p + 8, true);
    const method = v.getUint16(p + 10, true);
    const time = v.getUint16(p + 12, true);
    const date = v.getUint16(p + 14, true);
    let compSize = v.getUint32(p + 20, true);
    let usize = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    let localOffset = v.getUint32(p + 42, true);
    const name = decodeName(cd.subarray(p + 46, p + 46 + nameLen), (flags & 0x800) !== 0);
    let mtime = dosToMs(time, date);
    let mtimeUTC = false;
    let e = p + 46 + nameLen;
    const eEnd = e + extraLen;
    while (e + 4 <= eEnd) {
      const id = v.getUint16(e, true);
      const len = v.getUint16(e + 2, true);
      const d = e + 4;
      if (id === 0x0001) {
        let q = d;
        if (usize === 0xffffffff) { usize = Number(v.getBigUint64(q, true)); q += 8; }
        if (compSize === 0xffffffff) { compSize = Number(v.getBigUint64(q, true)); q += 8; }
        if (localOffset === 0xffffffff) { localOffset = Number(v.getBigUint64(q, true)); q += 8; }
      } else if (id === 0x5455 && len >= 5 && (v.getUint8(d) & 1)) {
        mtime = v.getUint32(d + 1, true) * 1000;
        mtimeUTC = true;
      }
      e = d + len;
    }
    entries.push({ name, dir: name.endsWith('/'), method, compSize, size: usize, localOffset, flags, mtime, mtimeUTC });
    p = eEnd + commentLen;
  }
  return entries;
}

export async function extractEntry(blob: Blob, entry: ZipEntry): Promise<Uint8Array> {
  if (entry.flags & 1) throw new Error('Encrypted ZIP entry (password-protected) — not supported');
  const h = await readBuf(blob, entry.localOffset, entry.localOffset + 30);
  const hv = new DataView(h.buffer);
  if (hv.getUint32(0, true) !== 0x04034b50) throw new Error('Corrupt local file header');
  const start = entry.localOffset + 30 + hv.getUint16(26, true) + hv.getUint16(28, true);
  const data = await readBuf(blob, start, start + entry.compSize);
  if (entry.method === 0) return data;
  if (entry.method === 8) {
    const out = inflateSync(data, entry.size ? { out: new Uint8Array(entry.size) } : undefined);
    return out;
  }
  throw new Error(`Unsupported ZIP compression method ${entry.method}`);
}
