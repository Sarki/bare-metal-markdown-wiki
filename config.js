/* ══════════════ SETTINGS (edit me) ══════════════
   Local-first: your settings live here, in this file — not in the UI.
   This file and articles/ are YOURS: a wiki upgrade replaces everything
   else, so keep these and nothing is lost. Missing keys fall back to the
   app's built-in defaults, so an old config still works with a new version.

   maxResults  : maximum number of search results to display
   wikiName    : name shown in the topbar and the browser tab title
   tocSide     : where the table of contents is shown — 'left' (sidebar) or 'right' (rail)
   tocLevels   : heading levels shown in the TOC (H1..Hn) — 1 to 6
   pageWidth   : article column width, percent of the reading area — 10 to 100
   foldersOpen : start with the sidebar folders expanded (false = all collapsed)
   imageExts   : extensions read as images in live-render mode (bundled mode needs no list, the browser paints any format)
   brandIcon   : glyph before the wiki name in the topbar (any emoji/character); '' hides it
   favicon     : tab icon — image file next to index.html, URL, or data: URI; '' = browser default
   badgeColors : which first-words color inline @{ badges }
   landingPage : page opened on load (slug like 'Guides/Basics'); '' = generated home
   sidebarOrder: how the sidebar lists pages vs folders — 'files' | 'folders' | 'alpha' */
window.WIKI = {
  maxResults: 200,
  wikiName: 'Local Wiki', // shown in the topbar (after the book icon) and as "Page — name" tab titles
  tocSide: 'left',
  tocLevels: 3, // heading levels shown in the TOC (H1..Hn); 1–6
  pageWidth: 70, // article column width as % of the reading area; 10–100
  foldersOpen: false,
  landingPage: 'Home', // page opened on load; '' shows the generated home (recent + folders)
  sidebarOrder: 'files', // 'files' (pages then folders) | 'folders' (folders then pages) | 'alpha' (mixed alphabetical)
  imageExts: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'], // live-render mode only; add e.g. 'bmp' or 'avif' if your browser supports it
  brandIcon: '📚', // glyph before the wiki name in the topbar; '' hides it — the static index.html fallback keeps the default 📚
  favicon: '', // browser tab icon: image file next to index.html (keep it — it's yours, like this file), any URL, or a data: URI; '' = browser default
  // first word of a badge → its color, matched case-insensitively; unknown words stay the gray pill
  badgeColors: {
    green:  ['stable', 'ok', 'done', 'active', 'success', 'passed', 'shipped', 'final'],
    yellow: ['draft', 'wip', 'todo', 'pending', 'review', 'progress', 'untested'],
    red:    ['error', 'failed', 'fails', 'failing', 'broken', 'danger', 'urgent', 'deprecated'],
    blue:   ['info', 'new', 'beta', 'note', 'preview'],
    purple: ['alpha', 'experimental', 'planned', 'idea']
  }
};
