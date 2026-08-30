const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { dialog } = require('electron');
const { sanitizedGitEnvironment } = require('./worktree-manager.cjs');
const git = (cwd, args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true, env: sanitizedGitEnvironment() }).trim();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(check, label, duration = 20000) { const deadline = Date.now() + duration; while (Date.now() < deadline) { if (await check()) return; await delay(250); } throw new Error(`Handoff smoke timeout: ${label}`); }
async function prepareHandoffFixture(workspace) {
  git(workspace, ['init', '--initial-branch=main']); git(workspace, ['config', 'user.name', 'DSH smoke']); git(workspace, ['config', 'user.email', 'smoke@example.invalid']); git(workspace, ['config', 'core.autocrlf', 'false']);
  await fsp.writeFile(path.join(workspace, 'data.txt'), 'baseline\n'); git(workspace, ['add', 'data.txt']); git(workspace, ['commit', '-m', 'handoff fixture']);
  await fsp.writeFile(path.join(workspace, 'data.txt'), 'staged\n'); git(workspace, ['add', 'data.txt']); await fsp.appendFile(path.join(workspace, 'data.txt'), 'unstaged\n');
  await fsp.writeFile(path.join(workspace, 'new.txt'), 'untracked\n');
}
async function runHandoffSmoke({ window, dock, supervisor, selected, workspacePath, version, target, origin, api, realModel, mount }) {
  const checks = {}, originalDialog = dialog.showMessageBox, control = (op, payload) => supervisor.credentialHost.sessionControl.request(op, payload);
  const wc = window.webContents, evaluate = (code) => wc.executeJavaScript(code, true);
  let confirmations = 0;
  dialog.showMessageBox = async (...args) => {
    if (['交接到独立工作树', '返回原目录继续'].includes(args.at(-1)?.title)) { confirmations++; return { response: 1 }; }
    return originalDialog(...args);
  };
  try {
    const sessionContext = { workspacePath, sessionId: selected.sessionId };
    const before = await control('inspect', sessionContext), marker = `DSH_HANDOFF_${randomBytes(8).toString('hex')}`;
    if (realModel) {
      const receipt = await api(origin, 'session.prompt', { sessionId: selected.sessionId, mode: 'queue', content: [{ type: 'text', text: `本次会话验收标记为 ${marker}。请记住，只回复收到，不调用工具。` }] });
      if (!receipt.accepted) throw new Error('Model source turn was not accepted');
      await waitFor(async () => { const row = await control('inspect', sessionContext); return row.eventCount > before.eventCount && !row.running && !row.pending && !row.turnOpen; }, 'source model turn', 240000);
    }
    await waitFor(() => evaluate('window.__DSH_CONTINUITY__?.ready()'), 'draft initialized');
    await evaluate('window.__DSH_COMPOSER_TEXT__.append(window.__DSH_COMPOSER_TEXT__.current(), "交接验收草稿，不要发送。")');
    await evaluate('document.querySelector(".dsh-document-actions button").click()');
    await waitFor(() => evaluate('document.querySelectorAll(".dsh-document-chip").length === 1 && !window.__DSH_DOCUMENT_INTAKE__.isPending()'), 'document attachment');
    await evaluate('window.__DSH_CONTINUITY__.flush()'); const draft = await evaluate('window.__DSH_COMPOSER_TEXT__.read()');
    const index = git(workspacePath, ['write-tree']), status = git(workspacePath, ['status', '--porcelain']), childPid = supervisor.child.pid;
    await dock.act('select', 'worktrees'); const surface = dock.surfaces.get('worktrees');
    const run = async () => {
      await waitFor(() => surface.webContents.executeJavaScript('worktreesAPI.getState().then(s=>s.handoffAvailable)', true), 'authoritative idle gate');
      return surface.webContents.executeJavaScript('worktreesAPI.handoff()', true);
    };
    const out = await run(); if (!out.ok) throw new Error(out.message);
    await mount(); await waitFor(() => evaluate('window.__DSH_CONTINUITY__?.ready()'), 'target draft');
    checks.outward = out.sessionId !== selected.sessionId && out.workspacePath !== workspacePath;
    checks.harnessProcessSurvived = supervisor.child.pid === childPid;
    checks.draftAndReference = await evaluate('window.__DSH_COMPOSER_TEXT__.read()') === draft;
    checks.codeAndIndex = git(out.workspacePath, ['write-tree']) === index && git(out.workspacePath, ['status', '--porcelain']) === status;
    checks.originalUntouched = git(workspacePath, ['status', '--porcelain']) === status;
    if (realModel) {
      await evaluate('window.__DSH_COMPOSER_TEXT__.remove(window.__DSH_COMPOSER_TEXT__.current(), window.__DSH_COMPOSER_TEXT__.read())'); await evaluate('window.__DSH_CONTINUITY__.flush()');
      const receipt = await api(origin, 'session.prompt', { sessionId: out.sessionId, mode: 'queue', content: [{ type: 'text', text: '前面对话里本次验收的 DSH_HANDOFF_ 标记是什么？仅把完整标记写入当前工作区 handed-result.txt。不读取其他文件，不安装依赖，不访问网络，不能猜测。' }] });
      if (!receipt.accepted) throw new Error('Forked model resume rejected');
      await waitFor(async () => { const text = await fsp.readFile(path.join(out.workspacePath, 'handed-result.txt'), 'utf8').catch(() => ''); const row = await control('inspect', { workspacePath: out.workspacePath, sessionId: out.sessionId }); return text.trim() === marker && !row.running && !row.pending && !row.turnOpen; }, 'model retained history in target cwd', 240000);
      checks.realModelHistoryAndCwd = true;
    }
    await fsp.appendFile(path.join(workspacePath, 'data.txt'), 'external change\n');
    const denied = await run(); checks.conflictingReturnDenied = !denied.ok && denied.message.includes('原目录已产生');
    await fsp.writeFile(path.join(workspacePath, 'data.txt'), 'staged\nunstaged\n');
    await fsp.appendFile(path.join(out.workspacePath, 'data.txt'), 'child work\n');
    const back = await run(); if (!back.ok) throw new Error(back.message);
    checks.returned = back.workspacePath === workspacePath && back.sessionId !== selected.sessionId;
    checks.returnCodeAndIndex = (await fsp.readFile(path.join(workspacePath, 'data.txt'), 'utf8')).includes('child work') && git(workspacePath, ['write-tree']) === index;
    checks.worktreeRetained = (await fsp.stat(out.workspacePath)).isDirectory();
    checks.nativeConfirmations = confirmations === 3;
    const state = await surface.webContents.executeJavaScript('worktreesAPI.getState()', true);
    checks.recoveryRecords = state.handoffs.length === 2 && state.handoffs.some((row) => row.phase === 'returned');
    await fsp.writeFile(`${target}.worktrees.png`, (await surface.webContents.capturePage()).toPNG());
    return { ok: Object.values(checks).every(Boolean), version, realModel, checks, evidence: 'real Git, native worktree guarded IPC, Harness public SDK history fork, source-preserving code/index transfer; exact native handoff confirmations approved only by isolated smoke' };
  } finally { dialog.showMessageBox = originalDialog; }
}
module.exports = { prepareHandoffFixture, runHandoffSmoke };
