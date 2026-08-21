const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  getDeepSeekCredentialStatus,
  inspectRawCredential,
  managedCredentialConfigured
} = require('../electron/credential-status.cjs');

test('credential preflight reports only safe state and rejects invalid header characters', () => {
  const secret = 'secret-密钥';
  const result = inspectRawCredential(secret);
  assert.equal(result.status, 'invalid');
  assert.equal(result.reason, 'invalid-header-character');
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test('credential preflight distinguishes missing, quoted, and configured environment values', () => {
  assert.equal(inspectRawCredential('').status, 'missing');
  assert.equal(inspectRawCredential('  raw-key').reason, 'surrounding-whitespace');
  assert.equal(inspectRawCredential('"raw-key"').reason, 'surrounding-quotes');
  assert.equal(inspectRawCredential('raw-key').status, 'configured');
});

test('managed credential detection checks the reference without returning its value', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-credential-'));
  const credentialFile = path.join(root, '.credentials.yaml');
  const secret = 'raw-managed-secret';
  try {
    await fs.writeFile(credentialFile, `OTHER_KEY: value\nDEEPSEEK_API_KEY: ${secret}\n`, 'utf8');
    assert.equal(managedCredentialConfigured(await fs.readFile(credentialFile, 'utf8')), true);
    const result = await getDeepSeekCredentialStatus({ env: {}, credentialFile });
    assert.equal(result.status, 'configured');
    assert.equal(result.source, 'managed-file');
    assert.equal(result.policy, 'software-first');
    assert.equal(JSON.stringify(result).includes(secret), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('software-managed credential wins over an inherited environment value', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-credential-priority-'));
  const credentialFile = path.join(root, '.credentials.yaml');
  const managedSecret = 'managed-secret';
  const inheritedSecret = 'legacy-密钥';
  try {
    await fs.writeFile(credentialFile, `DEEPSEEK_API_KEY: ${managedSecret}\n`, 'utf8');
    const result = await getDeepSeekCredentialStatus({
      env: { DEEPSEEK_API_KEY: inheritedSecret },
      credentialFile
    });
    assert.equal(result.status, 'configured');
    assert.equal(result.source, 'managed-file');
    assert.equal(result.reason, 'software-managed');
    assert.equal(result.environmentIgnored, true);
    assert.equal(JSON.stringify(result).includes(managedSecret), false);
    assert.equal(JSON.stringify(result).includes(inheritedSecret), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('missing software credential reports that a Windows environment value is isolated', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-credential-missing-'));
  try {
    const result = await getDeepSeekCredentialStatus({
      env: { DEEPSEEK_API_KEY: 'legacy-secret' },
      credentialFile: path.join(root, '.credentials.yaml')
    });
    assert.equal(result.status, 'missing');
    assert.equal(result.source, 'managed-file');
    assert.equal(result.reason, 'software-not-configured');
    assert.equal(result.environmentIgnored, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
