/* Local Wiki — no server, fully offline after build.
 * Frame = index.html; knowledge = markdown; rendered on the fly.
 * Two loaders: bundled (data.js) always works; live (File System Access) in Chrome/Edge.
 */
(function () {
  'use strict';

  // ---------- tiny helpers ----------
  function el(id) { return document.getElementById(id); }
  function usesDarkScheme(scheme, systemDark) { // same rule the browser uses to resolve light-dark() in style.css
    const allowed = scheme.split(' ');
    return allowed.includes('dark') && (systemDark || !allowed.includes('light'));
  }
  function nextTheme(t) { return { system: 'light', light: 'dark', dark: 'system' }[t]; } // the theme button cycles System → Light → Dark
  function isSearchShortcut(e, mac) { // Cmd K on a Mac, Ctrl K elsewhere; Ctrl K on a Mac keeps its text-field meaning (delete to end of line)
    return (mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k';
  }
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
  const defValidateLink = md.validateLink.bind(md); // markdown-it blocks non-http schemes for links AND images; let file:// through (works when the wiki itself runs on file://, browsers block it over http — nothing more we can do)
  md.validateLink = function (u) { return /^file:\/\/\//i.test(u) || defValidateLink(u); };
  if (window.MditExtras) { md.use(MditExtras.container); md.use(MditExtras.alerts); md.use(MditExtras.tabs); md.use(MditExtras.badges); md.use(MditExtras.buttons); } // ::: containers, > [!NOTE] alerts, ::: tabs, @{ badges }, @[button links]
  function injectBadgeColors() { // user badge colours from config.js ({ words: [...], color: '#hex' }): paste the same pill CSS style.css defines for the built-ins, so rendered badges AND the editor menu entries wear it
    if (!window.MditExtras) return;
    var C = window.MditExtras.badgeCustomColors(), css = '';
    for (var k in C) css += '.badge--' + k + ' { color: ' + C[k] + '; background: color-mix(in srgb, ' + C[k] + ' 12%, transparent); border-color: color-mix(in srgb, ' + C[k] + ' 40%, transparent); }\n';
    if (css) { var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st); }
  }
  injectBadgeColors();
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
  function currentMermaidTheme() { return usesDarkScheme(getComputedStyle(document.documentElement).colorScheme, systemDark.matches) ? 'dark' : 'default'; }
  function initMermaid(theme) { if (window.mermaid) { try { mermaid.initialize({ startOnLoad: false, theme: theme }); } catch (e) {} } }
  let mermaidTheme = currentMermaidTheme();
  initMermaid(mermaidTheme);

  // ---------- state ----------
  const WIKI = window.WIKI || {}; // settings live in config.js; every key has a built-in default
  let RAW = [];                 // [{slug, mtime, content}]
  let PAGES = {};               // slug -> {slug,title,folder,tags,mtime,content,links}
  let IMAGES = {};              // "folder/file.png" (KB-root-relative) -> data URI
  let STEM = {};                // lowercased filename stem -> [slugs]
  let mode = 'bundled';
  let activeTag = '';
  let liveHandle = null;       // FileSystemDirectoryHandle, once connected
  let liveDirs = [];           // every folder the live scan saw, empty ones included: the sidebar seeds its folder rows from here
  let lastRefresh = 0;         // debounce for focus auto-refresh
  let liveStamp = '';
  let editing = null;
  let treeOpen = null;         // folders the user opened/closed by hand (path -> bool); survives every sidebar redraw
  let shownPage = '';
  let loading = null;
  let tocHtml = '';            // current page's TOC, injected into the sidebar or rail
  const tocSide = (WIKI.tocSide === 'right') ? 'right' : 'left'; // from the settings in config.js
  const narrowMq = window.matchMedia('(max-width: 760px)'); // drawer breakpoint — keep in sync with the @media block in style.css
  function intSetting(v, lo, hi, def) { return Math.min(hi, Math.max(lo, parseInt(v, 10) || def)); }
  const tocLevels = intSetting(WIKI.tocLevels, 1, 6, 3); // TOC heading depth, 1–6
  const foldersOpen = WIKI.foldersOpen === true; // start with the sidebar folders expanded
  const editButton = WIKI.editButton !== false; // false hides the live-render Edit button: live folder, read-only wiki
  const landingPage = typeof WIKI.landingPage === 'string' ? WIKI.landingPage : ''; // page opened at empty hash; '' = generated home
  const sidebarOrder = (WIKI.sidebarOrder === 'folders' || WIKI.sidebarOrder === 'alpha') ? WIKI.sidebarOrder : 'files'; // 'folders' | 'files' | 'alpha'
  document.documentElement.style.setProperty('--page-w', intSetting(WIKI.pageWidth, 10, 100, 70) + '%'); // article width cap, 10–100%
  document.documentElement.style.setProperty('--search-w', intSetting(WIKI.searchWidth, 10, 100, 50) + '%'); // search panel width, 10–100% of the window
  document.documentElement.style.setProperty('--search-h', intSetting(WIKI.searchHeight, 10, 100, 60) + 'vh'); // search panel max height, 10–100% of the window
  const wikiName = (typeof WIKI.wikiName === 'string' && WIKI.wikiName.trim()) ? WIKI.wikiName.trim() : 'Local Wiki'; // shown in topbar + tab titles
  document.querySelector('.brand-name').textContent = wikiName;
  if (typeof WIKI.brandIcon === 'string') { // unset keeps the built-in mark; '' hides it; any other text replaces it
    const mark = document.querySelector('.brand-mark');
    if (WIKI.brandIcon) { mark.textContent = WIKI.brandIcon; mark.classList.add('brand-glyph'); } else mark.remove();
  }
  if (typeof WIKI.favicon === 'string' && WIKI.favicon) el('favicon').href = WIKI.favicon; // custom tab icon: file next to index.html, any URL, or a data: URI
  const expandOnPrint = WIKI.expandOnPrint !== false; // open every fold in the article right before printing, restore after

  // ---------- interface language ----------
  function uiDict() { // every word the app itself shows; en is the fallback for keys a language is missing. Languages other than en/fr: add yours through config.js `ui`
    return {
      en: {
        langCode: 'en',
        menu: 'Menu', search: 'Search pages…', clearSearch: 'Clear search',
        modeTitle: 'Where pages come from: bundled snapshot (data.js) or a connected live folder',
        themeTitle: 'Theme: %1 (click for %2)', themeSystem: 'System', themeLight: 'Light', themeDark: 'Dark',
        refreshTitle: 'Re-read the connected folder now (live mode)',
        btnBundled: 'Bundled', btnBundledTitle: 'Leave live render and go back to the bundled data.js snapshot. This wiki then forgets the folder until you pick one again.',
        btnLive: 'Live render', btnLiveTitle: 'Point the wiki at your markdown folder for live rendering (one-time, remembered).',
        resizer: 'Drag to resize the sidebar',
        linkedFrom: 'Linked from', notFound: 'Not found', noPageAt: 'No page at',
        home: 'Home', tagPrefix: 'Tagged: ', noPages: 'No pages yet. Add <code>.md</code> files to <code>articles/</code> and run the build, or use',
        emptyTree: 'No pages.', loadingFolder: 'Reading your folder\u2026 this can take a while on a network drive.',
        copyCode: 'Copy code snippet', noResults: '\u2014 no results \u2014',
        matchesNote: '%1 matches &mdash; showing the first %2. Edit <code>maxResults</code> in config.js to see more.',
        edit: 'Edit', newPage: 'New page', newFolder: 'New folder',
        delPage: 'Delete page', delFolder: 'Delete folder',
        confirmDelPage: 'Delete the page %1? It cannot be undone.',
        confirmDelFolder: 'Delete the folder %1 and everything inside it? It cannot be undone.',
        couldNotDelete: 'Could not delete: ',
        promptPageName: 'New page name (without .md):', promptFolderName: 'New folder name:',
        nameTaken: 'A file or folder with that name already exists.',
        nameBad: 'Invalid name: empty, hidden (leading dot), or containing / \\ : * ? " < > |.',
        couldNotCreate: 'Could not create: ', folderCreated: 'Folder created.',
        utf8Note: 'This page is not saved as UTF-8 text, so saving it here would damage its special characters. Convert it to UTF-8 in a text editor first.',
        notUtf8Error: 'someone saved this page in a format other than UTF-8 text, so saving here would damage its special characters. Your text is still in the box; convert the file to UTF-8 in a text editor, then save again.',
        preview: 'Preview', save: 'Save', cancel: 'Cancel', previewHint: 'Click outside or press Esc to close.',
        saving: 'Saving\u2026', couldNotSave: 'Could not save: ',
        savedToast: 'Saved. Re-run the build (build.sh, or build.bat on Windows) to refresh the bundled snapshot, so wikis opened without live render see this edit.',
        conflictOnSave: 'Someone else saved this page while you were editing, on the same lines as you. Nothing was saved: choose what to keep above, then Save again.',
        someoneSaved: 'Someone else saved this page while you were editing.', mergeBtn: 'Merge their changes into mine', changesBtn: 'Show what changed',
        conflictsIntro: 'Your edit and theirs changed the same lines. For each place below, choose what to keep; the text box unlocks once every one is decided.',
        theirs: 'Theirs', yours: 'Yours', keepMine: 'Keep mine', keepTheirs: 'Keep theirs', keepBoth: 'Keep both',
        mergedMsg: 'Their changes are merged into your text. Check it, then Save.',
        promptLink: 'Type link text', promptUrl: 'Enter the link URL',
        tbBold: 'Bold', tbItalic: 'Italic', tbStrike: 'Strikethrough', tbHeading: 'Heading', tbLink: 'Link', tbQuote: 'Quote', tbCode: 'Code',
        tbUL: 'Generic List', tbOL: 'Numbered List', tbTable: 'Insert Table', tbUndo: 'Undo', tbRedo: 'Redo'
      },
      fr: {
        langCode: 'fr',
        menu: 'Menu', search: 'Rechercher une page\u2026', clearSearch: 'Effacer la recherche',
        modeTitle: 'D\u2019où viennent les pages : instantan\u00e9 embarqu\u00e9 (data.js) ou dossier en direct connect\u00e9',
        themeTitle: 'Th\u00e8me : %1 (cliquer pour %2)', themeSystem: 'Syst\u00e8me', themeLight: 'Clair', themeDark: 'Sombre',
        refreshTitle: 'Relire le dossier connect\u00e9 maintenant (mode en direct)',
        btnBundled: 'Embarqu\u00e9', btnBundledTitle: 'Quitter le rendu en direct et revenir \u00e0 l\u2019instantan\u00e9 data.js. Le wiki oublie alors le dossier jusqu\u2019\u00e0 ce que vous en re-choisissiez un.',
        btnLive: 'Rendu en direct', btnLiveTitle: 'Pointer le wiki vers votre dossier markdown pour le rendu en direct (une seule fois, m\u00e9moris\u00e9).',
        resizer: 'Faire glisser pour redimensionner la barre lat\u00e9rale',
        linkedFrom: 'Li\u00e9 depuis', notFound: 'Introuvable', noPageAt: 'Aucune page \u00e0',
        home: 'Accueil', tagPrefix: 'Tag\u00e9 : ', noPages: 'Aucune page pour l\u2019instant. Ajoutez des fichiers <code>.md</code> dans <code>articles/</code> et lancez le build, ou utilisez',
        emptyTree: 'Aucune page.', loadingFolder: 'Lecture de votre dossier\u2026 cela peut \u00eatre long sur un lecteur r\u00e9seau.',
        copyCode: 'Copier le code', noResults: '\u2014 aucun r\u00e9sultat \u2014',
        matchesNote: '%1 r\u00e9sultats \u2014 voici les %2 premiers. Modifiez <code>maxResults</code> dans config.js pour en voir plus.',
        edit: 'Modifier', newPage: 'Nouvelle page', newFolder: 'Nouveau dossier',
        delPage: 'Supprimer la page', delFolder: 'Supprimer le dossier',
        confirmDelPage: 'Supprimer la page %1 ? Cette action est irréversible.',
        confirmDelFolder: 'Supprimer le dossier %1 et tout son contenu ? Cette action est irréversible.',
        couldNotDelete: 'Suppression impossible : ',
        promptPageName: 'Nom de la nouvelle page (sans .md) :', promptFolderName: 'Nom du nouveau dossier :',
        nameTaken: 'Un fichier ou dossier porte déjà ce nom.',
        nameBad: 'Nom invalide : vide, caché (point au début), ou contenant / \\ : * ? " < > |.',
        couldNotCreate: 'Création impossible : ', folderCreated: 'Dossier créé.',
        utf8Note: 'Cette page n\u2019est pas encod\u00e9e en UTF-8 : la sauvegarder ici ab\u00eemerait ses caract\u00e8res sp\u00e9ciaux. Convertissez-la d\u2019abord en UTF-8 dans un \u00e9diteur de texte.',
        notUtf8Error: 'quelqu\u2019un a sauvegard\u00e9 cette page dans un format autre que du texte UTF-8 : la sauvegarder ici ab\u00eemerait ses caract\u00e8res sp\u00e9ciaux. Votre texte est toujours dans la zone de saisie ; convertissez le fichier en UTF-8 dans un \u00e9diteur de texte, puis enregistrez \u00e0 nouveau.',
        preview: 'Aper\u00e7u', save: 'Enregistrer', cancel: 'Annuler', previewHint: 'Cliquez hors de l\u2019aper\u00e7u ou appuyez sur \u00c9chap pour fermer.',
        saving: 'Enregistrement\u2026', couldNotSave: 'Enregistrement impossible : ',
        savedToast: 'Enregistr\u00e9. Relancez le build (build.sh, ou build.bat sous Windows) pour rafra\u00eechir l\u2019instantan\u00e9 embarqu\u00e9, afin que les wikis ouverts sans rendu en direct voient cette modification.',
        conflictOnSave: 'Quelqu\u2019un d\u2019autre a sauvegard\u00e9 cette page pendant votre \u00e9dition, sur les m\u00eames lignes. Rien n\u2019a \u00e9t\u00e9 sauvegard\u00e9 : choisissez quoi garder ci-dessus, puis enregistrez \u00e0 nouveau.',
        someoneSaved: 'Quelqu\u2019un d\u2019autre a sauvegard\u00e9 cette page pendant votre \u00e9dition.', mergeBtn: 'Fusionner ses changements dans les miens', changesBtn: 'Voir ce qui a chang\u00e9',
        conflictsIntro: 'Votre \u00e9dition et la sienne ont modifi\u00e9 les m\u00eames lignes. Pour chaque endroit ci-dessous, choisissez quoi garder ; la zone de texte se d\u00e9verrouille une fois tous les choix faits.',
        theirs: 'La sienne', yours: 'La v\u00f4tre', keepMine: 'Garder la mienne', keepTheirs: 'Garder la sienne', keepBoth: 'Garder les deux',
        mergedMsg: 'Ses changements sont fusionn\u00e9s dans votre texte. V\u00e9rifiez-le, puis enregistrez.',
        promptLink: 'Texte du lien', promptUrl: 'Adresse du lien',
        tbBold: 'Gras', tbItalic: 'Italique', tbStrike: 'Barr\u00e9', tbHeading: 'Titre', tbLink: 'Lien', tbQuote: 'Citation', tbCode: 'Code',
        tbUL: 'Liste \u00e0 puces', tbOL: 'Liste num\u00e9rot\u00e9e', tbTable: 'Ins\u00e9rer un tableau', tbUndo: 'Annuler', tbRedo: '\u00c9tablir'
      }
    };
  }
  function tr(k) { // the word for key k: config.js `ui` wins, then a pack the owner added in config.js `languages`, then the built-in pack for the language, then en
    var w = window.WIKI || {};
    var langs = w.languages || {}; // owner-added packs (config.js is yours and survives upgrades); the built-in ones are in uiDict()
    if (!tr.d) tr.d = uiDict();
    if (!tr.lang) {
      var l = ((w.language || (window.navigator && window.navigator.language) || '') + '').toLowerCase().slice(0, 2); // '' = auto: the browser's language, if a pack exists for it
      tr.lang = tr.d[l] || langs[l] ? l : 'en';
    }
    var o = w.ui || {};
    if (k in o) return o[k];
    var mine = langs[tr.lang];
    if (mine && k in mine) return mine[k];
    var d = tr.d[tr.lang] || {};
    return k in d ? d[k] : tr.d.en[k];
  }
  function translateToolbar(cm) { // EasyMDE gives its built-in toolbar buttons their name as a CSS class: swap its English hover titles for ours (the wiki's own buttons already carry their titles)
    var T = { bold: 'tbBold', italic: 'tbItalic', strikethrough: 'tbStrike', heading: 'tbHeading', link: 'tbLink', quote: 'tbQuote', code: 'tbCode', 'unordered-list': 'tbUL', 'ordered-list': 'tbOL', table: 'tbTable', undo: 'tbUndo', redo: 'tbRedo' };
    if (!cm.gui) return; // the test stubs hand back a bare object
    cm.gui.toolbar.querySelectorAll('button').forEach(function (b) {
      if (!b.classList) return; // the test stubs hand back bare {disabled} objects
      for (var cls in T) if (b.classList.contains(cls)) { b.title = tr(T[cls]); b.setAttribute('aria-label', tr(T[cls])); break; }
    });
  }

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
      const fm = parseFrontmatter(p.src);
      const folder = p.slug.indexOf('/') !== -1 ? p.slug.slice(0, p.slug.lastIndexOf('/')) : '';
      const stemFile = p.slug.split('/').pop();
      p.tags = fm.tags; p.folder = folder; p.content = fm.body;
      let title = fm.title;
      if (!title) { const h1 = fm.body.match(/^#\s+(.+)$/m); title = h1 ? h1[1].trim() : ''; }
      if (!title) title = stemFile.replace(/\.md$/i, '').replace(/[-_]+/g, ' ').trim();
      p.title = title;
      p.haystack = (title + ' ' + fm.body).toLowerCase();
      p.plain = fm.body.replace(/[#*`>\[\]_~]/g, ' ').replace(/\s+/g, ' ');
      PAGES[p.slug] = p;
      (STEM[stemFile.toLowerCase()] = STEM[stemFile.toLowerCase()] || []).push(p.slug);
    });
    for (const slug in PAGES) PAGES[slug].links = outLinks(PAGES[slug]);
  }
  const WIKI_LINK_RE = /\[\[([^\]|\n]+?)(?:\|([^\]\n]+?))?\]\]/g;
  function outLinks(p) {
    const set = new Set();
    outsideCode(p.content, function (s) { // mentions inside code do not create backlinks
      let m;
      while ((m = WIKI_LINK_RE.exec(s))) { const slug = resolveSlug(m[1].trim()); if (slug) set.add(slug); }
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
      return s.replace(WIKI_LINK_RE, function (m, target, display) {
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
      if (/^(https?:|mailto:|file:)/i.test(h)) { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener'); a.classList.add('ext-link'); } // external + file: links: keep the wiki in place
      else if (/\.md($|#|\?)/i.test(h)) { const s = resolveMdPath(h, base); if (s) a.setAttribute('href', '#' + encodeURIComponent(s)); }
      else if (/\.html?($|#|\?)/i.test(h)) { const abs = absPath(h, base); if (abs) { a.setAttribute('href', 'articles/' + abs); a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener'); a.classList.add('html-file'); } } // local HTML files leave the frame: new tab, like external links
    });
    pageNode.querySelectorAll('img[src]').forEach(function (im) { // local images resolve against the page folder, same as .md links; live mode holds the bytes in IMAGES, bundled mode points at the articles/ files so they lazy-load
      const s = im.getAttribute('src');
      if (!s || /^(https?:|file:|data:)/i.test(s)) return; // no extension filter: the browser renders whatever format it supports
      const abs = absPath(s, base);
      im.src = IMAGES[abs] || 'articles/' + abs; // shortcut: 'articles' must match build.sh's KB dir — read from settings if it ever becomes configurable
    });
  }
  function highlightCode(pageNode) {
    if (!window.hljs) return;
    pageNode.querySelectorAll('pre code').forEach(function (c) {
      if (/language-mermaid\b/.test(c.className)) return;
      try { hljs.highlightElement(c); } catch (e) {} // reads the language-js class markdown-it already set; auto-detects when the fence has no language
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
  let mermaidQueue = Promise.resolve();
  function queueMermaid(job) { mermaidQueue = mermaidQueue.then(job).catch(function () {}); }
  function runMermaid(pageNode) {
    const nodes = [];
    pageNode.querySelectorAll('pre code.language-mermaid').forEach(function (code) {
      const div = document.createElement('div'); div.className = 'mermaid'; div.textContent = div.dataset.src = code.textContent;
      const pre = code.closest('pre'); pre.replaceWith(div); nodes.push(div);
    });
    if (nodes.length && window.mermaid) queueMermaid(function () { return mermaid.run({ nodes: nodes }); });
  }
  function redrawMermaid() { // mermaid bakes its theme into the SVG: when the mode flips, draw the page's diagrams again from their source
    const theme = currentMermaidTheme();
    if (theme === mermaidTheme) return;
    mermaidTheme = theme;
    queueMermaid(function () {
      initMermaid(mermaidTheme);
      const nodes = Array.from(el('page').querySelectorAll('.mermaid[data-src]'));
      nodes.forEach(function (n) { n.removeAttribute('data-processed'); n.textContent = n.dataset.src; });
      if (nodes.length && window.mermaid) return mermaid.run({ nodes: nodes });
    });
  }
  function addCopyButtons(pageNode) {
    pageNode.querySelectorAll('pre').forEach(function (pre) {
      if (pre.querySelector('.copybtn')) return;
      const b = document.createElement('button');
      b.className = 'copybtn'; b.type = 'button'; b.title = tr('copyCode'); b.setAttribute('aria-label', tr('copyCode'));
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
  function buildToc(pageNode, pageTitle) { // an h1 that echoes the shown title duplicates the sidebar/rail link — skip it
    const t = (pageTitle || '').trim().toLowerCase();
    const heads = Array.prototype.slice.call(pageNode.querySelectorAll('h1,h2,h3,h4,h5,h6')).filter(function (h) { const lvl = +h.tagName[1]; return lvl <= tocLevels && (lvl > 1 || h.textContent.trim().toLowerCase() !== t); }); // tagName is uppercase: 'H2'[1] -> 2
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
    markTocPosition();
  }
  function markTocPosition() { // scroll-spy: the TOC link of the section the article is currently scrolled into lights up
    const links = document.querySelectorAll('.page-toc .toclink');
    if (!links.length) return;
    const cTop = el('content').getBoundingClientRect().top;
    let cur = null; // links are in heading order: the last one already scrolled past the top edge wins
    Array.prototype.forEach.call(links, function (l) { const h = document.getElementById(l.getAttribute('href').slice(1)); if (h && h.getBoundingClientRect().top - cTop <= 20) cur = l; });
    Array.prototype.forEach.call(links, function (l) { l.classList.toggle('active', l === cur); });
  }
  function renderBacklinks(slug) {
    const box = el('backlinks');
    const from = Object.keys(PAGES).filter(function (s) { return s !== slug && PAGES[s].links.has(slug); });
    if (!from.length) { box.innerHTML = ''; return; }
    box.innerHTML = '<h3>' + tr('linkedFrom') + '</h3>' + from.map(function (s) {
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
      page.innerHTML = '<h1>' + tr('notFound') + '</h1><p>' + tr('noPageAt') + ' <code>' + escapeHtml(slug) + '</code>.</p>';
      tocHtml = ''; el('backlinks').innerHTML = ''; placeToc();
      return;
    }
    page.innerHTML = renderMarkdown(p.content);
    page.insertAdjacentHTML('afterbegin', crumbHtml(slug));
    if (mode === 'live' && editButton) { // the Edit button rides the crumb line; the notice below it is a full-width box, not breadcrumb text
      page.querySelector('.breadcrumbs').insertAdjacentHTML('beforeend', '<button class="btn edit-btn btn--blue" type="button" data-edit="open"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2.5 13.5l.6-2.8 8-8 2.2 2.2-8 8zM10.6 3.2l2.2 2.2" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>' + tr('edit') + '</button>');
      page.querySelector('.breadcrumbs').insertAdjacentHTML('afterend', '<span id="editNote" class="edit-note" role="status" aria-live="polite"></span>');
    }
    fixMdLinks(page, p.folder);
    highlightCode(page);
    runKaTeX(page);
    runMermaid(page);
    addCopyButtons(page);
    buildToc(page, p.title);
    renderBacklinks(slug);
  }

  function taggedSlugs() { return Object.keys(PAGES).filter(function (s) { return !activeTag || PAGES[s].tags.indexOf(activeTag) !== -1; }); }

  // ---------- home ----------
  function renderHome() {
    const page = el('page'); tocHtml = ''; el('backlinks').innerHTML = ''; placeToc();
    page.classList.add('home');
    const slugs = taggedSlugs();
    const byFolder = {};
    slugs.forEach(function (s) { const f = PAGES[s].folder || '(root)'; (byFolder[f] = byFolder[f] || []).push(s); });
    if (!Object.keys(PAGES).length) {
      page.innerHTML = '<h1>' + tr('home') + '</h1><p class="meta">' + tr('noPages') + ' <b>' + tr('btnLive') + '</b>.</p>';
      return;
    }
    const recent = slugs.map(function (s) { return PAGES[s]; }).sort(function (a, b) { return b.mtime - a.mtime; }).slice(0, 8);
    let html = '<h1>' + (activeTag ? tr('tagPrefix') + escapeHtml(activeTag) : tr('home')) + '</h1>';
    html += '<h2>Recent</h2><ul class="recent">' + recent.map(function (p) {
      return '<li><a href="#' + encodeURIComponent(p.slug) + '">' + escapeHtml(p.title) + '</a> <span class="meta">' + new Date(p.mtime * 1000).toLocaleDateString() + '</span></li>';
    }).join('') + '</ul>';
    html += '<h2>All pages</h2>';
    Object.keys(byFolder).sort().forEach(function (f) {
      html += '<div class="home-folder">' + escapeHtml(f) + '</div><ul>';
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
    const slugs = taggedSlugs();
    const root = { pages: [], subs: {} }; // nested tree: folder -> its pages + subfolders
    slugs.forEach(function (s) {
      const parts = PAGES[s].folder ? PAGES[s].folder.split('/') : [];
      let node = root;
      parts.forEach(function (part) { node.subs[part] = node.subs[part] || { pages: [], subs: {} }; node = node.subs[part]; });
      node.pages.push(s);
    });
    // a folder keeps whatever the user last set by hand; else it is open when it contains the
    // page on screen (or the landing page), otherwise per the foldersOpen setting
    for (const p of liveDirs) { // every folder the scan saw, empty ones included — PAGES alone would hide those
      let node = root;
      for (const part of p.split('/')) { node.subs[part] = node.subs[part] || { pages: [], subs: {} }; node = node.subs[part]; }
    }
    const shown = shownPage || (landingPage && PAGES[landingPage] ? landingPage : '');
    const activeFolder = PAGES[shown] ? (PAGES[shown].folder || '') : '';
    const isOpen = function (p) {
      if (treeOpen && p in treeOpen) return treeOpen[p];
      return activeFolder ? (activeFolder === p || activeFolder.indexOf(p + '/') === 0) : foldersOpen;
    };
    const canCreate = !!liveHandle && editButton; // live mode writes through the folder handle; editButton: false keeps the wiki read-only
    const delBtn = function (kind, p) { // trash can, same inline-SVG style as the + buttons
      return '<button class="newbtn" type="button" data-del="' + kind + '" data-path="' + escapeHtml(p) + '" title="' + escapeHtml(tr(kind === 'page' ? 'delPage' : 'delFolder')) + '" aria-label="' + escapeHtml(tr(kind === 'page' ? 'delPage' : 'delFolder')) + '"><svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3.5 4.5h9M6.5 3h3M4.5 4.5l.4 8.5h6.2l.4-8.5M6.7 6.5v4.5M9.3 6.5v4.5" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></button>';
    };
    const linkHtml = function (s) {
      const a = '<a href="#' + encodeURIComponent(s) + '" data-slug="' + escapeHtml(s) + '">' + escapeHtml(titleOf(s)) + '</a>';
      return canCreate ? '<span class="trow">' + a + delBtn('page', s) + '</span>' : a;
    };
    const newBtns = function (p) { // inline SVG keeps the icon font out, like every other control; the words ride the title/aria-label
      const plus = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none"/></svg>';
      const fold = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M2 4h4l1.5 1.5H14V12.5H2z" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linejoin="round"/><path d="M8 7.5v4M6 9.5h4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" fill="none"/></svg>';
      return '<button class="newbtn" type="button" data-new="page" data-path="' + escapeHtml(p) + '" title="' + escapeHtml(tr('newPage')) + '" aria-label="' + escapeHtml(tr('newPage')) + '">' + plus + '</button>' +
        '<button class="newbtn" type="button" data-new="folder" data-path="' + escapeHtml(p) + '" title="' + escapeHtml(tr('newFolder')) + '" aria-label="' + escapeHtml(tr('newFolder')) + '">' + fold + '</button>';
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
      let h = '<details class="grp" data-path="' + escapeHtml(p) + '"' + (isOpen(p) ? ' open' : '') + '><summary>' + escapeHtml(name) + (canCreate ? '<span class="grp-new">' + newBtns(p) + delBtn('folder', p) + '</span>' : '') + '</summary><div class="grp-body">';
      h += orderedItems(node, p).map(function (i) { return i[1]; }).join('');
      return h + '</div></details>';
    };
    // root pages are listed flat (no folder); top-level folders are <details> groups
    let html = orderedItems(root, '').map(function (i) { return i[1]; }).join('');
    if (canCreate) html = '<div class="side-new">' + newBtns('') + '</div>' + html; // even an empty live folder gets this: it's how you make the first page
    if (!slugs.length) html = '<div class="empty">' + tr('emptyTree') + '</div>' + (canCreate ? '<div class="side-new">' + newBtns('') + '</div>' : '');
    tree.innerHTML = html;
    markActive();
  }
  function syncModeGroup() { // narrow: the mode badge + live buttons ride the drawer, above the tree; wide: back in the topbar
    const g = document.querySelector('.modegrp');
    if (narrowMq.matches === (g.parentNode.id === 'sidebar')) return;
    if (narrowMq.matches) el('sidebar').insertBefore(g, el('sidebar').firstChild);
    else document.querySelector('.topbar').appendChild(g); // it was the last group already
  }
  function markActive() {
    const tree = el('tree');
    const links = Array.prototype.slice.call(tree.querySelectorAll('a'));
    links.forEach(function (a) { a.classList.toggle('active', a.dataset.slug === shownPage); });
    tree.querySelectorAll('.page-toc').forEach(function (n) { n.remove(); });
    if (shownPage && tocHtml && (tocSide === 'left' || narrowMq.matches)) { // narrow: the right rail is gone, the TOC follows the drawer instead
      const act = links.find(function (a) { return a.dataset.slug === shownPage; });
      if (act) (act.closest('.trow') || act).insertAdjacentHTML('afterend', tocHtml); // TOC sits directly under the file name — after the whole row, so live mode's flex row (link + trash) stays intact and the TOC doesn't squeeze between them
    }
    markTocPosition();
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
  function markHits(text, q) { // wrap every case-insensitive hit in <mark>; escape per-segment so the query can't inject HTML
    let out = '', i = 0;
    const t = text.toLowerCase();
    for (let j = t.indexOf(q, i); j >= 0; j = t.indexOf(q, i)) {
      out += escapeHtml(text.slice(i, j)) + '<mark>' + escapeHtml(text.slice(j, j + q.length)) + '</mark>';
      i = j + q.length;
    }
    return out + escapeHtml(text.slice(i));
  }
  function snippet(t, q) {
    const i = t.toLowerCase().indexOf(q);
    return i < 0 ? t.slice(0, 120) : t.slice(Math.max(0, i - 40), i + 90);
  }
  function doSearch(q) {
    q = q.trim().toLowerCase(); const box = el('searchResults');
    el('clearSearch').classList.toggle('show', q.length > 0); // own ✕ button — Firefox has no native one
    if (!q) { box.classList.add('hidden'); return; }
    const max = intSetting(WIKI.maxResults, 1, Infinity, 200);
    const all = Object.keys(PAGES).filter(function (s) { return PAGES[s].haystack.indexOf(q) !== -1; });
    const hits = all.slice(0, max);
    box.innerHTML = hits.length ? hits.map(function (s) {
      return '<a href="#' + encodeURIComponent(s) + '"><span class="crumb">' + markHits((PAGES[s].folder ? PAGES[s].folder + ' / ' : '') + PAGES[s].title, q) + '</span>' + markHits(snippet(PAGES[s].plain, q), q) + '</a>';
    }).join('') : '<a>' + tr('noResults') + '</a>';
    if (all.length > max) box.innerHTML += '<div class="search-note">' + tr('matchesNote').replace('%1', all.length).replace('%2', max) + '</div>';
    box.classList.remove('hidden');
  }

  // ---------- mode ----------
  function setMode(m) {
    const e = el('mode');
    e.textContent = m === 'live' ? ('live · ' + (liveHandle ? liveHandle.name : 'folder')) : 'bundled · data.js';
    e.className = 'mode' + (m === 'live' ? ' live' : '');
    el('refresh').classList.toggle('hidden', m !== 'live');
    el('leave').classList.toggle('hidden', m !== 'live');
    // "Live render" (pick a folder) only belongs to bundled mode; once live, "Bundled" is its way back out
    el('choose').classList.toggle('hidden', m === 'live' || typeof showDirectoryPicker !== 'function');
  }

  // ---------- routing ----------
  function closeNav() { // narrow-screen drawer: close it (also a harmless no-op on wide screens)
    document.body.classList.remove('nav-open');
    el('menuBtn').setAttribute('aria-expanded', 'false');
  }
  function renderLanding() { // what the empty hash shows: the configured page, else the generated home
    if (landingPage && PAGES[landingPage]) { renderPage(landingPage); return PAGES[landingPage].title; }
    renderHome(); return tr('home');
  }
  function route() {
    let slug = location.hash.slice(1);
    if (slug) slug = decodeURIComponent(slug);
    if (slug && /^(fn|fnref)-/.test(slug)) return; // in-page footnote anchor
    closeNav(); // picking a page in the drawer closes it
    showPage(slug);
    el('content').scrollTop = 0; // hash-only navigation: the browser never resets the article container, so do it here
  }
  function showPage(slug) {
    if (editing && editing.cm) editing.cm.toTextArea();
    shownPage = slug; editing = null;
    el('page').classList.remove('home');
    if (!slug) { document.title = renderLanding() + ' — ' + wikiName; }
    else { renderPage(slug); document.title = titleOf(slug) + ' — ' + wikiName; }
    renderSidebar(); // re-renders with the active page's folder chain open; ends with markActive()
  }

  // ---------- loaders ----------
  function loadBundled() {
    RAW = (window.PAGES_BUNDLED || []).map(function (p) { return { slug: p.slug, mtime: p.mtime, src: b64toUtf8(p.content) }; });
    IMAGES = {};
  }
  async function loadLive(handle) {
    const live = { stamp: '', raw: [], images: {}, dirs: [] };
    await walkDir(handle, '', live);
    return live;
  }
  function applyLive(live) { liveStamp = live.stamp; RAW = live.raw; IMAGES = live.images; liveDirs = live.dirs; }
  async function folderStamp(dir, prefix = '') {
    let stamp = '';
    for await (const e of dir.values()) {
      if (e.kind === 'directory') { stamp += prefix + e.name + '/\n'; stamp += await folderStamp(e, prefix + e.name + '/'); } // folder names in the stamp too: an empty folder appearing or vanishing has to count as a change
      else if (/\.md$/i.test(e.name) || imgExtRe.test(e.name)) stamp += prefix + e.name + ':' + (await e.getFile()).lastModified + '\n';
    }
    return stamp;
  }
  async function fileAt(root, path) {
    const parts = path.split('/');
    let dir = root;
    for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
    return dir.getFileHandle(parts[parts.length - 1]);
  }
  function versionOf(modified, raw) { return { modified: modified, raw: raw, text: raw.replace(/\r\n/g, '\n') }; }
  async function readForEdit(root, path) {
    const f = await (await fileAt(root, path)).getFile();
    const version = versionOf(f.lastModified, await f.text());
    return { text: version.text, version: version };
  }
  async function saveFile(root, path, text, version) {
    const handle = await fileAt(root, path);
    const current = await handle.getFile();
    const raw = await current.text();
    if (raw.indexOf('\uFFFD') !== -1) throw new Error(tr('notUtf8Error'));
    if (current.lastModified !== version.modified || raw !== version.raw) {
      const theirs = versionOf(current.lastModified, raw);
      const parts = merge3(version.text, text, theirs.text);
      if (parts.some(function (p) { return p.conflict; })) return { ok: false, parts: parts, version: theirs };
      text = parts.map(function (p) { return p.text; }).join('');
    }
    const out = raw.indexOf('\r\n') !== -1 ? text.replace(/\r?\n/g, '\r\n') : text;
    const w = await handle.createWritable();
    await w.write(out);
    await w.close();
    return { ok: true, version: versionOf((await handle.getFile()).lastModified, out) };
  }
  function validName(n) { // one path segment, no filesystem-reserved characters, not hidden and not ending in a dot
    return /^[^\/\\:*?"<>|.][^\/\\:*?"<>|]*$/.test(n) && !n.endsWith('.');
  }
  async function createEntry(root, page, folder, name) { // empty Name.md or a folder under folder; { error } for a bad or taken name
    if (!validName(name)) return { error: tr('nameBad') };
    let dir = root;
    for (const part of folder ? folder.split('/') : []) dir = await dir.getDirectoryHandle(part);
    const nf = function (e) { return ((e && e.name) + ' ' + (e && e.message)).indexOf('NotFound') !== -1; }; // real API throws DOMException NotFoundError; the test stubs a plain Error
    try {
      if (page) {
        try { await dir.getFileHandle(name + '.md'); return { error: tr('nameTaken') }; }
        catch (e) { if (!nf(e)) throw e; await dir.getFileHandle(name + '.md', { create: true }); }
      } else {
        try { await dir.getDirectoryHandle(name); return { error: tr('nameTaken') }; }
        catch (e) { if (!nf(e)) throw e; await dir.getDirectoryHandle(name, { create: true }); }
      }
    } catch (e) { return { error: tr('couldNotCreate') + e.message }; }
    return { ok: true, slug: (folder ? folder + '/' : '') + name }; // slug form, no .md — that's what routes and PAGES use; the next scan picks the entry up, empty folder included
  }
  async function deleteEntry(root, page, path) { // page: remove the slug's .md file; else the folder and, recursively, everything inside it
    if (!validName(path.split('/').pop())) return { error: tr('nameBad') };
    try {
      const parts = (page ? path + '.md' : path).split('/');
      let dir = root;
      for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
      await dir.removeEntry(parts[parts.length - 1], page ? undefined : { recursive: true });
    } catch (e) { return { error: tr('couldNotDelete') + e.message }; }
    return { ok: true };
  }
  function splitLines(text) { return text.match(/[^\n]*\n|[^\n]+$/g) || []; }
  function matchLines(a, b) {
    const match = new Array(a.length).fill(-1);
    let head = 0, tail = 0;
    while (head < a.length && head < b.length && a[head] === b[head]) { match[head] = head; head++; }
    while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) { match[a.length - 1 - tail] = b.length - 1 - tail; tail++; }
    const n = a.length - head - tail, m = b.length - head - tail;
    const len = new Uint32Array((n + 1) * (m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
      len[i * (m + 1) + j] = a[head + i] === b[head + j] ? len[(i + 1) * (m + 1) + j + 1] + 1 : Math.max(len[(i + 1) * (m + 1) + j], len[i * (m + 1) + j + 1]);
    }
    for (let i = 0, j = 0; i < n && j < m;) {
      if (a[head + i] === b[head + j]) { match[head + i] = head + j; i++; j++; }
      else if (len[(i + 1) * (m + 1) + j] >= len[i * (m + 1) + j + 1]) i++;
      else j++;
    }
    return match;
  }
  function merge3(base, mine, theirs) {
    const b = splitLines(base), my = splitLines(mine), th = splitLines(theirs);
    const toMine = matchLines(b, my), toTheirs = matchLines(b, th);
    const parts = [];
    function push(text, mineText) { parts.push({ text: text, mine: mineText }); }
    let i = 0, m = 0, t = 0;
    while (i < b.length || m < my.length || t < th.length) {
      if (i < b.length && toMine[i] === m && toTheirs[i] === t) { push(b[i], b[i]); i++; m++; t++; continue; }
      let next = i;
      while (next < b.length && (toMine[next] < 0 || toTheirs[next] < 0)) next++;
      const mEnd = next < b.length ? toMine[next] : my.length, tEnd = next < b.length ? toTheirs[next] : th.length;
      const was = b.slice(i, next).join(''), mineText = my.slice(m, mEnd).join(''), theirText = th.slice(t, tEnd).join('');
      if (mineText === was || mineText === theirText) push(theirText, mineText);
      else if (theirText === was) push(mineText, mineText);
      else {
        const myPart = my.slice(m, mEnd), thPart = th.slice(t, tEnd);
        let lead = 0, trail = 0;
        while (lead < myPart.length && lead < thPart.length && myPart[lead] === thPart[lead]) lead++;
        while (trail < myPart.length - lead && trail < thPart.length - lead && myPart[myPart.length - 1 - trail] === thPart[thPart.length - 1 - trail]) trail++;
        const agreed = function (lines) { const text = lines.join(''); if (text) push(text, text); };
        agreed(myPart.slice(0, lead));
        parts.push({ conflict: true, mine: myPart.slice(lead, myPart.length - trail).join(''), theirs: thPart.slice(lead, thPart.length - trail).join('') });
        agreed(myPart.slice(myPart.length - trail));
      }
      i = next; m = mEnd; t = tEnd;
    }
    return parts;
  }
  function extRe(list) { // live-render image list, set by imageExts in config.js; junk entries dropped, empty falls back to the built-in list
    const ok = (Array.isArray(list) ? list : []).filter(function (s) { return /^[a-z0-9]+$/i.test(s); });
    return new RegExp('\\.(' + (ok.length ? ok.join('|') : 'png|jpg|jpeg|gif|svg|webp') + ')$', 'i');
  }
  const imgExtRe = extRe(WIKI.imageExts); // bundled mode has no filter at all — the browser paints any format it supports
  async function walkDir(handle, prefix, live) { // same files, folders and order as folderStamp, so the stamp comes from this one pass
    for await (const e of handle.values()) {
      if (e.kind === 'directory') {
        live.dirs.push(prefix + e.name);
        live.stamp += prefix + e.name + '/\n';
        await walkDir(e, prefix + e.name + '/', live);
        continue;
      }
      const isPage = /\.md$/i.test(e.name);
      if (!isPage && !imgExtRe.test(e.name)) continue;
      const f = await e.getFile();
      live.stamp += prefix + e.name + ':' + f.lastModified + '\n';
      if (isPage) live.raw.push({ slug: (prefix + e.name).replace(/\.md$/i, ''), path: prefix + e.name, mtime: Math.floor(f.lastModified / 1000), src: await f.text() });
      else live.images[prefix + e.name] = await fileToDataURI(f, e.name);
    }
  }
  async function fileToDataURI(f, name) {
    const ext = name.split('.').pop().toLowerCase();
    const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' ? 'image/jpeg' : 'image/' + ext;
    return new Promise(function (res, rej) {
      const r = new FileReader();
      r.onload = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
      r.readAsDataURL(f.slice(0, f.size, mime));
    });
  }
  const dirKey = 'dir ' + location.pathname.replace(/[^/]*$/, ''); // file:// gives every local page one shared IndexedDB, so the one 'dir' slot used to make every wiki live-render the last folder picked; keying by this index.html's own folder keeps each wiki to its own
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
    async set(k, v) { const d = await this.open(); const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); },
    async del(k) { const d = await this.open(); const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').delete(k); }
  };
  function loadingNote() { // walking a folder on a network drive can take a while; without this the screen just sits blank and looks broken
    if (!el('page').innerHTML) el('page').innerHTML = '<p class="loading-note">' + tr('loadingFolder') + '</p>';
  }
  async function showFolder(h) {
    const mine = loading = { h: h };
    try {
      if ((await h.queryPermission({ mode: 'read' })) !== 'granted') return false;
      loadingNote();
      const live = await loadLive(h);
      if (loading !== mine || editing) return false;
      if (h === liveHandle && live.stamp === liveStamp) return true; // nothing changed: no redraw, so a folder you are browsing survives focus refreshes and live polls
      const scroll = h === liveHandle ? el('content').scrollTop : 0;
      liveHandle = h; applyLive(live); mode = 'live';
      buildIndex(); renderTags(); setMode('live'); showPage(shownPage);
      el('content').scrollTop = scroll;
      return true;
    } catch (e) { return false; } finally { if (loading === mine) loading = null; }
  }
  async function chooseFolder() {
    if (editing) return;
    try {
      // Chrome only accepts short token-ish ids (≤32 chars), so hash this wiki's folder key rather
      // than slug it: the id makes the dialog reopen where this wiki last picked (a picker can't be
      // given a path directly) and stays distinct per wiki
      let hid = 7; for (const ch of dirKey) hid = (Math.imul(hid, 31) + ch.charCodeAt(0)) >>> 0;
      const h = await showDirectoryPicker({ mode: 'readwrite', id: 'w' + hid.toString(36) });
      if (!(await showFolder(h))) return;
      closeNav();
      await IDB.set(dirKey, h);
    } catch (e) { /* cancelled or permission denied */ }
  }
  function leaveLive() { // the way back out: bundled snapshot now, and this wiki forgets the folder so the next open does not quietly live-render it again
    if (editing || mode !== 'live') return;
    liveHandle = null; liveDirs = []; liveStamp = ''; mode = 'bundled';
    IDB.del(dirKey).catch(function () {}); // best effort: if IDB is broken, the cost is just the folder reopening next time
    loadBundled();
    buildIndex(); renderTags(); renderSidebar(); setMode('bundled');
    route(); // the live page on screen may not exist in the snapshot
  }
  function refreshLive() {
    if (mode !== 'live' || editing || (loading && loading.h !== liveHandle)) return false;
    const now = Date.now(); if (now - lastRefresh < 1500) return false; lastRefresh = now;
    return showFolder(liveHandle);
  }
  async function pollLive() {
    if (editing) { await checkEditedPage(); return; }
    if (mode !== 'live' || loading || document.hidden) return;
    const mine = loading = { h: liveHandle };
    let changed = false;
    try { changed = (await folderStamp(liveHandle)) !== liveStamp; } catch (e) {}
    if (loading !== mine) return;
    loading = null;
    if (changed) { lastRefresh = 0; await refreshLive(); }
  }

  function editMsg(text) { const m = el('editMsg'); if (m) m.textContent = text; }

  let toastTimer = null;
  function toast(text) { // centered overlay for the good-news messages; warnings stay inline by the editor
    let t = el('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = text; t.classList.add('toast--on');
    clearTimeout(toastTimer); // long enough to read the full build reminder
    toastTimer = setTimeout(function () { t.classList.remove('toast--on'); }, 6000);
  }
  // EasyMDE (CodeMirror 5 inside) replaces the textarea with a highlighted one; no preview in its toolbar
  // because its preview renders with marked, not our markdown-it — [[links]] and ::: boxes would look wrong
  // there; the editor bar's Preview button uses the real wiki engine instead (previewEditor).
  // autoDownloadFontAwesome stops it pulling Font Awesome off a CDN — the wiki has to work offline.
  function wikiSnippets() { // what the wiki-only toolbar buttons insert: b + caret + a. The leading blank lines break out of the current block so the syntax renders even mid-paragraph; test-render.js checks each one really renders (the "then" marker)
    var bcols = window.MditExtras ? window.MditExtras.badgeColors() : {}; // one item per colour the renderer applies right now, config.js badgeColors included
    return [
      { name: 'alert', title: 'Callout box', items: [
        { name: 'note', title: 'note', b: '\n\n> [!NOTE]\n> ', a: '\n', then: 'markdown-alert-note' },
        { name: 'tip', title: 'tip', b: '\n\n> [!TIP]\n> ', a: '\n', then: 'markdown-alert-tip' },
        { name: 'important', title: 'important', b: '\n\n> [!IMPORTANT]\n> ', a: '\n', then: 'markdown-alert-important' },
        { name: 'warning', title: 'warning', b: '\n\n> [!WARNING]\n> ', a: '\n', then: 'markdown-alert-warning' },
        { name: 'caution', title: 'caution', b: '\n\n> [!CAUTION]\n> ', a: '\n', then: 'markdown-alert-caution' },
      ] },
      { name: 'fold', title: 'Foldable section', items: [
        { name: 'fold-closed', title: 'closed', b: '\n\n::: fold Title\n', a: '\n\n:::\n', then: '<details class="fold">' },
        { name: 'fold-open', title: 'open', b: '\n\n::: fold! Title\n', a: '\n\n:::\n', then: '<details class="fold" open' },
      ] },
      { name: 'block', title: 'Named container block', items: [ // own buttons: the wiki row breaks keep the toolbar tidy anyway (wiki-break)
        { name: 'block', title: 'block', b: '\n\n::: name\n', a: '\n\n:::\n', then: 'class="container name"' },
      ] },
      { name: 'tabs', title: 'Tabbed panels', items: [
        { name: 'tabs', title: 'tabs', b: '\n\n::: tabs\n::: tab: First\n', a: '\n:::\n::: tab: Second\n\n:::\n:::\n', then: 'class="container tabs"' },
      ] },
      { name: 'badges', title: 'Badge pill', items: [ // 'badges', not 'badge': EasyMDE puts the name on the button as a class, and the wiki's own .badge pill rules would grey it out and shrink its font. the colour items keep badge--x classes on purpose: that's what paints them
        { name: 'badge-plain', title: 'plain', b: '@{', a: '}', then: 'class="badge"' },
      ].concat(Object.keys(bcols).map(function (c) {
        var word = (bcols[c] || [])[0];
        if (!word) return null; // a config colour with no keywords cannot colour anything
        return { name: 'badge-' + c, title: c, className: 'badge--' + c, b: '@{' + word, a: '}', then: 'badge--' + c }; // the renderer's own class rides along, so the menu entry wears the wiki's colour (user.css included)
      }).filter(Boolean)) },
      { name: 'button', title: 'Button link', items: [
        { name: 'button-plain', title: 'plain', b: '@[', a: '](url)', then: 'class="btn"' },
      ].concat((window.MditExtras ? window.MditExtras.buttonColors : []).map(function (c) {
        return { name: 'button-' + c, title: c, className: 'btn--' + c, b: '@[', a: '](url){' + c + '}', then: 'btn--' + c };
      })) },
    ];
  }
  function insertSnip(cm, snip) {
    const sel = cm.getSelection(), at = cm.indexFromPos(cm.getCursor('from'));
    cm.replaceSelection(snip.b + sel + snip.a); // selected text ends up wrapped inside the snippet
    cm.setCursor(cm.posFromIndex(at + snip.b.length + sel.length));
    cm.focus();
  }
  function wikiButtons() { // EasyMDE's own custom-button + dropdown-group config, so vendor/easymde.min.js stays unpatched and swappable
    return wikiSnippets().map(function (g) {
      const kids = g.items.map(function (it) { return { name: it.name, title: it.title, className: it.className, action: function (ed) { insertSnip(ed.codemirror, it); } }; });
      return kids.length === 1 ? kids[0] : { name: g.name, title: g.title, children: kids };
    });
  }
  function makeEditor(ta) {
    if (!window.EasyMDE) return null; // vendor/easymde.min.js missing: the plain textarea still edits
    const cm = new window.EasyMDE({
      element: ta, spellChecker: false, status: false, lineWrapping: true, minHeight: '50vh', autofocus: true,
      autoDownloadFontAwesome: false, promptTexts: { link: tr('promptLink'), url: tr('promptUrl') }, // the link dialog's prompts, which ship in English
      toolbar: ['bold', 'italic', 'strikethrough', 'heading', '|', 'link', 'quote', 'code', '|', 'unordered-list', 'ordered-list', 'table', '|', 'undo', 'redo',
        { name: 'wiki-break', title: '', action: function () {} }].concat(wikiButtons()) // the invisible break: the wiki buttons always start on their own row, so they never get cut in half by the wrap (and no separator dangles at the row end)
    });
    translateToolbar(cm);
    return cm;
  }
  function draftText(ed) { return ed.cm ? ed.cm.value() : el('editText').value; }
  function draftReadOnly(ed, locked) {
    if (!ed.cm) { el('editText').readOnly = locked; return; }
    ed.cm.codemirror.setOption('readOnly', locked);
    ed.cm.gui.toolbar.querySelectorAll('button').forEach(function (b) { b.disabled = locked; });
  }
  function lockEditor(locked) {
    draftReadOnly(editing, locked);
    el('editSave').disabled = locked; el('editCancel').disabled = locked;
  }
  async function openEditor() {
    const slug = shownPage || landingPage; const p = PAGES[slug]; const h = liveHandle;
    if (!p || !h || editing) return;
    try {
      if ((await h.requestPermission({ mode: 'readwrite' })) !== 'granted') return;
      const opened = await readForEdit(h, p.path);
      if (liveHandle !== h || !PAGES[slug] || (shownPage || landingPage) !== slug || editing) return;
      if (opened.text.indexOf('\uFFFD') !== -1) {
        el('editNote').textContent = tr('utf8Note');
        return;
      }
      editing = { root: h, slug: slug, path: p.path, version: opened.version, saving: false, incoming: null, conflict: null, cm: null };
      const page = el('page');
      page.innerHTML = crumbHtml(slug) + '<div class="editor"><div id="editAlert" class="edit-alert"></div><div id="editConflicts" class="edit-conflicts"></div>' +
        '<textarea id="editText" spellcheck="false"></textarea>' +
        '<div class="editor-bar"><button id="editPreview" class="btn" type="button" data-edit="preview"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" stroke="currentColor" stroke-width="1.5" fill="none"/><circle cx="8" cy="8" r="1.8" fill="currentColor"/></svg>' + tr('preview') + '</button>' +
        '<button id="editSave" class="btn btn--green" type="button" data-edit="save"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 3h8l2.5 2.5V13H3z" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linejoin="round"/><path d="M5.5 3v3.5h5V3M5.5 13V9.5h5V13" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linejoin="round"/></svg>' + tr('save') + '</button>' +
        '<button id="editCancel" class="btn btn--red" type="button" data-edit="cancel"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' + tr('cancel') + '</button><span id="editMsg" class="edit-msg"></span></div>' +
        '<div id="editPreviewBox" class="edit-preview" hidden></div></div>';
      const ta = el('editText');
      ta.value = opened.text;
      editing.cm = makeEditor(ta);
      if (!editing.cm) ta.focus();
      tocHtml = ''; placeToc(); markActive(); el('backlinks').innerHTML = '';
    } catch (e) {}
  }
  async function saveEditor() {
    const ed = editing;
    if (!ed || ed.saving || ed.conflict) return;
    ed.saving = true; lockEditor(true); editMsg(tr('saving'));
    let r;
    try { r = await saveFile(ed.root, ed.path, draftText(ed), ed.version); }
    catch (e) { r = { error: e }; }
    if (r.ok) {
      if (loading && loading.h === ed.root) loading = null;
      if (liveHandle === ed.root && PAGES[ed.slug]) { PAGES[ed.slug].src = r.version.raw; buildIndex(); liveStamp = null; }
    }
    if (editing !== ed) return;
    if (!r.ok) {
      ed.saving = false; lockEditor(false);
      if (r.error) { editMsg(tr('couldNotSave') + r.error.message); return; }
      ed.incoming = null; el('editAlert').innerHTML = '';
      reconcile(ed, r.parts, r.version);
      editMsg(tr('conflictOnSave'));
      return;
    }
    renderTags(); showPage(shownPage);
    // the confirmation lands in a centered overlay over the re-rendered page, and always reminds
    // about the build: what Save updates is the .md file, so others only see it in the bundled
    // snapshot after build.sh/build.bat runs — everyone who saves needs to know this, not just once
    toast(tr('savedToast'));
  }
  async function checkEditedPage() {
    const ed = editing;
    if (ed.saving || ed.conflict) return;
    const known = ed.incoming || ed.version;
    let f, raw;
    try { f = await (await fileAt(ed.root, ed.path)).getFile(); if (f.lastModified === known.modified) return; raw = await f.text(); }
    catch (e) { return; }
    if (editing !== ed || ed.saving || ed.conflict) return;
    const now = versionOf(f.lastModified, raw);
    if (now.text === ed.version.text) { ed.version = now; ed.incoming = null; el('editAlert').innerHTML = ''; return; }
    if (ed.incoming && raw === ed.incoming.raw) { ed.incoming.modified = f.lastModified; return; }
    ed.incoming = now;
    el('editAlert').innerHTML = tr('someoneSaved') +
      ' <button class="btn" type="button" data-edit="merge">' + tr('mergeBtn') + '</button>' +
      ' <button class="btn" type="button" data-edit="changes">' + tr('changesBtn') + '</button>';
  }
  function changedLines(before, after) {
    const a = splitLines(before), b = splitLines(after), match = matchLines(a, b), out = [];
    let j = 0;
    a.forEach(function (line, i) {
      if (match[i] < 0) { out.push('- ' + line); return; }
      while (j < match[i]) out.push('+ ' + b[j++]);
      j++;
    });
    while (j < b.length) out.push('+ ' + b[j++]);
    return out.map(function (l) { return l.replace(/\n$/, ''); }).join('\n');
  }
  function showChanges() {
    const ed = editing;
    if (!ed || !ed.incoming || el('editAlert').innerHTML.indexOf('<pre>') !== -1) return;
    el('editAlert').innerHTML += '<pre>' + escapeHtml(changedLines(ed.version.text, ed.incoming.text)) + '</pre>';
  }
  function mergeIncoming() {
    const ed = editing;
    if (!ed || !ed.incoming || ed.saving || ed.conflict) return;
    const theirs = ed.incoming;
    ed.incoming = null; el('editAlert').innerHTML = '';
    reconcile(ed, merge3(ed.version.text, draftText(ed), theirs.text), theirs);
  }
  function reconcile(ed, parts, theirs) {
    if (!parts.some(function (p) { return p.conflict; })) { putMerged(ed, parts, theirs); return; }
    ed.conflict = { parts: parts, version: theirs, choices: {} };
    draftReadOnly(ed, true); el('editSave').disabled = true;
    showConflicts(ed);
    el('editConflicts').scrollIntoView({ block: 'start' });
  }
  function putMerged(ed, parts, theirs) {
    const cm = ed.cm && ed.cm.codemirror, box = el('editText');
    const typedAt = cm ? cm.indexFromPos(cm.getCursor()) : box.selectionStart;
    let mineAt = 0, outAt = 0, cursor = null;
    for (const p of parts) {
      const at = typedAt - mineAt, kept = p.text === p.mine;
      if (cursor === null && (kept ? at <= p.mine.length : at < p.mine.length)) cursor = kept ? outAt + at : outAt;
      mineAt += p.mine.length; outAt += p.text.length;
    }
    const merged = parts.map(function (p) { return p.text; }).join(''), to = cursor === null ? outAt : cursor;
    if (cm) {
      const scroll = cm.getScrollInfo();
      cm.setValue(merged); cm.clearHistory(); cm.setCursor(cm.posFromIndex(to)); cm.scrollTo(scroll.left, scroll.top);
    } else {
      const top = box.scrollTop;
      box.value = merged; box.setSelectionRange(to, to); box.scrollTop = top;
    }
    ed.version = theirs;
  }
  function showConflicts(ed) {
    const c = ed.conflict;
    el('editConflicts').innerHTML = '<p>' + tr('conflictsIntro') + '</p>' +
      c.parts.map(function (p, k) {
        if (!p.conflict || c.choices[k]) return '';
        const btn = function (side, label) { return '<button class="btn" type="button" data-edit="pick" data-k="' + k + '" data-side="' + side + '">' + label + '</button>'; };
        return '<div class="conflict"><div class="conflict-side">' + tr('theirs') + '</div><pre>' + escapeHtml(p.theirs) + '</pre>' +
          '<div class="conflict-side">' + tr('yours') + '</div><pre>' + escapeHtml(p.mine) + '</pre>' +
          '<div class="conflict-bar">' + btn('mine', tr('keepMine')) + btn('theirs', tr('keepTheirs')) + btn('both', tr('keepBoth')) + '</div></div>';
      }).join('');
  }
  function pickConflict(k, side) {
    const ed = editing, c = ed && ed.conflict;
    if (!c || !c.parts[k] || !c.parts[k].conflict) return;
    c.choices[k] = side;
    if (c.parts.some(function (p, i) { return p.conflict && !c.choices[i]; })) { showConflicts(ed); return; }
    const both = function (p) { return p.theirs && p.mine && !/\n$/.test(p.theirs) ? p.theirs + '\n' + p.mine : p.theirs + p.mine; };
    const parts = c.parts.map(function (p, i) {
      if (!p.conflict) return p;
      return { text: c.choices[i] === 'mine' ? p.mine : c.choices[i] === 'theirs' ? p.theirs : both(p), mine: p.mine };
    });
    ed.conflict = null; el('editConflicts').innerHTML = '';
    draftReadOnly(ed, false); el('editSave').disabled = false;
    putMerged(ed, parts, c.version);
    editMsg(tr('mergedMsg'));
  }
  function cancelEditor() { showPage(shownPage); lastRefresh = 0; refreshLive(); }
  function previewEditor() { // toggle: the draft rendered through the wiki's own engine as a modal over everything, so what you preview is what saving produces (EasyMDE's built-in preview speaks a different markdown flavour and would lie about [[links]], badges, ::: — see makeEditor)
    if (!editing) return;
    const box = el('editPreviewBox');
    if (!box.hidden) { box.hidden = true; return; }
    box.innerHTML = '<p class="edit-preview-hint">' + tr('previewHint') + '</p>' + renderMarkdown(parseFrontmatter(draftText(editing)).body); // strip the front matter first, exactly like build.sh's snapshot does — raw, its --- lines come out as setext headings
    fixMdLinks(box, (PAGES[editing.slug] || {}).folder || '');
    highlightCode(box); runKaTeX(box); runMermaid(box);
    box.hidden = false;
  }

  // ---------- init ----------
  async function init() {
    document.documentElement.setAttribute('lang', tr('langCode')); // <html lang> follows the interface language tr() picked
    el('menuBtn').title = tr('menu'); el('menuBtn').setAttribute('aria-label', tr('menu'));
    el('search').placeholder = tr('search'); el('search').setAttribute('aria-label', tr('search'));
    el('clearSearch').title = tr('clearSearch');
    el('mode').title = tr('modeTitle');
    el('refresh').title = tr('refreshTitle'); el('refresh').setAttribute('aria-label', tr('refreshTitle'));
    el('leave').textContent = tr('btnBundled'); el('leave').title = tr('btnBundledTitle');
    el('choose').textContent = tr('btnLive'); el('choose').title = tr('btnLiveTitle');
    el('resizer').title = tr('resizer');
    el('refresh').addEventListener('click', refreshLive);
    window.addEventListener('focus', function () { if (!loading) refreshLive(); }); // re-read live folder when the tab regains focus
    setInterval(pollLive, 5000);
    el('search').addEventListener('input', function (e) { doSearch(e.target.value); });
    const themeBtn = el('themeBtn');
    const showTheme = function (v) {
      themeBtn.dataset.theme = v;
      const names = { system: tr('themeSystem'), light: tr('themeLight'), dark: tr('themeDark') };
      themeBtn.title = tr('themeTitle').replace('%1', names[v]).replace('%2', names[nextTheme(v)]);
      themeBtn.setAttribute('aria-label', themeBtn.title);
    };
    showTheme(document.documentElement.style.colorScheme || 'system'); // the <head> script already applied the saved choice
    themeBtn.addEventListener('click', function () {
      const t = nextTheme(themeBtn.dataset.theme);
      document.documentElement.style.colorScheme = t === 'system' ? '' : t;
      showTheme(t); redrawMermaid();
      try { localStorage.setItem('theme', t); } catch (e) {} // blocked storage: the choice lasts until reload
    });
    systemDark.addEventListener('change', redrawMermaid);
    const mac = /Mac|iPhone|iPad/.test(navigator.platform);
    el('searchKey').textContent = mac ? '\u2318K' : 'Ctrl K';
    document.addEventListener('keydown', function (e) {
      if (isSearchShortcut(e, mac)) { e.preventDefault(); el('search').focus(); el('search').select(); }
      else if (e.key === 'Escape' && editing && !el('editPreviewBox').hidden) previewEditor(); // Esc closes the preview modal
    });
    el('search').addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.target.value = ''; doSearch(''); } });
    el('search').addEventListener('click', function (e) { if (e.target.value) doSearch(e.target.value); }); // query still in the box → panel comes back
    document.addEventListener('click', function (e) { // any click outside box+panel dismisses the panel (text stays in the box)
      if (!e.target.closest('.search-wrap, #searchResults')) el('searchResults').classList.add('hidden');
    });
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
      const pa = e.target.closest('#editPreviewBox a'); // wiki links in the preview would route() away and close the editor; the box is a preview, so its links stay dead
      if (pa) { e.preventDefault(); return; }
      if (e.target.id === 'editPreviewBox') { previewEditor(); return; } // a click on the box itself or its ::before backdrop closes the preview modal (same idiom as the drawer backdrop)
      const ed = e.target.closest('[data-edit]');
      if (ed) {
        if (ed.dataset.edit === 'pick') pickConflict(Number(ed.dataset.k), ed.dataset.side);
        else ({ open: openEditor, save: saveEditor, cancel: cancelEditor, merge: mergeIncoming, changes: showChanges, preview: previewEditor })[ed.dataset.edit]();
        return;
      }
      const b = e.target.closest('.copybtn');
      if (!b) return;
      const code = b.closest('pre').querySelector('code');
      copyText(code ? code.textContent : b.closest('pre').textContent, function () {
        b.classList.add('copied');
        setTimeout(function () { b.classList.remove('copied'); }, 1500);
      });
    });
    const tocScroll = function (e) {
      const a = e.target.closest('a.toclink');
      if (a) { e.preventDefault(); const t = document.getElementById(a.getAttribute('href').slice(1)); if (t) t.scrollIntoView({ behavior: 'smooth' }); closeNav(); } // inside the drawer, jumping into the article closes it
    };
    el('tree').addEventListener('click', tocScroll);
    let spyRaf = 0; // scroll-spy, rAF-throttled: one pass per frame at most
    el('content').addEventListener('scroll', function () { if (!spyRaf) spyRaf = requestAnimationFrame(function () { spyRaf = 0; markTocPosition(); }); }, { passive: true });
    el('tree').addEventListener('click', function (e) { // clicking the current page's entry: same hash means no hashchange, so scroll the article back to the top
      const a = e.target.closest('a[data-slug]');
      if (a && a.dataset.slug === shownPage) { e.preventDefault(); closeNav(); el('content').scrollTo({ top: 0, behavior: 'smooth' }); }
    });
    el('tree').addEventListener('click', async function (e) { // live-mode sidebar buttons: + creates an empty page (then opens it) or a folder under the button's data-path, the trash removes one
      const n = e.target.closest('[data-new]'), d = e.target.closest('[data-del]');
      if (!n && !d) return;
      e.preventDefault(); // the folder-row buttons sit inside <summary>: the click must not toggle the folder open/closed
      if (d) {
        const page = d.getAttribute('data-del') === 'page', path = d.getAttribute('data-path') || '';
        if (!window.confirm(tr(page ? 'confirmDelPage' : 'confirmDelFolder').replace('%1', path.split('/').pop()))) return;
        const rd = await deleteEntry(liveHandle, page, path);
        if (rd.error) { toast(rd.error); return; }
        await refreshLive(); // the next scan no longer sees the entry: rows go, and a deleted page on screen reroutes to not-found
        return;
      }
      const page = n.getAttribute('data-new') === 'page';
      const name = ((window.prompt(page ? tr('promptPageName') : tr('promptFolderName'), '') || '') + '').trim();
      if (!name) return;
      const r = await createEntry(liveHandle, page, n.getAttribute('data-path') || '', name);
      if (r.error) { toast(r.error); return; }
      await refreshLive();
      if (page) location.hash = '#' + encodeURIComponent(r.slug);
      else toast(tr('folderCreated'));
    });
    el('tocRail').addEventListener('click', tocScroll);
    // narrow screens: the hamburger opens the sidebar as an overlay drawer
    el('menuBtn').addEventListener('click', function () {
      const open = document.body.classList.toggle('nav-open');
      this.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', function (e) { // backdrop, or any click outside the drawer, closes it
      if (document.body.classList.contains('nav-open') && !e.target.closest('.sidebar, #menuBtn')) closeNav();
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeNav(); });
    narrowMq.addEventListener('change', function () { if (!narrowMq.matches) closeNav(); renderSidebar(); syncModeGroup(); }); // crossing the breakpoint moves the TOC between rail and tree, and the mode group between topbar and drawer
    el('tags').addEventListener('click', function (e) {
      const t = e.target.closest('.tag'); if (!t) return;
      activeTag = (activeTag === t.dataset.tag) ? '' : t.dataset.tag;
      renderTags(); renderSidebar();
      if (!location.hash.slice(1) && !editing) route();
    });

    // the "Live render" button's visibility is handled by setMode (shown in bundled mode where the File System Access API exists)

    // resizable sidebar: drag the strip, width clamped 140–480 and remembered
    const setSidebarW = function (w) { document.documentElement.style.setProperty('--sidebar-w', w + 'px'); };
    let savedW = NaN;
    try { savedW = parseInt(localStorage.getItem('sidebar-w'), 10); } catch (e) {} // blocked storage: default width
    if (savedW >= 140 && savedW <= 480) setSidebarW(savedW);
    el('resizer').addEventListener('pointerdown', function (e) {
      e.preventDefault();
      let w = 0;
      const move = function (ev) { w = Math.min(480, Math.max(140, ev.clientX)); setSidebarW(w); };
      const up = function () { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); if (w) { try { localStorage.setItem('sidebar-w', w); } catch (e) {} } };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });

    try {
      const h = await IDB.get(dirKey);
      if (h) { const perm = await h.queryPermission({ mode: 'read' }); if (perm === 'granted') { loadingNote(); applyLive(await loadLive(h)); liveHandle = h; mode = 'live'; } }
    } catch (e) {}
    el('choose').addEventListener('click', chooseFolder);
    el('leave').addEventListener('click', leaveLive);
    el('tree').addEventListener('toggle', function (e) { // capture phase: the toggle event does not bubble. remembers hand-opened folders across redraws
      const p = e.target.getAttribute('data-path');
      if (p) { treeOpen = treeOpen || {}; treeOpen[p] = e.target.open; }
    }, true);
    if (mode !== 'live') loadBundled();

    buildIndex();
    renderSidebar(); renderTags(); syncModeGroup();
    setMode(mode);
    window.addEventListener('hashchange', route);
    if (expandOnPrint) { // CSS can't open <details>, so open every fold in the article for the paper, then restore
      let openedForPrint = [];
      window.addEventListener('beforeprint', function () {
        openedForPrint = Array.prototype.filter.call(document.querySelectorAll('#page details.fold'), function (d) { return !d.open; });
        openedForPrint.forEach(function (d) { d.open = true; });
      });
      window.addEventListener('afterprint', function () {
        openedForPrint.forEach(function (d) { d.open = false; });
        openedForPrint = [];
      });
    }
    route();
    lastRefresh = Date.now();
  }
  document.addEventListener('DOMContentLoaded', init);
})();
