const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
async function runWorkflowSmoke({ window, supervisor, selected, workspacePath, version, target, origin, api, crossWorkspace = false }) {
  const wc = window.webContents, evaluate = (code) => wc.executeJavaScript(code, true), checks = {};
  await evaluate('window.__DSH_SMOKE_NOTICES__=[];new MutationObserver(()=>{const t=document.querySelector(".dsh-session-workflow .dsh-document-status")?.textContent;if(t&&window.__DSH_SMOKE_NOTICES__.at(-1)!==t)window.__DSH_SMOKE_NOTICES__.push(t)}).observe(document.body,{subtree:true,childList:true,characterData:true})');
  const inspect = () => supervisor.credentialHost.sessionControl.request('inspect', { workspacePath, sessionId: selected.sessionId });
  const wait = async (check, name, timeout = 180000) => {
    await fsp.writeFile(`${target}.phase.json`, JSON.stringify({ name, at: new Date().toISOString() }));
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { if (await check()) return; await new Promise((resolve) => setTimeout(resolve, 250)); }
    const state = await inspect();
    const ui = await evaluate('({selected:localStorage.getItem("dsh.sessions.current"),draft:window.__DSH_COMPOSER_TEXT__.read(),status:document.querySelector(".dsh-session-workflow")?.textContent,buttons:Array.from(document.querySelectorAll("[data-composer-card] button")).map(b=>({label:b.getAttribute("aria-label"),disabled:b.disabled}))})');
    const notices = await evaluate('window.__DSH_SMOKE_NOTICES__.slice(-30)');
    await fsp.writeFile(`${target}.failure-state.json`, JSON.stringify({ name, state, ui, notices }, null, 2));
    await fsp.writeFile(`${target}.failure.png`, (await wc.capturePage()).toPNG());
    throw new Error(`Workflow smoke timeout: ${name}`);
  };
  const click = (label) => evaluate(`(()=>{const b=Array.from(document.querySelectorAll('.dsh-session-workflow button')).find(b=>b.textContent===${JSON.stringify(label)});if(!b||b.disabled||b.parentElement.hidden)throw new Error('Workflow action unavailable');b.click();return true})()`);
  const type = (text) => evaluate(`window.__DSH_COMPOSER_TEXT__.append(window.__DSH_COMPOSER_TEXT__.current(), ${JSON.stringify(text)})`);
  const start = async () => {
    const receipt = await api(origin, 'session.prompt', { sessionId: selected.sessionId, mode: 'queue', content: [{ type: 'text', text: '这是停止按钮验收。请连续输出200行“等待交互测试”，每行标序号。直接开始，不分析，不使用工具。下一条消息到达时立即以新指令为准。' }] });
    if (!receipt.accepted) throw new Error('Initial prompt rejected');
    await wait(async () => (await inspect()).running, 'running');
    await evaluate('window.__DSH_WORKFLOW__.refresh()');
    await wait(() => evaluate('Array.from(document.querySelectorAll("button")).some(b=>["Stop generating","停止生成"].includes(b.getAttribute("aria-label")||b.textContent.trim()))'), 'upstream stop');
    await wait(() => evaluate('document.querySelector(".dsh-session-workflow button")?.parentElement.hidden === false'), 'running controls');
  };
  const marker = `DSH_FLOW_${randomBytes(8).toString('hex')}`;
  await start(); await type(`取消之前的重复输出任务，现在只做这件事：把 ${marker} 写入当前工作区 queue-result.txt，然后结束。不要继续此前任务。`); await click('排队发送');
  await wait(async () => (await inspect()).pending > 0 && !(await evaluate('window.__DSH_COMPOSER_TEXT__.read()')).trim(), 'queue persisted and editor cleared'); checks.queued = true;
  if (crossWorkspace) {
    await wait(() => evaluate('Array.from(document.querySelectorAll("button")).some(b=>["插话发送","Steer queued message"].includes(b.getAttribute("aria-label"))&&!b.disabled)'), 'up-arrow available');
    await evaluate('Array.from(document.querySelectorAll("button")).find(b=>["插话发送","Steer queued message"].includes(b.getAttribute("aria-label"))&&!b.disabled).click()');
    await wait(() => evaluate('document.getElementById("dsh-reliable-interrupt-status")?.dataset.state === "success"'), 'up-arrow accepted', 15000);
    checks.upArrowAcceptedAcrossWorkspace = true;
  } else {
    await click('停止当前回合');
    await wait(async () => !(await inspect()).running, 'current turn stopped', 60000);
    checks.queueRetainedAfterStop = (await inspect()).pending > 0;
  }
  if (!crossWorkspace && checks.queueRetainedAfterStop) {
    await evaluate('window.__DSH_WORKFLOW__.refresh()');
    await click('继续排队消息');
    await wait(() => evaluate('window.__DSH_SMOKE_NOTICES__.some(t=>t.includes("继续处理原排队消息的请求已受理"))'), 'resume receipt', 10000);
  }
  await wait(async () => {
    const state = await inspect();
    return !state.running && !state.pending && (await fsp.readFile(path.join(workspacePath, 'queue-result.txt'), 'utf8').catch(() => '')).trim() === marker;
  }, 'queued prompt completed after stop'); checks.stoppedTurnDidNotClaimQueueDeleted = true;
  await start(); await type(`立即改做这件事：仅把 ${marker} 写入当前工作区 steer-result.txt，不继续数字解释。`); await click('插话并继续');
  await wait(async () => {
    const state = await inspect();
    return !state.running && !state.pending && (await fsp.readFile(path.join(workspacePath, 'steer-result.txt'), 'utf8').catch(() => '')).trim() === marker;
  }, 'steered prompt completed'); checks.steerActuallyReplied = true;
  checks.sentTextCleared = !(await evaluate('window.__DSH_COMPOSER_TEXT__.read()')).trim();
  await evaluate('window.__DSH_WORKFLOW__.refresh()');
  checks.idleActionsHidden = await evaluate('document.querySelector(".dsh-session-workflow button").parentElement.hidden');
  await fsp.writeFile(`${target}.workflow.png`, (await wc.capturePage()).toPNG());
  return { ok: Object.values(checks).every(Boolean), version, realModel: true, checks,
    notices: await evaluate('window.__DSH_SMOKE_NOTICES__.slice(-30)'), remainingDraft: await evaluate('window.__DSH_COMPOSER_TEXT__.read()'),
    evidence: 'Real DeepSeek calls and upstream composer/stop plus native reliable interrupt; marker files prove queued and steered messages executed.' };
}
module.exports = { runWorkflowSmoke };
