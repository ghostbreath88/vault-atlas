# Vault Atlas

A private, local-first dashboard, reader and interactive graph explorer for an Obsidian vault. It runs entirely in your browser and is built for an Android phone, including Samsung DeX.

- **Production app (GitHub Pages):** https://ghostbreath88.github.io/vault-atlas/
- **Source:** https://github.com/ghostbreath88/vault-atlas

Vault Atlas is read-only. It never writes to, renames, or deletes your Obsidian files. Your notes are read and indexed inside the browser. Nothing from your vault is sent to any server.

## Using it on Android or Samsung DeX (no computer or terminal needed)

1. **Make a ZIP of your vault.** In Samsung **My Files**, find your Obsidian vault folder (often `Internal storage › Documents › Obsidian › <vault>`, or wherever you created it). Long-press the folder, tap **More (⋮) → Compress**, and keep the ZIP format. Your original folder isn't changed.
2. **Open Vault Atlas** at the production link above in Chrome or Samsung Internet. You can also use **Add to Home screen** or **Install app** to get an app icon that works offline.
3. **Import.** Go to **Import & update → Choose vault ZIP** and pick the ZIP. Check the summary (notes, attachments, unsupported, ignored, and failed files), then tap **Apply**. Search, backlinks, tags, counts and the graph are then built on your device.
4. **Later updates.** Make a fresh ZIP and use one of the two options:
   - **Refresh entire vault**: shows what is added, changed, unchanged, missing and failed before anything is applied. It replaces the current snapshot without creating duplicates. If notes were moved or renamed with identical content, the app detects this and offers to move your pins, boards and views to the new path.
   - **Add or update files**: for a few edited notes. If the browser can't tell which folder a file came from, you're asked to choose. The app never guesses.
   - **Import a separate vault** is a separate action that creates a new vault entry.
5. **Optional:** in **Settings & data**, you can choose not to keep note content stored on the device. In that case, select your latest ZIP each time you open the app. Your pins, boards and saved views stay stored and reconnect by vault-relative path.

The demo vault (**Try the demo vault**) is synthetic, clearly labelled, and stored apart from your own vaults.

## Privacy

- No account, subscription, cloud database, analytics, AI model or API key.
- All parsing, indexing and graph layout run in browser workers on your device.
- All fonts, icons, the demo vault and the code are bundled with the app. There are no CDN requests at runtime.
- A strict Content-Security-Policy (`connect-src 'self'`) stops the app from making network requests to other origins.
- Remote images in notes are blocked by default. You can load them for a single note with an explicit button, which contacts that image's server.
- Embedded HTML is sanitised with DOMPurify. Scripts, iframes, forms, styles, `javascript:` links and event handlers are removed. Dataview, Templater and other plugin code is shown as plain code and never run.
- **Delete all imported local data** (Settings) removes every vault, note, board, view and setting from this browser. You have to type `DELETE` to confirm.

## Storage, snapshots and backups

- Imported notes are stored in this browser's IndexedDB on this device. The app asks for persistent storage, but **browser storage is not a backup**. Clearing site data, uninstalling the browser, or running low on space can erase it.
- Each import is a **snapshot**. There is no live sync with Obsidian.
- App-only data (pins, recent notes, dashboard layout, saved graph views, boards, confirmed moves) is stored separately from the replaceable snapshot and keyed by vault-relative path.
- Notes missing from a new snapshot are **kept and flagged**, not deleted silently. **Diagnostics** offers a reviewed cleanup, and lets you re-point or drop saved associations that no longer match a note.
- **Settings → Export app data** saves your settings, pins, views and boards to a JSON file. It contains no note text. This file is **not** a vault backup. Back up your vault the usual way.
- App updates keep your local data. The database schema is versioned (currently v2), and migrations are covered by tests (`tests/db-migration.test.ts`). When a new version is deployed, the app shows **Update ready — reload**. It never reloads by itself in the middle of an import.

## Link and tag rules

- A note's identity is its vault-relative path. Notes with the same name in different folders stay separate.
- Supported link forms: `[[Note]]`, `[[Note|text]]`, `[[Folder/Note]]`, `[[Note.md]]`, `[[Note#Heading]]`, `[[Note#^block]]`, `[[#Heading]]`, embeds `![[…]]`, and relative Markdown links `[text](../Folder/Note.md)` with `%20` decoding.
- An ambiguous name links only when one candidate is in the linking note's own folder. Otherwise it appears in Diagnostics and isn't counted. Unresolved links are listed and never turned into fake notes.
- Tags come from YAML `tags:` (list or string) and inline `#tag` / `#nested/tag`. Tags inside code, headings, comments and URL fragments are ignored. Aliases come from YAML `aliases:`.
- Notes that share a tag are **not** treated as linked. Tags appear as separate tag nodes with their own edge style. Board connections are app-only and never counted as links.

## Features

