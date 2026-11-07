import { load as yamlLoad, CORE_SCHEMA } from 'js-yaml';
import type { Heading, ParsedLink, ParsedNote } from './types';

const FM_RE = /^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

export function splitFrontmatter(text: string): { yaml: string | null; bodyStart: number } {
  const m = FM_RE.exec(text);
  if (!m) return { yaml: null, bodyStart: 0 };
  return { yaml: m[1] ?? '', bodyStart: m[0].length };
}

const blank = (s: string) => s.replace(/[^\n]/g, ' ');

/**
 * Returns a copy of `text` with code (fenced + inline), math blocks and comments replaced
 * by spaces. Newlines are preserved, so offsets and line numbers still line up.
 */
export function maskNonProse(text: string): string {
  let out = maskCode(text);
  // Comments: HTML and Obsidian %% %%.
  out = out.replace(/<!--[\s\S]*?-->/g, blank).replace(/%%[\s\S]*?%%/g, blank);
  return out;
}

/** Ranges [start,end) of Obsidian %% comments that are not inside code. */
export function commentRanges(text: string): [number, number][] {
  const masked = maskCode(text);
  const out: [number, number][] = [];
  for (const m of masked.matchAll(/%%[\s\S]*?%%/g)) out.push([m.index!, m.index! + m[0].length]);
  return out;
}

/** Masks fenced code, math blocks and inline code. */
export function maskCode(text: string): string {
  const lines = text.split('\n');
  let fence: { ch: string; len: number } | null = null;
  let math = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const stripped = line.replace(/^(?:\s*>)*\s*/, '');
    if (fence) {
      const m = /^(`{3,}|~{3,})\s*$/.exec(stripped);
      lines[i] = blank(line);
      if (m && m[1][0] === fence.ch && m[1].length >= fence.len) fence = null;
      continue;
    }
    if (math) {
      lines[i] = blank(line);
      if (/\$\$\s*$/.test(stripped)) math = false;
      continue;
    }
    const open = /^(`{3,}|~{3,})/.exec(stripped);
    if (open && !(open[1][0] === '`' && stripped.slice(open[1].length).includes('`'))) {
      fence = { ch: open[1][0], len: open[1].length };
      lines[i] = blank(line);
      continue;
    }
    if (/^\$\$/.test(stripped)) {
      lines[i] = blank(line);
      const singleLine = stripped.trim().length > 4 && /\$\$\s*$/.test(stripped.slice(2));
      if (!singleLine) math = true;
      continue;
    }
  }
  // Inline code: a run of N backticks closed by a run of exactly N backticks.
  return maskInlineCode(lines.join('\n'));
}

function maskInlineCode(s: string): string {
  const chars = s.split('');
  let i = 0;
  while (i < s.length) {
    if (s[i] !== '`') { i++; continue; }
    let n = 0;
    while (s[i + n] === '`') n++;
    const run = '`'.repeat(n);
    let j = i + n;
    let close = -1;
    while (j < s.length) {
      const k = s.indexOf(run, j);
      if (k < 0) break;
      if (s[k + n] !== '`' && s[k - 1] !== '`') { close = k; break; }
      j = k + 1;
      while (s[j] === '`') j++;
    }
    if (close < 0) { i += n; continue; }
    for (let x = i; x < close + n; x++) if (chars[x] !== '\n') chars[x] = ' ';
    i = close + n;
  }
  return chars.join('');
}

