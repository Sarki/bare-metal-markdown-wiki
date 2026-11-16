/* Local Wiki — no server, fully offline after build.
 * Frame = index.html; knowledge = markdown; rendered on the fly.
 * Two loaders: bundled (data.js) always works; live (File System Access) in Chrome/Edge.
 */
(function () {
  'use strict';

  // ---------- tiny helpers ----------
  function el(id) { return document.getElementById(id); }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function b64toUtf8(b64) {
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, function (c) { return c.charCodeAt(0); });
    return new TextDecoder('utf-8').decode(bytes);
  }
  function titleOf(slug) { return PAGES[slug] ? PAGES[slug].title : slug; }

  // ---------- markdown engine ----------
  const md = window.markdownit({ html: true, linkify: true, typographer: false, breaks: false });
  if (window.MditExtras) { md.use(MditExtras.container); md.use(MditExtras.alerts); md.use(MditExtras.tabs); md.use(MditExtras.badges); } // ::: containers, > [!NOTE] alerts, ::: tabs, @{ badges }
  if (window.mermaid) { try { mermaid.initialize({ startOnLoad: false, theme: 'default' }); } catch (e) {} }

  // ---------- state ----------
  const WIKI = window.WIKI || {}; // settings live in config.js; every key has a built-in default
  let RAW = [];                 // [{slug, mtime, content}]
  let PAGES = {};               // slug -> {slug,title,folder,tags,mtime,content,links}
  let IMAGES = {};              // "folder/file.png" (KB-root-relative) -> data URI
  let STEM = {};                // lowercased filename stem -> [slugs]
  let mode = 'bundled';
  let activeTag = '';
  let liveHandle = null;       // FileSystemDirectoryHandle, once connected
  let lastRefresh = 0;         // debounce for focus auto-refresh
  let tocHtml = '';            // current page's TOC, injected into the sidebar or rail
  let tocSide = (WIKI.tocSide === 'right') ? 'right' : 'left'; // from the settings block in index.html
  let tocLevels = Math.min(6, Math.max(1, parseInt(WIKI.tocLevels, 10) || 3)); // TOC heading depth, 1–6
  let foldersOpen = WIKI.foldersOpen === true; // start with the sidebar folders expanded
  let landingPage = typeof WIKI.landingPage === 'string' ? WIKI.landingPage : ''; // page opened at empty hash; '' = generated home
  let sidebarOrder = (WIKI.sidebarOrder === 'folders' || WIKI.sidebarOrder === 'alpha') ? WIKI.sidebarOrder : 'files'; // 'folders' | 'files' | 'alpha'
  document.documentElement.style.setProperty('--page-w', Math.min(100, Math.max(10, parseInt(WIKI.pageWidth, 10) || 70)) + '%'); // article width cap, 10–100%
  const wikiName = (typeof WIKI.wikiName === 'string' && WIKI.wikiName.trim()) ? WIKI.wikiName.trim() : 'Local Wiki'; // shown in topbar + tab titles
  document.querySelector('.brand').textContent = '\uD83D\uDCDA ' + wikiName; // keep the book icon, replace the default name

  // ---------- frontmatter ----------
  function parseFrontmatter(src) {
    const tags = []; let title = ''; let body = src;
    const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (m) {
      const block = m[1]; body = src.slice(m[0].length);
      const t = block.match(/^title:\s*(.+)$/m);
      if (t) title = t[1].trim().replace(/^["']|["']$/g, '');
      const ti = block.match(/^tags:\s*(.*)$/m);
      if (ti) {
        const inline = ti[1].trim();
        if (inline) tags.push.apply(tags, inline.split(',').map(function (s) { return s.trim().replace(/^["']|["']$/g, ''); }).filter(Boolean));
        else { let mm; const list = /^\s*-\s+(.+)$/gm; while ((mm = list.exec(block))) { const v = mm[1].trim().replace(/^["']|["']$/g, ''); if (v) tags.push(v); } }
      }
    }
    return { tags: tags, title: title, body: body };
  }

  // ---------- link resolution ----------
  function normalizeParts(parts) {
    const out = [];
    for (const p of parts) { if (p === '.' || p === '') continue; if (p === '..') out.pop(); else out.push(p); }
    return out;
  }
  function resolveSlug(t) {
    if (t.indexOf('/') !== -1) {
      const s = t.replace(/^\/+/, '').replace(/\.md$/i, '').replace(/\/+$/, '');
      return PAGES[s] ? s : null;
    }
    const arr = STEM[t.toLowerCase()];
    if (!arr || !arr.length) return null;
    if (arr.length === 1) return arr[0];
    return arr.slice().sort(function (a, b) { return a.split('/').length - b.split('/').length; })[0];
  }
  function absPath(t, base) { // resolve a relative ref against the page's folder (shared by .md links and images)
    const path = t.split('#')[0].split('?')[0];
    if (!path) return '';
    return path.charAt(0) === '/' ? path.slice(1) : normalizeParts((base ? base.split('/') : []).concat(path.split('/'))).join('/');
  }
  function resolveMdPath(t, base) {
    const abs = absPath(t, base).replace(/\.md$/i, '');
    return PAGES[abs] ? abs : null;
  }

  // ---------- index ----------
  function buildIndex() {
    PAGES = {}; STEM = {};
    RAW.forEach(function (p) {
      const fm = parseFrontmatter(p.content);
      const folder = p.slug.indexOf('/') !== -1 ? p.slug.slice(0, p.slug.lastIndexOf('/')) : '';
      const stemFile = p.slug.split('/').pop();
      p.tags = fm.tags; p.folder = folder; p.content = fm.body;
      let title = fm.title;
      if (!title) { const h1 = fm.body.match(/^#\s+(.+)$/m); title = h1 ? h1[1].trim() : ''; }
      if (!title) title = stemFile.replace(/\.md$/i, '').replace(/[-_]+/g, ' ').trim();
      p.title = title;
      PAGES[p.slug] = p;
      (STEM[stemFile.toLowerCase()] = STEM[stemFile.toLowerCase()] || []).push(p.slug);
    });
    for (const slug in PAGES) PAGES[slug].links = outLinks(PAGES[slug]);
  }
  function outLinks(p) {
    const set = new Set();
    outsideCode(p.content, function (s) { // mentions inside code do not create backlinks
      let m; const w = /\[\[([^\]|\n]+?)(?:\|([^\]\n]+?))?\]\]/g;
      while ((m = w.exec(s))) { const slug = resolveSlug(m[1].trim()); if (slug) set.add(slug); }
      const l = /\]\(([^)]+)\)/g;
      while ((m = l.exec(s))) { const t = m[1].trim(); if (/\.md($|#|\?)/i.test(t)) { const slug = resolveMdPath(t, p.folder); if (slug) set.add(slug); } }
      return s;
    });
    return set;
  }

  // ---------- wiki + footnotes ----------
  // [[…]]/[^…] rewriting must skip ``` fences and `spans`, otherwise example
  // sources written inside code get rewritten into mangled link markup.
  // shortcut: only ```/~~~ fences and single-` spans are protected; unclosed
  // fences and ``-spans can still be rewritten — upgrade to a real tokenizer
  // if a page needs that
  function outsideCode(src, fn) {
    const re = /([ \t]{0,3}(?:```|~~~)[^\n]*\n[\s\S]*?^[ \t]{0,3}(?:```|~~~)[ \t]*$|`[^`\n]+`)/gm;
    let out = '', last = 0, m;
    while ((m = re.exec(src))) {
      out += fn(src.slice(last, m.index)) + m[0]; // text before the code run is rewritten, code run kept
      last = re.lastIndex;
    }
    return out + fn(src.slice(last));
  }
  function wikiLinks(src) {
    return outsideCode(src, function (s) {
      return s.replace(/\[\[([^\]|\n]+?)(?:\|([^\]\n]+?))?\]\]/g, function (m, target, display) {
        const t = target.trim();
        const label = (display ? display.trim() : t).replace(/\.md$/i, '');
        const slug = resolveSlug(t);
        if (slug) return '[' + label + '](#' + encodeURIComponent(slug) + ')';
        return '<span class="broken-wiki">[' + escapeHtml(label) + ']</span>';
      });
    });
  }
  function withFootnotes(src) {
    const lines = src.split('\n'); const body = []; const defs = {}; let inFence = false;
    for (let i = 0; i < lines.length; i++) {
      if (/^[ \t]{0,3}(?:```|~~~)/.test(lines[i])) { inFence = !inFence; body.push(lines[i]); continue; } // fences pass through untouched
      if (inFence) { body.push(lines[i]); continue; }
      const m = lines[i].match(/^\s{0,3}\[\^([^\]]+)\]:\s?([\s\S]*)$/);
      if (m) {
        const id = m[1].trim();
        if (!(id in defs)) defs[id] = '';
        defs[id] += (defs[id] ? ' ' : '') + m[2];
        while (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1]) && !/^\s{0,3}\[\^[^\]]+\]:/.test(lines[i + 1])) { i++; defs[id] += ' ' + lines[i].trim(); }
        body.push('');
      } else body.push(lines[i]);
    }
    const num = {}; const used = [];
    const nbody = outsideCode(body.join('\n'), function (b) { return b.replace(/\[\^([^\]]+)\]/g, function (mm, id) {
      id = id.trim();
      if (!(id in num)) { num[id] = used.length + 1; used.push(id); }
      const n = num[id];
      return '<sup id="fnref-' + n + '"><a href="#fn-' + n + '">' + n + '</a></sup>';
    }); });
    let html = md.render(nbody);
    if (used.length) {
      html += '<section class="footnotes"><hr><ol>' + used.map(function (id) {
        const n = num[id];
        return '<li id="fn-' + n + '">' + md.renderInline(defs[id] || '') + ' <a href="#fnref-' + n + '">&uarr;</a></li>';
      }).join('') + '</ol></section>';
    }
    return html;
  }
  function renderMarkdown(src) { return withFootnotes(wikiLinks(src)); }

  // ---------- post-render ----------
  function fixMdLinks(pageNode, base) {
    pageNode.querySelectorAll('a[href]').forEach(function (a) {
      const h = a.getAttribute('href');
      if (!h || h.charAt(0) === '#') return;
      if (/^(https?:|mailto:)/i.test(h)) { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener'); a.classList.add('ext-link'); } // external links: keep the wiki in place
      else if (/\.md($|#|\?)/i.test(h)) { const s = resolveMdPath(h, base); if (s) a.setAttribute('href', '#' + encodeURIComponent(s)); }
      else if (/\.html?($|#|\?)/i.test(h)) { const abs = absPath(h, base); if (abs) { a.setAttribute('href', 'articles/' + abs); a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener'); a.classList.add('html-file'); } } // local HTML files leave the frame: new tab, like external links
    });
    pageNode.querySelectorAll('img[src]').forEach(function (im) { // local images resolve against the page folder, same as .md links; live mode holds the bytes in IMAGES, bundled mode points at the articles/ files so they lazy-load
      const s = im.getAttribute('src');
      if (!s || /^(https?:|data:)/i.test(s)) return;
      const abs = absPath(s, base);
      im.src = IMAGES[abs] || 'articles/' + abs; // shortcut: 'articles' must match build.sh's KB dir — read from settings if it ever becomes configurable
    });
  }
  function highlightCode(pageNode) {
    if (!window.hljs) return;
    pageNode.querySelectorAll('pre code').forEach(function (c) {
      if (/language-mermaid\b/.test(c.className)) return;
      try { c.innerHTML = hljs.highlight(c.textContent, { ignoreIllegals: true }).value; c.classList.add('hljs'); } catch (e) {}
    });
  }
  function runKaTeX(pageNode) {
    if (!window.renderMathInElement) return;
    try {
      renderMathInElement(pageNode, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '\\(', right: '\\)', display: false },
          { left: '$', right: '$', display: false }
        ],
        throwOnError: false,
        ignoredTags: ['script', 'style', 'textarea', 'pre', 'code'] // this auto-render lowercases nodeName before matching — capitals would match nothing
      });
    } catch (e) {}
  }
  function runMermaid(pageNode) {
    const nodes = [];
    pageNode.querySelectorAll('pre code.language-mermaid').forEach(function (code) {
      const div = document.createElement('div'); div.className = 'mermaid'; div.textContent = code.textContent;
      const pre = code.closest('pre'); pre.replaceWith(div); nodes.push(div);
    });
    if (nodes.length && window.mermaid) { try { mermaid.run({ nodes: nodes }); } catch (e) {} }
  }
  function addCopyButtons(pageNode) {
    pageNode.querySelectorAll('pre').forEach(function (pre) {
      if (pre.querySelector('.copybtn')) return;
      const b = document.createElement('button');
      b.className = 'copybtn'; b.type = 'button'; b.textContent = '\uD83D\uDCCB'; b.title = 'Copy code snippet'; // 📋
      pre.appendChild(b);
    });
  }
  function copyText(text, cb) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(cb, function () { legacyCopy(text); cb(); });
    } else { legacyCopy(text); cb(); }
  }
  function legacyCopy(text) { // clipboard API fallback (e.g. older Firefox on file://)
    const t = document.createElement('textarea');
    t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); t.select();
    try { document.execCommand('copy'); } catch (e) {}
    t.remove();
  }
  function buildToc(pageNode) {
    const heads = Array.prototype.slice.call(pageNode.querySelectorAll('h1,h2,h3,h4,h5,h6')).filter(function (h) { return +h.tagName[1] <= tocLevels; }); // tagName is uppercase: 'H2'[1] -> 2
    if (!heads.length) { tocHtml = ''; placeToc(); return; }
    let html = '';
    heads.forEach(function (h) {
      if (!h.id) h.id = 'hd-' + Math.random().toString(36).slice(2, 8);
      const lvl = +h.tagName[1] - 1;
      html += '<a href="#' + h.id + '" class="toclink toc-l' + lvl + '">' + escapeHtml(h.textContent.trim()) + '</a>';
    });
    tocHtml = '<div class="page-toc">' + html + '</div>';
    placeToc();
  }
  function placeToc() { // right rail only occupies its column when the setting is right AND the page has a TOC
    const show = tocSide === 'right' && !!tocHtml;
    el('content').classList.toggle('toc-right', show);
    el('tocRail').classList.toggle('hidden', !show);
    el('tocRail').innerHTML = show ? tocHtml : '';
  }
  function renderBacklinks(slug) {
    const box = el('backlinks');
    const from = Object.keys(PAGES).filter(function (s) { return s !== slug && PAGES[s].links.has(slug); });
    if (!from.length) { box.innerHTML = ''; return; }
    box.innerHTML = '<h3>Linked from</h3>' + from.map(function (s) {
      return '<a href="#' + encodeURIComponent(s) + '">' + escapeHtml(titleOf(s)) + '</a>';
    }).join(', ');
  }

  // ---------- page render ----------
  function crumbHtml(slug) {
    const parts = slug.split('/');
    let html = '<a href="#">articles</a>';
    parts.forEach(function (p, i) {
      const isLast = i === parts.length - 1;
      html += '<span class="crumb-sep">›</span>' + escapeHtml(p + (isLast ? '.md' : ''));
    });
    return '<nav class="breadcrumbs">' + html + '</nav>';
  }
  function renderPage(slug) {
    const page = el('page'); const p = PAGES[slug];
    if (!p) {
      page.innerHTML = '<h1>Not found</h1><p>No page at <code>' + escapeHtml(slug) + '</code>.</p>';
      tocHtml = ''; el('backlinks').innerHTML = ''; placeToc();
      return;
    }
    page.innerHTML = renderMarkdown(p.content);
    page.insertAdjacentHTML('afterbegin', crumbHtml(slug));
    fixMdLinks(page, p.folder);
    highlightCode(page);
    runKaTeX(page);
    runMermaid(page);
    addCopyButtons(page);
    buildToc(page);
    renderBacklinks(slug);
  }

  // ---------- home ----------
  function renderHome() {
    const page = el('page'); tocHtml = ''; el('backlinks').innerHTML = ''; placeToc();
    page.classList.add('home');
    const slugs = Object.keys(PAGES).filter(function (s) { return !activeTag || PAGES[s].tags.indexOf(activeTag) !== -1; });
    const byFolder = {};
    slugs.forEach(function (s) { const f = PAGES[s].folder || '(root)'; (byFolder[f] = byFolder[f] || []).push(s); });
    if (!Object.keys(PAGES).length) {
      page.innerHTML = '<h1>Home</h1><p class="meta">No pages yet. Add <code>.md</code> files to <code>articles/</code> and run the build, or use <b>Live render</b>.</p>';
      return;
    }
    const recent = Object.values(PAGES).filter(function (p) { return !activeTag || p.tags.indexOf(activeTag) !== -1; }).sort(function (a, b) { return b.mtime - a.mtime; }).slice(0, 8);
    let html = '<h1>' + (activeTag ? 'Tagged: ' + escapeHtml(activeTag) : 'Home') + '</h1>';
    html += '<h2>Recent</h2><ul class="recent">' + recent.map(function (p) {
      return '<li><a href="#' + encodeURIComponent(p.slug) + '">' + escapeHtml(p.title) + '</a> <span class="meta">' + new Date(p.mtime * 1000).toLocaleDateString() + '</span></li>';
    }).join('') + '</ul>';
    html += '<h2>All pages</h2>';
    Object.keys(byFolder).sort().forEach(function (f) {
      html += '<div class="grp" style="font-size:12px;color:var(--muted);margin:12px 0 4px;font-weight:700">' + escapeHtml(f) + '</div><ul>';
      byFolder[f].slice().sort(function (a, b) { return titleOf(a).localeCompare(titleOf(b)); }).forEach(function (s) {
        html += '<li><a href="#' + encodeURIComponent(s) + '">' + escapeHtml(titleOf(s)) + '</a></li>';
      });
      html += '</ul>';
    });
    page.innerHTML = html;
  }

  // ---------- sidebar / tags ----------
  function renderSidebar() {
    const tree = el('tree');
    const slugs = Object.keys(PAGES).filter(function (s) { return !activeTag || PAGES[s].tags.indexOf(activeTag) !== -1; });
    const root = { pages: [], subs: {} }; // nested tree: folder -> its pages + subfolders
    slugs.forEach(function (s) {
      const parts = PAGES[s].folder ? PAGES[s].folder.split('/') : [];
      let node = root;
      parts.forEach(function (part) { node.subs[part] = node.subs[part] || { pages: [], subs: {} }; node = node.subs[part]; });
      node.pages.push(s);
    });
    // a folder is open when it contains the page on screen (or the landing page),
    // otherwise per the foldersOpen setting
    const hashSlug = decodeURIComponent(location.hash.slice(1)) || '';
    const shown = hashSlug || (landingPage && PAGES[landingPage] ? landingPage : '');
    const activeFolder = PAGES[shown] ? (PAGES[shown].folder || '') : '';
    const isOpen = function (p) {
      return activeFolder ? (activeFolder === p || activeFolder.indexOf(p + '/') === 0) : foldersOpen;
    };
    const linkHtml = function (s) {
      return '<a href="#' + encodeURIComponent(s) + '" data-slug="' + escapeHtml(s) + '">' + escapeHtml(titleOf(s)) + '</a>';
    };
    const orderedItems = function (node, path) { // [display name, html] pairs, per sidebarOrder
      const pages = node.pages.slice().sort(function (a, b) { return titleOf(a).localeCompare(titleOf(b)); });
      const folderItems = Object.keys(node.subs).sort().map(function (sub) { return [sub, renderNode(sub, node.subs[sub], path)]; });
      let list = pages.map(function (s) { return [titleOf(s), linkHtml(s)]; });
      if (sidebarOrder === 'folders') list = folderItems.concat(list);
      else if (sidebarOrder === 'alpha') { list = list.concat(folderItems); list.sort(function (a, b) { return a[0].localeCompare(b[0]); }); }
      else list = list.concat(folderItems); // 'files': files first, then folders
      return list;
    };
    const renderNode = function (name, node, path) { // one <details> per folder, nested for subfolders
      const p = path ? path + '/' + name : name;
      let h = '<details class="grp"' + (isOpen(p) ? ' open' : '') + '><summary>' + escapeHtml(name) + '</summary><div class="grp-body">';
      h += orderedItems(node, p).map(function (i) { return i[1]; }).join('');
      return h + '</div></details>';
    };
    // root pages are listed flat (no folder); top-level folders are <details> groups
    let html = orderedItems(root, '').map(function (i) { return i[1]; }).join('');
    if (!slugs.length) html = '<div class="empty">No pages.</div>';
    tree.innerHTML = html;
    markActive();
  }
  function markActive() {
    const slug = decodeURIComponent(location.hash.slice(1)) || '';
    const tree = el('tree');
    const links = Array.prototype.slice.call(tree.querySelectorAll('a'));
    links.forEach(function (a) { a.classList.toggle('active', a.dataset.slug === slug); });
    tree.querySelectorAll('.page-toc').forEach(function (n) { n.remove(); });
    if (slug && tocHtml && tocSide === 'left') {
      const act = links.find(function (a) { return a.dataset.slug === slug; });
      if (act) act.insertAdjacentHTML('afterend', tocHtml); // TOC sits directly under the file name
    }
  }
  function renderTags() {
    const box = el('tags');
    const tags = {};
    Object.keys(PAGES).forEach(function (s) { PAGES[s].tags.forEach(function (t) { (tags[t] = tags[t] || []).push(s); }); });
    const names = Object.keys(tags);
    if (!names.length) { box.innerHTML = ''; return; }
    box.innerHTML = names.map(function (t) {
      return '<span class="tag' + (activeTag === t ? ' active' : '') + '" data-tag="' + escapeHtml(t) + '">' + escapeHtml(t) + '</span>';
    }).join('');
  }

  // ---------- search ----------
  function snippet(content, q) {
    const t = content.replace(/[#*`>\[\]_~]/g, ' ').replace(/\s+/g, ' ');
    const i = t.toLowerCase().indexOf(q);
    return i < 0 ? t.slice(0, 120) : t.slice(Math.max(0, i - 40), i + 90);
  }
  function doSearch(q) {
    q = q.trim().toLowerCase(); const box = el('searchResults');
    el('clearSearch').classList.toggle('show', q.length > 0); // own ✕ button — Firefox has no native one
    if (!q) { box.classList.add('hidden'); return; }
    const max = Math.max(1, parseInt(WIKI.maxResults, 10) || 200);
    const all = Object.keys(PAGES).filter(function (s) { return (PAGES[s].title + ' ' + PAGES[s].content).toLowerCase().indexOf(q) !== -1; });
    const hits = all.slice(0, max);
    box.innerHTML = hits.length ? hits.map(function (s) {
      return '<a href="#' + encodeURIComponent(s) + '"><span class="crumb">' + escapeHtml((PAGES[s].folder ? PAGES[s].folder + ' / ' : '') + PAGES[s].title) + '</span>' + escapeHtml(snippet(PAGES[s].content, q)) + '</a>';
    }).join('') : '<a>&mdash; no results &mdash;</a>';
    if (all.length > max) box.innerHTML += '<div class="search-note">' + all.length + ' matches &mdash; showing the first ' + max + '. Edit <code>maxResults</code> at the top of index.html to see more.</div>';
    box.classList.remove('hidden');
  }

  // ---------- mode ----------
  function setMode(m) {
    const e = el('mode');
    e.textContent = m === 'live' ? ('live · ' + (liveHandle ? liveHandle.name : 'folder')) : 'bundled · data.js';
    e.className = 'mode' + (m === 'live' ? ' live' : '');
    const r = el('refresh'); if (r) r.classList.toggle('hidden', m !== 'live');
  }

  // ---------- routing ----------
  function renderLanding() { // what the empty hash shows: the configured page, else the generated home
    if (landingPage && PAGES[landingPage]) { renderPage(landingPage); return PAGES[landingPage].title; }
    renderHome(); return 'Home';
  }
  function route() {
    let slug = location.hash.slice(1);
    if (slug) slug = decodeURIComponent(slug);
    if (slug && /^(fn|fnref)-/.test(slug)) return; // in-page footnote anchor
    el('page').classList.remove('home');
    if (!slug) { document.title = renderLanding() + ' — ' + wikiName; }
    else { renderPage(slug); document.title = (PAGES[slug] ? PAGES[slug].title : slug) + ' — ' + wikiName; }
    renderSidebar(); // re-renders with the active page's folder chain open; ends with markActive()
  }

  // ---------- loaders ----------
  function loadBundled() {
    RAW = (window.PAGES_BUNDLED || []).map(function (p) { return { slug: p.slug, mtime: p.mtime, content: b64toUtf8(p.content) }; });
    IMAGES = {};
  }
  async function loadLive(handle) {
    RAW = []; IMAGES = {};
    await walkDir(handle, '', RAW);
  }
  async function walkDir(handle, prefix, acc) {
    for await (const e of handle.values()) {
      if (e.kind === 'file') {
        if (/\.md$/i.test(e.name)) {
          const f = await e.getFile();
          acc.push({ slug: (prefix + e.name).replace(/\.md$/i, ''), mtime: Math.floor(f.lastModified / 1000), content: await f.text() });
        } else if (/\.(png|jpe?g|gif|svg|webp)$/i.test(e.name)) {
          IMAGES[prefix + e.name] = await fileToDataURI(await e.getFile(), e.name);
        }
      } else if (e.kind === 'directory') {
        await walkDir(e, prefix + e.name + '/', acc);
      }
    }
  }
  async function fileToDataURI(f, name) {
    const ext = name.split('.').pop().toLowerCase();
    const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' ? 'image/jpeg' : 'image/' + ext;
    const u8 = new Uint8Array(await f.arrayBuffer());
    let bin = '';
    for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
    return 'data:' + mime + ';base64,' + btoa(bin);
  }
  const IDB = {
    db: null,
    open() {
      if (this.db) return Promise.resolve(this.db);
      return new Promise(function (res, rej) {
        const r = indexedDB.open('localwiki', 1);
        r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
        r.onsuccess = function () { IDB.db = r.result; res(IDB.db); };
        r.onerror = function () { rej(r.error); };
      });
    },
    async get(k) { const d = await this.open(); return new Promise(function (res) { const g = d.transaction('kv').objectStore('kv').get(k); g.onsuccess = function () { res(g.result); }; }); },
    async set(k, v) { const d = await this.open(); const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); }
  };
  async function chooseFolder() {
    try {
      const h = await showDirectoryPicker({ mode: 'readwrite' });
      liveHandle = h;
      try { await IDB.set('dir', h); } catch (e) {}
      await loadLive(h); mode = 'live'; buildIndex(); renderSidebar(); renderTags(); setMode('live'); route();
    } catch (e) { /* cancelled or permission denied */ }
  }
  async function refreshLive() {
    if (mode !== 'live' || !liveHandle) return;
    const now = Date.now(); if (now - lastRefresh < 1500) return; lastRefresh = now;
    try {
      if ((await liveHandle.queryPermission({ mode: 'read' })) !== 'granted') return;
      await loadLive(liveHandle);
      buildIndex(); renderSidebar(); renderTags(); setMode('live'); route();
    } catch (e) {}
  }

  // ---------- init ----------
  async function init() {
    el('choose').addEventListener('click', chooseFolder);
    el('refresh').addEventListener('click', refreshLive);
    window.addEventListener('focus', refreshLive); // re-read live folder when the tab regains focus
    el('search').addEventListener('input', function (e) { doSearch(e.target.value); });
    el('search').addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.target.value = ''; doSearch(''); } });
    el('searchResults').addEventListener('click', function () { el('search').blur(); });
    el('clearSearch').addEventListener('click', function () {
      el('search').value = ''; doSearch(''); el('search').focus();
    });
    el('page').addEventListener('click', function (e) { // delegated: page content is re-rendered constantly
      const tb = e.target.closest('.tabs-bar button'); // ::: tabs switching
      if (tb) {
        const bar = tb.parentElement, wrap = bar.parentElement;
        bar.querySelectorAll('button').forEach(function (x) { x.classList.toggle('active', x === tb); });
        wrap.querySelectorAll('.tab-pane').forEach(function (p) { p.hidden = p.getAttribute('data-i') !== tb.getAttribute('data-i'); });
        return;
      }
      const b = e.target.closest('.copybtn');
      if (!b) return;
      const code = b.closest('pre').querySelector('code');
      copyText(code ? code.textContent : b.closest('pre').textContent, function () {
        b.textContent = '\u2705'; // ✅
        setTimeout(function () { b.textContent = '\uD83D\uDCCB'; }, 1500); // 📋
      });
    });
    const tocScroll = function (e) {
      const a = e.target.closest('a.toclink');
      if (a) { e.preventDefault(); const t = document.getElementById(a.getAttribute('href').slice(1)); if (t) t.scrollIntoView({ behavior: 'smooth' }); }
    };
    el('tree').addEventListener('click', tocScroll);
    el('tocRail').addEventListener('click', tocScroll);
    el('tags').addEventListener('click', function (e) {
      const t = e.target.closest('.tag'); if (!t) return;
      activeTag = (activeTag === t.dataset.tag) ? '' : t.dataset.tag;
      renderTags(); renderSidebar();
      if (!location.hash.slice(1)) route();
    });

    const canPick = typeof showDirectoryPicker === 'function';
    el('choose').classList.toggle('hidden', !canPick); // hidden by default; revealed only where the File System Access API exists

    // resizable sidebar: drag the strip, width clamped 140–480 and remembered
    const setSidebarW = function (w) { document.documentElement.style.setProperty('--sidebar-w', w + 'px'); };
    const savedW = parseInt(localStorage.getItem('sidebar-w'), 10);
    if (savedW >= 140 && savedW <= 480) setSidebarW(savedW);
    el('resizer').addEventListener('pointerdown', function (e) {
      e.preventDefault();
      let w = 0;
      const move = function (ev) { w = Math.min(480, Math.max(140, ev.clientX)); setSidebarW(w); };
      const up = function () { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); if (w) localStorage.setItem('sidebar-w', w); };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });

    try {
      const h = await IDB.get('dir');
      if (h) { const perm = await h.queryPermission({ mode: 'read' }); if (perm === 'granted') { liveHandle = h; await loadLive(h); mode = 'live'; } }
    } catch (e) {}
    if (mode !== 'live') loadBundled();

    buildIndex();
    renderSidebar(); renderTags();
    setMode(mode);
    window.addEventListener('hashchange', route);
    route();
    lastRefresh = Date.now();
  }
  document.addEventListener('DOMContentLoaded', init);
})();