- **Home:** search, continue reading, pinned notes, recently imported or updated notes, folders, tags, a random note, and clickable count cards (notes, resolved connections, tags, orphans, unresolved/ambiguous). Sections can be hidden and reordered. Dates come only from file metadata when it exists. None are invented.
- **Notes (library and reader):** full-text search across titles, content, tags, paths and frontmatter. Filters by folder, tag (explicit AND/OR) and status. The reader renders sanitised Markdown with tasks, tables, code, callouts (including folded ones), local images, note and section embeds, and clickable internal links. It also shows outgoing links, backlinks, tags, properties, path, a local graph, and **View original Markdown**.
- **Graph:** full or local (depth 1–3), with pan, zoom, fit, reset and drag on touch and mouse. Also: find and jump to a node, click for a preview, neighbour highlighting, optional arrows, and toggles for tags, attachments, unresolved links and orphans. Folder and tag filters (AND/OR), colour by folder or tag with a legend, size by degree, adaptive labels, pause/resume and freeze, and saved named views. Keyboard: arrows pan, `+`/`-` zoom, `0` fits, `Enter` opens.
- **Boards:** cards for notes, drag to arrange, labelled manual connections, pan and zoom, saved automatically.
- **Diagnostics:** unresolved links, ambiguous links, folder-proximity and alias resolutions, failed files, unsupported files, missing notes, and dangling associations.

## Not supported

- Community plugins (Dataview, Tasks queries, Templater, Excalidraw, Kanban, etc.) don't run. Their code blocks are shown as plain code.
- `.canvas` and `.base` files are listed in the import inventory and Diagnostics but not rendered. Embeds of them show a placeholder.
- LaTeX math, Mermaid diagrams and footnotes are shown as plain text. PDFs aren't rendered inline. They open in the device viewer.
- No live sync, no editing, no writing back to the vault.
- Folder selection depends on the browser. Android Chrome usually offers ZIP and multi-file selection only, so ZIP is the recommended path. Multi-file import can't always keep folder paths, which is why the app asks you to choose a folder.

## Tested

Automated tests run in CI on every push: unit tests (parser, resolver, inventory, graph edges, snapshot diff and move detection, dangling references, DB migration v1→v2) plus typecheck. `tests/e2e/acceptance.mjs` is a Playwright end-to-end run against a deployed URL.

| Area | How tested | Result |
| --- | --- | --- |
| Import synthetic vault ZIP (14 notes, 2 attachments, 1 corrupt, 2 unsupported, 3 hidden or ignored) | Playwright, Chromium (desktop and 390 px mobile emulation) | Pass |
| Reader: link forms, backlinks, tags, callouts, tasks, embeds, local images, remote-image opt-in | Playwright | Pass |
| Sanitising: no script execution, iframes, `javascript:` links or event handlers removed | Playwright | Pass |
| Graph: 13 note→note edges match the wikilinks; ambiguous link not counted; tag edges separate | Playwright | Pass |
| Graph controls: local depth, saved view, freeze, keyboard pan/zoom/fit, find and jump, touch tap | Playwright | Pass |
| Updated ZIP: added/changed/unchanged/missing shown before apply, move detected, no duplicates, missing note kept and flagged | Playwright | Pass |
| Re-importing the same ZIP adds nothing | Playwright | Pass |
| Pins and board cards follow a confirmed move; boards and views survive snapshot replacement | Playwright | Pass |
| Add or update files: asks for a folder when ambiguous; Apply blocked until chosen | Playwright | Pass |
| "Don't store note content" mode: app data kept, reconnects on next import | Playwright | Pass |
| Export app data → Delete all (typed confirmation) → restore → re-import reconnects by path | Playwright | Pass |
| Cancel a running import: nothing saved | Playwright, 5,000-note vault | Pass |
| Offline reload after first visit (service worker) | Playwright, offline mode | Pass |
| Network audit: only same-origin GET requests for app files; no vault text or names in any request | Playwright request log | Pass |
| DB migration v1 → v2 keeps notes, pins, boards, views, settings | Vitest + fake-indexeddb | Pass |
| Large vaults: 1,000 notes (≈1.4 s parse, 0.5 s save) and 5,000 notes (≈6.5 s parse, 3.1 s save, graph capped at 4,000 most-connected nodes with a notice) | Playwright, desktop Chromium in a cloud sandbox | Pass (desktop only) |
| Light and dark themes, reduced motion, phone layout without horizontal scrolling | Playwright screenshots | Pass |
| **Real Samsung Galaxy / DeX hardware**: touchscreen monitor, mouse, keyboard, My Files ZIP picker, Samsung Internet, Install app, persistent-storage prompt, performance on the phone | — | **Not verified** |
| Very large real vaults (>5,000 notes or large attachments) on a phone | — | **Not verified** |

## Developing (optional, needs Node 20)

```
npm ci
npm test
npm run dev
```

Pushing to `main` runs `.github/workflows/deploy.yml`, which tests the code, builds with `BASE=/<repo>/`, and publishes to GitHub Pages. Fixtures are generated by `fixtures/make-vault.py`, and `fixtures/make-large-vault.py N out.zip` builds a large synthetic vault. **Only synthetic test data is committed. Never commit a real vault.**

## Licence

MIT
