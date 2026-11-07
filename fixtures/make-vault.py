# Generates the synthetic test vault (v1 + v2) used for tests and the in-app demo.
import os, shutil, zipfile, base64, time, json
ROOT = os.path.dirname(os.path.abspath(__file__))
V = {}
V['Welcome.md'] = '''---
title: Welcome to the Atlas demo
tags: [meta, start]
aliases:
  - Home
  - Start Here
created: 2026-01-04
related: "[[Ideas/Garden]]"
---
# Welcome

This is a **synthetic demo vault** for Vault Atlas. Nothing here is real. ^intro-block

## Links of every flavour

- Piped display text: [[Ideas/Garden|my little garden]]
- Heading link: [[Journal/2026-03-14#Morning pages]]
- Block link: [[Recipes/Bread#^starter-ratio|starter ratio]]
- With extension: [[Orphaned Thought.md]]
- Same-note heading: [[#Section two]] and same-note block: [[#^intro-block]]
- Relative Markdown link: [the garden](Ideas/Garden.md)
- URL-encoded Markdown link: [big ideas](Ideas/Big%20Ideas.md)
- Unresolved: [[Missing Note]]
- Ambiguous (two notes called Meeting): [[Meeting]]
- Alias only (resolves only with alias fallback): [[AKA Thing]]
- External: [Example](https://example.com/page#not-a-tag)

Tags inline: #inbox and nested #health/sleep. Not tags: issue #123, C#, https://example.com/#anchor.

## Embeds

![[images/fern.png]]

![[Recipes/Bread#Starter]]

![[files/manual.pdf]]

![[Board.canvas]]

![Remote image that must not auto-load](https://example.com/tracker.png)

## Section two

> [!tip] Callouts work
> This is an Obsidian callout with a [[Ideas/Garden|link]].

> [!warning]- Folded callout
> Hidden until you open it.

- [ ] An open task
- [x] A finished task

| Column | Value |
| --- | --- |
| Tables | render |
'''
V['Ideas/Garden.md'] = '''---
tags: garden, ideas/outdoor
---
# Garden

Back to [[Welcome]]. Bread goes with the garden: [Bread](../Recipes/Bread.md) and [[Bread.md]].

Plant notes for the season. #garden/vegetables
'''
V['Ideas/Big Ideas.md'] = '''# Big Ideas

A note with a space in its filename, reached through a URL-encoded link. Links to [[Garden]].
'''
V['Recipes/Bread.md'] = '''---
tags:
  - food
  - food/baking
---
# Bread

## Starter

Feed the starter daily.

Flour to water is 1:1 by weight. ^starter-ratio
'''
V['Journal/2026-03-14.md'] = '''---
date: 2026-03-14
mood: calm
---
# Morning pages

Slept well. #journal #health/sleep

Thinking about [[Garden]] again. See https://example.com/page#also-not-a-tag

# Not a tag heading
'''
V['Work/Meeting.md'] = '''# Meeting (Work)

Notes from a work meeting. #work
'''
V['Personal/Meeting.md'] = '''# Meeting (Personal)

A personal meeting with a friend. #personal
'''
V['Work/Notes.md'] = '''# Work notes

This [[Meeting]] link resolves to the Meeting in the same folder (Work), like Obsidian does.
'''
V['Personal/Plan.md'] = '''# Plan

Explicit path link: [[Personal/Meeting]]. Also [[Work/Meeting|the work one]].
'''
V['Code Samples.md'] = '''# Code samples

Nothing in this note's code should become a link or tag.

```markdown
[[Fake Link In Fence]] and #fake-fence-tag
```

~~~
[[Tilde Fence Link]] #tilde-tag
~~~

Inline: `[[Inline Fake]]` and `#inline-fake-tag`.

%% Obsidian comment with [[Comment Link]] and #comment-tag %%

<!-- HTML comment [[Html Comment Link]] #html-comment-tag -->

```dataview
TABLE file.mtime FROM #journal
```

Escaped: \\[[Escaped Link]]

But this real one counts: [[Welcome]] #real-tag
'''
V['Aliased Note.md'] = '''---
aliases: [AKA Thing]
---
# Aliased Note

Known also as “AKA Thing”.
'''
V['Orphaned Thought.md'] = '''# Orphaned Thought

Nothing links here except Welcome. (Welcome links here, so this is not an orphan.)
'''
V['Lonely.md'] = '''# Lonely

A true orphan: no links in or out.
'''
V['Unsafe HTML.md'] = '''# Unsafe HTML

<script>window.__pwned = true</script>
<img src="x" onerror="window.__pwned = true">
<a href="javascript:window.__pwned=true">js link</a>
<iframe src="https://example.com"></iframe>
<b style="color:red">Bold HTML is fine</b>
'''
V['notes.txt'] = 'A text file — not an Obsidian note.\n'
V['Board.canvas'] = json.dumps({"nodes": [], "edges": []})
V['.obsidian/app.json'] = '{"legacyEditor": false}'
V['.obsidian/plugins/x/main.js'] = 'alert(1)'
V['.hidden.md'] = 'hidden'

PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAPklEQVR4nGNgGAWjYBSMglEwCkbBKBgFo2AUDH0wMTH9Z2BgYGBiYvrPwMDAwMTE9J+BgYGBgYGBYfgAAPnQBRF5yPm/AAAAAElFTkSuQmCC')
PDF = b'%PDF-1.1\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'
BIN = {'images/fern.png': PNG, 'files/manual.pdf': PDF}

def v2(files):
    f = dict(files)
    f['Ideas/Garden.md'] = f['Ideas/Garden.md'].replace('Plant notes for the season.', 'Plant notes for the season — UPDATED in v2, now with tomatoes.')
    f['New Idea.md'] = '# New Idea\n\nAdded in v2. Links to [[Garden]] and [[Kitchen/Bread]]. #ideas\n'
    del f['Lonely.md']
    f['Kitchen/Bread.md'] = f.pop('Recipes/Bread.md')  # moved, identical content
    f['Welcome.md'] = f['Welcome.md'].replace('Recipes/Bread', 'Kitchen/Bread')
    f['Ideas/Garden.md'] = f['Ideas/Garden.md'].replace('../Recipes/Bread.md', '../Kitchen/Bread.md')
    return f

def write(name, files):
    d = os.path.join(ROOT, name)
    shutil.rmtree(d, ignore_errors=True)
    for p, c in {**files, **BIN}.items():
        fp = os.path.join(d, 'Atlas Demo Vault', p)
        os.makedirs(os.path.dirname(fp), exist_ok=True)
        open(fp, 'wb').write(c if isinstance(c, bytes) else c.encode())
    z = os.path.join(ROOT, name + '.zip')
    with zipfile.ZipFile(z, 'w', zipfile.ZIP_DEFLATED) as zf:
        for base, _, fs in os.walk(d):
            for fn in sorted(fs):
                full = os.path.join(base, fn)
                zf.write(full, os.path.relpath(full, d))
        # a corrupt entry that must fail individually (stored data relabelled as deflate)
        zf.writestr(zipfile.ZipInfo('Atlas Demo Vault/Broken.md'), b'\xff\xfe this is not deflate data at all ' * 3, compress_type=zipfile.ZIP_STORED)
    b = bytearray(open(z, 'rb').read())
    name = b'Atlas Demo Vault/Broken.md'
    for sig, off in ((b'PK\x03\x04', 8), (b'PK\x01\x02', 10)):
        i = 0
        while True:
            i = b.find(sig, i)
            if i < 0: break
            nm_off = 30 if sig == b'PK\x03\x04' else 46
            if b[i+nm_off:i+nm_off+len(name)] == name:
                b[i+off] = 8
            i += 4
    open(z, 'wb').write(bytes(b))
    print('wrote', z)

write('vault-v1', V)
write('vault-v2', v2(V))
