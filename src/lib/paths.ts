// Vault-relative path utilities. Canonical note identity = normalized vault-relative path.

export function normalizePath(p: string): string {
  const s = p.normalize('NFC').replace(/\\/g, '/');
  const parts: string[] = [];
  for (const seg of s.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return parts.join('/');
}

export const dirname = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
export const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1);
export function extname(p: string): string {
  const b = basename(p);
  const i = b.lastIndexOf('.');
  return i > 0 ? b.slice(i + 1).toLowerCase() : '';
}
export const stripMd = (p: string) => p.replace(/\.md$/i, '');
export const noteName = (path: string) => stripMd(basename(path));
export const joinPath = (a: string, b: string) => normalizePath(a ? `${a}/${b}` : b);

/** Returns a human reason when a path should be ignored by default, else null. */
export function ignoredReason(path: string): string | null {
  const segs = path.split('/');
  for (const seg of segs) {
    if (seg === '.obsidian') return 'Obsidian configuration (.obsidian)';
    if (seg === '.trash') return 'Obsidian trash (.trash)';
    if (seg === '__MACOSX') return 'macOS ZIP metadata';
    if (seg.startsWith('.')) return 'Hidden file or folder';
  }
  const b = basename(path).toLowerCase();
  if (b === 'thumbs.db' || b === 'desktop.ini') return 'System file';
  return null;
}

export type MediaType = 'image' | 'pdf' | 'audio' | 'video';
export const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg'];
const AUDIO_EXT = ['mp3', 'm4a', 'wav', 'ogg', 'flac', 'webm_audio', '3gp'];
const VIDEO_EXT = ['mp4', 'webm', 'mov', 'ogv'];

export type FileClass =
  | { kind: 'note' }
  | { kind: 'attachment'; media: MediaType; mime: string }
  | { kind: 'unsupported'; reason: string };

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml', pdf: 'application/pdf',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac', '3gp': 'audio/3gpp',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', ogv: 'video/ogg',
};

export function classifyFile(path: string): FileClass {
  const ext = extname(path);
  if (ext === 'md') return { kind: 'note' };
  if (IMAGE_EXT.includes(ext)) return { kind: 'attachment', media: 'image', mime: MIME[ext] };
  if (ext === 'pdf') return { kind: 'attachment', media: 'pdf', mime: MIME.pdf };
  if (AUDIO_EXT.includes(ext)) return { kind: 'attachment', media: 'audio', mime: MIME[ext] };
  if (VIDEO_EXT.includes(ext)) return { kind: 'attachment', media: 'video', mime: MIME[ext] };
  if (ext === 'canvas') return { kind: 'unsupported', reason: 'Obsidian Canvas (.canvas) — listed only, not rendered' };
  if (ext === 'base') return { kind: 'unsupported', reason: 'Obsidian Bases (.base) — listed only, not supported' };
  if (ext === 'markdown' || ext === 'txt') return { kind: 'unsupported', reason: `.${ext} file — Obsidian only treats .md as notes` };
  return { kind: 'unsupported', reason: ext ? `Unsupported file type (.${ext})` : 'File without extension' };
}

/** If every path shares one top-level folder (typical for ZIPs and folder pickers), return it. */
export function commonRoot(paths: string[]): string | null {
  if (!paths.length) return null;
  let root: string | null = null;
  for (const p of paths) {
    const i = p.indexOf('/');
    if (i < 0) return null;
    const first = p.slice(0, i);
    if (root === null) root = first;
    else if (root !== first) return null;
  }
  return root;
}

export function encodeRoutePath(p: string) {
  return p.split('/').map(encodeURIComponent).join('/');
}
