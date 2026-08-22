const fsp = require('node:fs/promises');
const path = require('node:path');

const MIN_REVIEW_WIDTH = 280;
const MAX_REVIEW_WIDTH = 520;
const DEFAULT_REVIEW_WIDTH = 340;
const MIN_FILE_WIDTH = 220;
const MAX_FILE_WIDTH = 380;
const DEFAULT_FILE_WIDTH = 260;
const MIN_TERMINAL_HEIGHT = 160;
const MAX_TERMINAL_HEIGHT = 420;
const DEFAULT_TERMINAL_HEIGHT = 240;

const normalizeWorkbenchState = (value = {}) => {
  const width = Number.isFinite(value.reviewPanelWidth)
    ? Math.round(value.reviewPanelWidth)
    : DEFAULT_REVIEW_WIDTH;
  const fileWidth = Number.isFinite(value.filePanelWidth)
    ? Math.round(value.filePanelWidth)
    : DEFAULT_FILE_WIDTH;
  const height = Number.isFinite(value.terminalPanelHeight)
    ? Math.round(value.terminalPanelHeight)
    : DEFAULT_TERMINAL_HEIGHT;
  return Object.freeze({
    filePanelOpen: typeof value.filePanelOpen === 'boolean' ? value.filePanelOpen : true,
    filePanelWidth: Math.min(MAX_FILE_WIDTH, Math.max(MIN_FILE_WIDTH, fileWidth)),
    reviewPanelOpen: typeof value.reviewPanelOpen === 'boolean' ? value.reviewPanelOpen : true,
    reviewPanelWidth: Math.min(MAX_REVIEW_WIDTH, Math.max(MIN_REVIEW_WIDTH, width)),
    terminalPanelOpen: typeof value.terminalPanelOpen === 'boolean' ? value.terminalPanelOpen : true,
    terminalPanelHeight: Math.min(MAX_TERMINAL_HEIGHT, Math.max(MIN_TERMINAL_HEIGHT, height))
  });
};

class WorkbenchStore {
  constructor({ filePath }) {
    this.filePath = filePath;
    this.state = normalizeWorkbenchState();
  }

  async _persist() {
    await fsp.mkdir(path.dirname(this.filePath), { recursive: true });
    await fsp.writeFile(this.filePath, `${JSON.stringify({ version: 3, ...this.state }, null, 2)}\n`, 'utf8');
  }

  async init() {
    let stored = {};
    try {
      stored = JSON.parse(await fsp.readFile(this.filePath, 'utf8'));
    } catch {
      stored = {};
    }
    this.state = normalizeWorkbenchState(stored);
    await this._persist();
    return this.getState();
  }

  async setReviewPanelOpen(reviewPanelOpen) {
    this.state = normalizeWorkbenchState({ ...this.state, reviewPanelOpen });
    await this._persist();
    return this.getState();
  }

  async setFilePanelOpen(filePanelOpen) {
    this.state = normalizeWorkbenchState({ ...this.state, filePanelOpen });
    await this._persist();
    return this.getState();
  }

  async setFilePanelWidth(filePanelWidth) {
    this.state = normalizeWorkbenchState({ ...this.state, filePanelWidth });
    await this._persist();
    return this.getState();
  }

  async setReviewPanelWidth(reviewPanelWidth) {
    this.state = normalizeWorkbenchState({ ...this.state, reviewPanelWidth });
    await this._persist();
    return this.getState();
  }

  async setTerminalPanelOpen(terminalPanelOpen) {
    this.state = normalizeWorkbenchState({ ...this.state, terminalPanelOpen });
    await this._persist();
    return this.getState();
  }

  async setTerminalPanelHeight(terminalPanelHeight) {
    this.state = normalizeWorkbenchState({ ...this.state, terminalPanelHeight });
    await this._persist();
    return this.getState();
  }

  getState() {
    return { ...this.state };
  }
}

module.exports = {
  DEFAULT_FILE_WIDTH,
  DEFAULT_TERMINAL_HEIGHT,
  DEFAULT_REVIEW_WIDTH,
  MAX_FILE_WIDTH,
  MAX_TERMINAL_HEIGHT,
  MAX_REVIEW_WIDTH,
  MIN_FILE_WIDTH,
  MIN_TERMINAL_HEIGHT,
  MIN_REVIEW_WIDTH,
  WorkbenchStore,
  normalizeWorkbenchState
};
