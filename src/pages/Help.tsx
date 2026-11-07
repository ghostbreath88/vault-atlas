export default function Help() {
  return (
    <div className="page narrow">
      <div className="page-head"><div><h1 className="page-title">Help &amp; limits</h1><p className="page-sub">How Vault Atlas works, what it keeps private, and what it doesn't do (yet).</p></div></div>
      <div className="md" style={{ fontSize: '1rem' }}>
        <h2>Everyday use on Android / Samsung DeX</h2>
        <ol>
          <li>In <strong>My Files</strong>, open your Obsidian vault folder (often <em>Internal storage › Documents › Obsidian</em> or wherever you created it). Long-press the vault folder, tap <strong>More</strong> (⋮) → <strong>Compress</strong>, and keep the ZIP format. The original folder is left untouched.</li>
          <li>In Vault Atlas, open <strong>Import &amp; update</strong>. First time: <strong>Choose vault ZIP</strong>. Later: <strong>Refresh entire vault</strong> with your newest ZIP.</li>
          <li>Review the summary (new, changed, unchanged, missing, failed), then <strong>Apply update</strong>. Search, backlinks, tags, counts and the graph rebuild automatically.</li>
          <li>For a few edited notes, use <strong>Add or update files</strong> instead. If the browser doesn't tell Vault Atlas which folder a file came from, you'll be asked.</li>
        </ol>
        <p>Keyboard: <code>/</code> or <code>Ctrl K</code> search · in the graph, arrow keys pan, <code>+</code>/<code>-</code> zoom, <code>0</code> fits, <code>Enter</code> opens the selected note · on boards, arrow keys move the focused card (<code>Shift</code> for bigger steps), <code>Space</code> picks a card while connecting, <code>Delete</code> removes it.</p>

        <h2>Privacy</h2>
        <ul>
          <li>Your vault is read and indexed <strong>inside this browser</strong> using background workers. Note text, file names, tags, attachments and graph data are never sent to a server, analytics service or AI model. There is no account and no API key.</li>
          <li>The only network traffic is loading the app itself (from GitHub Pages) — after that it can run fully offline.</li>
          <li>Remote images in notes are <strong>blocked</strong> by default; you can load them per note. Loading one contacts that image's server.</li>
          <li>Embedded HTML is sanitised: scripts, iframes, forms, styles and event handlers are removed. Dataview, Templater and other plugin code blocks are shown as code and never run.</li>
          <li>Vault Atlas is <strong>read-only</strong>. It never writes, renames or deletes your Obsidian files.</li>
        </ul>

        <h2>Storage, snapshots and backups</h2>
        <ul>
          <li>Imported notes are stored in this browser's IndexedDB on this device (optional per vault). Pins, dashboard layout, saved graph views and boards are stored <strong>separately</strong> from the snapshot, keyed by vault-relative path, so replacing a snapshot never erases them.</li>
          <li>Each import is a <strong>snapshot</strong>. Changes you make in Obsidian appear only after you import again. There is no live sync.</li>
          <li>Notes that disappear from a new snapshot are <strong>kept and flagged as missing</strong> unless you choose to remove them. Renames/moves with identical content are detected and offered for confirmation so your pins and boards follow.</li>
          <li>Browser storage <strong>is not a backup</strong>. Clearing site data, uninstalling the browser, or low disk space can erase it. Use <strong>Settings › Export app data</strong> to save your pins, views and boards to a file. Your vault itself should be backed up the usual way.</li>
        </ul>

        <h2>How links are resolved</h2>
        <ul>
          <li>Each note's identity is its vault-relative path. Notes with the same name in different folders stay separate.</li>
          <li><code>[[Note]]</code> matches by file name. If several notes share the name, the one in the linking note's own folder wins (as in Obsidian, labelled “nearest”). Otherwise the link is <strong>ambiguous</strong>: listed in Diagnostics and not counted as a connection.</li>
          <li><code>[[Folder/Note]]</code> matches by path suffix; <code>[[Note#Heading]]</code> and <code>[[Note#^block]]</code> connect to the note in the graph while the reader jumps to the exact heading/block. Piped text <code>[[Note|text]]</code> never changes the target.</li>
          <li>Markdown links <code>[text](Folder/Note.md)</code> are resolved relative to the linking note first, then from the vault root; URL-encoding (<code>%20</code>) is decoded.</li>
          <li>Aliases are searchable. Alias-based link resolution is optional (off by default) and only used when exactly one note has that alias.</li>
          <li>Tags come from frontmatter (<code>tags:</code> as a list or text) and inline <code>#tags</code>, including nested <code>#parent/child</code>. Anything inside code blocks, inline code, comments, URLs and headings is ignored.</li>
          <li>Notes sharing a tag are <strong>not</strong> treated as linked. Tags appear as separate tag nodes with curved edges. Board connections are app-only and never counted as links.</li>
        </ul>

        <h2>Not supported (yet)</h2>
        <ul>
          <li><strong>Plugins:</strong> Dataview, Tasks queries, Templater, Excalidraw, Kanban and other community plugins don't run. Their code blocks are shown as plain code.</li>
          <li><strong>Canvas (.canvas)</strong> and <strong>Bases (.base)</strong> files are listed in the import inventory and Diagnostics but not rendered; embeds of them show a placeholder.</li>
          <li>PDFs aren't rendered inline (they open in your device's viewer). Embedded audio/video play with the browser's player when the format is supported.</li>
          <li>Math (LaTeX), Mermaid diagrams, footnotes, comments with nested code, and indented (4-space) code blocks are shown as plain text. Fake links inside indented code blocks may be counted.</li>
          <li>Editing notes, writing back to Obsidian, automatic folder sync, and a shared-tag “similarity” graph are not part of this release.</li>
          <li>Very large vaults: tested with synthetic vaults of 1,000 and 5,000 notes in desktop Chromium (5,000 notes: about 7 s to read and parse, 3 s to save). A phone will be slower and has not been measured. The full graph draws the most-connected notes up to a limit (4,000 by default, adjustable in Settings); use filters or the local graph beyond that.</li>
        </ul>
      </div>
    </div>
  );
}
