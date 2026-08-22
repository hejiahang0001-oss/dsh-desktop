const fsp = require('node:fs/promises');
const path = require('node:path');

const MIN_REVIEW_WIDTH = 280;
const MAX_REVIEW_WIDTH = 520;
const DEFAULT_REVIEW_WIDTH = 340;

const normalizeWorkbenchState = (value = {}) => {
  const width = Number.isFinite(value.reviewPanelWidth)
    ? Math.round(value.reviewPanelWidth)
    : DEFAULT_REVIEW_WIDTH;
  return Object.freeze({
    reviewPanelOpen: typeof value.reviewPanelOpen === 'boolean' ? value.reviewPanelOpen : true,
    reviewPanelWidth: Math.min(MAX_REVIEW_WIDTH, Math.max(MIN_REVIEW_WIDTH, width))
  });
};

class WorkbenchStore {
  constructor({ filePath }) {
    this.filePath = filePath;
    this.state = normalizeWorkbenchState();
  }

  async _persist() {
    await fsp.mkdir(path.dirname(this.filePath), { recursive: true });
    await fsp.writeFile(this.filePath, `${JSON.stringify({ version: 1, ...this.state }, null, 2)}\n`, 'utf8');
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

  async setReviewPanelWidth(reviewPanelWidth) {
    this.state = normalizeWorkbenchState({ ...this.state, reviewPanelWidth });
    await this._persist();
    return this.getState();
  }

  getState() {
    return { ...this.state };
  }
}

module.exports = {
  DEFAULT_REVIEW_WIDTH,
  MAX_REVIEW_WIDTH,
  MIN_REVIEW_WIDTH,
  WorkbenchStore,
  normalizeWorkbenchState
};
