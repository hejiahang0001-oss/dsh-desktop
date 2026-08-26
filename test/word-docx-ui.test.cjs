const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('the current release preserves the trusted Word skill and its fixed offline tool', () => {
  const manifest = JSON.parse(read('package.json'));
  assert.ok(manifest.build.extraResources.some((entry) => entry.from === 'resources/skills' && entry.to === 'skills'));
  const skill = read('resources/skills/word-docx/SKILL.md');
  assert.match(skill, /^---\nname: word-docx\n/m);
  assert.match(skill, /user-invocable: true/);
  assert.match(skill, /DSH_DESKTOP_DOCX_TOOL/);
  assert.match(skill, /结构验证已通过，未完成视觉渲染/);
  assert.equal(fs.existsSync(path.join(root, 'resources/skills/word-docx/scripts/word-docx.cjs')), true);
});

test('Word capability is visible in both the native Tools menu and command palette', () => {
  const main = read('electron/main.cjs');
  const commands = read('assets/workbench-command.js');
  assert.match(main, /label: '创建或修改 Word 文档…'/);
  assert.match(main, /Word 文档：内置 \/word-docx · 工作区内离线生成/);
  assert.match(commands, /id: 'word-docx\.invoke'/);
  assert.match(commands, /invokeWord: \(\) => invokeSkill\('word-docx'\)/);
});

test('Harness receives only desktop-owned absolute Word runtime paths', () => {
  const supervisor = read('electron/harness-supervisor.cjs');
  assert.match(supervisor, /SOFTWARE_MANAGED_RUNTIME = new Set\(\['DSH_BUNDLED_SKILL_DIR', 'DSH_DESKTOP_DOCX_TOOL', 'DSH_DESKTOP_XLSX_TOOL', 'DSH_DESKTOP_PPTX_TOOL', 'DSH_DESKTOP_NODE'\]\)/);
  assert.match(supervisor, /environment\.DSH_BUNDLED_SKILL_DIR = bundledSkillDir/);
  assert.match(supervisor, /environment\.DSH_DESKTOP_DOCX_TOOL = docxToolPath/);
  assert.match(supervisor, /environment\.DSH_DESKTOP_NODE = nodePath/);
});
