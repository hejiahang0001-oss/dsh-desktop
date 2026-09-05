const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = (p) => fs.readFileSync(p, 'utf8');
test('workspace navigation admits one activation and releases its lock after completion', async () => {
  const main = read('electron/main.cjs');
  const code = main.slice(main.indexOf('const activateWorkspace = async'), main.indexOf('const performWorkspaceActivation = async'));
  const releases = [], calls = [];
  const activate = require('node:vm').runInNewContext(`let workspaceActivationPromise = null; ${code}; activateWorkspace`, {
    appIsClosing: () => false,
    performWorkspaceActivation: async (workspace, session) => { calls.push([workspace, session]); return new Promise((resolve) => releases.push(resolve)); }
  });
  const first = activate('workspace-a', 'session-a');
  assert.equal((await activate('workspace-b', 'session-b')).ok, false); assert.equal(calls.length, 1);
  releases.shift()({ ok: true }); assert.equal((await first).ok, true);
  const next = activate('workspace-b', 'session-b'); assert.equal(calls.length, 2); releases.shift()({ ok: true }); assert.equal((await next).ok, true);
});
test('background task UI is native-only, bounded, text-rendered, accessible and packaged', () => {
  const main = read('electron/main.cjs'), preload = read('electron/tasks-subagents-preload.cjs'), ui = read('assets/background-tasks.js'), html = read('tasks-subagents.html');
  assert.match(main, /tasksSubagentsIpcAllowed\(event\)/); assert.match(preload, /background-action/);
  assert.doesNotMatch(preload, /readFile|writeFile|shell|executeJavaScript/);
  assert.match(ui, /textContent/); assert.doesNotMatch(ui, /innerHTML|eval\(/);
  assert.match(html, /aria-controls="background-task-panel"/); assert.match(html, /maxlength="8000"/);
  assert.match(html, /完全退出后不执行/); assert.match(main, /backgroundScheduleDescription\(input.schedule\)/);
  assert.match(main, /name: '后台任务调度',[\s\S]*backgroundTasks\.stop\(\)/); assert.match(main, /继续后台运行/);
  assert.match(main, /后台记录不能安全加载，已禁用调度/);
  assert.match(main, /if \(workspaceActivationPromise\) return \{ ok: false/);
  assert.match(main, /\['工作区切换', workspaceActivationPromise\]/);
  assert.match(html, /工作树不是内容脱敏/); assert.match(html, /新会话仍可通过桌面凭据桥使用 Key/);
  assert.ok(JSON.parse(read('package.json')).build.files.includes('assets/background-tasks.js'));
});
