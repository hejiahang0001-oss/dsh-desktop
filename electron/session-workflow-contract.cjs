// Test-only acceptance helpers. Durable outcomes, not command receipts, decide success.
const readSmokeHistory = async (api, origin, sessionId) => {
  const events = []; let throughSeq, beforeSeq;
  for (let count = 0; count < 100; count += 1) {
    const page = await api(origin, 'session.history', { sessionId, maxMessages: 100,
      ...(throughSeq === undefined ? {} : { throughSeq }), ...(beforeSeq === undefined ? {} : { beforeSeq }) });
    throughSeq ??= page.throughSeq;
    if (page.throughSeq !== throughSeq || !Array.isArray(page.events)) throw new Error('Smoke history cut changed.');
    const rows = page.events.map(row => row.event);
    if (rows.some(row => !row || !Number.isSafeInteger(row.seq) || row.seq > throughSeq)
      || rows.some((row, index) => index && row.seq <= rows[index - 1].seq)
      || (beforeSeq !== undefined && rows.some(row => row.seq >= beforeSeq))) throw new Error('Smoke history order is invalid.');
    events.unshift(...rows);
    if (!page.hasMore) return { events, throughSeq };
    if (!rows.length) throw new Error('Smoke history pagination made no progress.');
    beforeSeq = rows[0].seq;
  }
  throw new Error('Smoke history exceeded its fixture-only bound.');
};

const promptTurn = (events, requestId) => {
  let turn = null, admitted = false;
  for (const event of events) {
    if (event.type === 'turn/start') { turn = event.data.turn; admitted = false; }
    if (event.type === 'user/message' && event.data.source?.rpcId === requestId) admitted = true;
    if (event.type === 'turn/end' && admitted && event.data.turn === turn) return { turn, reason: event.data.reason, endSeq: event.seq };
  }
  return null;
};
const userStoppedPrompt = (history, requestId) => {
  const result = promptTurn(history.events, requestId);
  return result?.reason?.kind === 'aborted' && result.reason.reason?.kind === 'user';
};

function officialAction(labels, click = false, scope = '') {
  const visible = node => {
    if (!node) return false;
    const box = node.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0 || box.bottom <= 0 || box.right <= 0 || box.left >= innerWidth || box.top >= innerHeight) return false;
    for (let parent = node; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (parent.hidden || parent.inert || style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || Number(style.opacity) === 0) return false;
    }
    const hit = document.elementFromPoint(Math.max(0, Math.min(innerWidth - 1, box.left + box.width / 2)), Math.max(0, Math.min(innerHeight - 1, box.top + box.height / 2)));
    return hit === node || node.contains(hit);
  };
  if (document.getElementById('root')?.inert !== false) return false;
  const parent = scope ? document.querySelector(scope) : document;
  const buttons = [...(parent?.querySelectorAll('button') || [])].filter(node => visible(node) && !node.disabled
    && labels.includes(node.getAttribute('aria-label') || node.textContent.trim()));
  if (buttons.length !== 1) return false;
  if (click) buttons[0].click();
  return true;
}
const officialActionExpression = (labels, click = false, scope = '') => `(${officialAction.toString()})(${JSON.stringify(labels)},${click},${JSON.stringify(scope)})`;

module.exports = { readSmokeHistory, promptTurn, userStoppedPrompt, officialAction, officialActionExpression };
