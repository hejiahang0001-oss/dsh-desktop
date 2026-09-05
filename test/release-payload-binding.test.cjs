const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  DEFAULT_MEMBERS,
  hashPayloadTree,
  inspectReleasePayloadBinding,
  matchesDefaultMemberPolicy,
  normalizePayloadRelative,
  parseArchiveListing,
  sha256
} = require('../scripts/release-payload-binding.cjs');

const writeFile = (target, bytes) => {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
};

const fakePe = (marker) => {
  const bytes = Buffer.alloc(512);
  bytes.writeUInt16LE(0x5a4d, 0);
  bytes.writeUInt32LE(0x80, 0x3c);
  bytes.writeUInt32LE(0x00004550, 0x80);
  bytes.writeUInt16LE(0x20b, 0x80 + 24);
  bytes.write(marker, 0x180, 'utf8');
  return bytes;
};

const createFixture = (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-release-payload-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const installerPath = path.join(root, 'DSH-Desktop-Setup-1.1.8.exe');
  const portablePath = path.join(root, 'DSH-Desktop-Portable-1.1.8.exe');
  const unpackedRoot = path.join(root, 'win-unpacked');
  const content = new Map([
    [DEFAULT_MEMBERS[0].path, Buffer.from('fixed-app-asar')],
    [DEFAULT_MEMBERS[1].path, Buffer.from('fixed-wiki-basic')]
  ]);
  writeFile(installerPath, fakePe('installer'));
  writeFile(portablePath, fakePe('portable'));
  for (const [relative, bytes] of content) writeFile(path.join(unpackedRoot, ...relative.split('/')), bytes);
  return { root, installerPath, portablePath, unpackedRoot, content };
};

const digest = (bytes) => ({ bytes: bytes.length, sha256: sha256(bytes) });

const matchingOptions = async (fixture) => {
  const tree = await hashPayloadTree(fixture.unpackedRoot);
  return {
    ...fixture,
    expectedVersion: '1.1.8',
    inspectArchiveTree: async () => tree
  };
};

test('release payload binding requires both archives to match the current unpacked payload', async (context) => {
  const fixture = createFixture(context);
  const report = await inspectReleasePayloadBinding({
    ...(await matchingOptions(fixture)),
    extractMember: async (_archive, memberPath) => digest(fixture.content.get(memberPath.replace(/\\/g, '/')))
  });
  assert.equal(report.accepted, true);
  assert.deepEqual(report.archiveIdentity, {
    namesValid: true,
    canonicalPathsDistinct: true,
    fileIdentitiesDistinct: true,
    contentDistinct: true,
    executablesValid: true
  });
  assert.equal(report.payloadTrees.installer.matches, true);
  assert.equal(report.payloadTrees.portable.matches, true);
  assert.equal(report.members.length, 2);
  assert.ok(report.members.every((member) => member.matches));
  assert.deepEqual(report.members.map((member) => member.path), DEFAULT_MEMBERS.map((member) => member.path));
});

test('release payload binding rejects a stale Portable payload', async (context) => {
  const fixture = createFixture(context);
  const report = await inspectReleasePayloadBinding({
    ...(await matchingOptions(fixture)),
    extractMember: async (archive, memberPath) => {
      const bytes = fixture.content.get(memberPath.replace(/\\/g, '/'));
      return digest(path.basename(archive) === path.basename(fixture.portablePath)
        && memberPath.endsWith('app.asar') ? Buffer.from('stale-app-asar') : bytes);
    }
  });
  assert.equal(report.accepted, false);
  assert.equal(report.members[0].installer.matches, undefined);
  assert.equal(report.members[0].portable.sha256, sha256(Buffer.from('stale-app-asar')));
  assert.equal(report.members[0].matches, false);
});

test('release payload binding fails closed when an archive member cannot be extracted', async (context) => {
  const fixture = createFixture(context);
  const report = await inspectReleasePayloadBinding({
    ...(await matchingOptions(fixture)),
    extractMember: async (archive, memberPath) => {
      if (path.basename(archive) === path.basename(fixture.installerPath)
        && memberPath.endsWith('wiki-basic.cjs')) {
        const error = new Error('missing');
        error.code = 'release-member-extraction-failed';
        throw error;
      }
      return digest(fixture.content.get(memberPath.replace(/\\/g, '/')));
    }
  });
  assert.equal(report.accepted, false);
  assert.deepEqual(report.members[1].installer, {
    ok: false,
    code: 'release-member-extraction-failed'
  });
});

