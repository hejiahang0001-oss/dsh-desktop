const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('the current release preserves the trusted Excel skill and its fixed offline tool', () => {
  const manifest = JSON.parse(read('package.json'));
  assert.ok(manifest.build.extraResources.some((entry) => entry.from === 'resources/skills' && entry.to === 'skills'));
  const skill = read('resources/skills/excel-xlsx/SKILL.md');
  assert.match(skill, /^---\nname: excel-xlsx\n/m);
  assert.match(skill, /user-invocable: true/);
  assert.match(skill, /DSH_DESKTOP_XLSX_TOOL/);
  assert.match(skill, /formula-error/);
  assert.equal(fs.existsSync(path.join(root, 'resources/skills/excel-xlsx/scripts/excel-xlsx.cjs')), true);
});

test('Excel capability is visible in both the native Tools menu and command palette', () => {
  const main = read('electron/main.cjs');
  const commands = read('assets/workbench-command.js');
  assert.match(main, /label: '创建或修改 Excel 工作簿…'/);
  assert.match(main, /Excel 工作簿：内置 \/excel-xlsx · 公式与勾稽检查/);
  assert.match(commands, /id: 'excel-xlsx\.invoke'/);
  assert.match(commands, /invokeExcel: \(\) => invokeSkill\('excel-xlsx'\)/);
});

test('Harness receives only desktop-owned absolute Excel runtime paths', () => {
  const supervisor = read('electron/harness-supervisor.cjs');
  assert.match(supervisor, /SOFTWARE_MANAGED_RUNTIME = new Set\(\['DSH_BUNDLED_SKILL_DIR', 'DSH_DESKTOP_DOCX_TOOL', 'DSH_DESKTOP_XLSX_TOOL', 'DSH_DESKTOP_PPTX_TOOL', 'DSH_DESKTOP_WIKI_TOOL', 'DSH_DESKTOP_WIKI_CONFIG', 'DSH_DESKTOP_WIKI_HISTORY_SOURCE', 'DSH_DESKTOP_NODE', 'DSH_DESKTOP_DSH_BIN', 'DSH_DESKTOP_PATCH'\]\)/);
  assert.match(supervisor, /path\.join\(bundledSkillDir, 'excel-xlsx', 'scripts', 'excel-xlsx\.cjs'\)/);
  assert.match(supervisor, /environment\.DSH_DESKTOP_XLSX_TOOL = xlsxToolPath/);
});
