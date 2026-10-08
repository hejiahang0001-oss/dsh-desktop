const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { collectPackageLicenses, verifyPdfNotices } = require('../scripts/generate-third-party-licenses.cjs');

const fixture = (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-license-inventory-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
};
const writeManifest = (root, relative, manifest) => {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(manifest));
  return { path: relative };
};

test('license inventory follows descriptor manifests including nested versions and deduplicates identities', (context) => {
  const root = fixture(context);
  const descriptor = { files: [
    writeManifest(root, 'node_modules/@deepseek-ai/dsh/package.json', { name: '@deepseek-ai/dsh', version: '0.2.1-alpha.1', license: 'MIT' }),
    writeManifest(root, 'node_modules/dep/package.json', { name: 'dep', version: '2.0.0', license: 'Apache-2.0' }),
    writeManifest(root, 'node_modules/@deepseek-ai/dsh/node_modules/dep/package.json', { name: 'dep', version: '1.0.0', license: 'MIT' }),
    writeManifest(root, 'node_modules/parent/node_modules/dep/package.json', { name: 'dep', version: '1.0.0', license: 'MIT' })
  ] };
  assert.deepEqual(collectPackageLicenses(root, descriptor).map(({ name, version }) => `${name}@${version}`), [
    'dep@2.0.0', '@deepseek-ai/dsh@0.2.1-alpha.1', 'dep@1.0.0'
  ]);
});

test('license inventory rejects absent licenses, conflicting identities, traversal and links', (context) => {
  const root = fixture(context);
  const relative = 'node_modules/dep/package.json';
  const descriptor = { files: [writeManifest(root, relative, { name: 'dep', version: '1.0.0' })] };
  assert.throws(() => collectPackageLicenses(root, descriptor), /no declared license/);
  writeManifest(root, relative, { name: 'dep', version: '1.0.0', license: 'MIT' });
  descriptor.files.push(writeManifest(root, 'node_modules/parent/node_modules/dep/package.json', { name: 'dep', version: '1.0.0', license: 'Apache-2.0' }));
  assert.throws(() => collectPackageLicenses(root, descriptor), /Conflicting/);
  assert.throws(() => collectPackageLicenses(root, { files: [{ path: '../node_modules/dep/package.json' }] }), /Unsafe/);
  fs.symlinkSync(path.join(root, 'node_modules/dep'), path.join(root, 'node_modules/linked'), 'junction');
  assert.throws(() => collectPackageLicenses(root, { files: [{ path: 'node_modules/linked/package.json' }] }), /Linked/);
});

test('PDF inventory still requires all ten upstream embedded notices', (context) => {
  const root = fixture(context);
  const file = path.join(root, '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/lib/client.pdf.js');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const notices = ['LICENSE', 'cmaps/LICENSE', 'standard_fonts/LICENSE_FOXIT', 'standard_fonts/LICENSE_LIBERATION',
    'wasm/LICENSE_JBIG2', 'wasm/LICENSE_OPENJPEG', 'wasm/LICENSE_PDFJS_JBIG2', 'wasm/LICENSE_PDFJS_OPENJPEG', 'wasm/LICENSE_PDFJS_QCMS', 'wasm/LICENSE_QCMS'];
  const bundle = `pdfjs-dist@6.3.289\n//! Bundled PDF.js license notices\n${notices.map((notice) => `// ${notice}\n`).join('')}`;
  fs.writeFileSync(file, bundle);
  assert.doesNotThrow(() => verifyPdfNotices(root));
  fs.writeFileSync(file, bundle.replace('// wasm/LICENSE_QCMS\n', ''));
  assert.throws(() => verifyPdfNotices(root), /notices are incomplete/);
});

test('license generation uses the central binding and verifies before writing', () => {
  const source = fs.readFileSync(path.join(__dirname, '../scripts/generate-third-party-licenses.cjs'), 'utf8');
  assert.match(source, /harnessDesktop\.PRODUCT_BINDING/);
  assert.match(source, /verifyHarnessDesktopRuntime\(path\.join\(root, 'vendor', binding\.runtimeDirectory\)\)/);
  assert.match(source, /inspectDesktopOfficeEngine\(harnessModules\)/);
  assert.doesNotMatch(source, /harness-hoisted|Expected 599/);
});
