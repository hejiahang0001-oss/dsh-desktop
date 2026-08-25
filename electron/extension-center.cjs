const { randomUUID } = require('node:crypto');

const MAX_INVENTORY_ENTRIES = 512;
const MAX_MODULE_NAME = 256;
const FIBER_PHASES = new Set(['pending', 'loading', 'active', 'failed', 'unloading', null]);

const immutable = (value) => Object.freeze(value);
const REMOTE_SEGMENT_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$.-]{0,63}$/;

const boundedErrorMessage = (value, fallback) => {
  if (typeof value !== 'string') return fallback;
  const normalized = value.replace(/[\0-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, 512) : fallback;
};

const safeHarnessOrigin = (value) => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:'
      && url.hostname === '127.0.0.1'
      && Boolean(url.port)
      && url.pathname === '/'
      && !url.username
      && !url.password
      && !url.search
      && !url.hash;
  } catch {
    return false;
  }
};

const callHarnessRemote = async (origin, namespace, method, args = {}, {
  fetchImpl = globalThis.fetch,
  timeoutMs = 3000
} = {}) => {
  if (!safeHarnessOrigin(origin)) throw new Error('Harness Remote 地址不是受信任的随机回环地址。');
  if (!REMOTE_SEGMENT_PATTERN.test(namespace) || !REMOTE_SEGMENT_PATTERN.test(method)) {
    throw new Error('Harness Remote 端点无效。');
  }
  if (!args || typeof args !== 'object' || Array.isArray(args) || Object.getPrototypeOf(args) !== Object.prototype) {
    throw new Error('Harness Remote 参数必须是普通对象。');
  }
  if (typeof fetchImpl !== 'function') throw new Error('Harness Remote 传输不可用。');
  const endpoint = `${namespace}/${method}`;
  const rpcId = randomUUID();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(8000, Math.max(250, timeoutMs)));
  timer.unref?.();
  let response;
  try {
    response = await fetchImpl(new URL(`/api/${endpoint}`, origin).toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId, method: endpoint, payload: { args } }),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
  if (!response?.ok) throw new Error(`Harness Remote 返回 HTTP ${response?.status || 'unknown'}。`);
  const message = await response.json();
  if (message?.type !== 'server-response' || message.rpcId !== rpcId || typeof message.result?.ok !== 'boolean') {
    throw new Error('Harness Remote 返回了不匹配的响应。');
  }
  if (!message.result.ok) throw new Error(boundedErrorMessage(message.result.error?.message, 'Harness Remote 拒绝了请求。'));
  return message.result.value;
};

const safeModuleName = (value) => {
  if (typeof value !== 'string') return '';
  const normalized = value.replace(/[\0-\x1f\x7f]/g, '').trim();
  return normalized && normalized.length <= MAX_MODULE_NAME ? normalized : '';
};

const sanitizePluginInventory = (snapshot) => {
  const raw = Array.isArray(snapshot?.entries) ? snapshot.entries : [];
  const entries = [];
  for (const item of raw.slice(0, MAX_INVENTORY_ENTRIES)) {
    const moduleName = safeModuleName(item?.moduleName);
    const fiberPhase = FIBER_PHASES.has(item?.fiberPhase) ? item.fiberPhase : null;
    if (!moduleName || typeof item?.enabled !== 'boolean') continue;
    entries.push(immutable({ moduleName, enabled: item.enabled, fiberPhase }));
  }
  return immutable({ entries: immutable(entries), limited: raw.length > MAX_INVENTORY_ENTRIES });
};

const categoryOf = (moduleName) => {
  if (/(?:^|\/)dsh-(?:client-ui-)?skill(?:-|$)|(?:^|\/)dsh-tool-skill(?:\/|$)/i.test(moduleName)) return 'skills';
  if (/(?:^|\/)dsh-mcp-client(?:\/|$)/i.test(moduleName)) return 'mcp';
  return 'plugins';
};

const summarize = (entries) => immutable({
  total: entries.length,
  enabled: entries.filter((item) => item.enabled).length,
  active: entries.filter((item) => item.enabled && item.fiberPhase === 'active').length,
  failed: entries.filter((item) => item.fiberPhase === 'failed').length,
  disabled: entries.filter((item) => !item.enabled).length,
  transitional: entries.filter((item) => ['pending', 'loading', 'unloading'].includes(item.fiberPhase)).length
});

const liveStatus = (summary, available) => {
  if (!available) return 'unavailable';
  if (summary.failed > 0 || summary.transitional > 0) return 'degraded';
  return summary.total > 0 ? 'healthy' : 'degraded';
};

const surface = (value) => immutable(value);

