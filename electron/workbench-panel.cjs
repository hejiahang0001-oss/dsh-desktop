const { normalizeWorkbenchState } = require('./workbench-store.cjs');

const getWorkbenchPanelBootstrapScript = (state) => {
  const safeState = normalizeWorkbenchState(state);
  return `window.__DSH_WORKBENCH_BOOTSTRAP__ = Object.freeze(${JSON.stringify(safeState)});`;
};

const getWorkbenchPanelLayoutScript = (state) => {
  const safeState = normalizeWorkbenchState(state);
  return `(() => {
    const panels = [window.__DSH_WORKBENCH__, window.__DSH_TERMINAL__, window.__DSH_FILES__];
    let applied = 0;
    for (const panel of panels) {
      if (!panel || typeof panel.applyLayout !== 'function') continue;
      panel.applyLayout(${JSON.stringify(safeState)});
      applied += 1;
    }
    return applied === panels.length;
  })()`;
};

module.exports = {
  getWorkbenchPanelBootstrapScript,
  getWorkbenchPanelLayoutScript
};
