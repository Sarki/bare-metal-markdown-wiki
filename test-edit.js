'use strict';


const grab = require('./test-grab.js');
const api = (0, eval)('(function () { const imgExtRe = /\\.png$/i; let lockOps = Promise.resolve();' + ['fileAt', 'readForEdit', 'saveFile', 'folderStamp', 'lockOf', 'lockAge', 'takeLock', 'dropLock', 'lockQueued'].map(grab).join('\n') +
  '\nreturn { readForEdit: readForEdit, saveFile: saveFile, folderStamp: folderStamp, lockAge: lockAge, takeLock: takeLock, dropLock: dropLock }; })()');

let clock = Date.now(); // real timestamps, so lock ages measured against Date.now() mean something
function fakeFolder(tree) {
  function dir(node) {
    return {
      kind: 'directory',
      async getDirectoryHandle(name) { if (!node[name] || typeof node[name].text === 'string') throw new Error('NotFoundError'); return dir(node[name]); },
      async getFileHandle(name, opts) {
        if (!node[name]) { if (!opts || !opts.create) throw new Error('NotFoundError'); node[name] = page(''); }
        return file(node[name], name);
      },
      async removeEntry(name) { if (!node[name]) throw new Error('NotFoundError'); delete node[name]; },
      async *values() { for (const k of Object.keys(node)) { if (!node[k]) continue; yield typeof node[k].text === 'string' ? file(node[k], k) : Object.assign(dir(node[k]), { name: k }); } }
    };
  }
  function file(f, name) {
    return {
      kind: 'file', name: name,
      async getFile() { return { lastModified: f.modified, text: async function () { return f.text; } }; },
      async createWritable() { let buf = ''; return { write: async function (s) { buf += s; }, close: async function () { f.text = buf; f.modified = ++clock; } }; }
    };
  }
  return dir(tree);
}
function page(text) { return { text: text, modified: ++clock }; }

const tests = [];
function test(name, fn) { tests.push([name, fn]); }
function eq(got, want, what) { if (got !== want) throw new Error(what + ': expected ' + JSON.stringify(want) + ', got ' + JSON.stringify(got)); }

test('saves an edit into a subfolder file', async function () {
  const tree = { Guides: { 'Basics.md': page('old') } };
  const root = fakeFolder(tree);
  const opened = await api.readForEdit(root, 'Guides/Basics.md');
  eq(opened.text, 'old', 'opened text');
  const r = await api.saveFile(root, 'Guides/Basics.md', 'new text', opened.version);
  eq(r.ok, true, 'saved');
  eq(tree.Guides['Basics.md'].text, 'new text', 'file on disk');
});

test('refuses to save over a file someone else changed meanwhile', async function () {
  const tree = { 'Home.md': page('v1') };
  const root = fakeFolder(tree);
  const opened = await api.readForEdit(root, 'Home.md');
  tree['Home.md'] = page('their edit');
  const r = await api.saveFile(root, 'Home.md', 'my edit', opened.version);
  eq(r.ok, false, 'saved');
  eq(tree['Home.md'].text, 'their edit', 'file on disk');
});

test('refuses to save when the content changed but the timestamp did not', async function () {
  const tree = { 'Home.md': page('v1') };
  const root = fakeFolder(tree);
  const opened = await api.readForEdit(root, 'Home.md');
  tree['Home.md'].text = 'their edit';
  const r = await api.saveFile(root, 'Home.md', 'my edit', opened.version);
  eq(r.ok, false, 'saved');
  eq(tree['Home.md'].text, 'their edit', 'file on disk');
});

test('a second save after the first one is not a conflict', async function () {
  const tree = { 'Home.md': page('v1') };
  const root = fakeFolder(tree);
  const opened = await api.readForEdit(root, 'Home.md');
  const first = await api.saveFile(root, 'Home.md', 'v2', opened.version);
  const second = await api.saveFile(root, 'Home.md', 'v3', first.version);
  eq(second.ok, true, 'second save');
  eq(tree['Home.md'].text, 'v3', 'file on disk');
});

