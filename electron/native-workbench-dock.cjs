const { EventEmitter } = require('node:events');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { dockBounds } = require('./dock-layout.cjs');

// This is a facade around a native, separately sandboxed WebContentsView, not an Electron subclass.
class NativeToolSurface extends EventEmitter {
  constructor(dock, id, options) {
    super(); this.dock = dock; this.id = id; this.options = options; this.closed = false; this.floating = null;
    this.view = new dock.WebContentsView({ webPreferences: { ...options.webPreferences, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
    this.webContents = this.view.webContents; this.isNativeDockSurface = true;
    this.webContents.on('destroyed', () => this.destroy());
    this.webContents.on('will-frame-navigate', (event) => { if (!event.isMainFrame) event.preventDefault(); });
    this.view.setBackgroundColor(options.backgroundColor || '#171716');
    dock.window.contentView.addChildView(this.view); this.view.setVisible(false);
    this.webContents.on('render-process-gone', () => this.destroy());
  }
  async loadFile(file) { await this.webContents.loadFile(file); await this.webContents.insertCSS(this.dock.surfaceCss); this.emit('ready-to-show'); }
  isDestroyed() { return this.closed || this.webContents.isDestroyed(); }
  isMinimized() { return this.floating?.isMinimized() || false; }
  restore() { this.floating?.restore(); }
  show() { void this.dock.select(this.id).catch(this.dock.reportError); if (this.floating) this.floating.show(); }
  hide() { if (this.floating) this.floating.hide(); else void this.dock.collapse().catch(this.dock.reportError); }
  focus() { (this.floating || this.dock.window).focus(); this.webContents.focus(); }
  getDialogParent() { return this.floating || this.dock.window; }
  close() { this.destroy(); }
  destroy() {
    if (this.closed) return; this.closed = true;
    if (!this.dock.window.isDestroyed()) this.dock.window.contentView.removeChildView(this.view);
    if (this.floating && !this.floating.isDestroyed()) { this.floating.contentView.removeChildView(this.view); this.floating.destroy(); }
    if (!this.webContents.isDestroyed()) this.webContents.close({ waitForBeforeUnload: false });
    this.dock.surfaces.delete(this.id); this.emit('closed'); this.dock.layout();
  }
}

class NativeWorkbenchDock {
  constructor({ window, WebContentsView, BrowserWindow, rootDir, store, surfaceCss, onSelect, onPanel, onError = () => {} }) {
    Object.assign(this, { window, WebContentsView, BrowserWindow, rootDir, store, surfaceCss, onSelect, onPanel, onError });
    this.mainWebContents = window.webContents;
    this.reportError = (error) => { this.lastError = error.message || '工作台操作失败'; this.onError(error); if (!this.bar?.webContents.isDestroyed()) this.bar?.webContents.send('dock:state', this.state()); };
    this.surfaces = new Map(); this.bar = null; this.closed = false; this.selectionQueue = Promise.resolve();
    this.onResize = () => this.layout(); window.on('resize', this.onResize);
    this.onLoaded = () => this.layout(); window.webContents.on('did-finish-load', this.onLoaded);
  }
  async init() {
    this.bar = new this.WebContentsView({ webPreferences: { preload: path.join(this.rootDir, 'electron', 'dock-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
    this.window.contentView.addChildView(this.bar);
    const page = pathToFileURL(path.join(this.rootDir, 'workbench-dock.html')).href;
    this.bar.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.bar.webContents.on('will-navigate', (event, url) => { if (url !== page) event.preventDefault(); });
    this.bar.webContents.on('will-redirect', (event) => event.preventDefault());
    this.bar.webContents.on('will-frame-navigate', (event) => { if (event.url !== page) event.preventDefault(); });
    this.bar.webContents.on('will-attach-webview', (event) => event.preventDefault());
    await this.bar.webContents.loadURL(page); this.layout();
  }
  create(id, options) {
    if (this.surfaces.has(id)) return this.surfaces.get(id);
    const surface = new NativeToolSurface(this, id, options); this.surfaces.set(id, surface); return surface;
  }
  async select(id) {
    await this.store.update({ active: id, open: true }); this.layout();
  }
  async collapse() {
    await this.store.update({ open: false }); this.layout(); this.window.webContents.focus();
  }
  async act(action, value) {
    if (action === 'select') { const task = this.selectionQueue.then(async () => { await this.onSelect(value); await this.select(value); }); this.selectionQueue = task.catch(() => {}); await task; return this.state(); }
    if (action === 'panel') { await this.onPanel(value); return this.state(); }
    if (action === 'collapse') await this.collapse();
    else if (action === 'height') { if (![240, 360, 500].includes(value)) throw new Error('无效面板高度。'); await this.store.update({ height: value }); this.layout(); }
    else if (action === 'detach') this.detach();
    else throw new Error('未知工作台操作。');
    return this.state();
  }
  state() { return { ...this.store.getState(), opened: [...this.surfaces.keys()], floating: Boolean(this.surfaces.get(this.store.getState().active)?.floating), error: this.lastError || '' }; }
  layout() {
    if (this.closed || this.window.isDestroyed() || !this.bar || this.bar.webContents.isDestroyed()) return;
    const state = this.store.getState(), [width, height] = this.window.getContentSize();
    const selected = this.surfaces.get(state.active);
    const bounds = dockBounds(width, height, state.height, state.open && selected && !selected.floating);
    this.bar.setBounds(bounds.bar);
    for (const [id, surface] of this.surfaces) {
      if (surface.isDestroyed() || surface.floating) continue;
      const visible = state.open && id === state.active;
      surface.view.setVisible(visible); if (visible) surface.view.setBounds(bounds.pane);
    }
    // Reserve the native panel's actual DIP height in the remote layout; expose no native write API.
    const cssHeight = bounds.reserved / this.window.webContents.getZoomFactor();
    void this.window.webContents.executeJavaScript(`document.documentElement.style.setProperty('--dsh-native-dock-height', ${JSON.stringify(`${cssHeight}px`)})`).catch(this.reportError);
    this.bar.webContents.send('dock:state', this.state());
  }
  detach() {
    const surface = this.surfaces.get(this.store.getState().active);
    if (!surface || surface.isDestroyed()) return;
    if (surface.floating) {
      const floating = surface.floating; surface.floating = null;
      floating.contentView.removeChildView(surface.view); this.window.contentView.addChildView(surface.view); floating.destroy();
      this.layout(); surface.focus(); return;
    }
    this.window.contentView.removeChildView(surface.view);
    const floating = new this.BrowserWindow({ width: Math.max(900, surface.options.width || 900), height: 680, minWidth: 720, minHeight: 420,
      title: surface.options.title, show: false, autoHideMenuBar: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    surface.floating = floating; floating.contentView.addChildView(surface.view); surface.view.setVisible(true);
    const resize = () => { const [width, height] = floating.getContentSize(); surface.view.setBounds({ x: 0, y: 0, width, height }); };
    floating.on('resize', resize); floating.on('closed', () => { if (surface.floating === floating) surface.destroy(); });
    resize(); floating.show(); surface.focus(); this.layout();
  }
  destroy() {
    this.closed = true; this.window.removeListener('resize', this.onResize); this.mainWebContents.removeListener('did-finish-load', this.onLoaded);
    for (const surface of [...this.surfaces.values()]) surface.destroy();
    if (this.bar) { if (!this.window.isDestroyed()) this.window.contentView.removeChildView(this.bar); if (!this.bar.webContents.isDestroyed()) this.bar.webContents.close({ waitForBeforeUnload: false }); }
  }
}
module.exports = { NativeWorkbenchDock, NativeToolSurface };
