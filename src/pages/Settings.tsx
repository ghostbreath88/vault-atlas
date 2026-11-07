import { useEffect, useRef, useState } from 'react';
import { Download, Upload, Trash2, HardDrive, ShieldCheck, Smartphone, Palette } from 'lucide-react';
import { useStore, saveSettings, exportAppData, importAppData, deleteAllLocalData, deleteVault, setPersistContent, setObsidianVaultName, toast, setState, type AppDataExport } from '../store';
import { requestPersistence, storageEstimate } from '../lib/db';
import { Confirm, Dialog, downloadText, fmtBytes, go } from '../ui';

declare const __APP_VERSION__: string;

let deferredInstall: any = null;
if (typeof window !== 'undefined') window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; });

export default function SettingsPage() {
  const { settings, vault, vaults, persistence, app } = useStore((s) => s);
  const [est, setEst] = useState<{ usage?: number; quota?: number; persisted?: boolean }>({});
  const [confirmAll, setConfirmAll] = useState(false);
  const [confirmVault, setConfirmVault] = useState(false);
  const [pending, setPending] = useState<AppDataExport | null>(null);
  const [mapFrom, setMapFrom] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [canInstall, setCanInstall] = useState(!!deferredInstall);
  useEffect(() => { storageEstimate().then(setEst); const t = setInterval(() => setCanInstall(!!deferredInstall), 1500); return () => clearInterval(t); }, [vault, persistence]);
  const standalone = matchMedia('(display-mode: standalone)').matches;

  const doExport = async () => {
    const data = await exportAppData();
    downloadText(`vault-atlas-settings-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2));
    toast('Settings, pins, views and boards exported');
  };
  const onFile = async (f?: File) => {
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (data?.format !== 'vault-atlas-appdata') throw new Error('Not a Vault Atlas settings export');
      setPending(data);
      setMapFrom(data.vaults.find((v: any) => v.id === vault?.id)?.id ?? data.vaults.find((v: any) => !v.isDemo)?.id ?? '');
    } catch (e) { toast((e as Error).message, 'error'); }
  };
  const applyImport = async (mode: 'all' | 'map') => {
    if (!pending) return;
    try {
      const n = await importAppData(pending, mode === 'map' && vault && mapFrom ? { fromVaultId: mapFrom, toVaultId: vault.id } : undefined);
      toast(`Restored app data for ${n} vault${n === 1 ? '' : 's'}`);
      setPending(null);
    } catch (e) { toast((e as Error).message, 'error'); }
  };

  return (
    <div className="page narrow">
      <div className="page-head"><div><h1 className="page-title">Settings &amp; data</h1><p className="page-sub">Everything is stored only in this browser on this device.</p></div></div>
      <div className="stack" style={{ gap: 20 }}>
        <section className="card stack">
          <div className="row"><Palette size={18} color="var(--accent)" /><strong>Appearance &amp; reading</strong></div>
          <label className="field">Theme
            <select className="input" value={settings.theme} onChange={(e) => saveSettings({ theme: e.target.value as any })} data-testid="select-theme">
              <option value="system">Match system</option><option value="dark">Dark</option><option value="light">Light (warm)</option>
            </select>
          </label>
          <label className="field">Remote images in notes
            <select className="input" value={settings.remoteImages} onChange={(e) => saveSettings({ remoteImages: e.target.value as any })}>
              <option value="ask">Blocked, with a per-note “Load” button</option><option value="off">Always blocked</option>
            </select>
          </label>
          <label className="check"><input type="checkbox" checked={settings.aliasFallback} onChange={(e) => saveSettings({ aliasFallback: e.target.checked })} data-testid="check-alias" />Resolve links by alias when no note name matches (only if exactly one note has that alias; marked “via alias”)</label>
          {vault && <label className="field">Obsidian vault name (for “Open in Obsidian” links)<input className="input" key={vault.id} defaultValue={app?.obsidianVaultName ?? ''} placeholder={vault.rootName ?? vault.name} onBlur={(e) => setObsidianVaultName(e.target.value.trim())} /></label>}
        </section>

        <section className="card stack">
          <div className="row"><HardDrive size={18} color="var(--accent)" /><strong>Storage on this device</strong></div>
          <div className="small muted">Using {fmtBytes(est.usage)} of about {fmtBytes(est.quota)} available to this site. Persistent storage: <strong>{est.persisted ? 'granted' : persistence === 'unsupported' ? 'not supported' : 'not granted'}</strong>.</div>
          {!est.persisted && <div><button className="btn sm" onClick={async () => { const p = await requestPersistence(); setState({ persistence: p }); toast(p === 'granted' ? 'Persistent storage granted' : 'The browser declined persistent storage (often granted after installing the app or using it more)', p === 'granted' ? 'ok' : 'warn'); storageEstimate().then(setEst); }}>Ask for persistent storage</button></div>}
          <div className="notice warn small"><ShieldCheck aria-hidden /><div><strong>This is not a backup.</strong> Browser data can be erased by clearing site data, uninstalling the browser, or low storage. Your Obsidian vault remains the source of truth — keep it backed up separately.</div></div>
          {vault && (
            <label className="check"><input type="checkbox" checked={vault.persistContent} onChange={(e) => setPersistContent(e.target.checked).then(() => toast(e.target.checked ? 'Note content will be kept on this device' : 'Stored note content removed; it stays in memory until you close the app'))} data-testid="check-persist-vault" />Keep note content of “{vault.name}” on this device</label>
          )}
          <label className="field">Skip attachments larger than (MB)<input className="input" type="number" min={1} max={500} value={settings.maxAttachmentMB} onChange={(e) => saveSettings({ maxAttachmentMB: Math.max(1, Number(e.target.value) || 40) })} /></label>
          <label className="field">Maximum notes drawn in the full graph<input className="input" type="number" min={200} max={20000} step={100} value={settings.graphNodeLimit} onChange={(e) => saveSettings({ graphNodeLimit: Math.max(200, Number(e.target.value) || 4000) })} /></label>
        </section>

        <section className="card stack">
          <div className="row"><Download size={18} color="var(--accent)" /><strong>Export / import app data</strong></div>
          <div className="small muted">Saves your <strong>settings, pinned notes, reading history, dashboard layout, saved graph views, frozen layouts and boards</strong> to a JSON file you can keep in Drive or Downloads. It contains note <em>paths</em> but <strong>no note content</strong> — it is not a backup of your vault.</div>
          <div className="row-wrap">
            <button className="btn" onClick={doExport} data-testid="button-export"><Download />Export app data</button>
            <button className="btn ghost" onClick={() => fileRef.current?.click()} data-testid="button-import-appdata"><Upload />Import app data</button>
            <input ref={fileRef} type="file" hidden accept="application/json,.json" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} data-testid="input-appdata" />
          </div>
        </section>

        <section className="card stack">
          <div className="row"><Smartphone size={18} color="var(--accent)" /><strong>Install &amp; offline</strong></div>
          <div className="small muted">{standalone ? 'Running as an installed app.' : 'Install Vault Atlas to open it like an app, offline. In Chrome: ⋮ menu → “Add to Home screen” / “Install app”.'} After the first load, the app works offline; your imported vault is read from this device.</div>
          {canInstall && !standalone && <div><button className="btn" onClick={async () => { deferredInstall?.prompt(); deferredInstall = null; setCanInstall(false); }}>Install app</button></div>}
          <div className="xs faint">Version {__APP_VERSION__}</div>
        </section>

        <section className="card stack" style={{ borderColor: 'color-mix(in srgb, var(--danger) 30%, transparent)' }}>
          <div className="row"><Trash2 size={18} color="var(--danger)" /><strong>Delete data</strong></div>
          <div className="small muted">Deleting only affects Vault Atlas in this browser. Your Obsidian files are never touched.</div>
          <div className="row-wrap">
            {vault && <button className="btn danger" onClick={() => setConfirmVault(true)} data-testid="button-delete-vault">Delete “{vault.isDemo ? 'Demo vault' : vault.name}” from this device</button>}
            <button className="btn danger" onClick={() => setConfirmAll(true)} data-testid="button-delete-all">Delete all imported local data</button>
          </div>
        </section>
      </div>
      {confirmVault && vault && <Confirm title={`Delete “${vault.name}”?`} body="Removes this vault's imported notes, attachments, pins, boards, views and history from this browser. Consider exporting app data first." confirmLabel="Delete vault" danger onCancel={() => setConfirmVault(false)} onConfirm={async () => { setConfirmVault(false); await deleteVault(vault.id); toast('Vault deleted from this device'); go('#/'); }} />}
      {confirmAll && <Confirm title="Delete all imported local data?" body={<>This erases <strong>every vault ({vaults.length})</strong>, all notes, attachments, pins, boards, graph views, settings and import history stored by Vault Atlas in this browser. It cannot be undone. Your Obsidian files are not affected.</>} requireText="DELETE" confirmLabel="Delete everything" danger onCancel={() => setConfirmAll(false)}
        onConfirm={async () => { setConfirmAll(false); await deleteAllLocalData(); toast('All local Vault Atlas data deleted'); go('#/'); setTimeout(() => location.reload(), 300); }} />}
      {pending && (
        <Dialog title="Import app data" onClose={() => setPending(null)}>
          <div className="small muted">Exported {new Date(pending.exportedAt).toLocaleString()} · {pending.vaults.length} vault(s): {pending.vaults.map((v) => v.name).join(', ')}. Existing items with the same IDs are replaced; nothing else is deleted.</div>
          {vault && pending.vaults.length > 0 && (
            <label className="field">Apply one vault's data to the current vault “{vault.name}”
              <select className="input" value={mapFrom} onChange={(e) => setMapFrom(e.target.value)}>{pending.vaults.map((v) => <option key={v.id} value={v.id}>{v.name}{v.id === vault.id ? ' (same vault)' : ''}</option>)}</select>
            </label>
          )}
          <div className="xs faint">Pins and boards reconnect by vault-relative path. Paths that don't exist in the current snapshot are flagged in Diagnostics, not deleted.</div>
          <div className="dialog-actions">
            <button className="btn ghost" onClick={() => setPending(null)}>Cancel</button>
            <button className="btn" onClick={() => applyImport('all')} data-testid="button-restore-appdata">Restore all as exported</button>
            {vault && <button className="btn primary" onClick={() => applyImport('map')} data-testid="button-apply-appdata">Apply to current vault</button>}
          </div>
        </Dialog>
      )}
    </div>
  );
}
