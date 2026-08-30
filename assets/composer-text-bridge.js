(() => {
  if (window.__DSH_COMPOSER_TEXT__) return true;
  const current = () => document.querySelector('[data-composer-card] [data-composer-input][contenteditable="true"], [data-composer-card] textarea:not([disabled])');
  const read = (input = current()) => {
    if (input?.tagName === 'TEXTAREA') return input.value;
    if (!input) return '';
    // The public rendered Lexical blocks use ONE newline, matching the
    // upstream clipboard/draft serialization; innerText uses CSS paragraph gaps.
    const content = (node) => node.nodeType === Node.TEXT_NODE ? node.textContent
      : node.nodeName === 'BR' ? '\n' : Array.from(node.childNodes).map(content).join('');
    return Array.from(input.childNodes).map((block) => {
      const text = content(block);
      return block.childNodes.length === 1 && block.firstChild.nodeName === 'BR' ? '' : text;
    }).join('\n');
  };
  const insert = async (input, text, range, guard = () => true) => {
    if (!input?.isConnected || input !== current() || !guard()) throw new Error('输入框已变化，请在当前会话重试。');
    input.focus({ preventScroll: true });
    if (input.tagName === 'TEXTAREA') {
      const value = read(input);
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(input, range ? value.replace(range, text) : value + text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    // Focus may restore the editor's old caret on its next commit. Let that
    // settle before applying the public selection or only one character may
    // be removed when returning from a toolbar button.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    if (input !== current() || !guard()) throw new Error('会话已变化，请在原会话重新添加。');
    const selection = window.getSelection();
    selection.removeAllRanges();
    const selected = range === 'all' ? document.createRange() : range || document.createRange();
    if (range === 'all') selected.selectNodeContents(input);
    if (!range) { selected.selectNodeContents(input); selected.collapse(false); }
    selection.addRange(selected);
    if (range === 'all') input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', keyCode: 65, ctrlKey: true, bubbles: true, cancelable: true }));
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
  const remove = (input, text, guard) => {
    if (input?.tagName === 'TEXTAREA') return insert(input, '', text, guard);
    if (text === read(input)) return insert(input, '', 'all', guard);
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
    return insert(input, '', range, guard);
  };
  const restore = (input, text, guard) => {
    if (read(input).trim()) throw new Error('输入框已有内容，未覆盖当前草稿。');
    return insert(input, text, null, guard);
  };
  window.__DSH_COMPOSER_TEXT__ = Object.freeze({ current, read, append, remove, restore });
  return true;
})();
