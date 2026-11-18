/* test-render.js — smoke test for the markdown-it + mdit-extras.js pair.
   Run:  node test-render.js
   Re-run it after replacing ANY vendor file (especially markdown-it.min.js):
   mdit-extras.js relies on markdown-it's internal block-rule API, which the
   official packages never guarantee to keep stable.
   Exits non-zero on failure, so it can gate an upgrade. */
'use strict';
global.window = global;

const fs = require('fs');
const path = require('path');
const MarkdownIt = require('./vendor/markdown-it.min.js');
require('./vendor/mdit-extras.js');

const md = new MarkdownIt({ html: true, linkify: true, typographer: false, breaks: false });
if (!window.MditExtras) { console.error('FAIL: window.MditExtras missing'); process.exit(1); }
md.use(MditExtras.container);
md.use(MditExtras.alerts);
md.use(MditExtras.tabs);
md.use(MditExtras.badges);
md.use(MditExtras.buttons);

const cases = [
  // [name, input, mustContain]
  ['container basic',        '::: note\nhello\n:::\n',                          'class="container note"'],
  ['container bare',         ':::\nhi\n:::\n',                                  '<div class="container">'],
  ['container closing name', '::: tip\nx\n::: tip\n',                           '<div class="container tip">'],
  ['container fence inside', '::: tip\n```js\nlet x = 1;\n```\n:::\n',          'language-js'],
  ['unclosed container',     '::: note\nhello\n',                                'class="container note"'],
  ['text after container',   'before\n\n::: warn\nx\n:::\n\nafter\n',           'after'],
  ['container in list',      '- item\n\n  ::: note\n  nested\n  :::\n',         'class="container note"'],
  ['nested containers',      '::: note\nouter\n::: tip\ninner\n:::\nstill outer\n:::\n', 'class="container tip"'],
  ['plain ::: not eaten',    'just ::: text\n',                                  '<p>just ::: text</p>'],
  ['alert basic',            '> [!NOTE]\n> body\n',                              'markdown-alert-note'],
  ['alert default title',    '> [!NOTE]\n> body\n',                              'markdown-alert-title">Note<'],
  ['alert custom title',     '> [!NOTE] My title\n> body\n',                     'markdown-alert-title">My title<'],
  ['alert lowercase',        '> [!warning]\n> careful\n',                        'markdown-alert-warning'],
  ['alert blank line in',    '> [!IMPORTANT]\n>\n> deep\n',                      'markdown-alert-important'],
  ['alert bold body',        '> [!CAUTION]\n> **danger**\n',                     '<strong>danger</strong>'],
  ['alert tip',              '> [!TIP] t\n',                                     'markdown-alert-tip'],
  ['plain quote untouched',  '> just a quote\n',                                 '<blockquote>'],
  ['marker mid-doc',         'text\n> [!NOTE]\n> b\n',                           'markdown-alert-note'],
  ['alert in list',          '- x\n  > [!WARNING]\n  > hot\n',                   'markdown-alert-warning'],
  ['nested quote',           '> > [!NOTE]\n> > x\n',                             'markdown-alert-note'],
  ['quote starts with fence','> ```js\n> x\n> ```\n',                            'language-js'],
  ['lazy continuation',      '> [!NOTE]\nplain lazy line\n',                     'markdown-alert-note'],
  ['alert is a div',         '> [!NOTE]\n> x\n',                                 '<div class="markdown-alert markdown-alert-note">'],
  ['marker stripped',        '> [!NOTE]\n> x\n',                                 '<p class="markdown-alert-title">Note</p><p>\nx</p>'],
  ['tabs group',            '::: tabs\n::: tab: Node\na\n:::\n::: tab: Python\nb\n:::\n:::\n', 'class="container tabs"'],
  ['tabs bar buttons',      '::: tabs\n::: tab: Node\na\n:::\n::: tab: Python\nb\n:::\n:::\n', '<button type="button" class="active" data-i="0">Node</button>'],
  ['tabs first pane open',  '::: tabs\n::: tab: Node\na\n:::\n::: tab: Python\nb\n:::\n:::\n', '<div class="tab-pane" data-i="0">'],
  ['tabs second hidden',    '::: tabs\n::: tab: Node\na\n:::\n::: tab: Python\nb\n:::\n:::\n', '<div class="tab-pane" data-i="1" hidden>'],
  ['tabs name with space',  '::: tabs\n::: tab: C Sharp\na\n:::\n:::\n', '>C Sharp</button>'],
  ['tabs name inline',      '::: tabs\n::: tab: @{draft wip} **x**\na\n:::\n:::\n', '<span class="badge badge--yellow">draft wip</span> <strong>x</strong>'],
  ['tabs fence inside',     '::: tabs\n::: tab: JS\n```js\nlet a = 1;\n```\n:::\n:::\n', 'language-js'],
  ['bare tabs stays plain', '::: tabs\njust text\n:::\n', 'container tabs">\n<p>just text</p>'],
  ['container inside pane', '::: tabs\n::: tab: A\n::: note\ninner\n:::\n:::\n:::\n', 'class="container note"'],
  ['fold basic',            '::: fold Title\nb\n:::\n',   '<details class="fold">\n<summary>Title</summary>'],
  ['fold starts open',      '::: fold! T\nb\n:::\n',      '<details class="fold" open="">'],
  ['fold no title',         '::: fold\nb\n:::\n',         '<details class="fold">\n<p>b</p>'],
  ['fold markdown inside',  '::: fold T\n```js\nlet a = 1;\n```\n:::\n', 'language-js'],
  ['fold title inline',     '::: fold @{draft} x\nb\n:::\n', '<summary><span class="badge badge--yellow">draft</span> x</summary>'],
  ['fold matched close',    '::: fold T\nb\n::: fold T\n', '</details>'],
  ['fold nested',           '::: fold a\n::: fold b\nx\n:::\n:::\n', '<summary>a</summary><details class="fold">'],
  ['badge after punctuation',  'Status: @{stable} and @{draft} ok',  'Status: <span class="badge badge--green">stable</span> and <span class="badge badge--yellow">draft</span> ok'],
  ['badge basic',           'a @{stable} b',            '<span class="badge badge--green">stable</span>'],
  ['badge escaped',         '@{<b>}',                    '&lt;b&gt;'],
  ['badge two in a line',   '@{a} and @{b}',             '<span class="badge">a</span> and <span class="badge">b</span>'],
  ['badge with spaces',     '@{draft review}',           '<span class="badge badge--yellow">draft review</span>'],
  ['at-sign not a badge',   'a@example.com and @{oops',  '@{oops'], // unclosed @{ stays literal
  ['badge color green',     '@{stable}',                  '<span class="badge badge--green">stable</span>'],
  ['badge color red',       '@{deprecated}',              'badge--red'],
  ['badge color multiword', '@{draft review}',            'badge--yellow'],
  ['badge gray fallback',   '@{v1.0}',                    '<span class="badge">v1.0</span>'],
  ['button basic',          'go @[start](a/Basics.md)',   '<a href="a/Basics.md" class="btn">start</a>'],
  ['button label markdown', '@[**go** now](u)',           '<a href="u" class="btn"><strong>go</strong> now</a>'],
  ['plain link no button',  'plain [x](u) and me@ and [y](v)', 'plain <a href="u">x</a>'],
  ['escaped @ no button',   'foo\\@[x](u)',               'foo@<a href="u">x</a>'],
  ['button scheme blocked', '@[bad](javascript:alert(1))', '@[bad](javascript'],
  ['button with title',     '@[x](u "t")',                'title="t" class="btn"'],
  ['button color',          '@[x](u){red}',               '<a href="u" class="btn btn--red">x</a>'],
  ['button color unknown',  '@[x](u){mauve}',             'class="btn">x</a>{mauve}'],
  ['plain link color kept', '[x](u){red}',                '<a href="u">x</a>{red}'],
  // baseline: stock markdown still works
  ['fence',                  '```js\nlet a = 1;\n```\n',                         'language-js'],
  ['inline code',            'use `x()` now',                                     '<code>x()</code>'],
  ['linkify',                'visit https://example.com',                        '<a href="https://example.com"'],
  ['table',                  '| a | b |\n|---|---|\n| 1 | 2 |\n',               '<table>'],
];

