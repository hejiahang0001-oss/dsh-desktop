const fs = require('node:fs');
const path = require('node:path');

const MAX_FILES = 20_000;
const MAX_TEXT_BYTES = 5 * 1024 * 1024;
const argumentValues = (name) => process.argv
  .filter((value) => value.startsWith(`--${name}=`))
  .map((value) => value.slice(name.length + 3));

const credentialFile = argumentValues('credential-file')[0];
const scanRoots = argumentValues('scan-root');
if (!credentialFile || scanRoots.length === 0) {
  throw new Error('Usage: node scripts/verify-no-secret-leak.cjs --credential-file=<yaml> --scan-root=<directory> [--scan-root=<directory>]');
}

const credentialText = fs.readFileSync(path.resolve(credentialFile), 'utf8');
const credentialValues = credentialText.split(/\r?\n/)
  .map((line) => /^\s*(?:DEEPSEEK_API_KEY|apiKey|key|token)\s*:\s*['"]?([^'"\s#]{12,})/i.exec(line)?.[1] || '')
  .filter(Boolean);
if (credentialValues.length === 0) throw new Error('No bounded credential scalar was found for the exact leak scan.');

const credentialLeakPaths = new Set();
const tokenLeakPaths = new Set();
let filesChecked = 0;
for (const scanRoot of scanRoots) {
  const root = path.resolve(scanRoot);
  if (!fs.existsSync(root)) continue;
  const rootInfo = fs.lstatSync(root);
  if (rootInfo.isSymbolicLink()) continue;
  const queue = rootInfo.isDirectory() ? [root] : [];
  const initialFiles = rootInfo.isFile() ? [root] : [];
  for (const target of initialFiles) {
    filesChecked += 1;
    if (rootInfo.size > MAX_TEXT_BYTES) continue;
    const text = fs.readFileSync(target, 'utf8');
    if (credentialValues.some((value) => text.includes(value))) credentialLeakPaths.add(target);
    for (const match of text.matchAll(/\?token=([^\s"'<>]+)/g)) {
      if (match[1] !== '[REDACTED]') tokenLeakPaths.add(target);
    }
  }
  while (queue.length > 0) {
    const directory = queue.shift();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      filesChecked += 1;
      if (filesChecked > MAX_FILES) throw new Error(`Leak scan exceeds ${MAX_FILES} entries.`);
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        queue.push(target);
        continue;
      }
      if (!entry.isFile() || fs.statSync(target).size > MAX_TEXT_BYTES) continue;
      let text;
      try { text = fs.readFileSync(target, 'utf8'); } catch { continue; }
      if (credentialValues.some((value) => text.includes(value))) credentialLeakPaths.add(target);
      for (const match of text.matchAll(/\?token=([^\s"'<>]+)/g)) {
        if (match[1] !== '[REDACTED]') tokenLeakPaths.add(target);
      }
    }
  }
}

if (credentialLeakPaths.size > 0 || tokenLeakPaths.size > 0) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    credentialLeakPaths: [...credentialLeakPaths],
    tokenLeakPaths: [...tokenLeakPaths]
  })}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    credentialValuesChecked: credentialValues.length,
    filesChecked,
    tokenLogsChecked: true
  })}\n`);
}
