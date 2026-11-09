// Bridge to the Android app's native helpers (android/.../AtlasNativePlugin.java).
// In the browser / GitHub Pages build none of this is used: isNative is false.
import { Capacitor, registerPlugin } from '@capacitor/core';

export const isNative = Capacitor.isNativePlatform();

export interface FolderStatus {
  connected: boolean; uri?: string; name?: string; permission?: boolean; accessible?: boolean;
  reason?: 'permission-revoked' | 'not-found';
}
export interface FolderEntry { path: string; id: string; size: number; mtime: number }
export interface FolderListing extends FolderStatus { files: FolderEntry[]; hidden: { path: string; dir: boolean; size: number }[] }
export interface NativeInfo { internetPermission: boolean; blockedRequests: number; sdk: number; versionName: string; versionCode: number; obsidianInstalled: boolean }

interface AtlasNativePlugin {
  info(): Promise<NativeInfo>;
  pickFolder(o?: { initialUri?: string }): Promise<FolderStatus & { cancelled?: boolean }>;
  folderStatus(): Promise<FolderStatus>;
  disconnectFolder(): Promise<FolderStatus>;
  listFolder(): Promise<FolderListing>;
  readFiles(o: { ids: string[] }): Promise<{ files: { id: string; data?: string; error?: string }[] }>;
  saveFile(o: { name: string; mime: string; data: string }): Promise<{ saved?: boolean; cancelled?: boolean }>;
  openExternal(o: { uri: string }): Promise<{ opened: boolean; reason?: string }>;
  openAttachment(o: { name: string; mime: string; data: string }): Promise<{ opened: boolean; reason?: string }>;
}

export const AtlasNative = registerPlugin<AtlasNativePlugin>('AtlasNative');

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Save a file the user names in Android's Save dialog (browser: normal download). */
export async function saveUserFile(name: string, mime: string, content: string | Uint8Array): Promise<boolean> {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  if (isNative) {
    const r = await AtlasNative.saveFile({ name, mime, data: bytesToBase64(bytes) });
    return !!r.saved;
  }
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return true;
}

/** Open a link in another app (Obsidian, browser). Returns a user-facing problem, or null. */
export async function openOutside(uri: string): Promise<string | null> {
  if (!isNative) { window.open(uri, uri.startsWith('obsidian:') ? '_self' : '_blank', 'noopener,noreferrer'); return null; }
  const r = await AtlasNative.openExternal({ uri });
  if (r.opened) return null;
  return r.reason === 'obsidian-not-installed' ? 'Obsidian doesn’t seem to be installed on this device.' : 'No app on this device can open that link.';
}

/** Android: hand an imported attachment (e.g. a PDF) to a viewer app. */
export async function openAttachmentNative(name: string, mime: string, blob: Blob): Promise<string | null> {
  const r = await AtlasNative.openAttachment({ name, mime, data: bytesToBase64(new Uint8Array(await blob.arrayBuffer())) });
  return r.opened ? null : 'No app on this device can open this kind of file.';
}

/**
 * Android: links in notes would otherwise be followed inside the app's WebView (where the network is blocked).
 * Hand them to other apps instead — obsidian:// directly, web links only after the user confirms.
 */
export function installNativeLinkHandler(notify: (msg: string, tone?: 'warn' | 'error') => void) {
  if (!isNative) return;
  document.addEventListener('click', (e) => {
    const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a) return;
    const href = a.getAttribute('href') || '';
    if (/^obsidian:/i.test(href)) {
      e.preventDefault();
      openOutside(href).then((err) => err && notify(err, 'warn'));
    } else if (/^(https?|mailto):/i.test(href) && !href.startsWith(location.origin)) {
      e.preventDefault();
      if (confirm(`Open this link in another app?\n\n${href}\n\nVault Atlas itself has no internet access; your browser will open the link.`)) {
        openOutside(href).then((err) => err && notify(err, 'warn'));
      }
    }
  }, true);
}