export function lineAt(text: string, offset: number): number {
  let n = 0;
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

export function parseWikiInner(innerRaw: string): Pick<ParsedLink, 'target' | 'fragment' | 'fragmentType' | 'display'> {
  const inner = innerRaw.replace(/\\\|/g, '|');
  const pipe = inner.indexOf('|');
  const targetPart = pipe >= 0 ? inner.slice(0, pipe) : inner;
  const display = pipe >= 0 ? inner.slice(pipe + 1).trim() : undefined;
  const hash = targetPart.indexOf('#');
  const target = (hash >= 0 ? targetPart.slice(0, hash) : targetPart).trim();
  let fragment = hash >= 0 ? targetPart.slice(hash + 1).trim() : undefined;
  let fragmentType: ParsedLink['fragmentType'];
  if (fragment !== undefined) {
    if (fragment.startsWith('^')) { fragmentType = 'block'; fragment = fragment.slice(1); }
    else fragmentType = 'heading';
    if (!fragment) { fragment = undefined; fragmentType = undefined; }
  }
  return { target, fragment, fragmentType, display: display || undefined };
}

const WIKI_RE = /(!?)\[\[([^\[\]\r\n]+?)\]\]/g;
const MD_RE = /(!?)\[((?:[^\[\]\n]|\[[^\[\]\n]*\])*)\]\(\s*(<[^>\n]*>|[^\s()]*(?:\([^\s()]*\)[^\s()]*)*)(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?\s*\)/g;
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
const URL_RE = /\b(?:https?|ftp|obsidian|file):\/\/[^\s<>()\]]+/gi;
// Tags: preceded by start/whitespace/(/,/; ; letters, numbers, _, -, / and emoji.
const TAG_RE = /(?<=^|[\s(,;])#([\p{L}\p{N}\p{M}_\-\/\p{Extended_Pictographic}\u200d\ufe0f]+)/gu;

function safeDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

export function parseMarkdownDest(destRaw: string): Pick<ParsedLink, 'target' | 'fragment' | 'fragmentType' | 'external'> {
  let dest = destRaw.trim();
  if (dest.startsWith('<') && dest.endsWith('>')) dest = dest.slice(1, -1);
  if (SCHEME_RE.test(dest)) return { target: dest, external: true };
  const hash = dest.indexOf('#');
  const target = safeDecode(hash >= 0 ? dest.slice(0, hash) : dest);
  let fragment = hash >= 0 ? safeDecode(dest.slice(hash + 1)) : undefined;
  let fragmentType: ParsedLink['fragmentType'];
  if (fragment) {
    if (fragment.startsWith('^')) { fragmentType = 'block'; fragment = fragment.slice(1); }
    else fragmentType = 'heading';
  } else fragment = undefined;
  return { target, fragment, fragmentType };
}

export function normalizeTag(t: string): string {
  return t.replace(/^#+/, '').replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '').trim();
}
export function isValidTag(t: string): boolean {
  return !!t && /[^\d\/]/.test(t);
}

function toStringList(v: unknown, splitSpaces: boolean): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.flatMap((x) => toStringList(x, false));
  if (typeof v === 'string') return v.split(splitSpaces ? /[,\s]+/ : /,/).map((s) => s.trim()).filter(Boolean);
  if (typeof v === 'number' || typeof v === 'boolean') return [String(v)];
  return [];
}

function collectStrings(v: unknown, key: string, out: { key: string; value: string }[]) {
  if (typeof v === 'string') out.push({ key, value: v });
  else if (Array.isArray(v)) v.forEach((x) => collectStrings(x, key, out));
  else if (v && typeof v === 'object') Object.entries(v as Record<string, unknown>).forEach(([k, x]) => collectStrings(x, `${key}.${k}`, out));
}

export function parseNote(text: string): ParsedNote {
  const src = text.replace(/^\uFEFF/, '');
  const { yaml: fmText, bodyStart } = splitFrontmatter(src);
  let frontmatter: Record<string, unknown> | null = null;
  let frontmatterError: string | undefined;
  if (fmText !== null) {
    try {
      const v = fmText.trim() ? yamlLoad(fmText, { schema: CORE_SCHEMA, json: true }) : {};
      if (v && typeof v === 'object' && !Array.isArray(v)) frontmatter = v as Record<string, unknown>;
      else if (v != null) frontmatterError = 'Frontmatter is not a key/value map';
      else frontmatter = {};
    } catch (e) {
      frontmatterError = (e as Error).message.split('\n')[0];
    }
  }
  const body = src.slice(bodyStart);
  const bodyLine0 = lineAt(src, bodyStart);
  const masked = maskNonProse(body);
  const links: ParsedLink[] = [];

  // Wikilinks / embeds
  let proseForMd = masked;
  WIKI_RE.lastIndex = 0;
  for (const m of masked.matchAll(WIKI_RE)) {
    const idx = m.index!;
    // Escaped "\[[" is not a link
    if (idx > 0 && masked[idx - 1] === '\\') continue;
    links.push({ kind: 'wikilink', embed: m[1] === '!', raw: m[0], line: bodyLine0 + lineAt(body, idx), ...parseWikiInner(m[2]) });
    proseForMd = proseForMd.slice(0, idx) + ' '.repeat(m[0].length) + proseForMd.slice(idx + m[0].length);
  }
  // Markdown links / images
  let proseForTags = proseForMd;
  for (const m of proseForMd.matchAll(MD_RE)) {
    const idx = m.index!;
    if (idx > 0 && proseForMd[idx - 1] === '\\') continue;
    const d = parseMarkdownDest(m[3]);
    if (!d.target && !d.fragment) continue;
    links.push({ kind: 'markdown', embed: m[1] === '!', raw: m[0], display: m[2] || undefined, line: bodyLine0 + lineAt(body, idx), ...d });
    // keep the visible text for tag scanning, blank the destination
    const textStart = idx + m[1].length + 1;
    const textEnd = textStart + m[2].length;
    proseForTags = proseForTags.slice(0, textEnd) + ' '.repeat(idx + m[0].length - textEnd) + proseForTags.slice(idx + m[0].length);
  }
  proseForTags = proseForTags.replace(URL_RE, (s) => ' '.repeat(s.length));

  // Headings and block IDs
  const headings: Heading[] = [];
  const blockIds: string[] = [];
  const mlines = masked.split('\n');
  mlines.forEach((l, i) => {
    const h = /^ {0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/.exec(l);
    if (h) headings.push({ level: h[1].length, text: h[2].replace(/\s\^[A-Za-z0-9-]+$/, '').trim(), line: bodyLine0 + i });
    const b = /(?:^|\s)\^([A-Za-z0-9-]+)[ \t]*$/.exec(l);
    if (b) blockIds.push(b[1]);
  });

  // Tags
  const tagMap = new Map<string, { name: string; sources: Set<'frontmatter' | 'inline'> }>();
  const addTag = (raw: string, source: 'frontmatter' | 'inline') => {
    const t = normalizeTag(raw);
    if (!isValidTag(t)) return;
    const key = t.toLowerCase();
    const cur = tagMap.get(key) ?? { name: t, sources: new Set() };
    cur.sources.add(source);
    tagMap.set(key, cur);
  };
  const tagLines = proseForTags.split('\n');
  tagLines.forEach((l) => {
    // A heading marker ("# Title") is never a tag; the regex already requires no space after '#'.
    for (const m of l.matchAll(TAG_RE)) addTag(m[1], 'inline');
  });

  let aliases: string[] = [];
  if (frontmatter) {
    toStringList(frontmatter.tags ?? frontmatter.tag, true).forEach((t) => addTag(t, 'frontmatter'));
    aliases = toStringList(frontmatter.aliases ?? frontmatter.alias, false);
    // Links inside property values count, as in Obsidian.
    const strs: { key: string; value: string }[] = [];
    for (const [k, v] of Object.entries(frontmatter)) if (!['tags', 'tag', 'aliases', 'alias'].includes(k)) collectStrings(v, k, strs);
    for (const { key, value } of strs) {
      for (const m of value.matchAll(WIKI_RE)) {
        links.push({ kind: 'wikilink', embed: m[1] === '!', raw: m[0], line: 0, property: key, ...parseWikiInner(m[2]) });
      }
    }
  }

  const tags = [...tagMap.values()].map((t) => t.name);
  const tagSources: ParsedNote['tagSources'] = {};
  tagMap.forEach((v, k) => (tagSources[k] = [...v.sources]));
  const wordCount = (masked.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu) || []).length;

  return { frontmatter, frontmatterError, bodyStart, aliases, tags, tagSources, links, headings, blockIds, wordCount };
}

/** Normalization for comparing heading link fragments with headings (Obsidian-like). */
export function normHeading(s: string): string {
  return s.replace(/[#|^:\[\]%*_`]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}
export function slugHeading(s: string): string {
  return normHeading(s).replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s/g, '-');
}