test('release payload binding cannot replace the fixed member policy with an equally sized list', async (context) => {
  const fixture = createFixture(context);
  const substituted = DEFAULT_MEMBERS.map((member, index) => ({
    ...member,
    path: index === 0 ? 'resources/other.asar' : member.path
  }));
  writeFile(path.join(fixture.unpackedRoot, 'resources', 'other.asar'), 'fixed-app-asar');
  const report = await inspectReleasePayloadBinding({
    ...(await matchingOptions(fixture)),
    members: substituted,
    extractMember: async (_archive, memberPath) => {
      const normalized = memberPath.replace(/\\/g, '/');
      return digest(normalized === 'resources/other.asar'
        ? Buffer.from('fixed-app-asar') : fixture.content.get(normalized));
    }
  });
  assert.equal(matchesDefaultMemberPolicy(substituted), false);
  assert.equal(report.accepted, false);
  assert.ok(report.members.every((member) => member.matches));
});

test('release payload binding rejects stale extra resources even when its sampled members match', async (context) => {
  const fixture = createFixture(context);
  writeFile(path.join(fixture.unpackedRoot, 'resources', 'legal', 'LICENSE.txt'), 'current-license');
  const reference = await hashPayloadTree(fixture.unpackedRoot);
  const staleRecords = reference.records.map((record) => record.path === 'resources/legal/LICENSE.txt'
    ? { ...record, bytes: Buffer.byteLength('old-license'), sha256: sha256(Buffer.from('old-license')) }
    : record);
  const staleTree = {
    files: staleRecords.length,
    bytes: staleRecords.reduce((sum, record) => sum + record.bytes, 0),
    treeSha256: '0'.repeat(64),
    records: staleRecords
  };
  const report = await inspectReleasePayloadBinding({
    ...fixture,
    expectedVersion: '1.1.8',
    inspectArchiveTree: async (archive) => path.basename(archive) === path.basename(fixture.portablePath) ? staleTree : reference,
    extractMember: async (_archive, memberPath) => digest(fixture.content.get(memberPath.replace(/\\/g, '/')))
  });
  assert.equal(report.accepted, false);
  assert.equal(report.members.every((member) => member.matches), true);
  assert.equal(report.payloadTrees.installer.matches, true);
  assert.equal(report.payloadTrees.portable.matches, false);
  assert.deepEqual(report.payloadTrees.portable.mismatched, ['resources/legal/LICENSE.txt']);
});

test('release payload binding rejects one archive copied under the other package name', async (context) => {
  const fixture = createFixture(context);
  writeFile(fixture.portablePath, fs.readFileSync(fixture.installerPath));
  const report = await inspectReleasePayloadBinding({
    ...(await matchingOptions(fixture)),
    extractMember: async (_archive, memberPath) => digest(fixture.content.get(memberPath.replace(/\\/g, '/')))
  });
  assert.equal(report.accepted, false);
  assert.equal(report.archiveIdentity.contentDistinct, false);
});

test('release payload binding rejects a non-PE Portable wrapper', async (context) => {
  const fixture = createFixture(context);
  writeFile(fixture.portablePath, 'ordinary 7z bytes');
  const report = await inspectReleasePayloadBinding({
    ...(await matchingOptions(fixture)),
    extractMember: async (_archive, memberPath) => digest(fixture.content.get(memberPath.replace(/\\/g, '/')))
  });
  assert.equal(report.accepted, false);
  assert.equal(report.archives.portable.looksLikePe, false);
  assert.equal(report.archiveIdentity.executablesValid, false);
});

