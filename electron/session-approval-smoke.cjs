'use strict';
// Test-only, fixture-scoped official Ask UI acceptance. Never changes permission presets.
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { officialActionExpression, promptTurn } = require('./session-workflow-contract.cjs');
const generated = new WeakSet();
const within = (parent, file) => { const rel = path.relative(parent, file); return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel); };
const quote = value => `'${value.replaceAll("'", "''")}'`;
const fixtureCommand = fixture => `Set-Content -LiteralPath ${quote(fixture.file)} -Value ${quote(fixture.marker)} -NoNewline -Encoding utf8`;

async function createApprovalFixture(target, workspacePath) {
  assert.ok(path.isAbsolute(target) && path.isAbsolute(workspacePath), 'approval paths must be absolute');
  const root = `${path.resolve(target)}.user-data`;
  workspacePath = path.resolve(workspacePath);
  assert.ok(within(root, workspacePath), 'approval workspace must belong to this isolated smoke profile');
  for (let item = workspacePath; ; item = path.dirname(item)) {
    const stat = await fsp.lstat(item);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), 'approval profile must not contain a directory link');
    if (item === root) break;
  }
  const directory = await fsp.mkdtemp(path.join(root, 'approval-fixture-'));
  assert.ok(!within(workspacePath, directory), 'approval fixture must be a sibling outside the workspace');
  const id = randomUUID(), marker = `DSH_ASK_${id.replaceAll('-', '')}`;
  const identity = async file => { const stat = await fsp.lstat(file); return Object.freeze({ dev: stat.dev, ino: stat.ino }); };
  const fields = { root, workspacePath, directory, id, marker, file: path.join(directory, `${id}.txt`),
    identities: Object.freeze({ root: await identity(root), directory: await identity(directory) }) };
  const fixture = Object.freeze({ ...fields, command: fixtureCommand(fields) });
  generated.add(fixture);
  return fixture;
}

async function validateApprovalFixture(fixture) {
  assert.ok(generated.has(fixture), 'approval fixture was not minted in this run');
  assert.match(fixture.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(fixture.marker, `DSH_ASK_${fixture.id.replaceAll('-', '')}`);
  assert.equal(fixture.command, fixtureCommand(fixture));
  assert.equal(path.dirname(fixture.directory), fixture.root);
  assert.ok(path.basename(fixture.directory).startsWith('approval-fixture-'));
  assert.equal(fixture.file, path.join(fixture.directory, `${fixture.id}.txt`));
  assert.ok(!within(fixture.workspacePath, fixture.directory));
  for (const [key, directory] of [['root', fixture.root], ['directory', fixture.directory]]) {
    const stat = await fsp.lstat(directory);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), 'approval fixture identity changed');
    assert.equal(stat.dev, fixture.identities[key].dev, 'approval fixture identity changed');
    assert.equal(stat.ino, fixture.identities[key].ino, 'approval fixture identity changed');
  }
  assert.equal(await fsp.lstat(fixture.file).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; }), false, 'approval target must still be absent');
}

const matchingApproval = (events, requestId, fixture) => {
  const accepted = events.find(event => event.type === 'user/message' && event.data.source?.rpcId === requestId);
  if (!accepted) return null;
  for (const asked of events.filter(event => event.seq > accepted.seq && event.type === 'approval/asked')) {
    const call = events.find(event => event.type === 'tool/call' && event.seq > accepted.seq && event.seq < asked.seq && event.data.callId === asked.data.callId);
    if (call?.data.name !== 'pwsh' || asked.data.toolName !== 'pwsh') continue;
    let args; try { args = JSON.parse(call.data.arguments); } catch { continue; }
    if (args.command !== fixture.command || args.sandbox_permissions !== 'danger-full-access'
      || args.run_in_background === true || (args.workdir !== undefined && path.resolve(args.workdir) !== fixture.workspacePath)
      || !String(args.justification || '').includes(fixture.marker)) continue;
    const decided = events.find(event => event.type === 'approval/decided' && event.data.id === asked.data.id);
    return { id: asked.data.id, callId: asked.data.callId, outcome: decided?.data.outcome || null };
  }
  return null;
};

const approvalGateResult = ({ denied, allowed, allowOneFixtureApprovalExplicitlyAuthorized }) => ({
  ok: denied === true && allowed === true && allowOneFixtureApprovalExplicitlyAuthorized === true,
  status: allowOneFixtureApprovalExplicitlyAuthorized === true ? (denied && allowed ? 'passed' : 'failed') : 'pending-authorization',
  rejectedFixtureVerified: denied === true,
  allowedOnceFixtureVerified: allowed === true,
  allowOneFixtureApprovalExplicitlyAuthorized: allowOneFixtureApprovalExplicitlyAuthorized === true
});

