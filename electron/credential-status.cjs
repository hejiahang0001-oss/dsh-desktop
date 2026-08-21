const fsp = require('node:fs/promises');

const INVALID_HEADER_CHARACTER = /[^\t\x20-\x7e\x80-\xff]/;

const credentialStatus = (status, source, reason, message, metadata = {}) => Object.freeze({
  status,
  source,
  reason,
  message,
  policy: 'software-first',
  ...metadata
});

const inspectRawCredential = (value) => {
  if (typeof value !== 'string' || value.length === 0) {
    return credentialStatus('missing', 'none', 'not-configured', '尚未配置 DeepSeek API Key。');
  }
  if (INVALID_HEADER_CHARACTER.test(value)) {
    return credentialStatus(
      'invalid',
      'env',
      'invalid-header-character',
      '启动环境中的 DEEPSEEK_API_KEY 包含 HTTP Header 不允许的字符。'
    );
  }
  if (value.trim() !== value) {
    return credentialStatus(
      'invalid',
      'env',
      'surrounding-whitespace',
      '启动环境中的 DEEPSEEK_API_KEY 含有首尾空白。'
    );
  }
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return credentialStatus(
      'invalid',
      'env',
      'surrounding-quotes',
      '启动环境中的 DEEPSEEK_API_KEY 不应包含外层引号。'
    );
  }
  return credentialStatus('configured', 'env', 'available', '已从启动环境读取 DeepSeek API Key。');
};

const managedCredentialConfigured = (document) => String(document || '')
  .split(/\r?\n/)
  .some((line) => /^\s*DEEPSEEK_API_KEY\s*:\s*\S/.test(line));

const getDeepSeekCredentialStatus = async ({ env = process.env, credentialFile } = {}) => {
  const environmentIgnored = typeof env.DEEPSEEK_API_KEY === 'string' && env.DEEPSEEK_API_KEY.length > 0;

  if (credentialFile) {
    try {
      const document = await fsp.readFile(credentialFile, 'utf8');
      if (managedCredentialConfigured(document)) {
        return credentialStatus(
          'configured',
          'managed-file',
          'software-managed',
          '已在 DSH Desktop 软件中配置 DeepSeek API Key。',
          { environmentIgnored }
        );
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        return credentialStatus(
          'unavailable',
          'managed-file',
          'credential-file-unreadable',
          '无法读取 DSH Desktop 软件托管凭据状态。',
          { environmentIgnored }
        );
      }
    }
  }
  return credentialStatus(
    'missing',
    'managed-file',
    'software-not-configured',
    environmentIgnored
      ? '尚未在软件中配置 DeepSeek API Key；Windows 环境变量已隔离，不会覆盖软件设置。'
      : '尚未在 DSH Desktop 软件中配置 DeepSeek API Key。',
    { environmentIgnored }
  );
};

module.exports = {
  getDeepSeekCredentialStatus,
  inspectRawCredential,
  managedCredentialConfigured
};
