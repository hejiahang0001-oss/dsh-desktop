const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const fsp = require('node:fs/promises');
const { AtomicJsonFile } = require('./atomic-json-store.cjs');
const { GitCheckpointManager } = require('./checkpoint-manager.cjs');
const { isSessionId, pathKey } = require('./harness-workspace-sync.cjs');
const { contextKey } = require('./document-intake-controller.cjs');
const phases = new Set(['preparing', 'copying', 'forking', 'ready', 'returned', 'failed', 'interrupted']);
const validPath = (value) => typeof value === 'string' && value.length <= 2048 && path.isAbsolute(value) && !/[\0-\x1f]/.test(value);
const validState = (state) => state?.version === 1 && Array.isArray(state.entries) && state.entries.length <= 100
  && state.entries.every((row) => /^[a-f0-9-]{36}$/.test(row.id || '') && phases.has(row.phase)
    && isSessionId(row.sourceSessionId) && isSessionId(row.targetSessionId) && validPath(row.sourcePath)
    && (!row.targetPath || validPath(row.targetPath)) && ['out', 'back'].includes(row.direction));
const sameTree = (a, b) => a.tree === b.tree && a.indexTree === b.indexTree;
const idle = (state) => !state.running && !state.pending && !state.approvals && !state.liveJobs && !state.turnOpen;

