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
  const previous = { ...process.env };
  try {
    Object.assign(process.env, {
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
    });
    plugin.apply(ctx);
    assert.equal(contributor.name, 'dsh-desktop-runtime');
    const values = contributor.resolve({});
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
  } finally {
    for (const name of Object.keys(process.env)) if (!Object.hasOwn(previous, name)) delete process.env[name];
    Object.assign(process.env, previous);
  }
});