const buildExtensionCenter = ({
  runtimeVersion = '',
  runtimeCapabilities = {},
  profiles = [],
  inventory,
  inventoryError = ''
} = {}) => {
  const sanitized = sanitizePluginInventory(inventory);
  const liveAvailable = !inventoryError && Array.isArray(inventory?.entries);
  const skillEntries = sanitized.entries.filter((item) => categoryOf(item.moduleName) === 'skills');
  const mcpEntries = sanitized.entries.filter((item) => categoryOf(item.moduleName) === 'mcp');
  const pluginEntries = sanitized.entries;
  const skillSummary = summarize(skillEntries);
  const mcpSummary = summarize(mcpEntries);
  const pluginSummary = summarize(pluginEntries);
  const profileCount = Array.isArray(profiles) ? profiles.length : 0;
  const externalCount = Array.isArray(profiles)
    ? profiles.reduce((total, profile) => total + (Array.isArray(profile?.dependencies) ? profile.dependencies.length : 0), 0)
    : 0;
  const skillCapability = runtimeCapabilities?.skills || {};
  const mcpCapability = runtimeCapabilities?.mcp || {};
  const inventoryCapability = runtimeCapabilities?.pluginInventory || {};
  const capabilityStatus = (summary, capability) => {
    if (liveAvailable && summary.total > 0) return liveStatus(summary, true);
    if (capability.status === 'ready') return 'ready';
    return capability.status === 'invalid' || capability.status === 'missing' ? 'degraded' : 'unavailable';
  };

  const surfaces = immutable([
    surface({
      id: 'skills',
      title: 'Skills',
      subtitle: '任务方法与可按需加载的说明',
      status: capabilityStatus(skillSummary, skillCapability),
      version: skillCapability.version || runtimeVersion,
      source: '官方 Harness Skill 注册表与文件系统提供器',
      scope: 'Harness Home、当前工作区与 Agent preset 分层生效',
      permission: '随当前会话权限运行；扩展中心不读取 Skill 正文',
      ...skillSummary,
      manageable: false,
      message: liveAvailable && skillSummary.total > 0
        ? `官方运行清单确认 ${skillSummary.active}/${skillSummary.total} 个 Skill 相关模块处于活动状态。`
        : skillCapability.status === 'ready'
          ? '固定运行时已验证官方 Skill 注册表；实时清单当前没有确认活动项。'
          : 'Harness 实时清单尚不可用；固定运行时也未确认官方 Skill 能力。'
    }),
    surface({
      id: 'plugins',
      title: 'Plugins',
      subtitle: 'Harness 加载层与受控外部扩展',
      status: liveStatus(pluginSummary, liveAvailable),
      version: inventoryCapability.version || runtimeVersion,
      source: '官方 pluginInventory.list 与本机 Profile 清单',
      scope: `${profileCount} 个 Profile；${externalCount} 个已声明外部依赖`,
      permission: '固定运行时只读；已审核外部扩展需原生确认后变更',
      ...pluginSummary,
      manageable: true,
      message: liveAvailable
        ? `官方运行清单确认 ${pluginSummary.active}/${pluginSummary.total} 个加载项处于活动状态。`
        : 'Harness 实时清单尚不可用；下方仍可核对固定闭包和本机 Profile。'
    }),
    surface({
      id: 'hooks',
      title: 'Hooks',
      subtitle: '事件触发与自动化挂钩',
      status: 'unsupported',
      version: runtimeVersion,
      source: `固定 Harness ${runtimeVersion || '当前版本'} 上游能力边界`,
      scope: '当前没有独立 Hooks 清单或生命周期接口',
      permission: '不扫描脚本文本，也不自行执行 Hook',
      total: 0,
      enabled: 0,
      active: 0,
      failed: 0,
      disabled: 0,
      transitional: 0,
      manageable: false,
      message: '当前固定上游未提供可验证的 Hooks 管理面；桌面版不会用普通插件或安装脚本冒充 Hooks。'
    }),
    surface({
      id: 'mcp',
      title: 'MCP',
      subtitle: '外部工具与数据服务连接',
      status: capabilityStatus(mcpSummary, mcpCapability),
      version: mcpCapability.version || runtimeVersion,
      source: '官方 @deepseek-ai/dsh-mcp-client 运行项',
      scope: 'MCP 服务与工具由 Harness composition 管理',
      permission: '按服务器、工具和当前会话权限执行；桌面版不读取连接密钥',
      ...mcpSummary,
      manageable: false,
      message: liveAvailable && mcpSummary.total > 0
        ? `官方运行清单确认 ${mcpSummary.active}/${mcpSummary.total} 个 MCP 客户端模块处于活动状态。`
        : mcpCapability.status === 'ready'
          ? '固定运行时已验证官方 MCP 客户端；没有活动项不代表已配置具体服务。'
          : 'Harness 实时清单尚不可用；固定运行时也未确认官方 MCP 客户端，这不代表已配置具体服务。'
    })
  ]);

  const issues = immutable(sanitized.entries
    .filter((item) => !item.enabled || item.fiberPhase === 'failed' || ['pending', 'loading', 'unloading'].includes(item.fiberPhase))
    .slice(0, 16)
    .map((item) => immutable({
      category: categoryOf(item.moduleName),
      moduleName: item.moduleName,
      status: !item.enabled ? 'disabled' : item.fiberPhase
    })));

  return immutable({
    available: liveAvailable,
    source: 'pluginInventory.list',
    limited: sanitized.limited,
    surfaces,
    issues,
    message: liveAvailable
      ? '实时状态来自 Harness 官方只读插件清单；DSH 不维护第二份加载状态。'
      : (inventoryError || 'Harness 实时扩展清单尚不可用。')
  });
};

module.exports = {
  MAX_INVENTORY_ENTRIES,
  boundedErrorMessage,
  buildExtensionCenter,
  callHarnessRemote,
  categoryOf,
  safeHarnessOrigin,
  safeModuleName,
  sanitizePluginInventory,
  summarize
};
