/* ══════════════ SETTINGS (edit me) ══════════════
   Local-first: your settings live here, in this file — not in the UI.
   This file and articles/ are YOURS: a wiki upgrade replaces everything
   else, so keep these and nothing is lost. Missing keys fall back to the
   app's built-in defaults, so an old config still works with a new version.

   maxResults  : maximum number of search results to display
   searchWidth : search results panel width, percent of the window — 10 to 100
   searchHeight : search results panel max height, percent of the window — 10 to 100
   wikiName    : name shown in the topbar and the browser tab title
   tocSide     : where the table of contents is shown — 'left' (sidebar) or 'right' (rail)
   tocLevels   : heading levels shown in the TOC (H1..Hn) — 1 to 6
   pageWidth   : article column width, percent of the reading area — 10 to 100
   foldersOpen   : start with the sidebar folders expanded (false = all collapsed)
   editButton  : show the Edit button in live-render mode (false = read-only wiki)
   imageExts   : extensions read as images in live-render mode (bundled mode needs no list, the browser paints any format)
   brandIcon   : icon before the wiki name in the topbar — left out = built-in logo; any emoji/character replaces it; '' hides it
   favicon     : tab icon — image file next to index.html, URL, or data: URI; '' = the built-in logo
   expandOnPrint : open every ::: fold section when printing (false keeps them closed)
   language    : interface language — 'en' or 'fr' are built in; '' = your browser's language if a pack exists, else 'en'
   languages   : your own interface pack — add a whole new language here without touching app.js
   ui          : replace individual interface strings (any language, even one with no pack); wins over language
   badgeColors : which first-words color inline @{ badges }
   landingPage : page opened on load (slug like 'Guides/Basics'); '' = generated home
   sidebarOrder: how the sidebar lists pages vs folders — 'files' | 'folders' | 'alpha' */
window.WIKI = {
  maxResults: 200,
  searchWidth: 50, // search results panel width as % of the window; 10–100 (panel is centred under the topbar)
  searchHeight: 60, // search results panel max height as % of the window; 10–100 (panel scrolls past that)
  wikiName: 'Local Wiki', // shown in the topbar (after the icon) and as "Page — name" tab titles
  tocSide: 'left',
  tocLevels: 3, // heading levels shown in the TOC (H1..Hn); 1–6
  pageWidth: 70, // article column width as % of the reading area; 10–100
  foldersOpen: false,
  editButton: true, // false hides the Edit button: live render reads the folder, but nobody edits it from this wiki
  landingPage: 'Home', // page opened on load; '' shows the generated home (recent + folders)
  sidebarOrder: 'files', // 'files' (pages then folders) | 'folders' (folders then pages) | 'alpha' (mixed alphabetical)
  imageExts: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'], // live-render mode only; add e.g. 'bmp' or 'avif' if your browser supports it
  // brandIcon: '📚', // left out = the built-in logo; any emoji/character replaces it; '' hides it; for an image, go to user.css
  favicon: '', // browser tab icon: image file next to index.html (keep it — it's yours, like this file), any URL, or a data: URI; '' = the built-in logo
  expandOnPrint: true, // printing opens every fold section so nothing is hidden on paper; false keeps folds as you left them
  language: '', // 'en' or 'fr' built in; '' = your browser's language if a pack exists, else 'en'
  // languages: { de: { save: 'Speichern', preview: 'Vorschau', cancel: 'Abbrechen' } }, // your whole pack here: copy the key list from app.js uiDict(), any subset works — missing keys fall back to English. Then: language: 'de'
  // ui: { save: 'Stocker', preview: 'Aperçu' }, // replace single strings (uncomment, any key); wins over language. en/fr built-in keys are listed in app.js uiDict()
  // first word of a badge → its color, matched case-insensitively; unknown words stay the gray pill.
  // your own color: give the words plus a color, and the pill CSS is made for you (rendered badges and the editor menu):
  // badgeColors: { ...above..., mauve: { words: ['plum', 'lilac'], color: '#a371f7' } }
  badgeColors: {
    green:  ['stable', 'ok', 'done', 'active', 'success', 'passed', 'shipped', 'final'],
    yellow: ['draft', 'wip', 'todo', 'pending', 'review', 'progress', 'untested'],
    red:    ['error', 'failed', 'fails', 'failing', 'broken', 'danger', 'urgent', 'deprecated'],
    blue:   ['info', 'new', 'beta', 'note', 'preview'],
    purple: ['alpha', 'experimental', 'planned', 'idea']
  }
};