async function runApprovalSmoke({ window, selected, workspacePath, version, target, origin, api, evaluate, wait, inspect, history, onboarding,
  allowOneFixtureApprovalExplicitlyAuthorized = false }) {
  const assertPreset = async () => {
    const snapshot = await api(origin, 'session.history', { sessionId: selected.sessionId, maxMessages: 1 });
    assert.equal(snapshot.projections?.values?.permissions?.currentValue, 'workspace-write', 'Ask smoke will not change the default permission preset');
  };
  await assertPreset();
  const cases = [];
  const exercise = async allow => {
    if (allow && allowOneFixtureApprovalExplicitlyAuthorized !== true) throw new Error('One-time approval lacks explicit human authorization.');
    const fixture = await createApprovalFixture(target, workspacePath);
    await validateApprovalFixture(fixture);
    const requestId = randomUUID();
    const prompt = `这是隔离审批验收，只操作刚生成的测试目录。请调用一次 pwsh 工具，command 必须逐字为：\n${fixture.command}\n`
      + `sandbox_permissions 为 danger-full-access（仅这条命令一次性请求，不更改会话权限），justification 必须包含 ${fixture.marker}。`
      + '不要先用其他命令，不读取任何文件，不提权管理员，不安装、不联网。如果被拒绝，直接报告拒绝并结束，绝不换方式或重试。如果获准，等待该命令完成再结束。';
    const receipt = await api(origin, 'session.prompt', { sessionId: selected.sessionId, requestId, mode: 'queue', content: [{ type: 'text', text: prompt }] });
    if (!receipt.accepted) throw new Error('Approval fixture prompt rejected.');
    let approval;
    await wait(async () => {
      approval = matchingApproval((await history()).events, requestId, fixture);
      return approval && !approval.outcome && (await inspect()).approvals === 1
        && await evaluate(officialActionExpression(allow ? ['允许一次', 'Allow once'] : ['拒绝', 'Reject'], false, '[data-approval-key]'));
    }, allow ? 'exact fixture approval available' : 'exact fixture rejection available');
    await validateApprovalFixture(fixture);
    await assertPreset();
    const shown = await evaluate(`(()=>{const panel=document.querySelector('[data-approval-key]');return !!panel&&panel.textContent.includes(${JSON.stringify(fixture.marker)})&&panel.textContent.includes(${JSON.stringify(path.basename(fixture.file))})})()`);
    assert.equal(shown, true, 'approval UI must disclose the exact fixture command');
    await fsp.writeFile(`${target}.ask-${allow ? 'allow' : 'deny'}-pending.png`, (await window.webContents.capturePage()).toPNG());
    if (!await evaluate(officialActionExpression(allow ? ['允许一次', 'Allow once'] : ['拒绝', 'Reject'], true, '[data-approval-key]'))) throw new Error('Exact approval action became unavailable.');
    let finalHistory;
    await wait(async () => {
      finalHistory = await history();
      const observed = matchingApproval(finalHistory.events, requestId, fixture), state = await inspect();
      return observed?.id === approval.id && observed.outcome === (allow ? 'allowed-once' : 'rejected')
        && !state.running && !state.pending && !state.turnOpen && promptTurn(finalHistory.events, requestId)?.reason?.kind === 'completed';
    }, allow ? 'allowed-once fixture completed' : 'rejected fixture completed');
    const content = await fsp.readFile(fixture.file, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    assert.equal(content, allow ? fixture.marker : null, 'approval decision must agree with the actual file effect');
    await assertPreset();
    cases.push({ outcome: allow ? 'allowed-once' : 'rejected', fixtureId: fixture.id, fileEffectVerified: true, permissionPresetUnchanged: true });
    return true;
  };
  const denied = await exercise(false);
  const allowed = allowOneFixtureApprovalExplicitlyAuthorized === true ? await exercise(true) : false;
  return { ...approvalGateResult({ denied, allowed, allowOneFixtureApprovalExplicitlyAuthorized }), version, realModel: true,
    onboarding, cases, permissionPreset: 'workspace-write', realUserDataUsed: false,
    boundary: 'Only a generated isolated sibling marker command may receive one-time approval; session permission is never changed. Unapproved allow coverage is pending, not passing.' };
}

module.exports = { createApprovalFixture, validateApprovalFixture, matchingApproval, approvalGateResult, runApprovalSmoke };
