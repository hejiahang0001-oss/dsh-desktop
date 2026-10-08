const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { dialog, desktopCapturer } = require('electron');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(check, label, ms = 20000) { const end = Date.now() + ms; while (Date.now() < end) { if (await check()) return; await delay(100); } throw new Error(`Dock smoke timeout: ${label}`); }
async function runNativeDockSmoke({ window, dock, terminal, broker, version, target, sessionId, origin, api, realModel }) {
  const assertions = {}, originalDialog = dialog.showMessageBox;
  let readConfirmations = 0;
  dialog.showMessageBox = async (...args) => {
    const options = args.at(-1);
    if (options.title === '启动交互式终端') return { response: 0 };
    if (options.title === '允许 AI 读取当前终端输出？') { readConfirmations++; return { response: 1 }; }
    return originalDialog(...args);
  };
  const act = (action, value) => dock.bar.webContents.executeJavaScript(`dockAPI.act(${JSON.stringify(action)},${JSON.stringify(value)})`, true);
  const shot = async (label) => {
    // Windows STARTUPINFO can suppress the first ShowWindow during a hidden
    // test launch. Restore visibility before requiring a real composed frame.
    if (window.isMinimized()) window.restore();
    window.show();
    await waitFor(() => window.isVisible(), 'native capture visibility');
    window.focus(); await delay(400);
    await fsp.writeFile(`${target}.${label}.window.json`, JSON.stringify({ visible: window.isVisible(), minimized: window.isMinimized(), bounds: window.getBounds(), mediaSourceId: window.getMediaSourceId() }));
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1920, height: 1400 } });
    const source = sources.find((item) => item.id === window.getMediaSourceId());
    if (!source || source.thumbnail.isEmpty()) throw new Error('Native composed-window capture unavailable');
    await fsp.writeFile(`${target}.${label}.png`, source.thumbnail.toPNG());
  };
  try {
    if (process.argv.includes('--smoke-lulu-layout')) {
      return await require('./workbench-layout-smoke.cjs').runWorkbenchLayoutSmoke({ window, dock, target, version });
    }
    const brand = await window.webContents.executeJavaScript(`(() => {
      const marks = [...document.querySelectorAll('svg[viewBox="0 0 23.16 17.04"]')].map(svg => ({
        parent: svg.parentElement.className,
        ancestors: [svg.parentElement, svg.parentElement.parentElement, svg.parentElement.parentElement.parentElement].map(e => ({ tag: e.tagName, cls: e.className })),
        hidden: svg.getAttribute('aria-hidden'),
        visibility: getComputedStyle(svg).visibility,
        mascotBackground: getComputedStyle(svg.closest('.qVIJiq_fishHitbox, .ghK-Yq_root .ghK-Yq_railMark, .ghK-Yq_root .ghK-Yq_brandMark') || svg.parentElement).backgroundImage.startsWith('url("data:image/png;base64,')
      }));
      return { marks, configured: getComputedStyle(document.documentElement).getPropertyValue('--lulu-brand-image').includes('data:image/png;base64,') };
    })()`);
    await fsp.writeFile(`${target}.brand.json`, JSON.stringify(brand, null, 2));
    assertions.luluMascot = brand.configured && brand.marks.length > 0 && brand.marks.every(mark => mark.visibility === 'hidden' && mark.mascotBackground);
    if (process.argv.includes('--smoke-lulu-brand')) {
      await window.webContents.executeJavaScript(`document.querySelectorAll('button').forEach(button => { if (button.textContent.trim() === '稍后配置') button.click(); })`, true);
      const originalBounds = window.getBounds();
      const originalDark = await window.webContents.executeJavaScript('document.body.getAttribute("data-ds-dark-theme")');
      const appearances = [];
      try {
        for (const variant of [
          { name: 'light', dark: false, width: 1280, height: 880 },
          { name: 'dark', dark: true, width: 1280, height: 880 },
          { name: 'compact', dark: false, width: 1024, height: 720 }
        ]) {
          window.setSize(variant.width, variant.height); dock.layout();
          const state = await window.webContents.executeJavaScript(`(async () => {
            document.body.toggleAttribute('data-ds-dark-theme', ${variant.dark});
            const containers = [...document.querySelectorAll('.qVIJiq_fishHitbox, .ghK-Yq_root .ghK-Yq_railMark, .ghK-Yq_root .ghK-Yq_brandMark')];
            const images = containers.map(element => getComputedStyle(element).backgroundImage);
            const decoded = await Promise.all([...new Set(images)].map(async source => {
              if (!source.startsWith('url("data:image/png;base64,') || !source.endsWith('")')) return false;
              const image = new Image(); image.src = source.slice(5, -2);
              await image.decode(); return image.naturalWidth > 0 && image.naturalHeight > 0;
            }));
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const fits = element => {
              if (!element) return false;
              const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
              return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0
                && rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1;
            };
            const input = document.querySelector('[data-composer-input][contenteditable=true]');
            input?.focus();
            return { dark: document.body.hasAttribute('data-ds-dark-theme'), imageCount: images.length,
              imagesDecoded: decoded.length > 0 && decoded.every(Boolean),
              inputVisible: fits(input), inputFocusable: Boolean(input && document.activeElement === input),
              navigationVisible: fits(document.querySelector('.ghK-Yq_root .ghK-Yq_toggle')),
              noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth + 1 };
          })()`);
          appearances.push({ ...variant, ...state });
          assertions[`brand${variant.name}`] = state.dark === variant.dark && state.imagesDecoded
            && state.inputVisible && state.inputFocusable && state.navigationVisible && state.noHorizontalOverflow;
          await fsp.writeFile(`${target}.brand-${variant.name}.png`, (await window.webContents.capturePage()).toPNG());
        }
      } finally {
        await window.webContents.executeJavaScript(`document.body.${originalDark === null ? 'removeAttribute("data-ds-dark-theme")' : `setAttribute("data-ds-dark-theme", ${JSON.stringify(originalDark)})`}`);
        window.setBounds(originalBounds); dock.layout();
      }
      await fsp.writeFile(`${target}.appearances.json`, JSON.stringify(appearances, null, 2));
      return { ok: Object.values(assertions).every(Boolean), version, assertions, appearances, realModel: false,
        evidence: 'Real Harness decorative branding in light, dark and compact windows; images decoded before capture. No model request or full native tool assertions.' };
    }
    await act('select', 'terminal');
    const surface = dock.surfaces.get('terminal'), terminalId = surface.webContents.id;
    const state = await surface.webContents.executeJavaScript('terminalAPI.start({cols:100,rows:24})', true);
    if (!state.ok) throw new Error(state.message || 'Terminal did not start');
    await waitFor(() => terminal.getState().status === 'running', 'PTY running');
    const pid = terminal.getState().pid, marker = `DSH_DOCK_${randomBytes(8).toString('hex')}`;
    await surface.webContents.executeJavaScript(`terminalAPI.write(${JSON.stringify(`Write-Output '${marker}'\r`)})`, true);
    await waitFor(() => terminal.getSnapshot().output.includes(marker), 'PTY marker');
    // Both entries only open a terminal surface; neither grants write/resize/read access.
    const remoteTerminalMethods = await window.webContents.executeJavaScript('Object.keys(desktopAPI.terminal).sort()');
    assertions.remoteCannotWrite = JSON.stringify(remoteTerminalMethods) === '["openOfficial","openWindow"]';
    assertions.localSandbox = await surface.webContents.executeJavaScript('typeof require === "undefined" && typeof process === "undefined" && typeof terminalAPI.write === "function"');
    await act('collapse'); await act('select', 'terminal');
    assertions.collapsePreservesPty = terminal.getState().pid === pid && surface.webContents.id === terminalId && terminal.getSnapshot().output.includes(marker);
    await act('detach'); assertions.detachedNative = Boolean(surface.floating) && surface.floating.contentView.children.includes(surface.view);
    await act('detach'); assertions.redockPreservesPty = !surface.floating && terminal.getState().pid === pid && surface.webContents.id === terminalId;
    for (const tool of ['office', 'tasks', 'extensions', 'wiki', 'worktrees']) {
      await act('select', tool); const current = dock.surfaces.get(tool);
      assertions[`${tool}Native`] = current?.isNativeDockSurface === true && current.view.getVisible();
      assertions[`${tool}Content`] = await current.webContents.executeJavaScript('document.body.innerText.trim().length > 30');
      if (tool === 'office') { await delay(1200); await shot('office'); }
    }
    const closedOffice = dock.surfaces.get('office');
    await closedOffice.webContents.executeJavaScript('document.getElementById("close").click()', true).catch(() => {});
    await waitFor(() => !dock.surfaces.has('office'), 'native tool close');
    await act('select', 'office'); assertions.toolReopened = dock.surfaces.get('office').webContents.id !== closedOffice.webContents.id;
    await act('select', 'terminal'); await act('height', 240);
    const fits = async () => {
      await delay(250);
      await fsp.writeFile(`${target}.geometry.json`, JSON.stringify(await window.webContents.executeJavaScript('(()=>{let e=document.querySelector("[data-composer-card]"); const rows=[];while(e){const r=e.getBoundingClientRect();const s=getComputedStyle(e);rows.push({tag:e.tagName,id:e.id,cls:e.className,left:r.left,right:r.right,width:r.width,minWidth:s.minWidth,maxWidth:s.maxWidth});e=e.parentElement;}return rows;})()'), null, 2));
      const rect = await window.webContents.executeJavaScript('(()=>{const e=document.querySelector("[data-composer-input]");const r=e.getBoundingClientRect();const buttons=[...document.querySelectorAll("button")].filter(b=>/发送|Send/.test(b.getAttribute("aria-label")||""));return {top:r.top,bottom:Math.max(r.bottom,...buttons.map(b=>b.getBoundingClientRect().bottom)),innerHeight};})()');
      const bar = dock.bar.getBounds(), zoom = window.webContents.getZoomFactor();
      const horizontal = await window.webContents.executeJavaScript('(()=>{const root=document.getElementById("root").getBoundingClientRect();const card=document.querySelector("[data-composer-card]").getBoundingClientRect();return card.left>=root.left-1 && card.right<=root.right+1 && [...document.querySelectorAll("[data-composer-card] button")].filter(b=>b.getBoundingClientRect().width>0).every(b=>{const r=b.getBoundingClientRect();return r.left>=root.left-1&&r.right<=root.right+1;});})()');
      await fsp.writeFile(`${target}.layout-${zoom}.json`, JSON.stringify({ rect, bar, zoom, horizontal, extras: await window.webContents.executeJavaScript('Array.from(document.querySelectorAll(".dsh-document-intake")).map(e=>({text:e.textContent,top:e.getBoundingClientRect().top,bottom:e.getBoundingClientRect().bottom}))') }, null, 2));
      return horizontal && rect.top >= 0 && rect.bottom * zoom <= bar.y + 1;
    };
    assertions.composerFits = await fits(); await shot('terminal');
    window.setSize(1000, 760); assertions.compactComposerFits = await fits(); await shot('compact');
    for (const zoom of [0.8, 1.2, 1.4]) { window.webContents.setZoomFactor(zoom); dock.layout(); assertions[`zoom${zoom}Fits`] = await fits(); }
    window.webContents.setZoomFactor(1); dock.layout();
    const snapshot = await broker.read({ sessionId, workspacePath: terminal.workspacePath || terminal.getState().cwd, maxChars: 4000 });
    assertions.confirmedReadOnly = snapshot.includes(marker) && readConfirmations === 1;
    if (realModel) {
      const workspace = terminal.getState().cwd;
      const receipt = await api(origin, 'session.prompt', { sessionId, mode: 'queue', content: [{ type: 'text', text: '请调用 desktop_terminal_read 读取桌面终端，找出 DSH_DOCK_ 开头的完整标记。只把这个标记写入当前工作区 native-terminal-result.txt；不加说明、不安装依赖、不访问网络、不读取其他文件。不知道标记时不能猜测。' }] });
      if (!receipt.accepted) throw new Error('Live terminal task rejected');
      await waitFor(async () => {
        const text = await fsp.readFile(path.join(workspace, 'native-terminal-result.txt'), 'utf8').catch(() => '');
        const list = await api(origin, 'session.list', {});
        return text.trim() === marker && list.items?.find((item) => item.sessionId === sessionId)?.running === false;
      }, 'live model terminal read and result', 240000);
      assertions.realModelReadVerified = readConfirmations > 1;
    }
    await surface.webContents.executeJavaScript('terminalAPI.stop()', true);
    await waitFor(() => !terminal.isActive(), 'stop PTY'); assertions.stopped = true;
    return { ok: Object.values(assertions).every(Boolean), version, assertions, realModel, readConfirmations,
      evidence: 'Real Harness, guarded native views and real PTY; exact native confirmations approved by isolated smoke only. Screenshots capture composed native window.' };
  } finally { dialog.showMessageBox = originalDialog; }
}
module.exports = { runNativeDockSmoke };
