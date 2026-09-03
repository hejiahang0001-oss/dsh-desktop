const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('the current release preserves the trusted PowerPoint skill and fixed offline tool', () => {
  const manifest = JSON.parse(read('package.json'));
  assert.ok(manifest.build.extraResources.some((entry) => entry.from === 'resources/skills' && entry.to === 'skills'));
  const skill = read('resources/skills/powerpoint-pptx/SKILL.md');
  assert.match(skill, /^---\nname: powerpoint-pptx\n/m);
  assert.match(skill, /user-invocable: true/);
  assert.match(skill, /DSH_DESKTOP_PPTX_TOOL/);
  assert.match(skill, /speaker notes/i);
  assert.equal(fs.existsSync(path.join(root, 'resources/skills/powerpoint-pptx/scripts/powerpoint-pptx.cjs')), true);
});

test('PowerPoint capability is visible in the native Tools menu and command palette', () => {
  const main = read('electron/main.cjs');
  const commands = read('assets/workbench-command.js');
  assert.match(main, /label: '创建或修改 PowerPoint 演示文稿…'/);
  assert.match(main, /PowerPoint：内置 \/powerpoint-pptx · 可编辑对象与严格检查/);
  assert.match(commands, /id: 'powerpoint-pptx\.invoke'/);
  assert.match(commands, /invokePowerPoint: \(\) => invokeSkill\('powerpoint-pptx'\)/);
});

test('Harness receives only the desktop-owned absolute PowerPoint runtime path', () => {
  const supervisor = read('electron/harness-supervisor.cjs');
  assert.match(supervisor, /SOFTWARE_MANAGED_RUNTIME = new Set\(\['DSH_BUNDLED_SKILL_DIR', 'DSH_DESKTOP_DOCX_TOOL', 'DSH_DESKTOP_XLSX_TOOL', 'DSH_DESKTOP_PPTX_TOOL', 'DSH_DESKTOP_WIKI_TOOL', 'DSH_DESKTOP_WIKI_CONFIG', 'DSH_DESKTOP_WIKI_HISTORY_SOURCE', 'DSH_DESKTOP_NODE', 'DSH_DESKTOP_DSH_BIN', 'DSH_DESKTOP_PATCH'\]\)/);
  assert.match(supervisor, /path\.join\(bundledSkillDir, 'powerpoint-pptx', 'scripts', 'powerpoint-pptx\.cjs'\)/);
  assert.match(supervisor, /environment\.DSH_DESKTOP_PPTX_TOOL = pptxToolPath/);
  assert.match(supervisor, /BUNDLED_POWERPOINT_SKILL_MISSING/);
});
