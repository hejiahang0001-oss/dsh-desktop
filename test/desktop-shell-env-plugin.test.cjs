'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

test('desktop shell environment plugin forwards only fixed non-secret runtime facts', async () => {
  const moduleUrl = pathToFileURL(path.resolve(__dirname, '..', 'runtime', 'dsh-desktop-shell-env', 'index.mjs')).href;
  const plugin = await import(`${moduleUrl}?test=${Date.now()}`);
  let contributor;
  const ctx = {
    shellEnv: {
      register(value) {
        contributor = value;
        return () => undefined;
      }
    }
  };
  const environment = {
    DSH_CWD: 'C:\\Project',
    DSH_DESKTOP_NODE: 'C:\\App\\runtime\\node.exe',
    DSH_DESKTOP_DOCX_TOOL: 'C:\\App\\skills\\word.cjs',
    DSH_DESKTOP_XLSX_TOOL: 'C:\\App\\skills\\excel.cjs',
    DSH_DESKTOP_PPTX_TOOL: 'C:\\App\\skills\\powerpoint.cjs',
    DSH_DESKTOP_WIKI_TOOL: 'C:\\App\\skills\\wiki.cjs',
    DSH_DESKTOP_WIKI_CONFIG: 'C:\\Data\\wiki-settings.json',
    DSH_DESKTOP_WIKI_HISTORY_SOURCE: 'C:\\Data\\wiki-history-source.json',
    DEEPSEEK_API_KEY: 'must-not-forward',
    DSH_UNREVIEWED_VALUE: 'must-not-forward'
  };
  const values = plugin.resolveDesktopShellEnvironment(environment);
  assert.deepEqual(Object.keys(values).sort(), [
    'DSH_CWD',
    'DSH_DESKTOP_DOCX_TOOL',
    'DSH_DESKTOP_NODE',
    'DSH_DESKTOP_PPTX_TOOL',
    'DSH_DESKTOP_WIKI_CONFIG',
    'DSH_DESKTOP_WIKI_HISTORY_SOURCE',
    'DSH_DESKTOP_WIKI_TOOL',
    'DSH_DESKTOP_XLSX_TOOL'
  ]);
  assert.equal(values.DSH_CWD, 'C:\\Project');
  assert.equal(JSON.stringify(values).includes('must-not-forward'), false);

  plugin.apply(ctx, environment);
  assert.equal(contributor.name, 'dsh-desktop-runtime');
  assert.deepEqual(contributor.resolve({ agent: { session: { header: { id: 'session-a', cwd: 'C:\\Project' } } } }), values);
});

test('desktop shell workspace follows each execution without mutating earlier snapshots or ambient paths', async (t) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const { execFileSync } = require('node:child_process');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-shell-binding-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const a = path.join(root, 'A'), b = path.join(root, 'B');
  fs.mkdirSync(a); fs.mkdirSync(b);
  const plugin = await import(pathToFileURL(path.resolve('runtime/dsh-desktop-shell-env/index.mjs')).href);
  let contributor;
  const environment = Object.fromEntries(['DSH_CWD', 'DSH_DESKTOP_NODE', 'DSH_DESKTOP_DOCX_TOOL',
    'DSH_DESKTOP_XLSX_TOOL', 'DSH_DESKTOP_PPTX_TOOL', 'DSH_DESKTOP_WIKI_TOOL',
    'DSH_DESKTOP_WIKI_CONFIG', 'DSH_DESKTOP_WIKI_HISTORY_SOURCE'].map(key => [key, a]));
  plugin.apply({ shellEnv: { register(value) { contributor = value; } } }, environment);
  const execution = (id, cwd) => ({ agent: { session: { id, header: { id, cwd } } } });
  const first = contributor.resolve(execution('a', a));
  const second = contributor.resolve(execution('b', b));
  assert.equal(second.DSH_CWD, b);
  assert.equal(first.DSH_CWD, a);
  assert.notEqual(first, second);
  assert.equal(Object.isFrozen(second), true);
  assert.equal(contributor.resolve(execution('a', a)).DSH_CWD, a);
  assert.equal(second.DSH_DESKTOP_XLSX_TOOL, a);
  assert.equal(environment.DSH_CWD, a);
  for (const [snapshot, name] of [[second, 'B.txt'], [first, 'A.txt']]) {
    execFileSync(process.execPath, ['-e', 'require("node:fs").writeFileSync(require("node:path").join(process.env.DSH_CWD,process.argv[1]),"marker")', name],
      { env: { ...process.env, ...snapshot }, windowsHide: true });
  }
  assert.deepEqual(fs.readdirSync(a), ['A.txt']);
  assert.deepEqual(fs.readdirSync(b), ['B.txt']);
  for (const invalid of [undefined, {}, { agent: {} }, execution('', b), execution('b', 'relative'),
    execution('b', ''), execution('b', b + '\u0000'), { agent: { session: { id: 'a', header: { id: 'b', cwd: b } } } }]) {
    assert.throws(() => contributor.resolve(invalid), /agent-bound workspace/);
  }
});
