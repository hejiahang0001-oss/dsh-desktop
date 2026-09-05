const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

async function runWorkflowSmoke({ window, supervisor, selected, workspacePath, version, target, origin, api, crossWorkspace = false }) {
  const wc = window.webContents;
  const evaluate = (code) => wc.executeJavaScript(code, true);
  const checks = {};
  const inspect = () => supervisor.credentialHost.sessionControl.request('inspect', { workspacePath, sessionId: selected.sessionId });
  const wait = async (check, name, timeout = 180000) => {
    await fsp.writeFile(`${target}.phase.json`, JSON.stringify({ name, at: new Date().toISOString() }));
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await check()) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const state = await inspect();
    const ui = await evaluate('({selected:localStorage.getItem("dsh.sessions.current"),draft:window.__DSH_COMPOSER_TEXT__.read(),buttons:Array.from(document.querySelectorAll("[data-composer-card] button")).map(b=>({label:b.getAttribute("aria-label")||b.textContent.trim(),disabled:b.disabled}))})');
    await fsp.writeFile(`${target}.failure-state.json`, JSON.stringify({ name, state, ui }, null, 2));
    await fsp.writeFile(`${target}.failure.png`, (await wc.capturePage()).toPNG());
    throw new Error(`Workflow smoke timeout: ${name}`);
  };
  const type = (text) => evaluate(`window.__DSH_COMPOSER_TEXT__.append(window.__DSH_COMPOSER_TEXT__.current(), ${JSON.stringify(text)})`);
  const pressEnter = (accelerated = false) => evaluate(`(()=>{const input=window.__DSH_COMPOSER_TEXT__.current();input.focus();input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true,ctrlKey:${accelerated}}));return true})()`);
  const officialButtonAvailable = (labels) => evaluate(`Array.from(document.querySelectorAll('button')).some(b=>${JSON.stringify(labels)}.includes(b.getAttribute('aria-label')||b.textContent.trim())&&!b.disabled)`);
  const clickOfficialButton = (labels) => evaluate(`(()=>{const labels=${JSON.stringify(labels)};const b=Array.from(document.querySelectorAll('button')).find(b=>labels.includes(b.getAttribute('aria-label')||b.textContent.trim())&&!b.disabled);if(!b)throw new Error('Official Harness action unavailable');b.click();return true})()`);
  const stopLabels = ['Stop generating', '停止生成'];
  const steerQueueLabels = ['Steer queued message', '插话发送'];
  const start = async () => {
    const receipt = await api(origin, 'session.prompt', {
      sessionId: selected.sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: '这是官方交互验收。请连续输出200行“等待交互测试”，每行标序号。直接开始，不分析，不使用工具。下一条消息到达时立即以新指令为准。' }]
    });
    if (!receipt.accepted) throw new Error('Initial prompt rejected');
    await wait(async () => (await inspect()).running, 'running');
    await wait(() => officialButtonAvailable(stopLabels), 'official stop available');
  };

  const marker = `DSH_FLOW_${randomBytes(8).toString('hex')}`;
  const queueResult = path.join(workspacePath, 'queue-result.txt');
  const steerResult = path.join(workspacePath, 'steer-result.txt');

  await start();
  await type(`取消之前的重复输出任务，现在只做这件事：把 ${marker} 写入当前工作区 queue-result.txt，然后结束。不要继续此前任务。`);
  await pressEnter(false);
  await wait(async () => (await inspect()).pending > 0 && !(await evaluate('window.__DSH_COMPOSER_TEXT__.read()')).trim(), 'official queue accepted');
  checks.officialQueueAccepted = true;
  await wait(() => officialButtonAvailable(steerQueueLabels), 'official up-arrow available');
  await clickOfficialButton(steerQueueLabels);
  checks.officialUpArrowInvoked = true;
  await wait(async () => {
    const state = await inspect();
    return !state.running && !state.pending && (await fsp.readFile(queueResult, 'utf8').catch(() => '')).trim() === marker;
  }, 'official queued steer completed');
  checks.officialQueuedSteerReplied = true;

  await start();
  await type(`立即改做这件事：仅把 ${marker} 写入当前工作区 steer-result.txt，不继续数字解释。`);
  await pressEnter(true);
  checks.officialCtrlEnterInvoked = true;
  await wait(async () => {
    const state = await inspect();
    return !state.running && !state.pending && (await fsp.readFile(steerResult, 'utf8').catch(() => '')).trim() === marker;
  }, 'official ctrl-enter steer completed');
  checks.officialCtrlEnterSteerReplied = true;
  checks.sentTextCleared = !(await evaluate('window.__DSH_COMPOSER_TEXT__.read()')).trim();

  await start();
  await clickOfficialButton(stopLabels);
  await wait(async () => !(await inspect()).running, 'official stop completed', 60000);
  const stopped = await inspect();
  checks.officialStopSettled = !stopped.running && stopped.pending === 0;

  await fsp.writeFile(`${target}.workflow.png`, (await wc.capturePage()).toPNG());
  return {
    ok: Object.values(checks).every(Boolean),
    version,
    realModel: true,
    crossWorkspace,
    checks,
    remainingDraft: await evaluate('window.__DSH_COMPOSER_TEXT__.read()'),
    evidence: 'Real DeepSeek calls exercised the unmodified official Harness queue, queued-message up-arrow, Ctrl+Enter steer and Stop controls; marker files prove the steered messages executed.'
  };
}

module.exports = { runWorkflowSmoke };
