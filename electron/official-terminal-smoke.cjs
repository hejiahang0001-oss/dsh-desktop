const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { callHarnessRemote } = require('./extension-center.cjs');
const { finishOfficialOnboarding } = require('./official-office-preview-contract.cjs');

// Public DOM ownership only: never focus behind a blocking dialog, clear inert,
// or read a credential input value to make a synthetic command reach the PTY.
const terminalInputExpression = (focus = false) => `(() => {
  const input = document.querySelector('[data-sidebar-terminal] .xterm-helper-textarea');
  const visible = element => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
  if (!input || input.disabled || input.readOnly || input.closest('[inert]')
    || document.getElementById('root')?.inert !== false
    || [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].some(visible)) return false;
  ${focus ? 'input.focus();' : ''}
  return document.activeElement === input;
})()`;

async function runOfficialTerminalSmoke({ window, selected, workspacePath, nodePath, origin, fetchImpl, evaluate, waitFor, open, target, version }) {
  const checks = {}, wc = window.webContents, owned = new Set();
  const remote = (method, args) => callHarnessRemote(origin, 'terminal', method, args, { fetchImpl, timeoutMs: 8000 });
  const list = () => remote('list', { sessionId: selected.sessionId });
  const poll = async (check, stage = 'terminal metadata') => {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const value = await check();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Official terminal acceptance timed out: ${stage}.`);
  };
  const runningTerminal = async (previousId) => {
    const items = await list();
    if (items.length !== (previousId ? 2 : 1)
      || items.some((item) => item.state !== 'running' || typeof item.id !== 'string' || !item.id)
      || new Set(items.map((item) => item.id)).size !== items.length
      || (previousId && !items.some((item) => item.id === previousId))) return null;
    return items.find((item) => item.id !== previousId);
  };
  const nativeReceipt = async (terminal, stage) => {
    // rc.2 exposes attachment writability through its stream and public status
    // UI, not WebTerminalInfo. Readiness alone is not proof: execute a fresh
    // command through the visible textarea and validate its independent receipt.
    await waitFor(`Boolean(document.querySelector('[data-sidebar-terminal] .xterm-helper-textarea'))
      && !document.querySelector('[data-sidebar-terminal] [role="status"], [data-sidebar-terminal] [role="alert"]')
      && Array.from(document.querySelectorAll('[data-sidebar-terminal] .xterm-rows > div')).some(row => row.textContent.includes('>'))`);
    const powershell = /^(powershell|pwsh)\.exe$/i.test(path.basename(terminal.shell.path));
    const cmd = /^cmd\.exe$/i.test(path.basename(terminal.shell.path));
    if (!powershell && !cmd) throw new Error('This Windows smoke covers discovered cmd/PowerShell only; no guessed shell commands were sent.');
    const filename = `terminal-${randomUUID()}.json`, marker = randomUUID();
    // Only a fresh fixture in the isolated test workspace. Never print a Key.
    const script = `require('node:fs').writeFileSync('${filename}',JSON.stringify({cwd:process.cwd(),keyPresent:Boolean(process.env.DEEPSEEK_API_KEY),marker:'${marker}'})); console.log('DSH official terminal verified')`;
    if (!path.isAbsolute(nodePath) || !(await fs.stat(nodePath)).isFile()) throw new Error('Bundled Node fixture helper is unavailable.');
    const command = `${powershell ? '& ' : ''}"${nodePath}" -e "${script}"`;
    window.focus(); wc.focus();
    await waitFor(terminalInputExpression(true));
    if (!await evaluate(terminalInputExpression())) throw new Error('Official terminal input lost focus before insertText.');
    await wc.insertText(command);
    await waitFor(`Array.from(document.querySelectorAll('[data-sidebar-terminal] .xterm-rows > div')).map(row => row.textContent).join('').replace(/\\s/g,'').includes(${JSON.stringify(marker)})`);
    window.focus(); wc.focus();
    if (!await evaluate(terminalInputExpression())) throw new Error('Official terminal input lost focus before Return.');
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
    const receipt = await poll(async () => {
      try { return JSON.parse(await fs.readFile(path.join(workspacePath, filename), 'utf8')); }
      catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return null; throw error; }
    }, `${stage} native keyboard receipt`);
    const result = {
      nativeKeyboardExecutes: receipt.marker === marker,
      workspaceBound: typeof receipt.cwd === 'string' && path.resolve(receipt.cwd).toLowerCase() === path.resolve(workspacePath).toLowerCase(),
      keyNotInherited: receipt.keyPresent === false,
    };
    if (!Object.values(result).every(Boolean)) throw new Error(`Official terminal receipt mismatch: ${stage}.`);
    return result;
  };
  if ((await list()).length) throw new Error('Terminal smoke requires a fresh isolated Session.');
  try {
    await finishOfficialOnboarding({ evaluate });
    await waitFor('Boolean(window.__DSH_OFFICIAL_FILES__?.openTerminal)');
    const opened = await open();
    if (!opened.ok) throw new Error(opened.message);
    await waitFor('Boolean(document.querySelector("[data-sidebar-terminal] .xterm-helper-textarea"))');
    const first = await poll(() => runningTerminal());
    owned.add(first.id);
    checks.officialPtyRunning = true;
    Object.assign(checks, await nativeReceipt(first, 'first terminal'));
    await fs.writeFile(`${target}.official-terminal.png`, (await wc.capturePage()).toPNG());
    window.setContentSize(1024, 720);
    await new Promise((resolve) => setTimeout(resolve, 400));
    checks.compactPanelVisible = await evaluate(`(() => {
      const screen = document.querySelector('[data-sidebar-terminal] .xterm-screen');
      if (!screen) return false;
      const r = screen.getBoundingClientRect();
      return r.width > 80 && r.height > 40 && r.left >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1;
    })()`);
    await fs.writeFile(`${target}.official-terminal-compact.png`, (await wc.capturePage()).toPNG());
    if (!(await open()).ok) throw new Error('Second terminal navigation rejected.');
    const second = await poll(() => runningTerminal(first.id));
    owned.add(second.id);
    checks.multipleIndependentTerminals = second.id !== first.id && (await list()).length === 2;
    // Establish real input on the second terminal before observing inventory.
    // Do not open/follow/take control between the two native-keyboard receipts.
    await nativeReceipt(second, 'second terminal before inventory');
    const metadata = await list(), repeatedMetadata = await list();
    if (![metadata, repeatedMetadata].every((items) => items.length === 2
      && items.some((item) => item.id === first.id && item.state === 'running')
      && items.some((item) => item.id === second.id && item.state === 'running'))) {
      throw new Error('Official terminal inventory changed during the read-only check.');
    }
    checks.readOnlyInventoryRetainsUserInput = Object.values(
      await nativeReceipt(second, 'second terminal after inventory')).every(Boolean);
    for (const id of owned) await remote('close', { agentId: selected.sessionId, id });
    owned.clear();
    checks.explicitCloseRemovesTerminals = (await list()).length === 0;
    if (!Object.values(checks).every(Boolean)) throw new Error(`Official terminal checks failed: ${JSON.stringify(checks)}`);
    return { ok: true, version, checks, modelCalls: 0, evidence: 'Official sidebar + Windows PTY + Electron native keyboard input; synthetic receipt in an isolated workspace. No private UI state or model output-read attachment.', unverified: ['Windows IME', 'terminal recovery across Host restart', 'other shells', 'another Windows machine'] };
  } catch (error) {
    await fs.writeFile(`${target}.failure.png`, (await wc.capturePage()).toPNG());
    await fs.writeFile(`${target}.failure.json`, JSON.stringify({ terminals: await list(),
      focused: { window: window.isFocused(), contents: wc.isFocused(), terminalInput: await evaluate(terminalInputExpression()) },
      visibleTerminalText: await evaluate('Array.from(document.querySelectorAll("[data-sidebar-terminal] .xterm-rows > div")).map(row => row.textContent).join("\\n")') }, null, 2));
    throw error;
  } finally {
    for (const id of owned) await remote('close', { agentId: selected.sessionId, id }).catch(() => {});
  }
}

module.exports = { runOfficialTerminalSmoke };