let pass = 0, fail = 0;
for (const [name, input, expect] of cases) {
  let out;
  try { out = md.render(input); } catch (e) { out = 'RENDER THREW: ' + e.message; }
  if (out.includes(expect)) pass++;
  else { fail++; console.error('FAIL: ' + name + '\n  in:   ' + JSON.stringify(input) + '\n  out:  ' + out + '\n  want: ' + expect); }
}
// the settings file (window.WIKI in config.js) overrides the vendor defaults
global.WIKI = { badgeColors: { green: ['xyz'] } };
const md2 = new MarkdownIt({ html: true });
md2.use(MditExtras.badges);
const o = md2.render('a @{xyz} b @{stable}');
if (o.includes('badge--green">xyz') && !o.includes('badge--green">stable')) pass++;
else { fail++; console.error('FAIL: badgeColors setting override\n  out:  ' + o); }
// config entries match case-insensitively: { yellow: ['WIP'] } colors @{wip}
global.WIKI = { badgeColors: { yellow: ['WIP'] } };
const md3 = new MarkdownIt({ html: true });
md3.use(MditExtras.badges);
const o3 = md3.render('@{wip} @{WIP} @{Wip thing}');
if ((o3.match(/badge--yellow/g) || []).length === 3) pass++;
else { fail++; console.error('FAIL: badgeColors case-insensitive\n  out:  ' + o3); }
console.log('test-render: ' + pass + '/' + (cases.length + 2) + ' passed');
process.exit(fail ? 1 : 0);
