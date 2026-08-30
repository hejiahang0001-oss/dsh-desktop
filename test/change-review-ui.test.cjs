const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('workbench Git review presents trustworthy empty and failure states', () => {
  const source = read('assets/workbench-panel.js');
  assert.match(source, /仓库干净/);
  assert.match(source, /Git 不可用/);
  assert.match(source, /当前目录不是 Git 仓库/);
  assert.match(source, /Git 状态读取失败/);
  assert.match(source, /未将读取失败误判为仓库干净/);
  assert.match(source, /对话、Office、Wiki、文件查看和终端仍可使用/);
  assert.match(source, /empty\.dataset\.state = reviewState/);
  assert.doesNotMatch(source, /暂无 Git 变更/);
});
