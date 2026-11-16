/* test-app.js — smoke test for app.js source passes (wiki links, footnotes,
   code-run protection). Loads app.js, extracts the functions verbatim, runs them.
   Run: node test-app.js. Exits non-zero on failure. */
'use strict';
global.window = global;

const fs = require('fs');
const path = require('path');
const MarkdownIt = require('./vendor/markdown-it.min.js');
require('./vendor/mdit-extras.js');
const md = new MarkdownIt({ html: true, linkify: true });
global.md = md;

const src = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
function grab(name) {
  const i = src.indexOf('function ' + name);
  if (i < 0) throw new Error('app.js: function ' + name + ' not found');
  let d = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}') { d--; if (!d) return src.slice(i, j + 1); }
  }
  throw new Error('unbalanced braces in ' + name);
}
const STEMS = {};
global.STEM = {}; global.PAGES = {};
(0, eval)([grab('escapeHtml'), grab('resolveSlug'), grab('outsideCode'), grab('normalizeParts'), grab('absPath'),
           grab('wikiLinks'), grab('withFootnotes')].join('\n') + '\n;global.withFootnotes=withFootnotes;global.wikiLinks=wikiLinks;global.absPath=absPath;');
['Home', 'Guides/Basics', 'Guides/Nope'].forEach(function (s) {
  global.PAGES[s] = { slug: s };
  const k = s.split('/').pop().toLowerCase();
  (global.STEM[k] = global.STEM[k] || []).push(s);
});

const cases = [
  ['wiki link in prose',            'go [[Basics|b]]',                               'href="#Guides%2FBasics"'],
  ['stem wins shallower',           '[[Basics]]',                                     '#Guides%2FBasics'],
  ['path form resolves',            '[[Guides/Nope]]',                                '#Guides%2FNope'],
  ['unknown target marked',         '[[Ghost]]',                                      'class="broken-wiki"'],
  ['fence protects wiki links',     'x\n```\n[[Basics]]\n```\ny',                     'code>[[Basics]'],
  ['backtick span protects links',  'see `[[Home]]` here',                            '[[Home]]', '!<span class="broken-wiki">'],
  ['inline backticks inside fence', 'a\n```html\npress `<kbd>x</kbd>` code\n[[Basics]]\n```', '[[Basics]]'],
  ['footnote ref outside code',     'claim.[^a]\n\n[^a]: def',                         '<sup id="fnref-1">'],
  ['footnote def not eaten in fence','```\n[^a]: def\n```\n',                           'code>[^a]: def', '!class="footnotes"'],
  ['footnote ref in fence kept',    '```\n[^a]\n```',                                   '[^a]'],
  ['footnote span outside code',    'see `[^a]` ok',                                   '[^a]', '!<sup id="fnref-'],
];
let bad = 0;
for (const c of cases) {
  const html = withFootnotes(wikiLinks(c[1]));
  const ok = c.slice(2).every(function (s) {
    return s.charAt(0) === '!' ? !html.includes(s.slice(1)) : html.includes(s);
  });
  if (!ok) { bad++; console.log('FAIL: ' + c[0] + '\n  got: ' + html.replace(/\n/g, '\\n')); }
}
const pathCases = [ // image/.md refs resolve against the page's folder
  ['pic.png', 'Guides', 'Guides/pic.png'],
  ['./pic.png', 'Guides', 'Guides/pic.png'],
  ['sub/pic.png', 'Guides', 'Guides/sub/pic.png'],
  ['../shared/x.png', 'Guides', 'shared/x.png'],
  ['/root.png', 'Guides', 'root.png'],
  ['pic.png#frag', 'Guides', 'Guides/pic.png'],
  ['pic.png', '', 'pic.png'],
];
for (const [t, base, want] of pathCases) {
  const got = absPath(t, base);
  if (got !== want) { bad++; console.log('FAIL: absPath ' + JSON.stringify(t) + ' @ ' + JSON.stringify(base) + ': got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); }
}
if (bad) { console.log(bad + ' failed'); process.exit(1); }
console.log('test-app: ' + (cases.length + pathCases.length) + '/' + (cases.length + pathCases.length) + ' passed');