test('release payload binding requires exact Setup and Portable names for the source version', async (context) => {
  const fixture = createFixture(context);
  const renamed = path.join(fixture.root, 'portable-copy.exe');
  fs.renameSync(fixture.portablePath, renamed);
  fixture.portablePath = renamed;
  const report = await inspectReleasePayloadBinding({
    ...(await matchingOptions(fixture)),
    extractMember: async (_archive, memberPath) => digest(fixture.content.get(memberPath.replace(/\\/g, '/')))
  });
  assert.equal(report.accepted, false);
  assert.equal(report.archiveIdentity.namesValid, false);
});

test('payload tree hashing includes legitimate empty files and archive listing keeps them bounded', async (context) => {
  const fixture = createFixture(context);
  writeFile(path.join(fixture.unpackedRoot, 'resources', 'empty.marker'), Buffer.alloc(0));
  const tree = await hashPayloadTree(fixture.unpackedRoot);
  const empty = tree.records.find((record) => record.path === 'resources/empty.marker');
  assert.deepEqual(empty, {
    path: 'resources/empty.marker',
    bytes: 0,
    sha256: sha256(Buffer.alloc(0))
  });
  const listing = parseArchiveListing(Buffer.from([
    'Path = resources\\empty.marker',
    'Size = 0',
    'Attributes = A',
    'Encrypted = -',
    ''
  ].join('\r\n'), 'utf8'));
  assert.deepEqual(listing.records, [{ path: 'resources/empty.marker', bytes: 0 }]);
});

test('archive listing rejects Windows aliases, alternate streams, controls, and reserved devices', () => {
  for (const unsafe of [
    'resources/x.',
    'resources/x ',
    'resources/x:stream',
    'resources/x?.txt',
    'resources/x*.txt',
    'resources/x|pipe.txt',
    'resources/x<in>.txt',
    'resources/x"quote.txt',
    'resources/CON.txt',
    'resources/com1.log',
    'resources/control\u0001.txt',
    '../resources/app.asar'
  ]) {
    assert.throws(() => normalizePayloadRelative(unsafe), (error) => error.code === 'unsafe-release-payload-path');
  }
  const duplicate = (left, right) => Buffer.from([
    `Path = ${left}`,
    'Size = 1',
    'Attributes = A',
    'Encrypted = -',
    '',
    `Path = ${right}`,
    'Size = 1',
    'Attributes = A',
    'Encrypted = -',
    ''
  ].join('\r\n'), 'utf8');
  assert.throws(
    () => parseArchiveListing(duplicate('resources\\Name.txt', 'resources\\name.txt')),
    (error) => error.code === 'duplicate-release-payload-path'
  );
  assert.throws(
    () => parseArchiveListing(duplicate('resources\\\u00e9.txt', 'resources\\e\u0301.txt')),
    (error) => error.code === 'duplicate-release-payload-path'
  );
});

test('release payload binding rejects an archive replaced during verification', async (context) => {
  const fixture = createFixture(context);
  const options = await matchingOptions(fixture);
  let calls = 0;
  const report = await inspectReleasePayloadBinding({
    ...options,
    extractMember: async (_archive, memberPath) => {
      calls += 1;
      if (calls === DEFAULT_MEMBERS.length * 2) fs.appendFileSync(fixture.portablePath, 'changed');
      return digest(fixture.content.get(memberPath.replace(/\\/g, '/')));
    }
  });
  assert.equal(report.accepted, false);
  assert.equal(report.stability.portable.ok, true);
  assert.equal(report.stability.portable.stable, false);
});

test('release payload binding rejects an unpacked tree changed during verification', async (context) => {
  const fixture = createFixture(context);
  const reference = await hashPayloadTree(fixture.unpackedRoot);
  let calls = 0;
  const report = await inspectReleasePayloadBinding({
    ...fixture,
    expectedVersion: '1.1.8',
    inspectArchiveTree: async () => {
      calls += 1;
      if (calls === 2) writeFile(path.join(fixture.unpackedRoot, 'resources', 'late-change.txt'), 'changed');
      return reference;
    },
    extractMember: async (_archive, memberPath) => digest(fixture.content.get(memberPath.replace(/\\/g, '/')))
  });
  assert.equal(report.accepted, false);
  assert.equal(report.stability.unpacked.ok, true);
  assert.equal(report.stability.unpacked.stable, false);
});
