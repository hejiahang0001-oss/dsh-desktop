(() => {
  'use strict';
  const api = window.wikiCenterAPI;
  if (!api) return;

  const nodes = {
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

  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (typeof text === 'string') node.textContent = text;
    return node;
  };
  const empty = (node) => node.replaceChildren();
  const setStatus = (text) => { nodes.globalStatus.textContent = text; };

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

  const renderState = (state = {}) => {
    currentState = state;
    const vault = state.vault || {};
    nodes.vaultStatus.className = `status ${vault.status || 'waiting'}`;
    nodes.vaultStatus.textContent = ({ ready: '已就绪', 'needs-init': '待初始化', unavailable: '不可用', unconfigured: '未配置' })[vault.status] || '检查中';
    nodes.vaultPath.textContent = vault.vaultPath || '尚未选择知识库目录。';
    nodes.vaultDetail.textContent = vault.message || '目录由本机用户选择；不复制个人 Vault、历史或凭据。';
    nodes.initialize.disabled = !vault.configured || vault.status === 'ready';
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

  nodes.choose.addEventListener('click', async () => {
    nodes.choose.disabled = true;
    setStatus('正在打开本机知识库目录选择器…');
    try {
      const response = await api.chooseVault();
      if (response?.state) renderState(response.state);
      else setStatus(response?.message || '未更改知识库。');
    } catch {
      setStatus('知识库选择失败；没有写入任何目录。');
    } finally {
      nodes.choose.disabled = false;
    }
  });

  nodes.initialize.addEventListener('click', async () => {
    nodes.initialize.disabled = true;
    setStatus('等待确认并初始化缺失的知识库结构…');
    try {
      const response = await api.initializeVault();
      if (response?.state) renderState(response.state);
      setStatus(response?.message || (response?.ok ? '知识库初始化完成。' : '知识库未改变。'));
    } catch {
      setStatus('知识库初始化失败；已有文件不会被覆盖。');
    }
  });

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

  nodes.previewProjectSync.addEventListener('click', async () => {
    nodes.previewProjectSync.disabled = true;
    nodes.invokeProjectSync.disabled = true;
    setStatus('正在检查当前项目的受支持源文件和 Wiki 清单…');
    try {
      const response = await api.previewProjectSync();
      if (!response?.ok) throw new Error(response?.message || 'project-preview-failed');
      const mode = response.mode === 'git' ? 'Git 增量 + 内容清单' : '内容清单（无需 Git）';
      nodes.projectStatus.className = `status ${response.unchanged ? 'ready' : 'needs-init'}`;
      nodes.projectStatus.textContent = response.unchanged ? '已同步' : '有增量';
      nodes.projectPreview.className = `preview ${response.limited ? 'warning' : ''}`;
      nodes.projectPreview.textContent = `项目：${response.project?.name || ''}\n模式：${mode}\n扫描：${response.scannedFiles || 0} 个文件${response.limited ? '（已达到安全上限）' : ''}\n增量：新增 ${response.delta?.added || 0}，修改 ${response.delta?.modified || 0}，移除 ${response.delta?.removed || 0}\n已有 Wiki 页面：${response.existingPages || 0}\n${response.message || ''}`;
      nodes.invokeProjectSync.disabled = response.unchanged || currentState.harness?.status !== 'ready';
      setStatus(response.unchanged ? '当前项目知识已是最新。' : '已发现项目增量；可让 Agent 按来源整理并在确认后同步。');
    } catch (error) {
      nodes.projectStatus.className = 'status unavailable';
      nodes.projectStatus.textContent = '检查失败';
      nodes.projectPreview.className = 'preview warning';
      nodes.projectPreview.textContent = error?.message && error.message !== 'project-preview-failed' ? error.message : '项目增量检查失败；知识库没有被修改。';
      setStatus('项目增量检查失败；知识库没有被修改。');
    } finally {
      nodes.previewProjectSync.disabled = !currentState.project?.available;
    }
  });

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
      nodes.capturePreview.className = 'preview success';
      nodes.capturePreview.textContent = `已保存：${response.path}\n${response.message || ''}`;
      setStatus('结论已保存；原始 Harness 会话保持只读。');
      previewReady = false;
    } catch {
      setStatus('结论保存失败；未完成的页面和跟踪更新已回退。');
      nodes.saveCapture.disabled = false;
    }
  });

  document.getElementById('close').addEventListener('click', () => window.close());
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') window.close(); });
  api.getState().then(renderState).catch(() => setStatus('Wiki 中心状态不可用。'));
})();