class SessionHandoff {
  constructor({ filePath, manager, control, getContext, confirm, activate, continuity, trashItem }) {
    Object.assign(this, { manager, control, getContext, confirm, activate, continuity, trashItem });
    this.file = new AtomicJsonFile({ filePath, validator: validState }); this.state = { version: 1, entries: [] }; this.busy = false;
  }
  async init() {
    this.state = (await this.file.read({ fallback: this.state })).value;
    const interrupted = this.state.entries.map((row) => ['preparing', 'copying', 'forking'].includes(row.phase)
      ? { ...row, phase: 'interrupted', message: '上次交接未结束。两端均保留；请打开原会话或已建立的目标，不自动重跑。' } : row);
    if (JSON.stringify(interrupted) !== JSON.stringify(this.state.entries)) await this.write(interrupted);
  }
  async write(entries) { const state = { version: 1, entries }; await this.file.write(state); this.state = state; }
  async update(id, patch) { await this.write(this.state.entries.map((row) => row.id === id ? { ...row, ...patch, updatedAt: Date.now() } : row)); }
  list(workspacePath) { return this.state.entries.filter((row) => [row.sourcePath, row.targetPath].some((value) => value && pathKey(value) === pathKey(workspacePath))).map((row) => ({ ...row })); }
  protects(workspacePath) { return this.state.entries.some((row) => row.phase !== 'returned' && row.targetPath && pathKey(row.targetPath) === pathKey(workspacePath)); }
  async checkpoint(workspacePath) { const manager = new GitCheckpointManager(); if (!(await manager.activate(workspacePath)).available) throw new Error('此目录不能安全建立 Git 交接恢复点。'); return manager; }
  async inspectContext(context) {
    if (!isSessionId(context?.sessionId) || !validPath(context?.workspacePath)) throw new Error('请先打开一个普通工作区会话。');
    const repository = await this.manager.inspect(context.workspacePath);
    if (!repository.available || repository.status !== 'ready') throw new Error(repository.message || '工作树暂不可用。');
    const session = await this.control('inspect', context);
    if (!idle(session)) throw new Error('当前会话仍在执行、排队、等待审批或运行后台命令；请先结束这些工作。');
    const checkpoint = await this.checkpoint(context.workspacePath), code = await checkpoint.captureCurrentState();
    if (code.sensitiveExcludedCount) throw new Error('当前有被安全规则排除的敏感文件改动；请先自行处理，交接不会复制凭据。');
    return { context, repository, session, checkpoint, code };
  }
  async transferDraft(source, target) {
    if (!this.continuity) return;
    const store = await this.continuity(), row = store.read(contextKey(source));
    const targetItems = [];
    for (const item of row.items) {
      let targetItem = item;
      const from = path.resolve(source.workspacePath, item.relativePath), to = path.resolve(target.workspacePath, item.relativePath);
      for (const [root, file] of [[source.workspacePath, from], [target.workspacePath, to]]) {
        const relative = path.relative(root, file);
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('会话附件越过了工作区边界。');
      }
      const sourceInfo = await fsp.lstat(from);
      if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink() || pathKey(await fsp.realpath(from)) !== pathKey(from) || sourceInfo.size > 32 * 1024 * 1024) throw new Error('会话附件已改变，未复制。');
      const buffer = await fsp.readFile(from);
      if (createHash('sha256').update(buffer).digest('hex') !== item.sha256) throw new Error('会话附件内容已改变；请重新添加后交接。');
      // Walk each parent before mkdir/copy: a repository-controlled symlink
      // must never redirect a document copy outside the new worktree.
      const parts = path.relative(target.workspacePath, path.dirname(to)).split(path.sep).filter(Boolean);
      let parent = target.workspacePath;
      for (const part of parts) {
        parent = path.join(parent, part); await fsp.mkdir(parent).catch((error) => { if (error.code !== 'EEXIST') throw error; });
        if ((await fsp.lstat(parent)).isSymbolicLink() || pathKey(await fsp.realpath(parent)) !== pathKey(parent)) throw new Error('附件目标经过了目录链接。');
      }
      try {
        const stat = await fsp.lstat(to);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32 * 1024 * 1024) throw new Error('目标已有不同的同名附件，未覆盖。');
        const existing = await fsp.readFile(to), sha256 = createHash('sha256').update(existing).digest('hex');
        if (sha256 !== item.sha256) {
          // Git may convert CRLF on checkout. Accept only a lossless UTF-8
          // line-ending difference; never rewrite a pre-existing target file.
          const utf8 = new TextDecoder('utf-8', { fatal: true });
          let sameText = false;
          try { sameText = /\.(csv|tsv|txt|md)$/i.test(to) && utf8.decode(existing).replace(/\r\n/g, '\n') === utf8.decode(buffer).replace(/\r\n/g, '\n'); } catch { /* Binary or invalid UTF-8 is not interchangeable. */ }
          if (!sameText) throw new Error('目标已有不同的同名附件，未覆盖。');
          targetItem = { ...item, sha256, bytes: existing.length };
        }
      } catch (error) { if (error.code !== 'ENOENT') throw error; await fsp.writeFile(to, buffer, { flag: 'wx' }); }
      targetItems.push(targetItem);
    }
    const key = contextKey(target), existing = store.read(key);
    if (existing.text || existing.items.length) throw new Error('目标会话已有草稿，未覆盖。');
    await store.saveAttachments(key, targetItems); await store.saveDraft(key, row.text, existing.revision);
  }
  async run() {
    if (this.busy) throw new Error('另一项会话交接仍在执行。');
    this.busy = true; let record, restore = null;
    try {
      if (this.state.entries.length >= 100) throw new Error('交接记录已到 100 条上限，需先整理记录。');
      const context = await this.getContext(), before = await this.inspectContext(context);
      const outward = this.state.entries.findLast((row) => row.direction === 'out' && row.phase === 'ready' && row.targetSessionId === context.sessionId && pathKey(row.targetPath) === pathKey(context.workspacePath));
      const direction = outward ? 'back' : 'out';
      if (!await this.confirm({ ...before, direction, targetPath: outward?.sourcePath })) return { ok: false, canceled: true, message: '已取消，原会话与代码保持不变。' };
      const current = await this.getContext();
      if (current.sessionId !== context.sessionId || pathKey(current.workspacePath) !== pathKey(context.workspacePath)) throw new Error('确认期间当前会话已切换。');
      const checked = await this.inspectContext(context);
      if (checked.repository.repository.head !== before.repository.repository.head || checked.session.historyHash !== before.session.historyHash || !sameTree(checked.code, before.code)) throw new Error('确认期间会话或代码已变化，请重新确认。');
      let destination, targetCheckpoint;
      if (outward) {
        destination = outward.sourcePath;
        const original = await this.inspectContext({ workspacePath: destination, sessionId: outward.sourceSessionId });
        if (original.repository.repository.head !== outward.sourceHead || !sameTree(original.code, outward.sourceCode)) throw new Error('原目录已产生其他修改或切换提交，不能覆盖。请先在审阅中比较两端代码。');
        targetCheckpoint = original.checkpoint;
      }
      record = { id: randomUUID(), phase: 'preparing', direction, sourcePath: context.workspacePath, sourceSessionId: context.sessionId,
        targetPath: destination || '', targetSessionId: `session-${randomUUID()}`, historyHash: before.session.historyHash,
        sourceHead: before.repository.repository.head, sourceCode: before.code, parentId: outward?.id || '', createdAt: Date.now(), updatedAt: Date.now() };
      await this.write([...this.state.entries, record]);
      const safety = await checked.checkpoint.create({ source: 'safety', sessionLink: { sessionId: context.sessionId, atSeq: checked.session.cursor } });
      if (!safety.last || !(safety.created || safety.unchanged)) throw new Error('未能建立交接恢复点。');
      if (!destination) {
        const created = await this.manager.create({ workspacePath: context.workspacePath }); destination = created.path;
        targetCheckpoint = await this.checkpoint(destination);
        await this.update(record.id, { targetPath: destination, worktreeId: created.createdId, branch: created.branch }); record.targetPath = destination;
      } else {
        const originalSafety = await targetCheckpoint.create({ source: 'safety' });
        if (!originalSafety.last) throw new Error('原目录未能建立恢复点。');
        restore = { manager: targetCheckpoint, snapshot: originalSafety.last };
      }
      await this.update(record.id, { phase: 'copying', checkpoint: safety.last, recoveryCheckpoint: restore?.snapshot || null });
      await targetCheckpoint.applySnapshot(safety.last, { trashItem: this.trashItem });
      const transferred = await targetCheckpoint.captureCurrentState();
      if (!sameTree(transferred, checked.code)) throw new Error('代码与暂存状态交接校验失败。');
      await this.transferDraft(context, { workspacePath: destination, sessionId: record.targetSessionId });
      await this.update(record.id, { phase: 'forking' });
      const fork = await this.control('fork', { ...context, targetPath: destination, childId: record.targetSessionId, historyHash: checked.session.historyHash });
      const finalSource = await this.inspectContext(context), finalContext = await this.getContext();
      if (finalSource.session.historyHash !== checked.session.historyHash || !sameTree(finalSource.code, checked.code)
        || finalContext.sessionId !== context.sessionId || pathKey(finalContext.workspacePath) !== pathKey(context.workspacePath)) throw new Error('交接保存期间原会话或代码又有变化；两端已保留，未切换。');
      await this.update(record.id, { phase: 'ready', inheritedEvents: fork.inheritedEvents });
      if (outward) await this.update(outward.id, { phase: 'returned' });
      restore = null;
      const opened = await this.activate(destination, fork.sessionId);
      if (!opened?.ok) throw new Error(`交接内容已保存，但界面未切换；请从交接记录打开目标会话。${opened?.error || ''}`);
      return { ok: true, sessionId: fork.sessionId, workspacePath: destination, message: '会话、草稿、资料与代码状态已交接。原会话和两端目录保留；未自动合并提交。' };
    } catch (error) {
      let rollback = '';
      if (restore) { try { await restore.manager.applySnapshot(restore.snapshot, { trashItem: this.trashItem }); rollback = ' 原目录已恢复到交接前。'; } catch { rollback = ' 自动恢复未完成，请用交接记录中的恢复点处理，勿重复操作。'; } }
      if (record) {
        const completed = this.state.entries.find((row) => row.id === record.id)?.phase === 'ready';
        await this.update(record.id, { phase: completed ? 'ready' : 'failed', message: `${error.message}${rollback}` });
      }
      throw new Error(`${error.message}${rollback}`);
    } finally { this.busy = false; }
  }
}
module.exports = { SessionHandoff, validState, idle };
