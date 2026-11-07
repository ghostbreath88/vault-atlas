import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { FileText, FileWarning } from 'lucide-react';
import { encodeRoutePath } from './lib/paths';
import type { NoteRecord } from './lib/types';

/* ---------------------------------------------------------------- router */
function getHash() { return window.location.hash || '#/'; }
export function useRoute() {
  const hash = useSyncExternalStore((cb) => { window.addEventListener('hashchange', cb); return () => window.removeEventListener('hashchange', cb); }, getHash);
  const raw = hash.replace(/^#/, '') || '/';
  const qi = raw.indexOf('?');
  const path = qi >= 0 ? raw.slice(0, qi) : raw;
  const query = new URLSearchParams(qi >= 0 ? raw.slice(qi + 1) : '');
  const segs = path.split('/').filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch { return s; } });
  return { path, segs, query, hash };
}
export function go(to: string) { window.location.hash = to.startsWith('#') ? to : '#' + to; }
export const noteRoute = (p: string) => `#/note/${encodeRoutePath(p)}`;
export function notesRoute(params: Record<string, string | undefined>) {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => v !== undefined && v !== '' && q.set(k, v));
  const s = q.toString();
  return `#/notes${s ? '?' + s : ''}`;
}

/* ---------------------------------------------------------------- formatting */
const dtf = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const dttf = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
export const fmtDate = (t?: number) => (t ? dtf.format(new Date(t)) : '—');
export const fmtDateTime = (t?: number) => (t ? dttf.format(new Date(t)) : '—');
export function fmtAgo(t?: number) {
  if (!t) return '—';
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return fmtDate(t);
}
export function fmtBytes(n?: number) {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}
export const plural = (n: number, w: string, p = w + 's') => `${n.toLocaleString()} ${n === 1 ? w : p}`;

export function plainSnippet(content: string, terms: string[] = [], len = 180): { text: string; terms: string[] } {
  const body = content.replace(/^---[\s\S]*?\n---\s*\n?/, '').replace(/```[\s\S]*?```/g, ' ').replace(/%%[\s\S]*?%%/g, ' ')
    .replace(/!?\[\[([^\]|#]*)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_m, a, b) => b || a).replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ').replace(/^#{1,6}\s+/gm, '').replace(/(^|\s)\^[A-Za-z0-9-]+(?=\s|$)/g, ' ').replace(/^\s*(?:[-*+]|\d+\.)\s+(?:\[.\]\s+)?/gm, '').replace(/^\s*>\s?(?:\[![^\]]+\][+-]?)?/gm, '').replace(/[*_>`~=]+/g, '').replace(/\s+/g, ' ').trim();
  if (!terms.length) return { text: body.slice(0, len) + (body.length > len ? '…' : ''), terms };
  const lower = body.toLowerCase();
  let at = -1;
  for (const t of terms) { const i = lower.indexOf(t.toLowerCase()); if (i >= 0 && (at < 0 || i < at)) at = i; }
  if (at < 0) return { text: body.slice(0, len) + (body.length > len ? '…' : ''), terms };
  const start = Math.max(0, at - 50);
  return { text: (start > 0 ? '…' : '') + body.slice(start, start + len) + (start + len < body.length ? '…' : ''), terms };
}

export function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length) return <>{text}</>;
  const re = new RegExp(`(${terms.filter(Boolean).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  const parts = text.split(re);
  return <>{parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p))}</>;
}

/* ---------------------------------------------------------------- components */
export function NoteRow({ note, snippet, terms = [], meta }: { note: NoteRecord; snippet?: boolean; terms?: string[]; meta?: ReactNode }) {
  const s = snippet ? plainSnippet(note.content, terms) : null;
  return (
    <a className="note-row" href={noteRoute(note.path)} data-testid={`note-row-${note.path}`}>
      {note.missing ? <FileWarning className="ico" aria-label="Missing from latest snapshot" /> : <FileText className="ico" aria-hidden />}
      <div className="grow">
        <div className="t"><Highlight text={note.name} terms={terms} />{note.missing && <span className="badge warn" style={{ marginLeft: 8 }}>Missing from latest import</span>}</div>
        <div className="p">{note.path}</div>
        {s && s.text && <div className="s"><Highlight text={s.text} terms={terms} /></div>}
      </div>
      {meta && <div className="meta">{meta}</div>}
    </a>
  );
}

export function Empty({ title, children, action, art = true }: { title: string; children?: ReactNode; action?: ReactNode; art?: boolean }) {
  return (
    <div className="empty">
      {art && <AtlasArt />}
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function AtlasArt() {
  return (
    <svg className="art" viewBox="0 0 120 120" fill="none" aria-hidden>
      <circle cx="60" cy="60" r="44" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" strokeDasharray="3 5" />
      <path d="M32 74 L52 44 L74 62 L90 38" stroke="currentColor" strokeWidth="1.6" strokeOpacity="0.7" />
      <path d="M52 44 L60 84 L74 62" stroke="currentColor" strokeWidth="1.2" strokeOpacity="0.4" />
      {[[32, 74, 5], [52, 44, 6.5], [74, 62, 5.5], [90, 38, 4.5], [60, 84, 4]].map(([x, y, r], i) => (
        <circle key={i} cx={x} cy={y} r={r} fill="currentColor" fillOpacity={i === 1 ? 1 : 0.55} />
      ))}
    </svg>
  );
}

export function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" fill="none" aria-hidden>
      <circle cx="16" cy="16" r="13" stroke="currentColor" strokeWidth="1.6" strokeOpacity="0.45" />
      <path d="M8.5 20.5 L14 10 L19.5 17 L23.5 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="14" cy="10" r="2.4" fill="currentColor" />
      <circle cx="19.5" cy="17" r="2" fill="currentColor" />
    </svg>
  );
}

export function Dialog({ title, onClose, children, wide, labelledBy }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; labelledBy?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current!;
    const first = el.querySelector<HTMLElement>('[autofocus], input, select, textarea, button');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key === 'Tab') {
        const f = [...el.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])')];
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    };
    el.addEventListener('keydown', onKey);
    return () => { el.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, []);
  const id = labelledBy ?? 'dlg-' + title.replace(/\W/g, '');
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'dialog' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-labelledby={id} ref={ref}>
        <h2 id={id}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** In-page confirmation (native confirm() is unreliable in embedded/PWA contexts). */
export function Confirm({ title, body, confirmLabel, danger, requireText, onConfirm, onCancel }: { title: string; body: ReactNode; confirmLabel: string; danger?: boolean; requireText?: string; onConfirm: () => void; onCancel: () => void }) {
  const [typed, setTyped] = useState('');
  return (
    <Dialog title={title} onClose={onCancel}>
      <div className="muted small">{body}</div>
      {requireText && (
        <label className="field">Type <strong className="mono">{requireText}</strong> to confirm
          <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus data-testid="input-confirm-text" />
        </label>
      )}
      <div className="dialog-actions">
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
        <button className={'btn ' + (danger ? 'danger' : 'primary')} disabled={!!requireText && typed.trim() !== requireText} onClick={onConfirm} data-testid="button-confirm">{confirmLabel}</button>
      </div>
    </Dialog>
  );
}

export function downloadText(filename: string, text: string, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function useMediaQuery(q: string) {
  return useSyncExternalStore((cb) => { const m = matchMedia(q); m.addEventListener('change', cb); return () => m.removeEventListener('change', cb); }, () => matchMedia(q).matches);
}
export const useReducedMotion = () => useMediaQuery('(prefers-reduced-motion: reduce)');
