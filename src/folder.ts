// Android: read-only access to the Obsidian vault folder the user picked with the system folder picker.
// Files are listed and read through Android's Storage Access Framework (AtlasNativePlugin.java);
// this module never writes anything to the folder.
import { AtlasNative, base64ToBytes, isNative, type FolderStatus } from './native';
import type { ImportSource } from './lib/importCore';
import { classifyFile, ignoredReason, normalizePath } from './lib/paths';
import { getState, setState, saveSettings } from './store';

/** Where the system folder picker starts the first time (Obsidian vaults usually live in Documents). */
const DOCUMENTS = 'content://com.android.externalstorage.documents/document/primary%3ADocuments';
const BATCH_BYTES = 3 * 1024 * 1024;
const BATCH_FILES = 60;

export async function loadFolderStatus(): Promise<FolderStatus | undefined> {
  if (!isNative) return undefined;
  try {
    const f = await AtlasNative.folderStatus();
    setState({ folder: f });
    return f;
  } catch { return undefined; }
}

export async function pickFolder(): Promise<FolderStatus | null> {
  const prev = getState().folder;
  const r = await AtlasNative.pickFolder(prev?.uri ? {} : { initialUri: DOCUMENTS });
  if (r.cancelled) return null;
  setState({ folder: r });
  return r;
}

export async function disconnectFolder() {
  const r = await AtlasNative.disconnectFolder();
  setState({ folder: r });
  await saveSettings({ folderVaultId: undefined });
}

export function folderProblem(f?: FolderStatus): string | null {
  if (!f?.connected) return null;
  if (f.reason === 'permission-revoked' || f.permission === false) return 'Vault Atlas no longer has permission to read this folder (access was removed in Android settings or by another app). Reconnect the folder to continue. Your pins, boards and views are kept.';
  if (f.reason === 'not-found' || f.accessible === false) return 'The connected folder can’t be found. It may have been moved, renamed or deleted, or its storage (e.g. an SD card) isn’t available. Reconnect the folder.';
  return null;
}

export type FolderProgress = (done: number, total: number, current: string) => void;

/**
 * Lists the connected folder and builds an import source for the normal import pipeline.
 * Files whose size and modification time match what Vault Atlas already has are not re-read;
 * their stored copy is reused, so a refresh after editing one note in Obsidian is fast.
 */
export type FolderImportSource = ImportSource & { kind: 'files'; unreadable: { path: string; error: string }[]; folderName: string };

export async function folderSource(onProgress: FolderProgress, isCancelled: () => boolean): Promise<FolderImportSource> {
  const listing = await AtlasNative.listFolder();
  setState({ folder: listing });
  const st = getState();
  const sameVault = st.vault && st.settings.folderVaultId === st.vault.id && st.vault.persistContent;
  const maxAtt = st.settings.maxAttachmentMB * 1048576;
  const files: { file: File; relPath: string; size?: number; mtime?: number }[] = [];
  const toRead: { id: string; path: string; size: number; mtime: number; mime: string }[] = [];

  for (const h of listing.hidden) files.push({ file: new File([], h.path.split('/').pop()!), relPath: h.path + (h.dir ? '/' : ''), size: h.size });
  for (const e of listing.files) {
    const path = normalizePath(e.path);
    const cls = classifyFile(path);
    const skip = ignoredReason(path) || cls.kind === 'unsupported' || (cls.kind === 'attachment' && e.size > maxAtt);
    if (skip) { files.push({ file: new File([], path.split('/').pop()!), relPath: path, size: e.size, mtime: e.mtime }); continue; }
    if (sameVault) {
      if (cls.kind === 'note') {
        const old = st.notes.get(path);
        if (old && !old.missing && old.size === e.size && old.sourceMtime === e.mtime) {
          files.push({ file: new File([old.content], path.split('/').pop()!, { lastModified: e.mtime }), relPath: path, mtime: e.mtime });
          continue;
        }
      } else {
        const old = st.attachments.get(path);
        if (old && !old.missing && old.size === e.size && old.sourceMtime === e.mtime) {
          files.push({ file: new File([old.blob], path.split('/').pop()!, { type: old.mime, lastModified: e.mtime }), relPath: path, mtime: e.mtime });
          continue;
        }
      }
    }
    toRead.push({ id: e.id, path, size: e.size, mtime: e.mtime, mime: cls.kind === 'attachment' ? cls.mime : 'text/markdown' });
  }

  let done = 0;
  const failed: { path: string; error: string }[] = [];
  for (let i = 0; i < toRead.length;) {
    if (isCancelled()) throw new Error('Import cancelled');
    const batch: typeof toRead = [];
    let bytes = 0;
    while (i < toRead.length && batch.length < BATCH_FILES && (batch.length === 0 || bytes + toRead[i].size <= BATCH_BYTES)) { bytes += toRead[i].size; batch.push(toRead[i++]); }
    onProgress(done, toRead.length, batch[0].path);
    const r = await AtlasNative.readFiles({ ids: batch.map((b) => b.id) });
    const byId = new Map(r.files.map((f) => [f.id, f]));
    for (const b of batch) {
      const got = byId.get(b.id);
      if (got?.data !== undefined) files.push({ file: new File([base64ToBytes(got.data) as BlobPart], b.path.split('/').pop()!, { type: b.mime, lastModified: b.mtime }), relPath: b.path, mtime: b.mtime });
      else failed.push({ path: b.path, error: got?.error ?? 'Could not be read' });
    }
    done += batch.length;
  }
  onProgress(toRead.length, toRead.length, '');
  return { kind: 'files', files, label: `Folder “${listing.name ?? 'vault'}” (${listing.files.length.toLocaleString()} files, ${toRead.length.toLocaleString()} re-read)`, fromFolder: true, unreadable: failed, folderName: listing.name ?? 'My vault' };
}