test('keeps Windows line endings of a CRLF file', async function () {
  const tree = { 'Home.md': page('a\r\nb\r\n') };
  const root = fakeFolder(tree);
  const opened = await api.readForEdit(root, 'Home.md');
  eq(opened.text, 'a\nb\n', 'text shown in the editor');
  await api.saveFile(root, 'Home.md', 'a\nb\nc\n', opened.version);
  eq(tree['Home.md'].text, 'a\r\nb\r\nc\r\n', 'file on disk');
});

test('keeps Unix line endings of an LF file', async function () {
  const tree = { 'Home.md': page('a\nb\n') };
  const root = fakeFolder(tree);
  const opened = await api.readForEdit(root, 'Home.md');
  await api.saveFile(root, 'Home.md', 'a\nb\nc\n', opened.version);
  eq(tree['Home.md'].text, 'a\nb\nc\n', 'file on disk');
});

test('folder stamp changes when a page is edited', async function () {
  const tree = { Guides: { 'Basics.md': page('x') }, 'Home.md': page('y') };
  const root = fakeFolder(tree);
  const before = await api.folderStamp(root);
  eq(await api.folderStamp(root), before, 'stamp with nothing changed');
  tree.Guides['Basics.md'] = page('x2');
  if (await api.folderStamp(root) === before) throw new Error('stamp did not change after an edit');
});

test('folder stamp changes when a page is added or removed', async function () {
  const tree = { 'Home.md': page('y') };
  const root = fakeFolder(tree);
  const before = await api.folderStamp(root);
  tree['New.md'] = page('n');
  const added = await api.folderStamp(root);
  if (added === before) throw new Error('stamp did not change after adding a page');
  delete tree['New.md'];
  eq(await api.folderStamp(root), before, 'stamp after removing the page again');
});

test('folder stamp ignores the browser temp files and lock files written beside a page', async function () {
  const tree = { 'Home.md': page('y') };
  const root = fakeFolder(tree);
  const before = await api.folderStamp(root);
  tree['Home.md.crswap'] = page('partial');
  tree['Home.md.lock'] = page('');
  eq(await api.folderStamp(root), before, 'stamp with a .crswap and a .lock file present');
});

test('a fresh lock says the page is taken, a dropped one says it is free', async function () {
  const tree = { Guides: { 'Basics.md': page('x') } };
  const root = fakeFolder(tree);
  eq(await api.lockAge(root, 'Guides/Basics.md'), null, 'a page nobody edits');
  await api.takeLock(root, 'Guides/Basics.md');
  const age = await api.lockAge(root, 'Guides/Basics.md');
  if (age === null) throw new Error('the lock file was not found');
  if (age > 20000) throw new Error('a lock written just now reads as ' + age + 'ms old');
  eq(tree.Guides['Basics.md'].text, 'x', 'the page itself is untouched');
  await api.dropLock(root, 'Guides/Basics.md');
  eq(await api.lockAge(root, 'Guides/Basics.md'), null, 'the lock after dropping it');
  eq(Object.keys(tree.Guides).join(','), 'Basics.md', 'the lock file is gone from the folder');
});

test('a lock left by a dead tab is old enough to edit over', async function () {
  const tree = { 'Home.md': page('y') };
  const root = fakeFolder(tree);
  tree['Home.md.lock'] = { text: '', modified: Date.now() - 60000 };
  const age = await api.lockAge(root, 'Home.md');
  if (age === null || age < 20000) throw new Error('a minute-old lock read as ' + age);
});

(async function () {
  let bad = 0;
  for (const [name, fn] of tests) {
    try { await fn(); } catch (e) { bad++; console.log('FAIL: ' + name + '\n  ' + e.message); }
  }
  console.log('test-edit: ' + (tests.length - bad) + '/' + tests.length + ' passed');
  process.exit(bad ? 1 : 0);
})();
