const { createHash } = require('node:crypto');
const { AtomicJsonFile } = require('./atomic-json-store.cjs');
const { normalizeWorkbenchState } = require('./workbench-store.cjs');
const TOOLS = Object.freeze(['terminal', 'office', 'tasks', 'extensions', 'wiki', 'worktrees']);
const normalizeDock = (value = {}) => ({ open: value.open === true, active: TOOLS.includes(value.active) ? value.active : 'terminal', height: Math.max(220, Math.min(600, Math.round(Number(value.height) || 330))) });
const projectKey = (workspace) => createHash('sha256').update(String(workspace).replaceAll('\\', '/').toLowerCase()).digest('hex');
const validStore = (value) => value?.version === 1 && value.projects && typeof value.projects === 'object' && !Array.isArray(value.projects) && Object.keys(value.projects).length <= 100;
class DockLayoutStore {
  constructor(filePath) { this.storage = new AtomicJsonFile({ filePath, validator: validStore }); this.state = { version: 1, projects: {} }; this.key = ''; this.queue = Promise.resolve(); }
  async init() { this.state = (await this.storage.read({ fallback: this.state })).value; }
  activate(workspace) { this.key = projectKey(workspace); return normalizeDock(this.state.projects[this.key]); }
  getState() { return normalizeDock(this.state.projects[this.key]); }
  getPanels() { const saved = this.state.projects[this.key]?.panels; return saved ? normalizeWorkbenchState(saved) : null; }
  update(change) {
    const key = this.key;
    const task = this.queue.then(async () => {
      const panels = change.panels || this.state.projects[key]?.panels;
      const next = { ...this.state, projects: { ...this.state.projects, [key]: { ...normalizeDock({ ...this.state.projects[key], ...change }), ...(panels ? { panels: normalizeWorkbenchState(panels) } : {}) } } };
      while (Object.keys(next.projects).length > 100) delete next.projects[Object.keys(next.projects)[0]];
      await this.storage.write(next); this.state = next; return normalizeDock(next.projects[key]);
    });
    this.queue = task.catch(() => {}); return task;
  }
}
const dockBounds = (width, height, requested, open) => {
  const barHeight = 42, paneHeight = open ? Math.min(Math.max(220, requested), Math.max(140, height - 260)) : 0;
  return { reserved: barHeight + paneHeight, bar: { x: 0, y: Math.max(0, height - paneHeight - barHeight), width, height: barHeight },
    pane: { x: 0, y: Math.max(0, height - paneHeight), width, height: paneHeight } };
};
module.exports = { DockLayoutStore, normalizeDock, dockBounds, TOOLS };
