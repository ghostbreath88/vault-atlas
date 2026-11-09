import { useEffect, useRef, useState } from 'react';
import { Home as HomeIcon, Library as LibIcon, Network, LayoutDashboard, Upload, Stethoscope, Settings as SetIcon, Search, Menu, ShieldCheck, HelpCircle, WifiOff } from 'lucide-react';
import { useStore, search, type SearchHit, openVault, getState } from './store';
import { useRoute, go, noteRoute, BrandMark, Highlight, plainSnippet } from './ui';
import Home from './pages/Home';
import Library from './pages/Library';
import NotePage from './pages/Note';
import GraphPage from './pages/Graph';
import Boards from './pages/Boards';
import ImportPage from './pages/Import';
import Diagnostics from './pages/Diagnostics';
import SettingsPage from './pages/Settings';
import Help from './pages/Help';
import FilePage from './pages/File';
import { dangling } from './store';

function useTheme() {
  useEffect(() => { document.documentElement.dataset.theme = 'dark'; }, []);
}

function useOnline() {
  const [on, setOn] = useState(navigator.onLine);
  useEffect(() => {
    const a = () => setOn(true), b = () => setOn(false);
    addEventListener('online', a); addEventListener('offline', b);
    return () => { removeEventListener('online', a); removeEventListener('offline', b); };
  }, []);
  return on;
}

function GlobalSearch() {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const notes = useStore((s) => s.notes);
  const hasIndex = useStore((s) => !!s.index);
  useEffect(() => {
    let live = true;
    if (!q.trim()) { setHits([]); return; }
    const t = setTimeout(() => search(q, 12).then((h) => live && (setHits(h), setSel(0))), 90);
    return () => { live = false; clearTimeout(t); };
  }, [q, hasIndex]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT')) {
        e.preventDefault(); inputRef.current?.focus(); inputRef.current?.select();
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  const choose = (p?: string) => {
    setOpen(false);
    if (p) go(noteRoute(p));
    else if (q.trim()) go(`#/notes?q=${encodeURIComponent(q)}`);
    inputRef.current?.blur();
  };
  return (
    <div className="global-search" role="search">
      <Search aria-hidden />
      <input
        ref={inputRef} className="search-input" type="search" placeholder="Search notes, tags, paths, properties…" aria-label="Search all notes"
        value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, hits.length)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
          else if (e.key === 'Enter') { e.preventDefault(); choose(sel < hits.length ? hits[sel]?.path : undefined); }
          else if (e.key === 'Escape') { setOpen(false); }
        }}
        role="combobox" aria-expanded={open && !!q} aria-controls="global-search-list" aria-autocomplete="list" data-testid="input-global-search"
      />
      {open && q.trim() && (
        <div className="search-pop" id="global-search-list" role="listbox">
          {hits.map((h, i) => {
            const n = notes.get(h.path);
            if (!n) return null;
            const s = plainSnippet(n.content, h.terms, 120);
            return (
              <div key={h.path} role="option" aria-selected={i === sel} className="search-item" onMouseDown={(e) => { e.preventDefault(); choose(h.path); }} onMouseEnter={() => setSel(i)}>
                <div className="t"><Highlight text={n.name} terms={h.terms} /></div>
                <div className="p">{n.path}</div>
                {s.text && <div className="s"><Highlight text={s.text} terms={h.terms} /></div>}
              </div>
            );
          })}
          <div role="option" aria-selected={sel === hits.length} className="search-item" onMouseDown={(e) => { e.preventDefault(); choose(); }}>
            <div className="t">{hits.length ? 'See all results in Notes' : 'No quick matches — open full search'}</div>
            <div className="p">Press Enter</div>
          </div>
        </div>
      )}
    </div>
  );
}

const NAV = [
  { to: '/', label: 'Home', icon: HomeIcon, match: (p: string) => p === '/' },
  { to: '/notes', label: 'Notes', icon: LibIcon, match: (p: string) => p.startsWith('/notes') || p.startsWith('/note/') },
  { to: '/graph', label: 'Graph', icon: Network, match: (p: string) => p.startsWith('/graph') },
  { to: '/boards', label: 'Boards', icon: LayoutDashboard, match: (p: string) => p.startsWith('/boards') },
];
const NAV2 = [
  { to: '/import', label: 'Import & update', icon: Upload, match: (p: string) => p.startsWith('/import') },
  { to: '/diagnostics', label: 'Diagnostics', icon: Stethoscope, match: (p: string) => p.startsWith('/diagnostics') },
  { to: '/settings', label: 'Settings & data', icon: SetIcon, match: (p: string) => p.startsWith('/settings') },
  { to: '/help', label: 'Help & limits', icon: HelpCircle, match: (p: string) => p.startsWith('/help') },
];

