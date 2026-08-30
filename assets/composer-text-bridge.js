(() => {
  if (window.__DSH_COMPOSER_TEXT__) return true;
  const current = () => document.querySelector('[data-composer-card] [data-composer-input][contenteditable="true"], [data-composer-card] textarea:not([disabled])');
  const read = (input = current()) => input?.tagName === 'TEXTAREA' ? input.value : input?.innerText || '';
  const insert = async (input, text, range, guard = () => true) => {
    if (!input?.isConnected || input !== current()) throw new Error('输入框已变化，请在当前会话重试。');
    input.focus({ preventScroll: true });
    if (input.tagName === 'TEXTAREA') {
      const value = read(input);
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(input, range ? value.replace(range, text) : value + text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    const selection = window.getSelection();
    selection.removeAllRanges();
    const selected = range || document.createRange();
    if (!range) { selected.selectNodeContents(input); selected.collapse(false); }
    selection.addRange(selected);
    // Let the upstream editor synchronize its selection before using its public paste/key handlers.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    if (input !== current() || !guard()) throw new Error('会话已变化，请在原会话重新添加。');
    let event;
    if (text) {
      const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', text);
      event = new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true });
    } else event = new KeyboardEvent('keydown', { key: 'Backspace', code: 'Backspace', keyCode: 8, bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    if (!event.defaultPrevented) throw new Error('输入框未接受资料操作，请重试。');
    await new Promise((resolve) => requestAnimationFrame(resolve));
  };
  const append = (input, text, guard) => insert(input, `${read(input).trim() && !read(input).endsWith('\n') ? '\n' : ''}${text}`, null, guard);
  const remove = (input, text) => {
    if (input?.tagName === 'TEXTAREA') return insert(input, '', text);
    const walker = document.createTreeWalker(input, NodeFilter.SHOW_TEXT);
    const nodes = []; let node, joined = '';
    while ((node = walker.nextNode())) { nodes.push({ node, start: joined.length }); joined += node.textContent; }
    const start = joined.indexOf(text);
    if (start < 0) throw new Error('引用已编辑，请直接在输入框中删除。');
    const first = nodes.findLast((item) => item.start <= start);
    const end = start + text.length;
    const last = nodes.findLast((item) => item.start < end);
    const range = document.createRange();
    range.setStart(first.node, start - first.start); range.setEnd(last.node, end - last.start);
    return insert(input, '', range);
  };
  window.__DSH_COMPOSER_TEXT__ = Object.freeze({ current, read, append, remove });
  return true;
})();
