import { useEffect, useMemo, useRef, useState } from 'react';
import { FileArchive, FolderOpen, Files, RefreshCw, FilePlus2, Library, Sparkles, X, CheckCircle2, AlertTriangle, Info, ShieldCheck, Trash2, ArrowRight, FolderSync, Unplug, Smartphone } from 'lucide-react';
import { getState, saveSettings, setObsidianVaultName, openVault } from '../store';
import { isNative } from '../native';
import { disconnectFolder, folderProblem, folderSource, loadFolderStatus, pickFolder } from '../folder';
import { useStore, startScan, buildPlan, applyPlan, suggestStripRoot, hasStructure, toast, cleanupMissing, type ImportPlan, type Progress, type ScanJob } from '../store';
import type { ImportSource } from '../lib/importCore';
import type { ImportLog, ImportMode } from '../lib/types';
import type { MoveCandidate } from '../lib/diff';
import { Confirm, fmtBytes, fmtDateTime, go, noteRoute, plural } from '../ui';
import demoZipUrl from '../../fixtures/vault-v1.zip?url';

const supportsFolder = typeof document !== 'undefined' && 'webkitdirectory' in document.createElement('input');
const MODE_TITLE: Record<ImportMode, string> = { 'new-vault': 'Import a separate vault', 'replace-snapshot': 'Refresh entire vault (replace snapshot)', 'add-update': 'Add or update files' };

type Step = { s: 'idle' } | { s: 'scanning'; mode: ImportMode; label: string; progress?: Progress; job?: { cancel: () => void } } | { s: 'review'; plan: ImportPlan; isDemo?: boolean; after?: (l: ImportLog) => Promise<void> } | { s: 'applying' } | { s: 'done'; log: ImportLog; isNew: boolean; returnTo?: string; auto?: boolean };

function Picker({ mode, onSource, compact }: { mode: ImportMode; onSource: (src: ImportSource) => void; compact?: boolean }) {
  const zip = useRef<HTMLInputElement>(null), dir = useRef<HTMLInputElement>(null), files = useRef<HTMLInputElement>(null);
  const t = mode.replace(/\W/g, '');
  const pickFiles = (list: FileList | null, kind: 'dir' | 'files') => {
    if (!list || !list.length) return;
    const arr = [...list];
    if (arr.length === 1 && /\.zip$/i.test(arr[0].name)) return onSource({ kind: 'zip', file: arr[0], label: arr[0].name });
    onSource({ kind: 'files', files: arr.map((f) => ({ file: f, relPath: (f as any).webkitRelativePath || f.name })), label: kind === 'dir' ? `Folder (${arr.length} files)` : `${arr.length} selected files` });
  };
  return (
    <div className={compact ? 'row-wrap' : 'stack'} style={{ gap: 8 }}>
      <button className="btn primary" onClick={() => zip.current?.click()} data-testid={`button-zip-${t}`}><FileArchive />Choose vault ZIP</button>
      {supportsFolder && <button className="btn" onClick={() => dir.current?.click()} data-testid={`button-folder-${t}`}><FolderOpen />Choose folder</button>}
      <button className="btn ghost" onClick={() => files.current?.click()} data-testid={`button-files-${t}`}><Files />Choose individual files</button>
      <input ref={zip} type="file" hidden accept=".zip,application/zip,application/x-zip-compressed,application/octet-stream" onChange={(e) => { const f = e.target.files?.[0]; if (f) onSource({ kind: 'zip', file: f, label: f.name }); e.target.value = ''; }} data-testid={`input-zip-${t}`} />
      <input ref={dir} type="file" hidden multiple {...({ webkitdirectory: '', directory: '' } as any)} onChange={(e) => { pickFiles(e.target.files, 'dir'); e.target.value = ''; }} data-testid={`input-folder-${t}`} />
      <input ref={files} type="file" hidden multiple onChange={(e) => { pickFiles(e.target.files, 'files'); e.target.value = ''; }} data-testid={`input-files-${t}`} />
    </div>
  );
}

function Count({ n, label, tone, id }: { n: number; label: string; tone?: 'warn' | 'danger' | 'ok'; id: string }) {
  return <div className="stat" style={{ cursor: 'default' }} data-testid={`count-${id}`}><span className="v" style={{ color: n && tone ? `var(--${tone})` : undefined }}>{n.toLocaleString()}</span><span className="l">{label}</span></div>;
}

