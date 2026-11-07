import { ExternalLink, Download } from 'lucide-react';
import { useStore, attachmentUrl } from '../store';
import { Empty, fmtBytes, fmtDate, noteRoute } from '../ui';

export default function FilePage({ path }: { path: string }) {
  const { attachments, index, notes } = useStore((s) => s);
  const a = attachments.get(path);
  if (!a) return <div className="page narrow"><Empty title="Attachment not available">There's no imported attachment at <span className="mono">{path}</span>.</Empty></div>;
  const url = attachmentUrl(path)!;
  const refs = index?.attachmentRefs[path] ?? [];
  return (
    <div className="page narrow">
      <div className="page-head"><div><h1 className="page-title wrap-any">{a.name}</h1><p className="page-sub mono wrap-any">{a.path} · {fmtBytes(a.size)}{a.sourceMtime ? ` · file date ${fmtDate(a.sourceMtime)}` : ''}</p></div></div>
      {a.media === 'image' && <img src={url} alt={a.name} style={{ maxWidth: '100%', borderRadius: 12, border: '1px solid var(--line)' }} />}
      {a.media === 'audio' && <audio controls src={url} style={{ width: '100%' }} />}
      {a.media === 'video' && <video controls src={url} style={{ width: '100%', borderRadius: 12 }} />}
      {a.media === 'pdf' && <div className="notice"><ExternalLink aria-hidden /><div>PDFs aren't rendered inside Vault Atlas. Opening it hands this local copy to your browser's or phone's PDF viewer — it isn't uploaded anywhere.</div></div>}
      <div className="row-wrap" style={{ margin: '16px 0 24px' }}>
        <a className="btn" href={url} target="_blank" rel="noopener noreferrer"><ExternalLink />Open</a>
        <a className="btn ghost" href={url} download={a.name}><Download />Save a copy</a>
      </div>
      <h2 className="section-title">Referenced by</h2>
      <div className="link-list">{refs.map((p) => <a key={p} href={noteRoute(p)}>{notes.get(p)?.name ?? p}</a>)}{!refs.length && <div className="empty-sm">No notes reference this file.</div>}</div>
    </div>
  );
}
