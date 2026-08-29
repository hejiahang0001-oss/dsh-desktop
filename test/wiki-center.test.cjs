const assert = require('node:assert/strict');
const test = require('node:test');

const {
  extractWikiSessionCandidates,
  selectCaptureCandidate
} = require('../electron/wiki-center.cjs');

const history = {
  events: [
    { seq: 1, time: 100, event: { type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'thinking', thinking: '不应暴露' }, { type: 'text', text: '# 第一条结论\n保留正文。' }] } } } },
    { seq: 2, event: { type: 'turn/end', data: { reason: { kind: 'aborted' } } } },
    { seq: 3, time: 300, event: { type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: '中断前可见前缀' }] } } } },
    { seq: 4, event: { type: 'user/message', data: { message: { role: 'user', content: [{ type: 'text', text: '用户内容' }] } } } },
    { seq: 5, time: 500, event: { type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: '最终结论\n第二行。' }] } } } }
  ]
};

test('Wiki candidates include only bounded assistant text with source sequence', () => {
  const candidates = extractWikiSessionCandidates(history);
  assert.deepEqual(candidates.map((item) => item.seq), [5, 3, 1]);
  assert.equal(candidates[0].title, '最终结论');
  assert.equal(candidates[1].interrupted, false);
  assert.equal(candidates[2].interrupted, true);
  assert.equal(candidates[2].text.includes('不应暴露'), false);
  assert.equal(candidates[2].title, '第一条结论');
});

test('capture request must reference a candidate and accepts only the fixed shape', () => {
  const candidates = extractWikiSessionCandidates(history);
  const selected = selectCaptureCandidate({ title: '修订标题', content: '由用户确认的内容', sourceSeq: 5 }, candidates);
  assert.equal(selected.candidate.sourceTime, 500);
  assert.equal(selected.title, '修订标题');
  assert.equal(selectCaptureCandidate({ title: '标题', content: '内容', sourceSeq: 999 }, candidates), null);
  assert.equal(selectCaptureCandidate({ title: '标题', content: '内容', sourceSeq: 5, sourceSessionId: '伪造' }, candidates), null);
});
