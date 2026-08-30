const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomBytes, createHash } = require('node:crypto');
const { DocumentIntake, documentReference } = require('./document-intake.cjs');
const { synchronizeHarnessWorkspace } = require('./harness-workspace-sync.cjs');
const { establishHarnessSession, createAuthenticatedHarnessFetch } = require('./harness-supervisor.cjs');
const { callHarnessApi } = require('./harness-workspace-sync.cjs');
const { callHarnessRemote, sanitizePluginInventory } = require('./extension-center.cjs');

const runCredentialAgentSmoke = async ({ output, source, smokeRoot, createSupervisor, runtime, version }) => {
  const homeDir = path.join(smokeRoot, 'harness');
  const workspacePath = path.join(smokeRoot, 'workspace');
  const externalPath = path.join(smokeRoot, 'outside');
  let supervisor, result;
  try {
    if (!source || !path.isAbsolute(source)) throw new Error('真实验收需要显式凭据源路径。');
    await fsp.mkdir(homeDir, { recursive: true }); await fsp.mkdir(workspacePath, { recursive: true }); await fsp.mkdir(externalPath, { recursive: true });
    const encryptedSource = path.basename(source) === '.credentials.dpapi.json';
    const sourceDigest = createHash('sha256').update(await fsp.readFile(source)).digest('hex');
    const vaultExists = await fsp.stat(path.join(homeDir, '.credentials.dpapi.json')).then(() => true, () => false);
    if (encryptedSource ? !vaultExists : vaultExists) throw new Error('测试凭据目录状态不正确，请使用新的完整隔离配置。');
    if (!encryptedSource) await fsp.copyFile(source, path.join(homeDir, '.credentials.yaml'), 1);
    const { createZip, documentEntries, readZip, normalizeSpec: wordSpec } = require(runtime.docxToolPath);
    const { workbookEntries, normalizeSpec: excelSpec } = require(runtime.xlsxToolPath);
    const token = `DOC_${randomBytes(6).toString('hex')}`;
    const left = 100 + randomBytes(1)[0], right = 200 + randomBytes(1)[0];
    const xlsxPath = path.join(externalPath, '核对 数据.xlsx');
    const docxPath = path.join(externalPath, '参考 文档.docx');
    await fsp.writeFile(xlsxPath, createZip(workbookEntries(excelSpec({ sheets: [{ name: '数据', rows: [['项目', '金额'], ['甲', left], ['乙', right]] }] }))));
    await fsp.writeFile(docxPath, createZip(documentEntries(wordSpec({ title: '读取验收', sections: [{ kind: 'paragraph', text: `本次文档标记是 ${token}。` }] }))));
    if (!readZip(await fsp.readFile(docxPath)).get('word/document.xml').toString('utf8').includes(token)) throw new Error('Word 测试资料缺少预期标记，拒绝浪费模型调用。');
    const imported = await new DocumentIntake().importFiles({ workspacePath, paths: [xlsxPath, docxPath] });
    if (imported.items.length !== 2) throw new Error('Office 测试资料导入失败。');
    supervisor = createSupervisor(smokeRoot, workspacePath);
    const auth = await establishHarnessSession(await supervisor.start());
    const origin = auth.origin, fetchImpl = createAuthenticatedHarnessFetch(auth);
    await supervisor.credentialHost.verifyReady(origin, fetchImpl);
    const apiCall = (origin, method, request) => callHarnessApi(origin, method, request, { fetchImpl });
    const inventory = sanitizePluginInventory(await callHarnessRemote(origin, 'pluginInventory', 'list', {}, { fetchImpl }));
    const credentialPlugins = inventory.entries.filter((entry) => /credential/.test(entry.moduleName));
    await fsp.writeFile(`${output}.inventory.json`, JSON.stringify(credentialPlugins));
    if (!credentialPlugins.some((entry) => entry.moduleName === 'dsh-desktop-credentials' && entry.fiberPhase === 'active')
      || credentialPlugins.some((entry) => entry.moduleName === '@deepseek-ai/dsh-credentials-local' && entry.enabled)) throw new Error(`凭据组件未达到安全就绪状态：${JSON.stringify(credentialPlugins)}`);
    const workspace = await synchronizeHarnessWorkspace({ origin, workspacePath, fetchImpl });
    const prompt = ['请读取以下两个真实文件，只使用本机工具，不安装依赖，不访问网络。',
      'Excel 的金额列求和，Word 取出 DOC_ 开头的文档标记。将结果写到工作区 intake-result.json，格式是 {"excelTotal": 数字, "wordMarker": "标记"}。',
      '可使用软件内置的 Word/Excel 工具或 Node.js 从 OOXML ZIP 读取，不能猜测文件内容。除结果文件外不要修改文件。',
      ...imported.items.map(documentReference)].join('\n');
    const receipt = await apiCall(origin, 'session.prompt', { sessionId: workspace.sessionId, mode: 'queue', content: [{ type: 'text', text: prompt }] });
    if (!receipt.accepted) throw new Error('真实任务没有被 Harness 接受。');
    const deadline = Date.now() + 300000; let observed, sawRunning = false, polls = 0;
    while (Date.now() < deadline) {
      const list = await apiCall(origin, 'session.list', {});
      const session = list.items?.find((item) => item.sessionId === workspace.sessionId);
      if (++polls % 15 === 0) await fsp.writeFile(`${output}.progress.json`, JSON.stringify({ polls, running: session?.running, sessionFields: Object.keys(session || {}), encrypted: supervisor.credentialHost?.status() }));
      sawRunning ||= session?.running === true;
      try { observed = JSON.parse(await fsp.readFile(path.join(workspacePath, 'intake-result.json'), 'utf8')); } catch { /* Await actual output. */ }
      if (session?.running === false && observed) break;
      if (sawRunning && session?.running === false) {
        const history = await apiCall(origin, 'session.history', { sessionId: workspace.sessionId, maxMessages: 8 });
        throw new Error(`模型回合结束但没有结果：${JSON.stringify(history).slice(-1800)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (!observed) {
      const history = await apiCall(origin, 'session.history', { sessionId: workspace.sessionId, maxMessages: 8 });
      throw new Error(`真实读取超时：${JSON.stringify(history).slice(-3000)}`);
    }
    const migrated = !await fsp.stat(path.join(homeDir, '.credentials.yaml')).then(() => true, () => false);
    const status = supervisor.credentialHost?.status();
    const checks = [path.join(homeDir, '.credentials.dpapi.json'), path.join(smokeRoot, 'logs', 'harness.log')];
    let noPlaintext = status?.configured === true;
    for (const file of checks) { const content = await fsp.readFile(file, 'utf8'); noPlaintext &&= supervisor.credentialHost.redact(content) === content; }
    const originalUnchanged = createHash('sha256').update(await fsp.readFile(source)).digest('hex') === sourceDigest;
    result = { ok: observed?.excelTotal === left + right && observed?.wordMarker === token && migrated && status?.encrypted && noPlaintext && originalUnchanged,
      version, realModel: true, excelReadVerified: observed?.excelTotal === left + right, wordReadVerified: observed?.wordMarker === token,
      legacyRemovedAfterEncryption: !encryptedSource && migrated, encryptedSource, encryptedStatus: status, noPlaintextInVaultOrLog: noPlaintext, sourceCredentialUnmodified: originalUnchanged,
      boundary: 'XLSX and DOCX real reads; PDF import/render is separate, OCR not included' };
  } catch (error) { result = { ok: false, version, error: String(error.message).replace(/sk-[A-Za-z0-9_-]+/g, '[REDACTED]') }; }
  finally { await supervisor?.stop(); await fsp.mkdir(path.dirname(output), { recursive: true }); await fsp.writeFile(output, `${JSON.stringify(result, null, 2)}\n`); }
  return result;
};
module.exports = { runCredentialAgentSmoke };