function FileList({ title, items, open }: { title: string; items: { path: string; note?: string }[]; open?: boolean }) {
  if (!items.length) return null;
  return (
    <details className="card pad-sm" open={open}>
      <summary style={{ cursor: 'pointer', fontWeight: 600, minHeight: 32 }}>{title} ({items.length.toLocaleString()})</summary>
      <div style={{ maxHeight: 260, overflowY: 'auto', marginTop: 8 }}>
        <table className="table"><tbody>{items.slice(0, 500).map((i) => <tr key={i.path + (i.note ?? '')}><td className="mono wrap-any">{i.path}</td>{i.note !== undefined && <td className="muted small">{i.note}</td>}</tr>)}</tbody></table>
        {items.length > 500 && <div className="xs faint">…and {items.length - 500} more</div>}
      </div>
    </details>
  );
}

function Review({ plan: initial, isDemo, after, onApplied, onCancel, onSwitchMode }: { plan: ImportPlan; isDemo?: boolean; after?: (l: ImportLog) => Promise<void>; onApplied: (l: ImportLog, isNew: boolean) => void; onCancel: () => void; onSwitchMode: (m: ImportMode) => void }) {
  const { vault, settings, notes } = useStore((s) => s);
  const [strip, setStrip] = useState(initial.stripRoot);
  const [dest, setDest] = useState<Record<string, string>>({});
  const plan = useMemo(() => buildPlan(initial.scan, initial.mode, strip, dest), [initial, strip, dest]);
  const [moves, setMoves] = useState<Record<string, boolean>>(() => Object.fromEntries(initial.diff.moves.map((m) => [m.from, m.reason === 'identical-content'])));
  useEffect(() => { setMoves(Object.fromEntries(plan.diff.moves.map((m) => [m.from, moves[m.from] ?? m.reason === 'identical-content']))); }, [plan.diff.moves.length]);
  const [missingAction, setMissingAction] = useState<'keep' | 'remove'>('keep');
  const [persist, setPersist] = useState(vault && plan.mode !== 'new-vault' ? vault.persistContent : settings.persistDefault);
  const [name, setName] = useState(isDemo ? 'Atlas Demo Vault' : initial.scan.root ?? '');
  const [busy, setBusy] = useState(false);
  const s = plan.scan;
  const d = plan.diff;
  const unresolvedDest = plan.needsDestination.filter((f) => !f.path);
  const overlap = d.changed.length + d.unchanged.length;
  const looksDifferent = plan.mode === 'replace-snapshot' && (vault?.manifest.length ?? 0) > 5 && overlap < 0.2 * (vault?.manifest.length ?? 0);
  const folders = useMemo(() => ['', ...new Set([...notes.values()].map((n) => n.folder).filter(Boolean))].sort(), [notes]);
  const rel = (p: string) => (strip && s.root ? p.slice(s.root.length + 1) : p);
  const examplePath = s.notes[0]?.rawPath;

  const apply = async () => {
    setBusy(true);
    try {
      const acceptedMoves: MoveCandidate[] = d.moves.filter((m) => moves[m.from]);
      const log = await applyPlan(plan, { persistContent: persist, missingAction, acceptedMoves, vaultName: name.trim() || undefined, isDemo });
      if (after) await after(log);
      onApplied(log, plan.mode === 'new-vault');
    } catch (e) {
      toast('Import failed: ' + (e as Error).message, 'error');
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ gap: 20 }} data-testid="import-review">
      <div>
        <h2 className="page-title" style={{ fontSize: '1.25rem' }}>Review: {MODE_TITLE[plan.mode]}</h2>
        <p className="page-sub">From <strong>{s.label}</strong> · {plural(s.totalEntries, 'file')} found. Nothing has been saved yet.</p>
      </div>
      {isDemo && <div className="notice warn"><Sparkles aria-hidden /><div>This is the <strong>synthetic demo vault</strong>. It is stored as a separate vault and never mixed with your notes. One file in it (<span className="mono">Broken.md</span>) is deliberately corrupt to show error reporting.</div></div>}
      {looksDifferent && (
        <div className="notice danger"><AlertTriangle aria-hidden /><div className="grow"><strong>This doesn't look like “{vault?.name}”.</strong> Only {overlap} of {vault?.manifest.length} existing files match. Replacing would mark most notes as missing.
          <div className="row-wrap" style={{ marginTop: 8 }}><button className="btn sm" onClick={() => onSwitchMode('new-vault')}>Import as a separate vault instead</button></div></div></div>
      )}
      {s.root && (
        <fieldset className="card pad-sm" style={{ border: '1px solid var(--line)' }}>
          <legend className="small" style={{ padding: '0 6px', fontWeight: 600 }}>Top-level folder “{s.root}”</legend>
          <label className="check"><input type="radio" name="strip" checked={strip} onChange={() => setStrip(true)} data-testid="radio-strip-root" />Treat “{s.root}” as the vault folder <span className="faint xs">(e.g. {examplePath && rel(examplePath).length ? examplePath.slice(s.root.length + 1) : ''})</span></label>
          <label className="check"><input type="radio" name="strip" checked={!strip} onChange={() => setStrip(false)} />Keep “{s.root}/” as a folder inside the vault <span className="faint xs">(e.g. {examplePath})</span></label>
          {s.hasObsidianDir && <div className="xs muted">Found an .obsidian folder inside “{s.root}”, so it's very likely the vault folder.</div>}
        </fieldset>
      )}
      {plan.mode === 'add-update' && !hasStructure(s) && plan.needsDestination.length > 0 && (
        <div className="card pad-sm stack">
          <div className="notice warn" style={{ border: 0, padding: 0, background: 'none' }}><AlertTriangle aria-hidden /><div><strong>Folder structure isn't available for these files.</strong> Your browser only gave file names. Choose where each one belongs — Vault Atlas won't guess.</div></div>
          <div className="table-scroll"><table className="table"><thead><tr><th>File</th><th>Destination in vault</th></tr></thead><tbody>
            {plan.needsDestination.map((f) => {
              const name = f.rawPath.split('/').pop()!;
              const val = dest[f.rawPath] ?? f.path ?? '';
              const opts = [...new Set([...(f.destChoices ?? []), ...folders.map((fd) => (fd ? `${fd}/${name}` : name))])];
              return (
                <tr key={f.rawPath}>
                  <td><div className="mono small wrap-any">{name}</div><div className="xs faint">{f.destReason}</div></td>
                  <td>
                    <select className="input" value={val} onChange={(e) => setDest({ ...dest, [f.rawPath]: e.target.value })} aria-label={`Destination for ${name}`} data-testid={`select-dest-${name}`}>
                      <option value="">Choose…</option>
                      {opts.map((o) => <option key={o} value={o}>{(f.destChoices ?? []).includes(o) ? `Update existing: ${o}` : `New: ${o}`}</option>)}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody></table></div>
          {unresolvedDest.length > 1 && (
            <div className="row-wrap"><span className="small muted">Put all unassigned files in:</span>
              <select className="input" style={{ maxWidth: 260 }} defaultValue="-" onChange={(e) => { if (e.target.value === '-') return; const fd = e.target.value; const o = { ...dest }; unresolvedDest.forEach((f) => { const n = f.rawPath.split('/').pop()!; o[f.rawPath] = fd ? `${fd}/${n}` : n; }); setDest(o); }}>
                <option value="-">Choose a folder…</option>{folders.map((fd) => <option key={fd} value={fd}>{fd || 'Vault root'}</option>)}
              </select>
            </div>
          )}
        </div>
      )}
      <div className="stats">
        <Count id="added" n={d.added.length} label="New" tone="ok" />
        <Count id="changed" n={d.changed.length} label="Changed" />
        <Count id="unchanged" n={d.unchanged.length} label="Unchanged" />
        {plan.mode === 'replace-snapshot' && <Count id="missing" n={d.missing.length} label="Missing from this import" tone="warn" />}
        <Count id="failed" n={s.failed.length} label="Failed to read" tone="danger" />
        <Count id="skipped" n={s.unsupported.length + s.skipped.length} label="Skipped / unsupported" />
        <Count id="ignored" n={s.ignored.length} label="Ignored (.obsidian, hidden)" />
      </div>
      {d.moves.length > 0 && (
        <div className="card pad-sm stack">
          <div className="row"><Info size={18} color="var(--accent)" /><strong className="small">Possible renames or moves</strong></div>
          <div className="xs muted">If a note moved, confirm it so pins, boards, reading history and graph views follow it to the new path.</div>
          {d.moves.map((m) => (
            <label key={m.from} className="check" style={{ alignItems: 'flex-start' }}>
              <input type="checkbox" checked={!!moves[m.from]} onChange={(e) => setMoves({ ...moves, [m.from]: e.target.checked })} data-testid={`check-move-${m.from}`} />
              <span><span className="mono small wrap-any">{m.from}</span> <ArrowRight size={14} style={{ verticalAlign: 'middle' }} /> <span className="mono small wrap-any">{m.to}</span><br /><span className="xs faint">{m.reason === 'identical-content' ? 'Identical content — very likely a move' : 'Same file name, different content — check before confirming'}</span></span>
            </label>
          ))}
        </div>
      )}
      {plan.mode === 'replace-snapshot' && d.missing.length > 0 && (
        <fieldset className="card pad-sm" style={{ border: '1px solid var(--line)' }}>
          <legend className="small" style={{ padding: '0 6px', fontWeight: 600 }}>{plural(d.missing.length - d.moves.filter((m) => moves[m.from]).length, 'file')} not in this import</legend>
          <label className="check"><input type="radio" name="missing" checked={missingAction === 'keep'} onChange={() => setMissingAction('keep')} data-testid="radio-missing-keep" />Keep them, flagged as missing (nothing is removed — review later)</label>
          <label className="check"><input type="radio" name="missing" checked={missingAction === 'remove'} onChange={() => setMissingAction('remove')} data-testid="radio-missing-remove" />Remove them from Vault Atlas now</label>
          <div className="xs faint">Either way, this only affects Vault Atlas's copy. Your Obsidian files are never touched. Pins and boards pointing to removed notes are kept and listed in Diagnostics.</div>
        </fieldset>
      )}
      {plan.duplicatesInSource.length > 0 && <div className="notice warn"><AlertTriangle aria-hidden /><div>{plural(plan.duplicatesInSource.length, 'path')} appear more than once in this import; the last copy wins: <span className="mono xs">{plan.duplicatesInSource.slice(0, 5).join(', ')}</span></div></div>}
      <div className="stack" style={{ gap: 8 }}>
        <FileList title="New" items={d.added.map((f) => ({ path: f.path }))} />
        <FileList title="Changed" items={d.changed.map((f) => ({ path: f.path }))} />
        <FileList title="Missing from this import" items={d.missing.map((f) => ({ path: f.path }))} />
        <FileList title="Failed to read" open items={s.failed.map((f) => ({ path: rel(f.path), note: f.error }))} />
        <FileList title="Skipped or unsupported" items={[...s.skipped, ...s.unsupported].map((f) => ({ path: rel(f.path), note: `${f.reason}${f.size ? ' · ' + fmtBytes(f.size) : ''}` }))} />
        <FileList title="Ignored" items={s.ignored.map((f) => ({ path: rel(f.path), note: f.reason }))} />
      </div>
      {plan.mode === 'new-vault' && <label className="field" style={{ maxWidth: 420 }}>Vault name in Vault Atlas<input className="input" value={name} onChange={(e) => setName(e.target.value)} data-testid="input-vault-name" /></label>}
      <label className="check" style={{ alignItems: 'flex-start' }}>
        <input type="checkbox" checked={persist} onChange={(e) => setPersist(e.target.checked)} data-testid="check-persist" />
        <span><strong>Keep a copy of note content on this device</strong><br /><span className="xs muted">Recommended. Lets you reopen the app (even offline) without re-importing. Stored in this browser's private storage only. If off, notes stay in memory until you close the tab; pins, boards and views are always kept.</span></span>
      </label>
      <div className="row-wrap">
        <button className="btn primary" disabled={busy || unresolvedDest.length > 0} onClick={apply} data-testid="button-apply-import">{busy ? 'Saving…' : plan.mode === 'new-vault' ? 'Import vault' : 'Apply update'}</button>
        <button className="btn ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        {unresolvedDest.length > 0 && <span className="small" style={{ color: 'var(--warn)' }}>Choose a destination for {plural(unresolvedDest.length, 'file')} first.</span>}
      </div>
    </div>
  );
}

export default function ImportPage({ query }: { query: URLSearchParams }) {
  const { vault, vaults, imports, notes, persistence, folder, settings, app } = useStore((s) => s);
  const [step, setStep] = useState<Step>({ s: 'idle' });
  const [cleanup, setCleanup] = useState(false);
  const missing = [...notes.values()].filter((n) => n.missing);
  const hasDemo = vaults.some((v) => v.isDemo);

  const begin = (mode: ImportMode, src: ImportSource, isDemo = false) => {
    const job = startScan(src, (p) => setStep((st) => (st.s === 'scanning' ? { ...st, progress: p } : st)));
    setStep({ s: 'scanning', mode, label: src.label, job });
    job.promise.then((scan) => {
      if (mode === 'add-update' && src.kind === 'files' && !hasStructure(scan) && scan.notes.length + scan.attachments.length === 0) { toast('No supported files were selected', 'warn'); setStep({ s: 'idle' }); return; }
      const plan = buildPlan(scan, mode, suggestStripRoot(scan, mode));
      setStep({ s: 'review', plan, isDemo });
    }).catch((e) => {
      if (/cancel/i.test(e.message)) toast('Import cancelled. Nothing was changed.', 'warn');
      else toast(e.message, 'error');
      setStep({ s: 'idle' });
    });
  };
  const startDemo = async () => {
    try {
      const blob = await (await fetch(demoZipUrl)).blob();
      begin('new-vault', { kind: 'zip', file: blob, label: 'Synthetic demo vault (bundled with the app)' }, true);
    } catch { toast('Could not load the bundled demo vault', 'error'); }
  };
  /** Android: read the connected vault folder (read-only) and update Vault Atlas from it. */
  const beginFolder = async (returnTo?: string) => {
    const f = await loadFolderStatus();
    if (!f?.connected) { toast('Connect your vault folder first', 'warn'); return; }
    const problem = folderProblem(f);
    if (problem) { toast(problem, 'error'); setStep({ s: 'idle' }); return; }
    const st0 = getState();
    if (st0.settings.folderVaultId && st0.vault?.id !== st0.settings.folderVaultId && st0.vaults.some((v) => v.id === st0.settings.folderVaultId)) await openVault(st0.settings.folderVaultId);
    let cancelled = false;
    let job: ScanJob | undefined;
    const cancel = () => { cancelled = true; job?.cancel(); };
    setStep({ s: 'scanning', mode: getState().vault ? 'replace-snapshot' : 'new-vault', label: `vault folder “${f.name ?? ''}”`, job: { cancel } });
    try {
      const src = await folderSource((done, total, current) => setStep((x) => (x.s === 'scanning' ? { ...x, progress: { done, total, current } } : x)), () => cancelled);
      job = startScan(src, (p) => setStep((x) => (x.s === 'scanning' ? { ...x, progress: p } : x)));
      const scan = await job.promise;
      scan.failed.push(...src.unreadable);
      scan.root = null; // folder paths are already vault-relative
      const st = getState();
      const linked = !!st.vault && st.settings.folderVaultId === st.vault.id;
      const mode: ImportMode = st.vault ? 'replace-snapshot' : 'new-vault';
      const plan = buildPlan(scan, mode, false);
      const after = async (log: ImportLog) => {
        await saveSettings({ folderVaultId: log.vaultId });
        if (!getState().app?.obsidianVaultName) setObsidianVaultName(src.folderName);
      };
      const newlyMissing = plan.diff.missing.filter((m) => !(m.kind === 'note' ? st.notes.get(m.path)?.missing : st.attachments.get(m.path)?.missing));
      if (linked && mode === 'replace-snapshot' && newlyMissing.length === 0 && plan.diff.moves.length === 0 && plan.duplicatesInSource.length === 0) {
        setStep({ s: 'applying' });
        const log = await applyPlan(plan, { persistContent: st.vault!.persistContent, missingAction: 'keep', acceptedMoves: [] });
        await after(log);
        setStep({ s: 'done', log, isNew: false, returnTo, auto: true });
      } else {
        setStep({ s: 'review', plan, after: async (log) => { await after(log); } });
      }
    } catch (e) {
      const msg = (e as any)?.message || String(e);
      if (/cancel/i.test(msg)) toast('Refresh cancelled. Nothing was changed.', 'warn');
      else { toast(msg, 'error'); loadFolderStatus(); }
      setStep({ s: 'idle' });
    }
  };
  const connectFolder = async () => {
    try {
      const f = await pickFolder();
      if (f) beginFolder();
    } catch (e) { toast((e as Error).message || String(e), 'error'); }
  };
  useEffect(() => { if (query.get('demo') === '1' && step.s === 'idle') { go('#/import'); startDemo(); } }, []);
  useEffect(() => { if (query.get('folder') === 'refresh' && step.s === 'idle') { const r = query.get('return') ?? undefined; go('#/import'); beginFolder(r); } }, [query.get('folder')]);
  useEffect(() => {
    const reset = (e: Event) => { if ((e as CustomEvent).detail === '/import') setStep((st) => (st.s === 'done' || st.s === 'idle' ? { s: 'idle' } : st)); };
    addEventListener('atlas:nav', reset);
    return () => removeEventListener('atlas:nav', reset);
  }, []);

  if (step.s === 'scanning') {
    const p = step.progress;
    const pct = p && p.total ? Math.round((p.done / p.total) * 100) : 0;
    return (
      <div className="page narrow">
        <div className="card stack" data-testid="import-progress">
          <strong>{MODE_TITLE[step.mode]}</strong>
          <div className="small muted">Reading <strong>{step.label}</strong> on this device…</div>
          <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><div style={{ width: pct + '%' }} /></div>
          <div className="row small"><span className="num">{p ? `${p.done.toLocaleString()} / ${p.total.toLocaleString()} files` : 'Opening…'}</span><span className="grow mono xs faint wrap-any" style={{ textAlign: 'right' }}>{p?.current}</span></div>
          <div><button className="btn" onClick={() => step.job?.cancel()} data-testid="button-cancel-import"><X />Cancel</button></div>
        </div>
      </div>
    );
  }
  if (step.s === 'review') {
    return <div className="page narrow"><Review plan={step.plan} isDemo={step.isDemo} after={step.after} onCancel={() => setStep({ s: 'idle' })} onApplied={(log, isNew) => setStep({ s: 'done', log, isNew })}
      onSwitchMode={(m) => setStep({ s: 'review', plan: buildPlan(step.plan.scan, m, suggestStripRoot(step.plan.scan, m)) })} /></div>;
  }
  if (step.s === 'done') {
    const c = step.log.counts;
    return (
      <div className="page narrow">
        <div className="card stack" data-testid="import-done">
          <div className="row"><CheckCircle2 color="var(--ok)" /><strong>{step.auto ? 'Refreshed from folder' : 'Import complete'}</strong></div>
          <div className="small muted">{step.isNew ? 'New vault imported.' : 'Snapshot updated.'} Search, backlinks, tags, dashboard counts and the graph have been rebuilt.{step.auto ? ' Nothing went missing, so no review was needed.' : ''}</div>
          <div className="stats">
            <Count id="done-added" n={c.added} label="New" /><Count id="done-changed" n={c.changed} label="Changed" /><Count id="done-unchanged" n={c.unchanged} label="Unchanged" />
            {step.log.mode === 'replace-snapshot' && <Count id="done-missing" n={c.missing - c.removed} label="Kept as missing" />}
            <Count id="done-removed" n={c.removed} label="Removed" /><Count id="done-moved" n={c.moved} label="Moves applied" /><Count id="done-failed" n={c.failed} label="Failed" />
          </div>
          {step.log.failed.length > 0 && <FileList title="Failed files" open items={step.log.failed.map((f) => ({ path: f.path, note: f.error }))} />}
          {persistence === 'denied' && <div className="notice warn"><Info aria-hidden /><div>Your browser didn't grant persistent storage. It may clear Vault Atlas data if the device runs low on space. Keep your ZIP and export your settings occasionally.</div></div>}
          <div className="row-wrap">{step.returnTo && step.returnTo !== '#/' && <a className="btn primary" href={step.returnTo} data-testid="button-return">Back to where you were</a>}<a className={'btn' + (step.returnTo && step.returnTo !== '#/' ? '' : ' primary')} href="#/" data-testid="button-go-home">Open dashboard</a><button className="btn ghost" onClick={() => setStep({ s: 'idle' })}>Import something else</button></div>
        </div>
      </div>
    );
  }
  if (step.s === 'applying') return <div className="page"><div className="empty-sm">Saving…</div></div>;

  return (
    <div className="page">
      <div className="page-head"><div><h1 className="page-title">Import &amp; update</h1>
        <p className="page-sub">Each import is a snapshot. Vault Atlas doesn't watch your Obsidian folder — import again whenever you want it up to date. Files are read inside this browser; nothing is uploaded and your originals are never modified.</p></div></div>
      {isNative && (
        <section className="card stack" style={{ marginBottom: 20 }} aria-labelledby="h-folder" data-testid="section-folder">
          <div className="row"><Smartphone size={18} color="var(--accent)" /><h2 id="h-folder" style={{ margin: 0, fontSize: 'var(--text-lg)' }}>Vault folder on this device</h2></div>
          {!folder?.connected ? <>
            <div className="xs muted">Pick your Obsidian vault folder once with Android's folder picker. Vault Atlas gets <strong>read-only</strong> access, remembers it, and can reread it whenever you tap <strong>Refresh from folder</strong> — for example after editing a note in Obsidian. It never changes your files.</div>
            <div><button className="btn primary" onClick={connectFolder} data-testid="button-connect-folder"><FolderOpen />Connect vault folder</button></div>
          </> : <>
            <div className="small">Connected: <strong className="mono" data-testid="text-folder-name">{folder.name ?? 'folder'}</strong> <span className="xs faint">(read-only)</span></div>
            {folderProblem(folder) && <div className="notice danger" data-testid="folder-problem"><AlertTriangle aria-hidden /><div>{folderProblem(folder)}</div></div>}
            <div className="row-wrap">
              {!folderProblem(folder) && <button className="btn primary" onClick={() => beginFolder()} data-testid="button-refresh-folder-import"><FolderSync />{settings.folderVaultId && vault?.id === settings.folderVaultId ? 'Refresh from folder' : 'Read this folder'}</button>}
              <button className="btn" onClick={connectFolder} data-testid="button-reconnect-folder"><FolderOpen />{folderProblem(folder) ? 'Reconnect folder' : 'Choose a different folder'}</button>
              <button className="btn ghost" onClick={() => disconnectFolder().then(() => toast('Folder disconnected. Imported notes stay in Vault Atlas.'))} data-testid="button-disconnect-folder"><Unplug />Disconnect</button>
            </div>
            {vault && <label className="field" style={{ maxWidth: 420 }}>Obsidian vault name (used by “Open in Obsidian”)
              <input className="input" key={vault.id + (app?.obsidianVaultName ?? '')} defaultValue={app?.obsidianVaultName ?? ''} placeholder={folder.name ?? vault.name} onBlur={(e) => setObsidianVaultName(e.target.value.trim())} data-testid="input-obsidian-vault" />
              <span className="xs faint">Must match the vault name shown in Obsidian (usually the folder name).</span>
            </label>}
          </>}
          <div className="xs faint">One connected folder at a time. ZIP import below still works as a fallback.</div>
        </section>
      )}
      {vault && (
        <section className="card stack" style={{ marginBottom: 20 }} aria-labelledby="h-update">
          <div className="row"><RefreshCw size={18} color="var(--accent)" /><h2 id="h-update" style={{ margin: 0, fontSize: 'var(--text-lg)' }}>Update “{vault.isDemo ? 'Demo vault' : vault.name}”</h2></div>
          <div className="grid cols-2">
            <div className="stack" style={{ gap: 10 }} data-testid="section-replace">
              <strong className="small">Refresh entire vault</strong>
              <div className="xs muted">Choose your latest vault ZIP (or the vault folder). You'll see what's new, changed, unchanged, missing and failed before anything is applied. This <strong>replaces the current snapshot</strong> — it never merges two snapshots or duplicates notes.</div>
              <Picker mode="replace-snapshot" onSource={(src) => begin('replace-snapshot', src)} />
            </div>
            <div className="stack" style={{ gap: 10 }} data-testid="section-add">
              <strong className="small">Add or update files</strong>
              <div className="xs muted">Bring in a few new or edited notes. Matching paths are updated; everything else stays as it is. If a file's folder is unknown, you'll be asked where it goes.</div>
              <Picker mode="add-update" onSource={(src) => begin('add-update', src)} />
            </div>
          </div>
        </section>
      )}
      <section className="card stack" style={{ marginBottom: 20 }} aria-labelledby="h-new">
        <div className="row"><Library size={18} color="var(--accent)" /><h2 id="h-new" style={{ margin: 0, fontSize: 'var(--text-lg)' }}>{vault ? 'Import a separate vault' : 'Import your vault'}</h2></div>
        <div className="xs muted">{vault ? 'Creates a new, independent vault in Vault Atlas. It does not touch the current one.' : 'A ZIP of your vault folder works on every device. On Android: open My Files → your Obsidian vault folder → long-press → Compress (ZIP), then choose that ZIP here.'}</div>
        <Picker mode="new-vault" compact onSource={(src) => begin('new-vault', src)} />
        {!supportsFolder && <div className="xs faint">Folder selection isn't available in this browser — use a ZIP.</div>}
        <div className="xs faint">Choosing individual files works too, but if the browser doesn't provide folder paths, notes land in the vault root and links using folder paths may not resolve. A ZIP preserves everything.</div>
      </section>
      {!hasDemo && (
        <section className="card stack" style={{ marginBottom: 20 }}>
          <div className="row"><Sparkles size={18} color="var(--accent)" /><strong>Demo vault</strong></div>
          <div className="xs muted">A small synthetic vault that exercises every feature (duplicate names, ambiguous and unresolved links, embeds, fake links inside code…). Stored separately and clearly labelled.</div>
          <div><button className="btn" onClick={startDemo} data-testid="button-load-demo"><Sparkles />Load demo vault</button></div>
        </section>
      )}
      {vault && missing.length > 0 && (
        <section className="card stack" style={{ marginBottom: 20 }} id="missing" aria-labelledby="h-missing">
          <div className="row"><AlertTriangle size={18} color="var(--warn)" /><h2 id="h-missing" style={{ margin: 0, fontSize: 'var(--text-lg)' }}>Missing files ({missing.length})</h2></div>
          <div className="xs muted">These were in an earlier snapshot but not in the latest import. They're still shown (flagged) so nothing disappears silently.</div>
          <div className="link-list" style={{ maxHeight: 220, overflowY: 'auto' }}>{missing.map((n) => <a key={n.path} href={noteRoute(n.path)} className="mono small">{n.path}</a>)}</div>
          <div><button className="btn danger" onClick={() => setCleanup(true)} data-testid="button-cleanup-missing"><Trash2 />Remove {plural(missing.length, 'missing note')} from Vault Atlas</button></div>
        </section>
      )}
      {imports.length > 0 && (
        <section aria-labelledby="h-history">
          <h2 className="section-title" id="h-history">Import history</h2>
          <div className="card tight table-scroll"><table className="table"><thead><tr><th>When</th><th>Type</th><th>Source</th><th className="num">New</th><th className="num">Changed</th><th className="num">Missing</th><th className="num">Failed</th></tr></thead>
            <tbody>{imports.slice(0, 20).map((l) => <tr key={l.id}><td>{fmtDateTime(l.at)}</td><td>{l.mode === 'new-vault' ? 'First import' : l.mode === 'replace-snapshot' ? 'Refresh' : 'Add/update'}</td><td className="wrap-any">{l.sourceLabel}</td><td className="num">{l.counts.added}</td><td className="num">{l.counts.changed}</td><td className="num">{l.mode === 'replace-snapshot' ? l.counts.missing : '—'}</td><td className="num">{l.counts.failed}</td></tr>)}</tbody></table></div>
        </section>
      )}
      <div className="notice" style={{ marginTop: 20 }}><ShieldCheck aria-hidden /><div>Supported: <strong>.md</strong> notes with YAML frontmatter, and images, PDFs, audio and video as attachments. The <span className="mono">.obsidian</span> folder, plugins and hidden files are ignored. <span className="mono">.canvas</span> and <span className="mono">.base</span> files are listed but not rendered. See <a href="#/help">Help &amp; limits</a>.</div></div>
      {cleanup && <Confirm title="Remove missing notes?" body={`${plural(missing.length, 'note')} that weren't in your latest import will be removed from Vault Atlas on this device. Your Obsidian files are not affected. Pins and boards that reference them are kept and listed in Diagnostics.`} confirmLabel="Remove" danger onCancel={() => setCleanup(false)} onConfirm={async () => { await cleanupMissing(missing.map((n) => n.path)); setCleanup(false); toast('Missing notes removed'); }} />}
    </div>
  );
}
