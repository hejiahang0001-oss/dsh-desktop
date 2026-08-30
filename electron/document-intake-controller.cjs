const { createHash } = require('node:crypto');
const { DocumentIntake, documentReference } = require('./document-intake.cjs');

const contextKey = (context) => createHash('sha256').update(`${context.workspacePath}\0${context.sessionId || 'new'}`).digest('hex');

class DocumentIntakeController {
  constructor({ getContext, chooseFiles, confirmImport, intake = new DocumentIntake() }) {
    this.getContext = getContext; this.chooseFiles = chooseFiles; this.confirmImport = confirmImport;
    this.intake = intake; this.catalog = new Map(); this.busy = false;
  }

  async getState() {
    const context = await this.getContext();
    const key = contextKey(context);
    return { available: true, context: key, items: this.catalog.get(key) || [] };
  }

  async importFiles({ expectedContext, paths, choose = false } = {}) {
    if (this.busy) return { ok: false, message: '上一批资料正在导入，请稍候。' };
    this.busy = true;
    try {
      const context = await this.getContext();
      const key = contextKey(context);
      if (key !== expectedContext) throw new Error('工作区或会话已切换，请在当前会话重新添加。');
      const selected = choose ? await this.chooseFiles() : paths;
      if (choose && !selected?.length) return { ok: false, canceled: true, context: key, message: '已取消选择，原文件未修改。' };
      if (!Array.isArray(selected) || !selected.length || selected.length > 10
        || selected.some((value) => typeof value !== 'string' || value.length > 2048 || /[\u0000-\u001f]/.test(value))) throw new Error('每次最多添加 10 个有效本机文件。');
      const assertCurrent = async () => {
        if (contextKey(await this.getContext()) !== key) throw new Error('导入期间工作区或会话已切换，请回到原会话重试。');
      };
      if (!choose && !await this.confirmImport(selected, context)) return { ok: false, canceled: true, context: key, message: '已取消导入，原文件未修改。' };
      await assertCurrent();
      const result = await this.intake.importFiles({ workspacePath: context.workspacePath, paths: selected, existing: this.catalog.get(key) || [], assertCurrent });
      const merged = new Map((this.catalog.get(key) || []).map((item) => [item.id, item]));
      for (const item of result.items) merged.set(item.id, item);
      this.catalog.set(key, [...merged.values()].slice(-50));
      while (this.catalog.size > 100) this.catalog.delete(this.catalog.keys().next().value);
      return { ok: result.items.length > 0, context: key, ...result,
        references: result.items.map(documentReference),
        message: result.items.length ? `已准备 ${result.items.length} 个文件；发送问题后才交给 AI 读取。` : '没有文件被导入，请查看原因。' };
    } catch (error) { return { ok: false, message: error.message || '文件导入失败，请重试。' }; }
    finally { this.busy = false; }
  }
}

module.exports = { DocumentIntakeController, contextKey };
