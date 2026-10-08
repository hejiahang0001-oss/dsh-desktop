const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const test = require('node:test');
const { HARNESS_RUNTIME_DIRECTORY, HARNESS_VERSION, readHarnessDesktopRuntime } = require('../electron/harness-desktop-runtime.cjs');

test('current runtime Node/browser ZIP parsers reject malformed ZIP64 with their actual dependency roles', (t) => {
  const runtimeRoot = path.resolve(__dirname, '../vendor', HARNESS_RUNTIME_DIRECTORY);
  if (!fs.existsSync(runtimeRoot)) {
    t.skip('Run pnpm runtime:deploy for the current product pin; this test never falls back to alpha.2.');
    return;
  }
  const runtime = readHarnessDesktopRuntime(runtimeRoot);
  const consumer = path.join(runtime.nodeModulesPath, '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/package.json');
  const consumerManifest = JSON.parse(fs.readFileSync(consumer));
  assert.equal(consumerManifest.version, HARNESS_VERSION);
  assert.equal(consumerManifest.devDependencies.fflate, '^0.8.3');
  assert.equal(consumerManifest.dependencies.fflate, undefined, 'Office preview embeds its ZIP parser at build time.');
  const runtimeConsumer = path.join(runtime.nodeModulesPath, '@deepseek-ai/dsh-session-log-export/package.json');
  const runtimeConsumerManifest = JSON.parse(fs.readFileSync(runtimeConsumer));
  assert.equal(runtimeConsumerManifest.version, HARNESS_VERSION);
  assert.ok(runtimeConsumerManifest.dependencies.fflate, 'The session exporter is the shipped external ZIP consumer.');
  const load = createRequire(runtimeConsumer);
  assert.equal(load('fflate/package.json').version, '0.8.3');
  // Exercise the installed distributions from the real runtime consumer. This
  // does not substitute for the Office browser worker's separate preview smoke.
  for (const specifier of ['fflate', 'fflate/browser']) {
    const target = load.resolve(specifier);
    const relative = path.relative(runtimeRoot, target).split(path.sep).join('/');
    const expected = runtime.descriptor.files.find(entry => entry.path === relative);
    assert.ok(expected, 'The parser must belong to this product descriptor.');
    assert.equal(createHash('sha256').update(fs.readFileSync(target)).digest('hex'), expected.sha256);
    const output = execFileSync(process.execPath, [path.join(__dirname, 'fixtures/fflate-office-probe.cjs'), target], {
      timeout: 5000, windowsHide: true, encoding: 'utf8'
    });
    assert.match(output, /ZIP64 rejected; Chinese ZIP round-trip passed/);
  }
});
