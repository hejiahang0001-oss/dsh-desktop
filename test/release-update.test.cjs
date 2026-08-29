const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  MAX_RELEASE_RESPONSE_BYTES,
  RELEASES_API,
  UpdatePreferenceStore,
  checkForProductUpdate,
  compareVersions,
  parseVersion,
  selectLatestProductRelease
} = require('../electron/release-update.cjs');

const release = (version, extra = {}) => ({
  tag_name: `v${version}`,
  html_url: `https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v${version}`,
  draft: false,
  prerelease: true,
  published_at: '2026-08-30T00:00:00Z',
  ...extra
});

test('semantic versions are bounded and compared numerically', () => {
  assert.equal(parseVersion('v0.9.0').text, '0.9.0');
  assert.equal(parseVersion('01.0.0'), null);
  assert.equal(parseVersion('v1.0.0-beta'), null);
  assert.ok(compareVersions('1.0.0', '0.10.9') > 0);
});

test('latest product release ignores drafts, malformed tags, and foreign URLs', () => {
  const selected = selectLatestProductRelease([
    release('0.8.0'),
    release('1.0.0', { draft: true }),
    release('0.9.0', { html_url: 'https://example.com/release' }),
    release('0.8.1')
  ]);
  assert.equal(selected.version, '0.8.1');
  assert.equal(selected.url, 'https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.8.1');
});

test('manual update check uses only the fixed GitHub endpoint and never downloads', async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify([release('0.9.0'), release('0.8.0')]), {
      status: 200,
      headers: { 'content-length': '400' }
    });
  };
  const result = await checkForProductUpdate({ currentVersion: '0.8.0', fetchImpl });
  assert.equal(request.url, RELEASES_API);
  assert.equal(request.options.method, 'GET');
  assert.equal(result.updateAvailable, true);
  assert.equal(result.release.version, '0.9.0');
  assert.equal(result.automaticDownload, false);
  assert.equal(result.automaticInstall, false);
});

test('update response size and HTTP errors fail closed', async () => {
  await assert.rejects(
    checkForProductUpdate({
      currentVersion: '0.8.0',
      fetchImpl: async () => new Response('[]', { status: 200, headers: { 'content-length': String(MAX_RELEASE_RESPONSE_BYTES + 1) } })
    }),
    /上限/
  );
  await assert.rejects(
    checkForProductUpdate({ currentVersion: '0.8.0', fetchImpl: async () => new Response('{}', { status: 503 }) }),
    /503/
  );
});

test('skipped Latest preference is atomic, bounded, and reversible', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-update-preference-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const filePath = path.join(root, 'update-state.json');
  const store = new UpdatePreferenceStore({ filePath });
  assert.deepEqual(await store.init(), { skippedVersion: '' });
  assert.deepEqual(await store.skip('v0.9.0'), { skippedVersion: '0.9.0' });
  assert.deepEqual(await store.clearSkip(), { skippedVersion: '' });
  await assert.rejects(store.skip('../../bad'), /invalid/i);
});