export default function App() {
  useTheme();
  const online = useOnline();
  const route = useRoute();
  const { ready, vault, vaults, index, toasts, dbError, updateReady } = useStore((s) => s);
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => { setNavOpen(false); }, [route.hash]);
  useEffect(() => { if (!route.path.startsWith('/note/')) document.getElementById('main')?.scrollTo({ top: 0 }); }, [route.path]);
  const issues = index ? index.stats.unresolved + index.stats.ambiguous : 0;
  const dang = index ? dangling().length : 0;

  let page: JSX.Element;
  const p = route.path;
  let fill = false;
  if (p.startsWith('/note/')) page = <NotePage path={route.segs.slice(1).join('/')} query={route.query} />;
  else if (p.startsWith('/file/')) page = <FilePage path={route.segs.slice(1).join('/')} />;
  else if (p.startsWith('/notes')) page = <Library query={route.query} />;
  else if (p.startsWith('/graph')) { page = <GraphPage query={route.query} />; fill = true; }
  else if (p.startsWith('/boards')) { page = <Boards id={route.segs[1]} />; fill = !!route.segs[1]; }
  else if (p.startsWith('/import')) page = <ImportPage query={route.query} />;
  else if (p.startsWith('/diagnostics')) page = <Diagnostics query={route.query} />;
  else if (p.startsWith('/settings')) page = <SettingsPage />;
  else if (p.startsWith('/help')) page = <Help />;
  else page = <Home />;

  return (
    <div className={'shell' + (navOpen ? ' nav-open' : '')}>
      <a className="skip-link" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>Skip to content</a>
      <aside className="sidebar" aria-label="Primary">
        <a className="brand" href="#/"><BrandMark /><span className="brand-name">Vault Atlas</span></a>
        {vaults.length > 0 && (
          <div className="vault-switch">
            <label className="sr-only" htmlFor="vault-select">Current vault</label>
            <select id="vault-select" className="input" value={vault?.id ?? ''} onChange={(e) => openVault(e.target.value)} data-testid="select-vault">
              {vaults.map((v) => <option key={v.id} value={v.id}>{v.isDemo ? `Demo · ${v.name}` : v.name}</option>)}
            </select>
          </div>
        )}
        <nav className="nav">
          {NAV.map((n) => (
            <a key={n.to} href={'#' + n.to} aria-current={n.match(p) ? 'page' : undefined} data-testid={`link-nav-${n.label.toLowerCase()}`}>
              <n.icon size={19} aria-hidden />{n.label}
              {n.to === '/notes' && index && <span className="count num">{index.stats.notes.toLocaleString()}</span>}
            </a>
          ))}
          <div className="nav-sep" />
          {NAV2.map((n) => (
            <a key={n.to} href={'#' + n.to} aria-current={n.match(p) ? 'page' : undefined} data-testid={`link-nav-${n.to.slice(1)}`} onClick={() => dispatchEvent(new CustomEvent('atlas:nav', { detail: n.to }))}>
              <n.icon size={19} aria-hidden />{n.label}
              {n.to === '/diagnostics' && issues + dang > 0 && <span className="count num">{issues + dang}</span>}
            </a>
          ))}
        </nav>
        <div className="side-foot">
          <div className="badge ok"><ShieldCheck aria-hidden />On-device only</div>
          <div>Notes are processed in this browser and never uploaded. Read-only: your Obsidian files are never changed.</div>
          {vault?.isDemo && <div style={{ marginTop: 8 }} className="badge warn">Viewing synthetic demo vault</div>}
        </div>
      </aside>
      <div className="scrim" onClick={() => setNavOpen(false)} />
      <div className="main">
        <header className="topbar">
          <button className="btn icon ghost menu-btn" aria-label="Open navigation" onClick={() => setNavOpen(true)} data-testid="button-menu"><Menu /></button>
          <GlobalSearch />
          {!online && <span className="badge" title="You are offline. Vault Atlas keeps working from local data."><WifiOff aria-hidden />Offline</span>}
          {updateReady && <button className="btn sm" onClick={updateReady} title="A new version of Vault Atlas is ready. Your data is kept." data-testid="button-update-app">Update ready — reload</button>}
          {vault?.isDemo && <span className="badge warn" title="Synthetic demo data, separate from your vaults">Demo</span>}
        </header>
        <main id="main" tabIndex={-1} className={'content' + (fill ? ' fill' : '')} style={{ outline: 'none' }}>
          {!ready ? <div className="page"><div className="empty-sm">Opening local data…</div></div>
            : dbError ? <div className="page"><div className="notice danger"><strong>Local storage is unavailable.</strong> {dbError}. Private/incognito windows or strict browser settings can block IndexedDB. You can still use the app, but nothing will be saved.</div>{page}</div>
            : page}
        </main>
      </div>
      <div className="toasts" aria-live="polite">{toasts.map((t) => <div key={t.id} className={'toast ' + (t.tone ?? '')}>{t.text}</div>)}</div>
    </div>
  );
}

// for tests / debugging in devtools
(globalThis as any).__atlas = { getState };
