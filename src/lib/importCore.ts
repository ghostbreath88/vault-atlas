import { parseNote } from './parser';
import { classifyFile, commonRoot, ignoredReason, normalizePath, type MediaType } from './paths';
import { extractEntry, readZipDirectory } from './zip';
import type { DateSource, InventoryItem, ParsedNote } from './types';

export type ImportSource =
  | { kind: 'zip'; file: Blob; label: string }
  | { kind: 'files'; files: { file: File; relPath: string; size?: number; mtime?: number }[]; label: string; fromFolder?: boolean };

export interface ScannedNote { rawPath: string; content: string; hash: string; size: number; mtime?: number; mtimeKind?: DateSource; parsed: ParsedNote; decodeWarning?: string }
export interface ScannedAttachment { rawPath: string; blob: Blob; media: MediaType; mime: string; hash: string; size: number; mtime?: number }
export interface ScanResult {
  label: string;
  notes: ScannedNote[];
  attachments: ScannedAttachment[];
  unsupported: InventoryItem[];
  ignored: InventoryItem[];
  skipped: InventoryItem[]; // supported but skipped (e.g. too large)
  failed: { path: string; error: string }[];
  root: string | null; // common top folder (candidate to strip)
  hasObsidianDir: boolean;
  totalEntries: number;
}

export interface ScanOptions { maxAttachmentBytes: number; onProgress?: (done: number, total: number, current: string) => void; isCancelled?: () => boolean }

interface Entry { path: string; size: number; mtime?: number; mtimeKind?: DateSource; read: () => Promise<Uint8Array> }

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const d = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function listEntries(src: ImportSource): Promise<Entry[]> {
  if (src.kind === 'zip') {
    const dir = await readZipDirectory(src.file);
    return dir
      .filter((e) => !e.dir)
      .map((e) => ({ path: normalizePath(e.name), size: e.size, mtime: e.mtime, mtimeKind: 'zip' as const, read: () => extractEntry(src.file, e) }));
  }
  return src.files.map(({ file, relPath, size, mtime }) => ({
    path: normalizePath(relPath || file.name),
    size: size ?? file.size,
    mtime: mtime || file.lastModified || undefined,
    mtimeKind: 'file' as const,
    read: async () => new Uint8Array(await file.arrayBuffer()),
  }));
}

export class CancelledError extends Error { constructor() { super('Import cancelled'); } }

export async function scanSource(src: ImportSource, opts: ScanOptions): Promise<ScanResult> {
  const entries = await listEntries(src);
  const res: ScanResult = { label: src.label, notes: [], attachments: [], unsupported: [], ignored: [], skipped: [], failed: [], root: null, hasObsidianDir: false, totalEntries: entries.length };
  res.root = commonRoot(entries.map((e) => e.path));
  const rel = (p: string) => (res.root ? p.slice(res.root.length + 1) : p);
  res.hasObsidianDir = entries.some((e) => rel(e.path).startsWith('.obsidian/'));
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let done = 0;
  for (const e of entries) {
    if (opts.isCancelled?.()) throw new CancelledError();
    opts.onProgress?.(done, entries.length, e.path);
    done++;
    const ig = ignoredReason(rel(e.path));
    if (ig) { res.ignored.push({ path: e.path, reason: ig, size: e.size }); continue; }
    const cls = classifyFile(e.path);
    if (cls.kind === 'unsupported') { res.unsupported.push({ path: e.path, reason: cls.reason, size: e.size }); continue; }
    if (cls.kind === 'attachment' && e.size > opts.maxAttachmentBytes) {
      res.skipped.push({ path: e.path, reason: `Larger than the ${Math.round(opts.maxAttachmentBytes / 1048576)} MB attachment limit (change in Settings)`, size: e.size });
      continue;
    }
    try {
      const bytes = await e.read();
      if (cls.kind === 'note') {
        const content = decoder.decode(bytes);
        const parsed = parseNote(content);
        res.notes.push({
          rawPath: e.path, content, hash: await sha256Hex(bytes), size: bytes.length, mtime: e.mtime, mtimeKind: e.mtimeKind, parsed,
          decodeWarning: content.includes('\uFFFD') ? 'Contains bytes that are not valid UTF-8' : undefined,
        });
      } else {
        res.attachments.push({ rawPath: e.path, blob: new Blob([bytes as BlobPart], { type: cls.mime }), media: cls.media, mime: cls.mime, hash: await sha256Hex(bytes), size: bytes.length, mtime: e.mtime });
      }
    } catch (err) {
      res.failed.push({ path: e.path, error: (err as Error).message || String(err) });
    }
    // Yield occasionally so cancellation messages are processed.
    if (done % 200 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  opts.onProgress?.(entries.length, entries.length, '');
  return res;
}
