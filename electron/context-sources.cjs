const { createHash } = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');

const PROJECT_ROOT_MARKERS = Object.freeze(['.git']);
const BASE_CANDIDATES = Object.freeze(['AGENTS.md', 'CLAUDE.md']);
const LOCAL_CANDIDATES = Object.freeze(['AGENTS.local.md', 'CLAUDE.local.md']);
const MAX_SOURCES = 32;
const MAX_SOURCE_BYTES = 1_048_576;

const isInsideOrEqual = (root, candidate) => {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};

const existingEntry = async (target) => {
  try {
    return await fsp.stat(target);
  } catch {
    return null;
  }
};

const findProjectRoot = async (workspacePath) => {
  const original = path.resolve(workspacePath);
  let current = original;
  for (;;) {
    for (const marker of PROJECT_ROOT_MARKERS) {
      if (await existingEntry(path.join(current, marker))) return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return original;
    current = parent;
  }
};

const ancestorChain = (root, leaf) => {
  const resolvedRoot = path.resolve(root);
  const resolvedLeaf = path.resolve(leaf);
  if (!isInsideOrEqual(resolvedRoot, resolvedLeaf)) return [resolvedLeaf];
  const chain = [];
  let current = resolvedLeaf;
  while (current !== resolvedRoot) {
    chain.push(current);
    current = path.dirname(current);
  }
  chain.push(resolvedRoot);
  return chain.reverse();
};

const sourceId = (absolutePath) => createHash('sha256')
  .update(process.platform === 'win32' ? absolutePath.toLocaleLowerCase() : absolutePath)
  .digest('hex')
  .slice(0, 20);

const toDisplayPath = (projectRoot, absolutePath) => {
  const relative = path.relative(projectRoot, absolutePath).replaceAll('\\', '/');
  return relative || path.basename(absolutePath);
};

class ContextSourceCatalog {
  constructor({ workspacePath, harnessHome }) {
    this.harnessHome = path.resolve(harnessHome);
    this.setWorkspace(workspacePath);
  }

  setWorkspace(workspacePath) {
    this.workspacePath = path.resolve(workspacePath);
    this.sourcePaths = new Map();
  }

  async _source(absolutePath, { kind, displayPath }) {
    const info = await existingEntry(absolutePath);
    if (!info?.isFile()) return null;
    const id = sourceId(absolutePath);
    this.sourcePaths.set(id, absolutePath);
    return Object.freeze({
      id,
      kind,
      displayPath,
      bytes: info.size,
      modifiedAt: info.mtime.toISOString(),
      status: info.size > MAX_SOURCE_BYTES ? 'oversized' : 'candidate',
      userControlled: true
    });
  }

  async scan({ sessionActive = false } = {}) {
    this.sourcePaths = new Map();
    const workspaceInfo = await existingEntry(this.workspacePath);
    if (!workspaceInfo?.isDirectory()) {
      return Object.freeze({
        available: false,
        workspacePath: '',
        projectRoot: '',
        sources: Object.freeze([]),
        layers: Object.freeze([]),
        memory: Object.freeze({ status: 'unavailable', title: '长期记忆', detail: '当前工作区不可用，尚未检查 Harness 上下文来源。' })
      });
    }

    const projectRoot = await findProjectRoot(this.workspacePath);
    const sources = [];
    const globalPath = path.join(this.harnessHome, 'AGENTS.md');
    const globalSource = await this._source(globalPath, { kind: 'global', displayPath: '$DSH_HOME/AGENTS.md' });
    if (globalSource) sources.push(globalSource);
    for (const directory of ancestorChain(projectRoot, this.workspacePath)) {
      for (const candidate of [...BASE_CANDIDATES, ...LOCAL_CANDIDATES]) {
        if (sources.length >= MAX_SOURCES) break;
        const absolutePath = path.join(directory, candidate);
        const source = await this._source(absolutePath, {
          kind: LOCAL_CANDIDATES.includes(candidate) ? 'overlay' : 'project',
          displayPath: toDisplayPath(projectRoot, absolutePath)
        });
        if (source) sources.push(source);
      }
    }

    const layers = Object.freeze([
      Object.freeze({
        id: 'harness-code-preset',
        owner: 'Harness',
        title: 'Code Agent 基础上下文',
        status: 'active',
        detail: '由固定的 DeepSeek Harness Code preset 组装；桌面版不显示或改写隐藏系统提示。'
      }),
      Object.freeze({
        id: 'desktop-language-policy',
        owner: 'DSH Desktop',
        title: '界面语言策略',
        status: 'active',
        detail: '仅约束可见自然语言，保留代码、命令、路径、标识符和原始输出。'
      }),
      Object.freeze({
        id: 'workspace-instructions',
        owner: '用户文件',
        title: '项目规则链',
        status: sources.length > 0 ? 'active' : 'empty',
        detail: sources.length > 0
          ? `检测到 ${sources.length} 个规则候选；Harness 再按内容去重、单文件与总预算决定实际纳入、忽略或截断的范围。`
          : '未检测到 AGENTS.md、CLAUDE.md 或本地覆盖文件。'
      }),
      Object.freeze({
        id: 'durable-session',
        owner: 'Harness',
        title: '持久会话历史',
        status: sessionActive ? 'active' : 'waiting',
        detail: sessionActive
          ? '当前工作区已绑定 Harness 会话；规则基线和后续变更由 Harness 写入持久会话上下文。'
          : '等待 Harness 完成工作区和会话同步。'
      })
    ]);
    return Object.freeze({
      available: true,
      workspacePath: this.workspacePath,
      projectRoot,
      sources: Object.freeze(sources),
      sourceLimitReached: sources.length >= MAX_SOURCES,
      layers,
      instructionPolicy: Object.freeze({
        projectRootMarkers: PROJECT_ROOT_MARKERS,
        baseCandidates: BASE_CANDIDATES,
        localCandidates: LOCAL_CANDIDATES,
        maxBytes: 65536,
        maxSourceBytes: MAX_SOURCE_BYTES
      }),
      memory: Object.freeze({
        status: 'harness-managed',
        title: '长期记忆',
        detail: '固定 Web Profile 不内置独立长期记忆数据库。Harness 已包含 MCP 客户端；如用户配置 Memory MCP 或记忆插件，其内容与权限由 Harness 管理，桌面版不会读取或冒充其状态。'
      })
    });
  }

  async resolveSourcePath(id) {
    if (typeof id !== 'string' || !/^[0-9a-f]{20}$/.test(id)) return null;
    const target = this.sourcePaths.get(id);
    if (!target) return null;
    const info = await existingEntry(target);
    return info?.isFile() ? target : null;
  }
}

module.exports = {
  BASE_CANDIDATES,
  ContextSourceCatalog,
  LOCAL_CANDIDATES,
  MAX_SOURCE_BYTES,
  PROJECT_ROOT_MARKERS,
  ancestorChain,
  findProjectRoot
};
