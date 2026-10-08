'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const test = require('node:test');
const application = require('../package.json');
const binding = require('../runtime/harness/package.json').dshDesktop;
const builderRequire = createRequire(require.resolve('electron-builder/package.json'));
const { getFileMatchers, copyFiles } = builderRequire('app-builder-lib/out/fileMatcher.js');
const projectRoot = path.resolve(__dirname, '..');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const isHarnessMapping = mapping => mapping && typeof mapping === 'object'
  && (mapping.to === 'harness' || mapping.to?.startsWith('harness/'));

async function filesUnder(root, relative = '') {
  const result = [];
  for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) result.push(...await filesUnder(root, name));
    else { assert.ok(entry.isFile()); result.push(name); }
  }
  return result.sort();
}

async function assertHarnessResourceCopy(context, descriptor, manifest) {
  assert.equal(builderRequire('electron-builder/package.json').version, application.devDependencies['electron-builder']);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-harness-mapping-'));
  context.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const from = `vendor/${binding.runtimeDirectory}`;
  const mappings = application.build.extraResources.filter(isHarnessMapping);
  const platformMappings = (application.build.win.extraResources || []).filter(isHarnessMapping);
  assert.ok(mappings.length + platformMappings.length > 0, 'The reviewed Harness must be included in package resources');
  for (const mapping of [...mappings, ...platformMappings]) {
    assert.ok(mapping.from === from || mapping.from.startsWith(`${from}/`), 'Harness source must follow the central runtime binding');
    assert.equal(mapping.to, `harness${mapping.from.slice(from.length)}`, 'Runtime-relative paths must survive the resource mapping');
  }
  const source = path.join(root, from), output = path.join(root, 'out/resources');
  const payload = {
    'node_modules/@deepseek-ai/dsh/package.json': JSON.stringify({ name: '@deepseek-ai/dsh', version: binding.packageVersion }),
    'node_modules/@deepseek-ai/dsh/lib/bin.js': 'export const fixture = "scoped CLI payload";\n',
    'node_modules/direct-package/index.cjs': 'module.exports = "top-level module";\n',
    'node_modules/direct-package/LICENSE': 'fixture package notice\n',
    'node_modules/direct-package/node_modules/nested-package/index.cjs': 'module.exports = "nested module";\n',
    'node_modules/direct-package/node_modules/nested-package/package.json': '{"name":"nested-package","version":"1.0.0"}\n'
  };
  for (const [relative, bytes] of Object.entries(payload)) {
    await fs.mkdir(path.dirname(path.join(source, relative)), { recursive: true });
    await fs.writeFile(path.join(source, relative), bytes);
  }
  await fs.writeFile(path.join(source, binding.descriptor.file), descriptor);
  await fs.writeFile(path.join(source, 'package.json'), manifest);
  const matchers = getFileMatchers({ extraResources: mappings }, 'extraResources', output, {
    defaultSrc: root, globalOutDir: path.join(root, 'out'), macroExpander: value => value,
    customBuildOptions: { extraResources: platformMappings }
  });
  await copyFiles(matchers, undefined, false);
  const packaged = path.join(output, 'harness');
  assert.deepEqual(await fs.readFile(path.join(packaged, binding.descriptor.file)), descriptor, 'Preserve descriptor bytes exactly');
  assert.deepEqual(await fs.readFile(path.join(packaged, 'package.json')), manifest);
  assert.deepEqual(await filesUnder(packaged), [binding.descriptor.file, 'package.json', ...Object.keys(payload)].sort(),
    'electron-builder must not omit the runtime root node_modules or nested dependencies');
  for (const [relative, bytes] of Object.entries(payload)) assert.equal(await fs.readFile(path.join(packaged, relative), 'utf8'), bytes);
}

test('fixed electron-builder copies synthetic Harness metadata and complete node_modules mapping without vendor', async context => {
  // These explicit fixtures test copying semantics even in a source-only checkout.
  const descriptor = Buffer.from(JSON.stringify({ fixture: 'synthetic-copy-only', version: binding.packageVersion }));
  const manifest = Buffer.from(JSON.stringify({ name: 'synthetic-harness-copy-fixture', version: binding.packageVersion, private: true }));
  await assertHarnessResourceCopy(context, descriptor, manifest);
});

test('fixed electron-builder preserves SHA-pinned real Harness metadata bytes when the runtime is deployed', async context => {
  const runtimeRoot = path.join(projectRoot, 'vendor', binding.runtimeDirectory);
  try {
    assert.ok((await fs.stat(runtimeRoot)).isDirectory(), 'The deployed Harness runtime must be a directory');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    context.skip('The deployed Harness runtime is absent; synthetic mapping still runs and full package gates remain required');
    return;
  }
  // A present but incomplete or corrupted runtime must fail, never silently skip.
  const descriptor = await fs.readFile(path.join(runtimeRoot, binding.descriptor.file));
  assert.equal(sha256(descriptor), binding.descriptor.sha256);
  const manifest = await fs.readFile(path.join(runtimeRoot, 'package.json'));
  await assertHarnessResourceCopy(context, descriptor, manifest);
});
