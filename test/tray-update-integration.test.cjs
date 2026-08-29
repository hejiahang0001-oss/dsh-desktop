const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('tray supervision uses fixed native surfaces and is packaged', () => {
  assert.match(main, /\bTray\b/);
  assert.match(main, /\bNotification\b/);
  assert.match(main, /new AgentTransitionTracker/);
  assert.match(main, /--tray-smoke-file=/);
  assert.match(main, /isBackgroundSupervisionRequired\(agentDiagnostics\)/);
  assert.match(main, /Agent 正在等待确认，可从托盘重新打开/);
  assert.ok(manifest.build.files.includes('build/icon.ico'));
});

test('update checking remains manual and automatic installation stays absent', () => {
  assert.match(main, /检查产品 Latest 更新/);
  assert.match(main, /自动下载与安装：关闭（未签名）/);
  assert.match(main, /checkForProductUpdate/);
  assert.match(main, /updatePreferenceStore\.skip/);
  assert.doesNotMatch(main, /autoUpdater/);
  assert.doesNotMatch(main, /quitAndInstall/);
});

test('V0.9 ships installer and user-level portable targets with distinct names', () => {
  const targets = manifest.build.win.target.map((entry) => entry.target);
  assert.deepEqual(targets, ['nsis', 'portable']);
  assert.equal(manifest.build.portable.artifactName, 'DSH-Desktop-Portable-${version}.${ext}');
  assert.equal(manifest.build.portable.requestExecutionLevel, 'user');
  assert.match(manifest.scripts['dist:win'], /--win nsis portable --x64/);
});
