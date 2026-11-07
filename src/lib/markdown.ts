import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';
import { commentRanges, normHeading, parseMarkdownDest, parseWikiInner, slugHeading, splitFrontmatter, isValidTag } from './parser';
import type { ResolvedLink } from './resolver';
import type { ParsedLink } from './types';
import { basename, encodeRoutePath, extname, IMAGE_EXT, stripMd } from './paths';

export interface RenderCtx {
  fromPath: string;
  resolve: (l: ParsedLink, from: string) => ResolvedLink;
  attachmentUrl: (path: string) => string | undefined;
  getContent: (path: string) => string | undefined;
  allowRemote: boolean;
  depth?: number;
  stack?: string[];
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const noteHref = (path: string, frag?: string, type?: 'heading' | 'block') =>
  `#/note/${encodeRoutePath(path)}${frag ? `?${type === 'block' ? 'b' : 'h'}=${encodeURIComponent(frag)}` : ''}`;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const REMOTE = /^(https?:)?\/\//i;

const md = new MarkdownIt({ html: true, linkify: true, breaks: true, typographer: false });
md.linkify.set({ fuzzyLink: false, fuzzyEmail: false });

// [[wikilinks]] and ![[embeds]]
md.inline.ruler.before('link', 'wikilink', (state, silent) => {
  const s = state.src;
  let pos = state.pos;
  let embed = false;
  if (s.charCodeAt(pos) === 0x21 /* ! */) { embed = true; pos++; }
  if (s.charCodeAt(pos) !== 0x5b || s.charCodeAt(pos + 1) !== 0x5b) return false;
  const end = s.indexOf(']]', pos + 2);
  if (end < 0 || end + 2 > state.posMax) return false;
  const inner = s.slice(pos + 2, end);
  if (!inner.trim() || /[\[\]\n]/.test(inner)) return false;
  if (!silent) {
    const t = state.push('wikilink', '', 0);
    t.meta = { embed, inner, raw: s.slice(state.pos, end + 2) };
  }
  state.pos = end + 2;
  return true;
});

// #tags (same rules as the parser)
const TAG_STICKY = /#([\p{L}\p{N}\p{M}_\-\/\p{Extended_Pictographic}\u200d\ufe0f]+)/uy;
md.inline.ruler.before('text', 'tag', (state, silent) => {
  if (state.src.charCodeAt(state.pos) !== 0x23) return false;
  const prev = state.pos > 0 ? state.src[state.pos - 1] : '';
  if (prev && !/[\s(,;]/.test(prev)) return false;
  TAG_STICKY.lastIndex = state.pos;
  const m = TAG_STICKY.exec(state.src);
  if (!m || m.index + m[0].length > state.posMax) return false;
  const tag = m[1].replace(/\/+$/, '');
  if (!isValidTag(tag)) return false;
  if (!silent) { const t = state.push('tag', '', 0); t.meta = { tag }; }
  state.pos += 1 + tag.length;
  return true;
});

// ==highlight==
md.inline.ruler.before('emphasis', 'mark', (state, silent) => {
  const s = state.src, start = state.pos;
  if (s.charCodeAt(start) !== 0x3d || s.charCodeAt(start + 1) !== 0x3d) return false;
  const end = s.indexOf('==', start + 2);
  if (end < 0 || end > state.posMax || end === start + 2 || /\s/.test(s[start + 2])) return false;
  if (silent) return true;
  state.push('mark_open', 'mark', 1);
  const oldMax = state.posMax;
  state.pos = start + 2;
  state.posMax = end;
  state.md.inline.tokenize(state);
  state.posMax = oldMax;
  state.pos = end + 2;
  state.push('mark_close', 'mark', -1);
  return true;
});

type Env = { ctx: RenderCtx };

function resolveLink(l: ParsedLink, ctx: RenderCtx) { return ctx.resolve(l, ctx.fromPath); }

function renderInternalAnchor(r: ResolvedLink, text: string): string {
  const okNote = (r.status === 'resolved' || r.status === 'resolved-nearest' || r.status === 'resolved-alias' || r.status === 'self') && r.targetKind === 'note';
  if (okNote) {
    const cls = ['internal-link'];
    if (r.status === 'resolved-alias') cls.push('via-alias');
    if (r.status === 'resolved-nearest') cls.push('via-nearest');
    if (r.fragmentFound === false) cls.push('frag-missing');
    const title = r.status === 'resolved-alias' ? `Resolved through an alias → ${r.targetPath}` : r.status === 'resolved-nearest' ? `Several notes share this name; resolved to the one in the same folder: ${r.targetPath}` : r.fragmentFound === false ? `Heading/block “${r.fragment}” not found in ${r.targetPath}` : r.targetPath!;
    return `<a class="${cls.join(' ')}" href="${esc(noteHref(r.targetPath!, r.fragment, r.fragmentType))}" data-note="${esc(r.targetPath!)}" title="${esc(title)}">${text}</a>`;
  }
  if (r.targetKind === 'attachment' && r.targetPath) return `<a class="internal-link attachment-link" href="#/file/${esc(encodeRoutePath(r.targetPath))}" data-attachment="${esc(r.targetPath)}">${text}</a>`;
  if (r.status === 'ambiguous') return `<span class="link-ambiguous" tabindex="0" title="${esc('Ambiguous link — candidates: ' + (r.candidates ?? []).join(', '))}">${text}</span>`;
  if (r.status === 'unsupported') return `<span class="link-unsupported" title="${esc(`${r.targetPath} is not supported by Vault Atlas`)}">${text}</span>`;
  return `<span class="link-unresolved" title="${esc(`Unresolved link: “${r.target}” — no matching note in this snapshot`)}">${text}</span>`;
}

md.renderer.rules.wikilink = (tokens, idx, _o, env: any) => {
  const { embed, inner, raw } = tokens[idx].meta as { embed: boolean; inner: string; raw: string };
  const parts = parseWikiInner(inner);
  const link: ParsedLink = { kind: 'wikilink', embed, raw, line: 0, ...parts };
  const r = resolveLink(link, env.ctx);
  if (embed) return renderEmbed(r, env.ctx);
  const text = esc(parts.display ?? (parts.target ? (parts.fragment ? `${parts.target} › ${parts.fragment}` : parts.target) : parts.fragment ?? inner));
  return renderInternalAnchor(r, text);
};
md.renderer.rules.tag = (tokens, idx) => {
  const tag = (tokens[idx] as any).meta.tag as string;
  return `<a class="tag" href="#/notes?tag=${encodeURIComponent(tag)}">#${esc(tag)}</a>`;
};

function renderEmbed(r: ResolvedLink, ctx: RenderCtx): string {
  const label = esc(r.display ?? r.target);
  if (r.targetKind === 'attachment' && r.targetPath) {
    const ext = extname(r.targetPath);
    if (IMAGE_EXT.includes(ext)) {
      const w = r.display && /^\d+(x\d+)?$/.test(r.display) ? r.display.split('x')[0] : '';
      return `<img class="embed-image" data-att="${esc(r.targetPath)}" alt="${esc(basename(r.targetPath))}"${w ? ` width="${w}"` : ''}>`;
    }
    if (ext === 'pdf') return `<span class="embed-file" data-kind="pdf"><span class="embed-file-name">PDF · ${esc(basename(r.targetPath))}</span> <a class="embed-open" href="#/file/${esc(encodeRoutePath(r.targetPath))}" data-attachment="${esc(r.targetPath)}">Open PDF</a><span class="embed-note-hint">PDFs aren’t rendered inline.</span></span>`;
    if (['mp3', 'm4a', 'wav', 'ogg', 'flac', '3gp'].includes(ext)) return `<audio class="embed-media" controls preload="metadata" data-att="${esc(r.targetPath)}"></audio>`;
    return `<video class="embed-media" controls preload="metadata" data-att="${esc(r.targetPath)}"></video>`;
  }
  if (r.targetKind === 'note' && r.targetPath && (r.status === 'resolved' || r.status === 'resolved-nearest' || r.status === 'resolved-alias' || r.status === 'self')) {
    return `<div class="embed-note" data-embed-note="${esc(r.targetPath)}" data-frag="${esc(r.fragment ?? '')}" data-frag-type="${r.fragmentType ?? ''}"></div>`;
  }
  const why = r.status === 'unsupported' ? `${esc(basename(r.targetPath ?? r.target))} — this file type can’t be embedded (shown in Diagnostics)` : r.status === 'ambiguous' ? `Ambiguous embed “${label}” — several files match` : `Embed not found: “${label}”`;
  return `<div class="embed-missing" role="note">${why}</div>`;
}

const defaultLinkOpen = md.renderer.rules.link_open ?? ((t, i, o, _e, s) => s.renderToken(t, i, o));
const defaultLinkClose = md.renderer.rules.link_close ?? ((t, i, o, _e, s) => s.renderToken(t, i, o));
md.renderer.rules.link_open = (tokens, idx, opts, env: any, self) => {
  const t = tokens[idx];
  const href = String(t.attrGet('href') ?? '');
  if (SCHEME.test(href) || REMOTE.test(href)) {
    if (/^(https?|mailto):/i.test(href)) {
      t.attrSet('target', '_blank'); t.attrSet('rel', 'noopener noreferrer nofollow'); t.attrSet('referrerpolicy', 'no-referrer'); t.attrSet('class', 'external-link');
      return defaultLinkOpen(tokens, idx, opts, env, self);
    }
    if (/^obsidian:/i.test(href)) { t.attrSet('class', 'external-link'); return defaultLinkOpen(tokens, idx, opts, env, self); }
    setClose(tokens, idx, '</span>');
    return `<span class="link-unsupported" title="${esc('Link scheme not opened: ' + href)}">`;
  }
  const d = parseMarkdownDest(href);
  const r = resolveLink({ kind: 'markdown', embed: false, raw: href, line: 0, ...d }, env.ctx);
  const html = renderInternalAnchor(r, '\u0000');
  setClose(tokens, idx, html.slice(html.indexOf('\u0000') + 1));
  return html.slice(0, html.indexOf('\u0000'));
};
function setClose(tokens: any[], idx: number, closeWith: string) {
  let depth = 0;
  for (let j = idx + 1; j < tokens.length; j++) {
    if (tokens[j].type === 'link_open') depth++;
    if (tokens[j].type === 'link_close') { if (depth === 0) { tokens[j].meta = { closeWith }; return; } depth--; }
  }
}
md.renderer.rules.link_close = (tokens, idx, opts, env, self) => {
  const m = (tokens[idx] as any).meta;
  if (m?.closeWith) return m.closeWith;
  return defaultLinkClose(tokens, idx, opts, env, self);
};
md.renderer.rules.image = (tokens, idx, _o, env: any) => {
  const t = tokens[idx];
  const src = String(t.attrGet('src') ?? '');
  const alt = t.content || '';
  if (REMOTE.test(src)) return `<img data-remote="${esc(src)}" alt="${esc(alt)}">`;
  if (SCHEME.test(src)) return `<span class="embed-missing">Image with unsupported source (${esc(src.split(':')[0])}:)</span>`;
  const d = parseMarkdownDest(src);
  const r = resolveLink({ kind: 'markdown', embed: true, raw: src, line: 0, ...d, display: alt }, env.ctx);
  return renderEmbed(r, env.ctx);
};

/* ---------------------------------------------------------- sanitize */

const purify = DOMPurify;
let hooked = false;
function hook() {
  if (hooked) return;
  hooked = true;
  purify.addHook('afterSanitizeAttributes', (node) => {
    const el = node as Element;
    const tag = el.tagName;
    if (!tag) return;
    if (tag === 'IMG' || tag === 'VIDEO' || tag === 'AUDIO' || tag === 'SOURCE') {
      const src = el.getAttribute('src');
      if (src) {
        el.removeAttribute('src');
        if (REMOTE.test(src)) el.setAttribute('data-remote', src);
        else if (!SCHEME.test(src)) el.setAttribute('data-rel-src', src);
      }
      el.removeAttribute('srcset');
      el.removeAttribute('poster');
    }
    if (tag === 'A') {
      const href = el.getAttribute('href') ?? '';
      if (/^(https?|mailto):/i.test(href)) { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer nofollow'); el.setAttribute('referrerpolicy', 'no-referrer'); }
      else if (!href.startsWith('#/') && !/^obsidian:/i.test(href)) el.removeAttribute('href');
    }
    el.removeAttribute('background');
    el.removeAttribute('ping');
  });
}

const PURIFY_CFG = {
  FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'link', 'meta', 'base', 'svg', 'math', 'frame', 'frameset', 'track', 'portal'],
  FORBID_ATTR: ['style', 'srcset', 'background', 'ping', 'formaction', 'action'],
  ALLOW_DATA_ATTR: true,
  RETURN_DOM_FRAGMENT: true,
} as const;

export function sanitizeToFragment(html: string): DocumentFragment {
  hook();
  return purify.sanitize(html, PURIFY_CFG as any) as unknown as DocumentFragment;
}

/* ---------------------------------------------------------- render */

function stripComments(src: string): string {
  const ranges = commentRanges(src);
  if (!ranges.length) return src;
  let out = '', last = 0;
  for (const [a, b] of ranges) { out += src.slice(last, a); last = b; }
  return out + src.slice(last);
}

export function extractSection(content: string, frag: string, type: string): string | null {
  const body = content.slice(splitFrontmatter(content).bodyStart);
  const lines = body.split('\n');
  if (type === 'block') {
    const i = lines.findIndex((l) => new RegExp(`(^|\\s)\\^${frag.replace(/[^A-Za-z0-9-]/g, '')}\\s*$`).test(l));
    if (i < 0) return null;
    let a = i, b = i;
    while (a > 0 && lines[a - 1].trim() && !/^#{1,6}\s/.test(lines[a - 1])) a--;
    while (b < lines.length - 1 && lines[b + 1].trim()) b++;
    return lines.slice(a, b + 1).join('\n');
  }
  const want = normHeading(frag.split('#').pop()!);
  const i = lines.findIndex((l) => { const m = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(l); return !!m && normHeading(m[2]) === want; });
  if (i < 0) return null;
  const level = /^ {0,3}(#{1,6})/.exec(lines[i])![1].length;
  let j = i + 1;
  while (j < lines.length && !(/^ {0,3}(#{1,6})\s/.exec(lines[j]) && /^ {0,3}(#{1,6})/.exec(lines[j])![1].length <= level)) j++;
  return lines.slice(i, j).join('\n');
}

export function renderMarkdown(source: string, ctx: RenderCtx): DocumentFragment {
  const body = stripComments(source.slice(splitFrontmatter(source).bodyStart));
  const html = md.render(body, { ctx } as Env);
  const frag = sanitizeToFragment(html);
  postProcess(frag, ctx);
  return frag;
}

function makeEl(tag: string, cls?: string, text?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

const CALLOUT_ICONS: Record<string, string> = { note: '✎', info: 'i', tip: '✦', hint: '✦', important: '!', success: '✓', check: '✓', done: '✓', question: '?', help: '?', faq: '?', warning: '!', caution: '!', attention: '!', failure: '✕', fail: '✕', missing: '✕', danger: '⚡', error: '⚡', bug: '•', example: '≡', quote: '❝', cite: '❝', abstract: '≡', summary: '≡', tldr: '≡', todo: '☐' };

function postProcess(root: DocumentFragment, ctx: RenderCtx) {
  // Local attachments (from our renderer and from relative <img> in raw HTML)
  root.querySelectorAll<HTMLElement>('[data-att]').forEach((el) => {
    const u = ctx.attachmentUrl(el.dataset.att!);
    if (u) (el as HTMLImageElement).src = u;
    else el.replaceWith(makeEl('div', 'embed-missing', `Attachment not available: ${el.dataset.att}`));
  });
  root.querySelectorAll<HTMLElement>('[data-rel-src]').forEach((el) => {
    const d = parseMarkdownDest(el.dataset.relSrc!);
    const r = ctx.resolve({ kind: 'markdown', embed: true, raw: el.dataset.relSrc!, line: 0, ...d }, ctx.fromPath);
    const u = r.targetKind === 'attachment' && r.targetPath ? ctx.attachmentUrl(r.targetPath) : undefined;
    if (u) (el as HTMLImageElement).src = u;
    else el.replaceWith(makeEl('span', 'embed-missing', `Local file not found: ${el.dataset.relSrc}`));
  });
  root.querySelectorAll<HTMLElement>('[data-remote]').forEach((el) => {
    const src = el.dataset.remote!;
    if (ctx.allowRemote && el.tagName === 'IMG') {
      (el as HTMLImageElement).referrerPolicy = 'no-referrer';
      (el as HTMLImageElement).src = src;
      return;
    }
    let host = src;
    try { host = new URL(src, 'https://x.invalid').host; } catch { /* ignore */ }
    const box = makeEl('span', 'remote-blocked');
    box.setAttribute('role', 'note');
    box.append(makeEl('span', 'remote-blocked-title', `Remote ${el.tagName === 'IMG' ? 'image' : 'media'} not loaded`), makeEl('span', 'remote-blocked-host', host));
    box.title = src;
    el.replaceWith(box);
  });
  // Headings: ids for fragment navigation
  root.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6').forEach((h) => {
    h.id = 'h-' + slugHeading(h.textContent ?? '');
    h.dataset.heading = normHeading(h.textContent ?? '');
  });
  // Block ids "^id" at end of a block
  root.querySelectorAll<HTMLElement>('p,li,td,blockquote>p').forEach((p) => {
    const last = p.lastChild;
    if (last && last.nodeType === 3) {
      const m = /(\s|^)\^([A-Za-z0-9-]+)\s*$/.exec(last.textContent ?? '');
      if (m) {
        last.textContent = (last.textContent ?? '').slice(0, m.index + m[1].length).trimEnd();
        p.dataset.block = m[2];
        p.id = 'b-' + m[2];
      }
    }
  });
  // Task lists
  root.querySelectorAll('li').forEach((li) => {
    const host = li.firstChild?.nodeName === 'P' ? li.firstChild : li;
    const t = host.firstChild;
    if (t && t.nodeType === 3) {
      const m = /^\[([ xX\/\-])\]\s/.exec(t.textContent ?? '');
      if (m) {
        t.textContent = (t.textContent ?? '').slice(m[0].length);
        const box = document.createElement('span');
        const done = m[1] !== ' ';
        box.className = 'task-box' + (done ? ' done' : '');
        box.setAttribute('role', 'img');
        box.setAttribute('aria-label', done ? 'Completed task' : 'Open task');
        box.textContent = done ? '✓' : '';
        host.insertBefore(box, host.firstChild);
        li.classList.add('task');
        if (done) li.classList.add('task-done');
      }
    }
  });
  // Callouts
  root.querySelectorAll('blockquote').forEach((bq) => {
    const p = bq.firstElementChild;
    if (!p || p.tagName !== 'P') return;
    const first = p.firstChild;
    if (!first || first.nodeType !== 3) return;
    const m = /^\[!([A-Za-z0-9_-]+)\]([+-]?)[ \t]*([^\n]*)/.exec(first.textContent ?? '');
    if (!m) return;
    const type = m[1].toLowerCase();
    const fold = m[2];
    first.textContent = (first.textContent ?? '').slice(m[0].length).replace(/^\n/, '');
    // Title = rest of first line (text + inline nodes until first <br>)
    const titleEl = makeEl('span', 'callout-title-text');
    if (m[3]) titleEl.append(document.createTextNode(m[3]));
    first.textContent = '';
    while (p.firstChild && p.firstChild.nodeName !== 'BR') titleEl.append(p.firstChild);
    if (p.firstChild?.nodeName === 'BR') p.firstChild.remove();
    if (!titleEl.textContent?.trim()) titleEl.textContent = type.charAt(0).toUpperCase() + type.slice(1);
    if (!p.textContent?.trim() && !p.querySelector('img')) p.remove();
    const content = makeEl('div', 'callout-content');
    while (bq.firstChild) content.append(bq.firstChild);
    const icon = makeEl('span', 'callout-icon', CALLOUT_ICONS[type] ?? '•');
    icon.setAttribute('aria-hidden', 'true');
    let box: HTMLElement;
    if (fold) {
      box = makeEl('details', 'callout');
      if (fold === '+') (box as HTMLDetailsElement).open = true;
      const sum = makeEl('summary', 'callout-title');
      sum.append(icon, titleEl);
      box.append(sum, content);
    } else {
      box = makeEl('div', 'callout');
      const t = makeEl('div', 'callout-title');
      t.append(icon, titleEl);
      box.append(t, content);
    }
    box.dataset.callout = type;
    bq.replaceWith(box);
  });
  // Tables: wrap for horizontal scroll
  root.querySelectorAll('table').forEach((t) => {
    const w = makeEl('div', 'table-wrap');
    t.replaceWith(w);
    w.append(t);
  });
  // Code blocks: label language, mark dataview etc. as not executed
  root.querySelectorAll('pre > code').forEach((c) => {
    const lang = [...c.classList].find((x) => x.startsWith('language-'))?.slice(9);
    if (!lang) return;
    const pre = c.parentElement!;
    pre.dataset.lang = lang;
    if (/^(dataview|dataviewjs|tasks|query|button|meta-bind.*|templater.*)$/i.test(lang)) {
      pre.classList.add('plugin-block');
      pre.dataset.lang = `${lang} · plugin query not run`;
    }
  });
  // Embedded notes (transclusion), limited depth, cycle-safe
  root.querySelectorAll<HTMLElement>('[data-embed-note]').forEach((el) => {
    const path = el.dataset.embedNote!;
    const depth = ctx.depth ?? 0;
    const stack = ctx.stack ?? [ctx.fromPath];
    const header = makeEl('a', 'embed-note-head', stripMd(basename(path)) + (el.dataset.frag ? ` › ${el.dataset.frag}` : ''));
    header.setAttribute('href', noteHref(path, el.dataset.frag || undefined, (el.dataset.fragType as any) || undefined));
    el.append(header);
    if (depth >= 2 || stack.includes(path + '#' + el.dataset.frag)) {
      el.append(makeEl('div', 'embed-missing', 'Nested embed not expanded (depth limit or loop).'));
      return;
    }
    const content = ctx.getContent(path);
    if (content == null) { el.append(makeEl('div', 'embed-missing', 'Embedded note content is not loaded.')); return; }
    let src = content;
    if (el.dataset.frag) {
      const sec = extractSection(content, el.dataset.frag, el.dataset.fragType || 'heading');
      if (sec == null) { el.append(makeEl('div', 'embed-missing', `Section “${el.dataset.frag}” not found in ${path}.`)); return; }
      src = sec;
    }
    const inner = renderMarkdown(src, { ...ctx, fromPath: path, depth: depth + 1, stack: [...stack, path + '#' + el.dataset.frag] });
    const body = makeEl('div', 'embed-note-body');
    body.append(inner);
    el.append(body);
  });
}
