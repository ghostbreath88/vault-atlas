import type { MediaType } from './paths';

export interface ParsedLink {
  kind: 'wikilink' | 'markdown';
  embed: boolean;
  raw: string;
  /** Path part as written (markdown links are URL-decoded). Empty = same note. */
  target: string;
  fragment?: string;
  fragmentType?: 'heading' | 'block';
  display?: string;
  line: number;
  external?: boolean;
  /** Set when the link was found inside a frontmatter property value. */
  property?: string;
}

export interface Heading { level: number; text: string; line: number }

export interface ParsedNote {
  frontmatter: Record<string, unknown> | null;
  frontmatterError?: string;
  bodyStart: number; // char offset where body begins
  aliases: string[];
  tags: string[]; // display form, deduped case-insensitively
  tagSources: Record<string, ('frontmatter' | 'inline')[]>; // keyed by lowercase tag
  links: ParsedLink[];
  headings: Heading[];
  blockIds: string[];
  wordCount: number;
}

export type DateSource = 'file' | 'zip';

export interface NoteRecord {
  vaultId: string;
  path: string;
  name: string;
  folder: string;
  content: string;
  hash: string;
  size: number;
  sourceMtime?: number;
  sourceMtimeKind?: DateSource;
  firstImportedAt: number;
  contentUpdatedAt: number;
  parsed: ParsedNote;
  /** Kept from an older snapshot at the user's request; not in latest import. */
  missing?: boolean;
}

export interface AttachmentRecord {
  vaultId: string;
  path: string;
  name: string;
  folder: string;
  media: MediaType;
  mime: string;
  size: number;
  hash: string;
  blob: Blob;
  sourceMtime?: number;
  firstImportedAt: number;
  contentUpdatedAt: number;
  missing?: boolean;
}

export interface InventoryItem { path: string; reason: string; size?: number }

export interface ManifestEntry { path: string; hash: string; size: number; kind: 'note' | 'attachment' }

export interface VaultRecord {
  id: string;
  name: string;
  isDemo?: boolean;
  createdAt: number;
  lastImportAt?: number;
  /** Whether note content + attachments are stored on this device. */
  persistContent: boolean;
  /** Lightweight manifest of the latest snapshot (paths + hashes) for diffing. */
  manifest: ManifestEntry[];
  /** Unsupported/ignored files seen in the latest snapshot. */
  inventory: InventoryItem[];
  ignoredCount: number;
  rootName?: string;
}

export interface ImportLog {
  id: string;
  vaultId: string;
  at: number;
  mode: ImportMode;
  sourceLabel: string;
  counts: { added: number; changed: number; unchanged: number; missing: number; failed: number; skipped: number; ignored: number; removed: number; moved: number };
  failed: { path: string; error: string }[];
}

export type ImportMode = 'new-vault' | 'add-update' | 'replace-snapshot';

export interface Board {
  id: string;
  vaultId: string;
  name: string;
  cards: BoardCard[];
  links: BoardLink[];
  camera: { x: number; y: number; zoom: number };
  createdAt: number;
  updatedAt: number;
}
export interface BoardCard { id: string; notePath: string; x: number; y: number; title: string }
export interface BoardLink { id: string; from: string; to: string; label: string }

export interface GraphFilters {
  folders: string[];
  tags: string[];
  tagMode: 'and' | 'or';
  showTags: boolean;
  showAttachments: boolean;
  showUnresolved: boolean;
  showOrphans: boolean;
  colorBy: 'folder' | 'tag' | 'none';
  sizeByDegree: boolean;
  arrows: boolean;
  labels: 'adaptive' | 'selected' | 'all';
}

export interface GraphView {
  id: string;
  vaultId: string;
  name: string;
  mode: 'full' | 'local';
  center?: string;
  depth: number;
  filters: GraphFilters;
  positions?: Record<string, [number, number]>;
  createdAt: number;
}

export interface DashboardPrefs { order: string[]; hidden: string[] }

/** Per-vault app-only data. Stored separately from imported content. */
export interface VaultAppData {
  vaultId: string;
  favorites: string[];
  recents: { path: string; at: number }[];
  dashboard: DashboardPrefs;
  frozenPositions?: Record<string, [number, number]>;
  /** Notes the user confirmed as moved: old path -> new path. */
  moves: { from: string; to: string; at: number }[];
  obsidianVaultName?: string;
}

export interface Settings {
  theme: 'system' | 'dark' | 'light';
  currentVaultId?: string;
  remoteImages: 'off' | 'ask';
  aliasFallback: boolean;
  maxAttachmentMB: number;
  graphNodeLimit: number;
  persistDefault: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  remoteImages: 'ask',
  aliasFallback: false,
  maxAttachmentMB: 40,
  graphNodeLimit: 4000,
  persistDefault: true,
};
