const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { OFFICE_SKILLS, inspectOfficeCenter, isOfficeSkillId } = require('../electron/office-center.cjs');

const createFixture = async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-office-center-'));
  for (const item of OFFICE_SKILLS) {
    const skill = path.join(root, 'resources', 'skills', item.skill);
    await fsp.mkdir(path.join(skill, 'scripts'), { recursive: true });
    await fsp.writeFile(path.join(skill, 'SKILL.md'), `name: ${item.skill}\n`);
    await fsp.writeFile(path.join(skill, 'scripts', item.tool), 'module.exports = {};\n');
  }
  return root;
};

test('Office center reports exactly three fixed editable delivery skills', async (t) => {
  const root = await createFixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const state = await inspectOfficeCenter({
    rootDir: root,
    resourcesPath: root,
    isPackaged: false,
    harnessReady: true,
    workspaceSynced: true,
    workspaceName: 'Finance <script>'
  });
  assert.equal(state.available, true);
  assert.equal(state.readyCount, 3);
  assert.deepEqual(state.office.map((item) => item.skill), ['word-docx', 'excel-xlsx', 'powerpoint-pptx']);
  assert.deepEqual(state.office.map((item) => item.extension), ['.docx', '.xlsx', '.pptx']);
  assert.equal(state.workspace.name, 'Finance <script>');
  assert.equal(state.integrations.length, 3);
});

test('Office center exposes only a validated current application version', async (t) => {
  const root = await createFixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const state = await inspectOfficeCenter({ rootDir: root, resourcesPath: root, appVersion: '1.0.1' });
  assert.equal(state.appVersion, '1.0.1');
  const invalid = await inspectOfficeCenter({ rootDir: root, resourcesPath: root, appVersion: '<script>' });
  assert.equal(invalid.appVersion, '');
});

test('Office center fails closed when a fixed tool is missing or linked', async (t) => {
  const root = await createFixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  await fsp.rm(path.join(root, 'resources', 'skills', 'excel-xlsx', 'scripts', 'excel-xlsx.cjs'));
  const missing = await inspectOfficeCenter({ rootDir: root, resourcesPath: root, isPackaged: false });
  assert.equal(missing.available, false);
  assert.equal(missing.readyCount, 2);
  assert.equal(missing.office.find((item) => item.id === 'excel').status, 'missing');

  const linkedRoot = await createFixture();
  t.after(() => fs.rmSync(linkedRoot, { recursive: true, force: true }));
  const external = path.join(linkedRoot, 'external-word');
  const skill = path.join(linkedRoot, 'resources', 'skills', 'word-docx');
  await fsp.rename(skill, external);
  await fsp.symlink(external, skill, process.platform === 'win32' ? 'junction' : 'dir');
  const linked = await inspectOfficeCenter({ rootDir: linkedRoot, resourcesPath: linkedRoot, isPackaged: false });
  assert.equal(linked.available, false);
  assert.equal(linked.office.find((item) => item.id === 'word').status, 'missing');
});

test('Office center accepts no arbitrary skill identifier', () => {
  assert.equal(isOfficeSkillId('word'), true);
  assert.equal(isOfficeSkillId('excel'), true);
  assert.equal(isOfficeSkillId('powerpoint'), true);
  assert.equal(isOfficeSkillId('word-docx'), false);
  assert.equal(isOfficeSkillId('../shell'), false);
});
