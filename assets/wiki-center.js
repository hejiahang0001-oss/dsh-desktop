(() => {
  'use strict';
  const api = window.wikiCenterAPI;
  if (!api) return;

  const nodes = {
    appVersion: document.getElementById('app-version'),
    onboarding: document.getElementById('wiki-onboarding'),
    onboardingChoose: document.getElementById('onboarding-choose-vault'),
    overview: document.getElementById('wiki-overview'),
    overviewStatus: document.getElementById('overview-status'),
    healthVaultPath: document.getElementById('health-vault-path'),
    healthStructure: document.getElementById('health-structure'),
    healthStructureDetail: document.getElementById('health-structure-detail'),
    healthPageCount: document.getElementById('health-page-count'),
    healthPageDetail: document.getElementById('health-page-detail'),
    healthLastSync: document.getElementById('health-last-sync'),
    healthFreshness: document.getElementById('health-freshness'),
    healthFreshnessDetail: document.getElementById('health-freshness-detail'),
    recoveryCallout: document.getElementById('recovery-callout'),
    recoveryTitle: document.getElementById('recovery-title'),
    recoveryDetail: document.getElementById('recovery-detail'),
    recoveryManagedPages: document.getElementById('recovery-managed-pages'),
    recoveryGuidance: document.getElementById('recovery-guidance'),
    recoverVault: document.getElementById('recover-vault'),
    checkSourceHealth: document.getElementById('check-source-health'),
    refreshWikiState: document.getElementById('refresh-wiki-state'),
    vaultStatus: document.getElementById('vault-status'),
    vaultPath: document.getElementById('vault-path'),
    vaultDetail: document.getElementById('vault-detail'),
    choose: document.getElementById('choose-vault'),
    initialize: document.getElementById('initialize-vault'),
    capabilityList: document.getElementById('capability-list'),
    projectStatus: document.getElementById('project-sync-status'),
    projectName: document.getElementById('project-name'),
    projectPath: document.getElementById('project-path'),
    previewProjectSync: document.getElementById('preview-project-sync'),
    invokeProjectSync: document.getElementById('invoke-project-sync'),
    projectPreview: document.getElementById('project-sync-preview'),
    historyStatus: document.getElementById('history-status'),
    loadHistorySessions: document.getElementById('load-history-sessions'),
    historySessionList: document.getElementById('history-session-list'),
    prepareHistory: document.getElementById('prepare-history'),
    invokeHistory: document.getElementById('invoke-history'),
    historyPreview: document.getElementById('history-preview'),
    queryForm: document.getElementById('query-form'),
    queryInput: document.getElementById('query-input'),
    querySubmit: document.getElementById('query-submit'),
    queryResults: document.getElementById('query-results'),
    loadCandidates: document.getElementById('load-candidates'),
    candidateList: document.getElementById('candidate-list'),
    captureTitle: document.getElementById('capture-title'),
    captureContent: document.getElementById('capture-content'),
    previewCapture: document.getElementById('preview-capture'),
    saveCapture: document.getElementById('save-capture'),
    capturePreview: document.getElementById('capture-preview'),
    globalStatus: document.getElementById('global-status')
  };

  let currentState = {};
  let selectedCandidate = null;
  let previewReady = false;
  const selectedHistory = new Set();
  let historyPrepared = false;
  let historyLimit = 8;
  let sourceCheck = null;
  let recoveryMode = '';
  let managedPageRecovery = null;

  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (typeof text === 'string') node.textContent = text;
    return node;
  };
  const empty = (node) => node.replaceChildren();
  const setStatus = (text) => { nodes.globalStatus.textContent = text; };
  const boundedText = (value, maxLength = 320) => typeof value === 'string'
    ? value.replace(/[\u0000\r\n]+/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, maxLength)
    : '';
  const managedRecoveryFrom = (response, scope) => {
    const code = boundedText(response?.code, 64).toLowerCase();
    const pages = Array.isArray(response?.missingManagedPages)
      ? response.missingManagedPages
        .filter((item) => typeof item === 'string')
        .map((item) => boundedText(item, 240))
        .filter(Boolean)
        .slice(0, 12)
      : [];
    if (code !== 'managed-pages-missing' && pages.length === 0) return null;
    const archiveKind = scope === 'history' ? 'dsh-history-ingest' : scope === 'capture' ? 'dsh-capture' : 'dsh-project-sync';
    return Object.freeze({ scope, pages: Object.freeze(pages), archiveHint: `_archives/${archiveKind}/` });
  };
  const adoptManagedRecovery = (response, scope) => {
    const next = managedRecoveryFrom(response, scope);
    if (next) managedPageRecovery = next;
    else if (managedPageRecovery?.scope === scope) managedPageRecovery = null;
    return next;
  };
  const trustedVersion = (state) => {
    const value = boundedText(state?.appVersion || state?.app?.version, 64);
    return /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/u.test(value) ? value : '';
  };
  const trustedHarnessVersion = (state) => {
    const value = boundedText(state?.harness?.version, 64);
    return /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/u.test(value) ? value : '';
  };
  const trustedTimestamp = (...values) => values.find((value) => (
    typeof value === 'string'
      && value.length >= 20
      && value.length <= 40
      && Number.isFinite(Date.parse(value))
  )) || '';
  const displayTimestamp = (value, fallback) => {
    if (!value) return fallback;
    try {
      return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
    } catch {
      return fallback;
    }
  };
  const setHealthTone = (node, tone = '') => {
    const item = node.closest('.health-item');
    if (!item) return;
    item.classList.remove('is-ready', 'is-warning', 'is-unavailable');
    if (tone) item.classList.add(tone);
  };
  const normalizeFreshness = (state) => {
    const declared = state?.vault?.sourceFreshness
      ?? state?.sourceFreshness
      ?? state?.project?.sourceFreshness;
    const raw = declared && typeof declared === 'object' && !Array.isArray(declared)
      ? declared
      : { status: declared };
    let status = boundedText(raw.status, 32).toLowerCase();
    let checkedAt = trustedTimestamp(
      raw.checkedAt,
      state?.vault?.sourceCheckedAt,
      state?.sourceCheckedAt,
      state?.project?.sourceCheckedAt
    );
    let message = boundedText(raw.message);
    if (sourceCheck?.ok === true) {
      status = sourceCheck.unchanged ? 'fresh' : 'stale';
      checkedAt = trustedTimestamp(sourceCheck.generatedAt, checkedAt);
      message = sourceCheck.unchanged
        ? '当前项目来源与最近一次同步记录一致。'
        : '当前项目来源有尚未同步的变化。';
    } else if (sourceCheck?.ok === false) {
      status = 'unavailable';
      message = boundedText(sourceCheck.message) || '来源检查失败，可稍后重试。';
    }
    status = ({ ready: 'fresh', current: 'fresh', changed: 'stale', outdated: 'stale', error: 'unavailable' })[status] || status;
    if (!['fresh', 'stale', 'checking', 'unavailable'].includes(status)) status = 'unknown';
    return { status, checkedAt, message };
  };

  const renderHealth = (state = {}) => {
    const vault = state.vault || {};
    const configured = vault.configured === true;
    const version = trustedVersion(state);
    const harnessVersion = trustedHarnessVersion(state);
    nodes.appVersion.textContent = `${version ? `DSH Desktop V${version}` : 'DSH Desktop'}${harnessVersion ? ` · Harness V${harnessVersion}` : ''}`;
    nodes.onboarding.hidden = configured;
    nodes.overview.hidden = !configured;
    if (!configured) return;

    nodes.healthVaultPath.textContent = boundedText(vault.vaultPath, 1024) || '路径状态不可用';
    const declaredRecovery = state.recovery && typeof state.recovery === 'object' ? state.recovery : null;
    const manualRecovery = declaredRecovery?.available === true && declaredRecovery.manualOnly === true;
    const missing = Array.isArray(vault.missing) ? vault.missing.filter((item) => typeof item === 'string') : [];
    const structure = ({
      ready: ['结构完整', '基础目录、索引和清单均可用。', 'is-ready'],
      'needs-init': [`缺少 ${missing.length} 项`, missing.length ? `缺少：${missing.slice(0, 6).join('、')}${missing.length > 6 ? ' 等' : ''}` : '结构不完整。', 'is-warning'],
      'recovery-required': ['写入保护中', '检测到待人工核对的恢复事务；核对完成前不会继续写入。', 'is-warning'],
      unavailable: manualRecovery
        ? ['恢复保护异常', boundedText(declaredRecovery.message) || '恢复保护记录无法安全校验；写入保持停用。', 'is-warning']
        : ['目录不可访问', boundedText(vault.message) || '请重新选择有效目录。', 'is-unavailable']
    })[vault.status] || ['等待检查', '知识库状态尚未提供。', ''];
    nodes.healthStructure.textContent = structure[0];
    nodes.healthStructureDetail.textContent = structure[1];
    setHealthTone(nodes.healthStructure, structure[2]);

    const pageCount = Number.isInteger(vault.pageCount) && vault.pageCount >= 0 ? vault.pageCount : 0;
    nodes.healthPageCount.textContent = String(pageCount);
    nodes.healthPageDetail.textContent = vault.limited === true ? '已达到安全扫描上限，实际页面可能更多。' : '可查询 Markdown 页面。';

    const lastSyncAt = trustedTimestamp(vault.lastSyncAt, state.lastSyncAt, state.project?.lastSyncAt);
    nodes.healthLastSync.textContent = displayTimestamp(
      lastSyncAt,
      sourceCheck?.ok === true && sourceCheck.unchanged ? '已同步，时间未提供' : '暂无可信记录'
    );

    const freshness = normalizeFreshness(state);
    const freshnessView = ({
      fresh: ['来源最新', 'is-ready'],
      stale: ['发现变化', 'is-warning'],
      checking: ['检查中', ''],
      unavailable: [sourceCheck?.ok === false ? '检查失败' : '暂不可查', 'is-unavailable'],
      unknown: ['待检查', '']
    })[freshness.status];
    nodes.healthFreshness.textContent = freshnessView[0];
    nodes.healthFreshnessDetail.textContent = freshness.message
      || (freshness.checkedAt ? `最近检查：${displayTimestamp(freshness.checkedAt, '时间不可用')}` : '点击检查后读取当前项目增量。');
    setHealthTone(nodes.healthFreshness, freshnessView[1]);
    nodes.checkSourceHealth.disabled = !state.project?.available;

    let recovery = null;
    if (declaredRecovery?.available === true) {
      recovery = {
        mode: 'ipc',
        label: boundedText(declaredRecovery.label, 60) || '运行安全恢复',
        message: boundedText(declaredRecovery.message) || '恢复前会再次校验当前知识库状态。'
      };
    } else if (managedPageRecovery) {
      const count = managedPageRecovery.pages.length;
      recovery = {
        mode: 'managed-pages-missing',
        label: '核对缺失受管页',
        actionLabel: '检查恢复副本',
        message: count
          ? `检测到 ${count} 个受管 Wiki 页面缺失或不安全，普通同步保持停用。`
          : '检测到受管 Wiki 页面缺失或不安全，普通同步保持停用。',
        pages: count ? `缺失：${managedPageRecovery.pages.join('、')}` : '',
        guidance: `先检查恢复副本；如恢复中心没有匹配事务，请在当前 Vault 的 ${managedPageRecovery.archiveHint} 中核对最新副本，手动恢复缺失页后再刷新状态并重新检查来源。软件不会自动删除清单记录。`
      };
    } else if (vault.status === 'recovery-required') {
      recovery = {
        mode: 'ipc',
        label: '核对恢复事务',
        message: '知识库仍处于写入保护状态；打开恢复中心核对副本，确认前不会继续写入。'
      };
    } else if (vault.status === 'unavailable') {
      recovery = { mode: 'choose-vault', label: '重新选择可用目录', message: '原目录当前不可访问；重新选择不会修改原目录。' };
    } else if (vault.status === 'needs-init') {
      recovery = { mode: 'initialize-vault', label: '补齐缺失结构', message: '只创建缺失项，不覆盖已有页面。' };
    } else if (freshness.status === 'stale' && state.project?.available) {
      recovery = { mode: 'refresh-source', label: '检查并同步来源', message: '先重新检查项目增量，再由你决定是否交给 Agent 同步。' };
    }
    recoveryMode = recovery?.mode || '';
    nodes.recoveryCallout.hidden = !recovery;
    nodes.recoverVault.disabled = !recovery;
    if (recovery) {
      nodes.recoveryTitle.textContent = recovery.label;
      nodes.recoveryDetail.textContent = recovery.message;
      nodes.recoveryManagedPages.textContent = recovery.pages || '';
      nodes.recoveryManagedPages.hidden = !recovery.pages;
      nodes.recoveryGuidance.textContent = recovery.guidance || '';
      nodes.recoveryGuidance.hidden = !recovery.guidance;
      nodes.recoverVault.textContent = recovery.actionLabel || recovery.label;
    } else {
      nodes.recoveryManagedPages.textContent = '';
      nodes.recoveryManagedPages.hidden = true;
      nodes.recoveryGuidance.textContent = '';
      nodes.recoveryGuidance.hidden = true;
    }

    const healthy = vault.status === 'ready' && freshness.status !== 'stale' && freshness.status !== 'unavailable';
    nodes.overviewStatus.className = `status ${healthy ? 'ready' : vault.status === 'unavailable' ? 'unavailable' : 'needs-init'}`;
    nodes.overviewStatus.textContent = healthy ? '可用' : recovery ? '需要处理' : '待检查';
  };

  const setHistoryDirty = () => {
    historyPrepared = false;
    nodes.invokeHistory.disabled = true;
    nodes.prepareHistory.disabled = selectedHistory.size < 1 || !currentState.history?.available;
    nodes.historyPreview.className = 'preview';
    nodes.historyPreview.textContent = selectedHistory.size > 0
      ? `已选择 ${selectedHistory.size} 个会话。请先检查范围。`
      : '尚未准备历史范围。Agent 完成预览和校验后，仍会在后续对话中等待你的明确确认再保存。';
  };

  const setPreviewDirty = () => {
    previewReady = false;
    nodes.saveCapture.disabled = true;
    nodes.previewCapture.disabled = !selectedCandidate || !currentState.vault?.ready;
    nodes.capturePreview.className = 'preview';
    nodes.capturePreview.textContent = selectedCandidate ? '内容已变化，请重新预览保存范围。' : '尚未生成保存预览。';
  };

  const renderCapabilities = (items = []) => {
    empty(nodes.capabilityList);
    for (const item of items) {
      const card = element('div', 'capability');
      card.append(element('strong', '', item.name || ''), element('small', '', item.status === 'ready' ? '已内置' : '组件缺失'));
      nodes.capabilityList.append(card);
    }
  };

  const renderState = (state = {}, { preserveSourceCheck = false } = {}) => {
    currentState = state;
    if (!preserveSourceCheck) sourceCheck = null;
    renderHealth(state);
    const vault = state.vault || {};
    nodes.vaultStatus.className = `status ${vault.status || 'waiting'}`;
    nodes.vaultStatus.textContent = ({ ready: '已就绪', 'needs-init': '待初始化', 'recovery-required': '写入保护中', unavailable: '不可用', unconfigured: '未配置' })[vault.status] || '检查中';
    nodes.vaultPath.textContent = vault.vaultPath || '尚未选择知识库目录。';
    nodes.vaultDetail.textContent = vault.message || '目录由本机用户选择；不复制个人 Vault、历史或凭据。';
    nodes.initialize.disabled = !vault.configured || vault.status !== 'needs-init';
    nodes.querySubmit.disabled = vault.status !== 'ready';
    nodes.loadCandidates.disabled = vault.status !== 'ready' || state.harness?.status !== 'ready' || !state.session?.available;
    const project = state.project || {};
    nodes.projectStatus.className = `status ${project.available ? 'ready' : 'waiting'}`;
    nodes.projectStatus.textContent = project.available ? '可检查' : '待工作区';
    nodes.projectName.textContent = project.name || '尚未读取当前项目。';
    nodes.projectPath.textContent = project.path || '只扫描受支持的源码与说明文件；外部知识库写入仍遵循 Harness 官方权限确认。';
    nodes.previewProjectSync.disabled = !project.available;
    nodes.invokeProjectSync.disabled = !project.available || state.harness?.status !== 'ready';
    nodes.projectPreview.className = 'preview';
    nodes.projectPreview.textContent = '尚未检查项目增量；保存前仍会再次校验并要求确认。';
    const history = state.history || {};
    nodes.historyStatus.className = `status ${history.available ? 'ready' : 'waiting'}`;
    nodes.historyStatus.textContent = history.available ? '可选择' : '待工作区';
    nodes.loadHistorySessions.disabled = !history.available;
    selectedHistory.clear();
    empty(nodes.historySessionList);
    nodes.historySessionList.append(element('p', 'empty', '每次最多选择 8 个已完成会话；原始历史保持只读。'));
    setHistoryDirty();
    renderCapabilities(state.skills || []);
    setPreviewDirty();
    setStatus(vault.status === 'ready'
      ? `知识库已就绪，共发现 ${vault.pageCount || 0} 个可查询页面。`
      : (vault.message || '请选择或初始化知识库。'));
  };

  const renderQueryResults = (response = {}) => {
    empty(nodes.queryResults);
    const results = Array.isArray(response.results) ? response.results : [];
    if (results.length === 0) {
      nodes.queryResults.append(element('p', 'empty', response.ok ? '知识库当前没有覆盖这个主题。' : (response.message || '查询失败。')));
      return;
    }
    for (const item of results) {
      const card = element('article', 'result');
      card.append(
        element('h3', '', item.title || item.path || '未命名页面'),
        element('div', 'meta', `页面：${item.path || ''}`),
        element('p', '', item.summary || item.excerpt || ''),
        element('div', 'meta', `来源：${(item.sources || []).join('；') || '页面未记录外部来源'}`)
      );
      nodes.queryResults.append(card);
    }
  };

  const capturePayload = () => ({
    title: nodes.captureTitle.value,
    content: nodes.captureContent.value,
    sourceSeq: selectedCandidate?.seq
  });

  const renderCandidates = (response = {}) => {
    empty(nodes.candidateList);
    selectedCandidate = null;
    const items = Array.isArray(response.items) ? response.items : [];
    if (items.length === 0) {
      nodes.candidateList.append(element('p', 'empty', response.message || '当前会话没有可保存的已完成助手结论。'));
      setPreviewDirty();
      return;
    }
    for (const item of items) {
      const label = element('label', 'candidate');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'wiki-candidate';
      radio.value = String(item.seq);
      const copy = element('div', '');
      copy.append(
        element('h3', '', item.title || `会话结论 #${item.seq}`),
        element('p', '', item.preview || ''),
        element('div', 'meta', `会话事件 ${item.seq}${item.interrupted ? ' · 已中断前缀' : ''}`)
      );
      radio.addEventListener('change', () => {
        selectedCandidate = item;
        nodes.captureTitle.value = item.title || `会话结论 ${item.seq}`;
        nodes.captureContent.value = item.text || '';
        setPreviewDirty();
      });
      label.append(radio, copy);
      nodes.candidateList.append(label);
    }
    setPreviewDirty();
  };

  const renderHistorySessions = (response = {}) => {
    empty(nodes.historySessionList);
    selectedHistory.clear();
    historyLimit = Number.isInteger(response.limit) ? response.limit : 8;
    const items = Array.isArray(response.items) ? response.items : [];
    if (items.length === 0) {
      nodes.historySessionList.append(element('p', 'empty', response.message || '当前工作区没有可导入的普通会话。'));
      setHistoryDirty();
      return;
    }
    for (const item of items) {
      const label = element('label', `candidate${item.ready ? '' : ' is-disabled'}`);
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = item.id || '';
      checkbox.disabled = !item.ready;
      const copy = element('div', '');
      const date = item.updatedAt ? new Date(item.updatedAt).toLocaleString('zh-CN') : '时间未知';
      copy.append(
        element('h3', '', item.title || '未命名 DSH 会话'),
        element('div', 'meta', `${date}${item.ready ? ' · 可导入' : ' · 正在运行'}`)
      );
      checkbox.addEventListener('change', () => {
        if (checkbox.checked && selectedHistory.size >= historyLimit) {
          checkbox.checked = false;
          setStatus(`每次最多选择 ${historyLimit} 个会话。`);
          return;
        }
        if (checkbox.checked) selectedHistory.add(item.id);
        else selectedHistory.delete(item.id);
        setHistoryDirty();
      });
      label.append(checkbox, copy);
      nodes.historySessionList.append(label);
    }
    setHistoryDirty();
  };

  const chooseWikiVault = async () => {
    nodes.choose.disabled = true;
    nodes.onboardingChoose.disabled = true;
    setStatus('正在打开本机知识库目录选择器…');
    try {
      const response = await api.chooseVault();
      if (response?.state) renderState(response.state);
      else setStatus(response?.message || '未更改知识库。');
    } catch {
      setStatus('知识库选择失败；没有写入任何目录。');
    } finally {
      nodes.choose.disabled = false;
      nodes.onboardingChoose.disabled = false;
    }
  };

  const initializeWikiVault = async () => {
    nodes.initialize.disabled = true;
    setStatus('等待确认并初始化缺失的知识库结构…');
    try {
      const response = await api.initializeVault();
      if (response?.state) renderState(response.state);
      setStatus(response?.message || (response?.ok ? '知识库初始化完成。' : '知识库未改变。'));
    } catch {
      setStatus('知识库初始化失败；已有文件不会被覆盖。');
    } finally {
      nodes.initialize.disabled = !currentState.vault?.configured || currentState.vault?.status !== 'needs-init';
    }
  };

  nodes.choose.addEventListener('click', chooseWikiVault);
  nodes.onboardingChoose.addEventListener('click', chooseWikiVault);
  nodes.initialize.addEventListener('click', initializeWikiVault);

  nodes.queryForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const query = nodes.queryInput.value.trim();
    if (!query) return;
    nodes.querySubmit.disabled = true;
    setStatus('正在只读查询已编译的 Wiki 页面…');
    try {
      const response = await api.query(query);
      renderQueryResults(response);
      setStatus(response?.ok ? `查询完成：返回 ${(response.results || []).length} 个页面。` : (response?.message || '查询失败。'));
    } catch {
      renderQueryResults({ ok: false, message: '查询失败；知识库页面没有被修改。' });
      setStatus('查询失败；知识库页面没有被修改。');
    } finally {
      nodes.querySubmit.disabled = currentState.vault?.status !== 'ready';
    }
  });

  const inspectProjectSource = async () => {
    nodes.previewProjectSync.disabled = true;
    nodes.checkSourceHealth.disabled = true;
    nodes.invokeProjectSync.disabled = true;
    nodes.healthFreshness.textContent = '检查中';
    nodes.healthFreshnessDetail.textContent = '正在读取受支持的项目源文件和 Wiki 清单。';
    setHealthTone(nodes.healthFreshness);
    setStatus('正在检查当前项目的受支持源文件和 Wiki 清单…');
    try {
      const response = await api.previewProjectSync();
      const missingRecovery = adoptManagedRecovery(response, 'project');
      if (!response?.ok && !missingRecovery) throw new Error(response?.message || 'project-preview-failed');
      sourceCheck = response;
      renderHealth(currentState);
      if (!response?.ok && missingRecovery) {
        nodes.projectStatus.className = 'status unavailable';
        nodes.projectStatus.textContent = '受管页缺失';
        nodes.projectPreview.className = 'preview warning';
        nodes.projectPreview.textContent = `${boundedText(response.message) || '受管页面缺失或不安全。'}\n\n普通同步保持停用；请按上方恢复提示核对副本。`;
        setStatus('受管页面缺失或不安全；普通同步保持停用，请先核对恢复副本。');
        return;
      }
      const mode = response.mode === 'git' ? 'Git 增量 + 内容清单' : '内容清单（无需 Git）';
      const existingPages = Array.isArray(response.existingPages)
        ? response.existingPages.length
        : (Number.isInteger(response.existingPages) ? response.existingPages : 0);
      const missingManaged = Array.isArray(response.missingManagedPages) ? response.missingManagedPages.length : 0;
      nodes.projectStatus.className = `status ${response.unchanged ? 'ready' : missingManaged ? 'unavailable' : 'needs-init'}`;
      nodes.projectStatus.textContent = response.unchanged ? '已同步' : missingManaged ? '受管页缺失' : '有增量';
      nodes.projectPreview.className = `preview ${response.limited || missingManaged ? 'warning' : ''}`;
      const humanEdited = Array.isArray(response.humanEditedPages) ? response.humanEditedPages.length : 0;
      nodes.projectPreview.textContent = `项目：${response.project?.name || ''}\n模式：${mode}\n扫描：${response.scannedFiles || 0} 个文件${response.limited ? '（已达到安全上限）' : ''}\n增量：新增 ${response.delta?.added || 0}，修改 ${response.delta?.modified || 0}，移除 ${response.delta?.removed || 0}\n已有 Wiki 页面：${existingPages}\n缺失或不安全的受管页：${missingManaged}\n人工修改：${humanEdited ? `${humanEdited} 页，Agent 同步前必须先读取合并` : '未检测到已跟踪页面偏离上次成功写入'}\n${response.message || ''}`;
      nodes.invokeProjectSync.disabled = response.unchanged || missingManaged > 0 || currentState.harness?.status !== 'ready';
      setStatus(response.unchanged
        ? '当前项目知识已是最新。'
        : missingManaged
          ? '受管页面缺失或不安全；普通同步已停止，请先核对恢复副本。'
          : '已发现项目增量；可让 Agent 按来源整理并在确认后同步。');
    } catch (error) {
      sourceCheck = { ok: false, message: error?.message && error.message !== 'project-preview-failed' ? error.message : '' };
      renderHealth(currentState);
      nodes.projectStatus.className = 'status unavailable';
      nodes.projectStatus.textContent = '检查失败';
      nodes.projectPreview.className = 'preview warning';
      nodes.projectPreview.textContent = error?.message && error.message !== 'project-preview-failed' ? error.message : '项目增量检查失败；知识库没有被修改。';
      setStatus('项目增量检查失败；知识库没有被修改。');
    } finally {
      nodes.previewProjectSync.disabled = !currentState.project?.available;
      nodes.checkSourceHealth.disabled = !currentState.project?.available;
    }
  };

  nodes.previewProjectSync.addEventListener('click', inspectProjectSource);
  nodes.checkSourceHealth.addEventListener('click', inspectProjectSource);

  nodes.invokeProjectSync.addEventListener('click', async () => {
    nodes.invokeProjectSync.disabled = true;
    setStatus('正在返回当前对话并加载 /wiki-update…');
    try {
      const response = await api.invokeProjectSync();
      if (!response?.ok) {
        setStatus(response?.message || '未能加载项目同步 Skill。');
        nodes.invokeProjectSync.disabled = false;
      }
    } catch {
      setStatus('未能加载项目同步 Skill；可在对话中手动输入 /wiki-update。');
      nodes.invokeProjectSync.disabled = false;
    }
  });

  nodes.loadHistorySessions.addEventListener('click', async () => {
    nodes.loadHistorySessions.disabled = true;
    setStatus('正在读取当前工作区的普通 DSH 会话目录…');
    try {
      const response = await api.listHistorySessions();
      renderHistorySessions(response);
      setStatus(response?.message || `已读取 ${(response.items || []).length} 个会话。`);
    } catch {
      renderHistorySessions({ message: 'DSH 历史列表读取失败；原始会话没有改变。' });
      setStatus('DSH 历史列表读取失败；原始会话没有改变。');
    } finally {
      nodes.loadHistorySessions.disabled = !currentState.history?.available;
    }
  });

  nodes.prepareHistory.addEventListener('click', async () => {
    if (selectedHistory.size < 1) return;
    nodes.prepareHistory.disabled = true;
    nodes.invokeHistory.disabled = true;
    setStatus('正在读取所选用户/助手文本，并在交给 Agent 前遮蔽固定凭据模式…');
    try {
      const response = await api.prepareHistory({ ids: [...selectedHistory] });
      const missingRecovery = adoptManagedRecovery(response, 'history');
      if (!response?.ok && !missingRecovery) throw new Error(response?.message || 'history-prepare-failed');
      renderHealth(currentState);
      if (!response?.ok && missingRecovery) {
        historyPrepared = false;
        nodes.historyStatus.className = 'status unavailable';
        nodes.historyStatus.textContent = '受管页缺失';
        nodes.historyPreview.className = 'preview warning';
        nodes.historyPreview.textContent = `${boundedText(response.message) || '受管历史页面缺失或不安全。'}\n\n历史导入保持停用；请按上方恢复提示核对副本。`;
        setStatus('受管历史页面缺失或不安全；历史导入保持停用，请先核对恢复副本。');
        return;
      }
      const warnings = (response.redactions || []).map((item) => `${item.label} ${item.count} 处`).join('、');
      const rows = (response.sessions || []).map((item) => `${item.title}：${item.messageCount} 条 · ${{ added: '新增', modified: '有变化', unchanged: '已导入' }[item.status] || item.status}${item.limited ? ' · 已按上限截取' : ''}`);
      const missingManaged = Array.isArray(response.missingManagedPages) ? response.missingManagedPages.length : 0;
      if (missingManaged) {
        adoptManagedRecovery(response, 'history');
        renderHealth(currentState);
      }
      nodes.historyStatus.className = `status ${response.unchanged ? 'ready' : response.blocked ? 'unavailable' : 'needs-init'}`;
      nodes.historyStatus.textContent = response.unchanged ? '无需更新' : response.blocked ? '受管页缺失' : '待整理';
      nodes.historyPreview.className = `preview ${warnings || response.limited || response.blocked ? 'warning' : 'success'}`;
      nodes.historyPreview.textContent = `项目：${response.project?.name || ''}\n会话：${response.sessionCount || 0} 个（新增 ${response.addedCount || 0}，有变化 ${response.modifiedCount || 0}，未变化 ${response.unchangedCount || 0}）\n可用文本：${response.totalMessages || 0} 条${response.limited ? '（部分会话已按安全上限截取）' : ''}\n缺失或不安全的受管页：${missingManaged}\n凭据遮蔽：${warnings || '未命中固定模式'}\n\n${rows.join('\n')}\n\n${response.message || ''}`;
      historyPrepared = !response.unchanged && !response.blocked;
      nodes.invokeHistory.disabled = !historyPrepared;
      setStatus(response.message || (response.unchanged ? '所选会话无需重复导入。' : '历史范围已准备。'));
    } catch (error) {
      historyPrepared = false;
      nodes.historyStatus.className = 'status unavailable';
      nodes.historyStatus.textContent = '准备失败';
      nodes.historyPreview.className = 'preview warning';
      nodes.historyPreview.textContent = error?.message && error.message !== 'history-prepare-failed' ? error.message : '历史范围准备失败；知识库没有被修改。';
      setStatus('历史范围准备失败；请重新加载会话后再试。');
    } finally {
      nodes.prepareHistory.disabled = selectedHistory.size < 1 || !currentState.history?.available;
    }
  });

  nodes.invokeHistory.addEventListener('click', async () => {
    if (!historyPrepared) return;
    nodes.invokeHistory.disabled = true;
    setStatus('正在返回当前对话并加载 /wiki-history-ingest dsh…');
    try {
      const response = await api.invokeHistory();
      if (!response?.ok) {
        setStatus(response?.message || '未能加载 DSH 历史导入 Skill。');
        nodes.invokeHistory.disabled = false;
      }
    } catch {
      setStatus('未能加载 DSH 历史导入 Skill；请重新准备历史。');
      nodes.invokeHistory.disabled = false;
    }
  });

  nodes.loadCandidates.addEventListener('click', async () => {
    nodes.loadCandidates.disabled = true;
    setStatus('正在读取当前 Harness 会话的最近助手消息…');
    try {
      const response = await api.getSessionCandidates();
      renderCandidates(response);
      setStatus(response?.message || `已读取 ${(response.items || []).length} 个候选结论。`);
    } catch {
      renderCandidates({ message: '会话候选读取失败；原始会话没有改变。' });
      setStatus('会话候选读取失败；原始会话没有改变。');
    } finally {
      nodes.loadCandidates.disabled = currentState.vault?.status !== 'ready' || currentState.harness?.status !== 'ready' || !currentState.session?.available;
    }
  });

  nodes.captureTitle.addEventListener('input', setPreviewDirty);
  nodes.captureContent.addEventListener('input', setPreviewDirty);

  nodes.previewCapture.addEventListener('click', async () => {
    nodes.previewCapture.disabled = true;
    setStatus('正在校验保存路径、来源和敏感内容…');
    try {
      const response = await api.previewCapture(capturePayload());
      if (!response?.ok) throw new Error(response?.message || 'preview-failed');
      previewReady = true;
      nodes.saveCapture.disabled = false;
      const warnings = (response.sensitive || []).map((item) => item.label).join('、');
      nodes.capturePreview.className = `preview ${warnings ? 'warning' : ''}`;
      nodes.capturePreview.textContent = `目标：${response.path}\n摘要：${response.summary || ''}\n来源：${response.source || ''}${warnings ? `\n敏感检查：${warnings}，保存时会再次确认。` : '\n敏感检查：未发现固定凭据模式。'}`;
      setStatus('保存范围已预览；点击“确认并保存”后还会出现原生确认。');
    } catch (error) {
      previewReady = false;
      nodes.saveCapture.disabled = true;
      nodes.capturePreview.className = 'preview warning';
      nodes.capturePreview.textContent = error?.message === 'preview-failed' ? '预览失败。' : '预览失败；请重新选择当前会话结论。';
      setStatus('保存预览失败；没有写入知识库。');
    } finally {
      nodes.previewCapture.disabled = !selectedCandidate || !currentState.vault?.ready;
    }
  });

  nodes.saveCapture.addEventListener('click', async () => {
    if (!previewReady) return;
    nodes.saveCapture.disabled = true;
    setStatus('等待原生确认并写入页面、索引和日志…');
    try {
      const response = await api.saveCapture(capturePayload());
      if (!response?.ok) {
        setStatus(response?.message || '结论未保存。');
        nodes.saveCapture.disabled = false;
        return;
      }
      nodes.capturePreview.className = `preview ${response.cleanupPending ? 'warning' : 'success'}`;
      nodes.capturePreview.textContent = `已保存：${response.path}\n${response.message || ''}`;
      setStatus(response.cleanupPending
        ? '结论已保存；写入锁仍待安全清理，请勿重复提交。'
        : '结论已保存；原始 Harness 会话保持只读。');
      previewReady = false;
    } catch {
      setStatus('结论保存失败；请查看错误或恢复提示。软件不会自动覆盖并发修改。');
      nodes.saveCapture.disabled = false;
    }
  });

  const refreshWikiState = async () => {
    nodes.refreshWikiState.disabled = true;
    setStatus('正在刷新知识库状态…');
    try {
      const state = await api.getState();
      renderState(state);
      setStatus(state?.vault?.status === 'ready'
        ? `状态已刷新，共发现 ${state.vault.pageCount || 0} 个可查询页面。`
        : (state?.vault?.message || '状态已刷新。'));
    } catch {
      setStatus('Wiki 中心状态刷新失败；现有知识库没有改变。');
    } finally {
      nodes.refreshWikiState.disabled = false;
    }
  };

  nodes.refreshWikiState.addEventListener('click', refreshWikiState);
  nodes.recoverVault.addEventListener('click', async () => {
    if (!recoveryMode) return;
    nodes.recoverVault.disabled = true;
    if (recoveryMode === 'choose-vault') {
      await chooseWikiVault();
      renderHealth(currentState);
      return;
    }
    if (recoveryMode === 'initialize-vault') {
      await initializeWikiVault();
      renderHealth(currentState);
      return;
    }
    if (recoveryMode === 'refresh-source') {
      await inspectProjectSource();
      renderHealth(currentState);
      return;
    }
    const managedRecovery = recoveryMode === 'managed-pages-missing';
    setStatus(managedRecovery ? '正在检查可用的 Wiki 恢复副本…' : '正在运行 Wiki 安全恢复…');
    try {
      const response = await api.recover();
      if (response?.state) renderState(response.state);
      if (managedRecovery && !response?.ok) {
        setStatus(`恢复中心没有打开匹配副本。请在当前 Vault 的 ${managedPageRecovery?.archiveHint || '_archives/'} 中核对最新副本，手动恢复缺失页后再刷新状态并重新检查来源。`);
      } else {
        setStatus(response?.message || (response?.ok ? 'Wiki 恢复操作已完成。' : 'Wiki 恢复未执行。'));
      }
    } catch {
      setStatus(managedRecovery
        ? `恢复中心暂不可用。请在当前 Vault 的 ${managedPageRecovery?.archiveHint || '_archives/'} 中核对最新副本；知识库没有被自动修改。`
        : 'Wiki 恢复入口暂不可用；知识库没有被修改。');
    } finally {
      renderHealth(currentState);
    }
  });

  document.getElementById('close').addEventListener('click', () => window.close());
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') window.close(); });
  api.getState().then(renderState).catch(() => setStatus('Wiki 中心状态不可用。'));
})();
