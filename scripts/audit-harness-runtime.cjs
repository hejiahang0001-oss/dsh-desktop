const fs = require('node:fs');
const path = require('node:path');
const semver = require('semver');
const { inspectHarnessRuntimePayload } = require('./harness-runtime-integrity.cjs');

function inventory(runtimeRoot) {
  const packages = new Map();
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Unexpected runtime link: ${file}`);
      if (entry.isDirectory()) walk(file);
      else if (entry.name === 'package.json') {
        let manifest;
        try { manifest = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
        if (typeof manifest.name !== 'string' || !semver.valid(manifest.version)) continue;
        const versions = packages.get(manifest.name) || new Set();
        versions.add(manifest.version); packages.set(manifest.name, versions);
      }
    }
  };
  walk(path.join(runtimeRoot, 'node_modules'));
  if (!packages.has('@deepseek-ai/dsh')) throw new Error('Missing Harness in audit inventory.');
  return Object.fromEntries([...packages].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([name, versions]) => [name, [...versions].sort()]));
}

function matchingAdvisories(packages, response) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) throw new Error('Invalid advisory response.');
  const findings = [];
  for (const [name, advisories] of Object.entries(response)) {
    if (!packages[name] || !Array.isArray(advisories)) throw new Error('Unexpected advisory package.');
    for (const advisory of advisories) {
      if (!semver.validRange(advisory.vulnerable_versions) || !['info', 'low', 'moderate', 'high', 'critical'].includes(advisory.severity)) throw new Error('Invalid advisory fields.');
      const versions = packages[name].filter((version) => semver.satisfies(version, advisory.vulnerable_versions, { includePrerelease: true }));
      if (versions.length) findings.push({ name, versions, severity: advisory.severity, title: advisory.title, url: advisory.url, range: advisory.vulnerable_versions });
    }
  }
  return findings;
}

async function audit(runtimeRoot) {
  const packages = inventory(runtimeRoot);
  const response = await fetch('https://registry.npmjs.org/-/npm/v1/security/advisories/bulk', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(packages), signal: AbortSignal.timeout(45000)
  });
  if (!response.ok) throw new Error(`Advisory registry returned ${response.status}.`);
  const body = await response.text();
  if (Buffer.byteLength(body) > 8 * 1024 * 1024) throw new Error('Advisory response is oversized.');
  const findings = matchingAdvisories(packages, JSON.parse(body));
  return { version: 1, checkedAt: new Date().toISOString(), source: 'https://registry.npmjs.org/-/npm/v1/security/advisories/bulk',
    inventory: packages, payload: inspectHarnessRuntimePayload(path.join(runtimeRoot, 'node_modules')), findings,
    ok: !findings.some(({ severity }) => ['moderate', 'high', 'critical'].includes(severity)) };
}

if (require.main === module) void (async () => {
  const argument = (key) => process.argv.find((arg) => arg.startsWith(`--${key}=`))?.slice(key.length + 3);
  const runtimeRoot = argument('runtime-root'), output = argument('output');
  if (!runtimeRoot || !output) throw new Error('runtime-root and output are required.');
  const report = await audit(path.resolve(runtimeRoot));
  fs.writeFileSync(path.resolve(output), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ok: report.ok, packages: Object.keys(report.inventory).length, findings: report.findings }));
  if (!report.ok) process.exitCode = 1;
})().catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = { inventory, matchingAdvisories, audit };
