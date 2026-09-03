const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MAX_RUNTIME_ENTRIES = 60_000;
const PAYLOAD_ALGORITHM = 'sha256-path-size-content-v1';
const PROVENANCE_FILE = 'harness-runtime.json';

const inspectHarnessRuntimePayload = (payloadRoot) => {
  const root = path.resolve(payloadRoot);
  const queue = [root];
  const files = [];
  let entries = 0;
  while (queue.length > 0) {
    const directory = queue.shift();
    const children = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of children) {
      entries += 1;
      if (entries > MAX_RUNTIME_ENTRIES) throw new Error(`Harness runtime exceeds ${MAX_RUNTIME_ENTRIES} entries.`);
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Harness runtime contains a linked path: ${target}`);
      if (entry.isDirectory()) {
        queue.push(target);
        continue;
      }
      if (!entry.isFile()) continue;
      const relative = path.relative(root, target).split(path.sep).join('/');
      if (relative === PROVENANCE_FILE) continue;
      const bytes = fs.readFileSync(target);
      files.push({
        path: relative,
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex')
      });
    }
  }
  files.sort((left, right) => left.path.localeCompare(right.path, 'en'));
  const digest = createHash('sha256');
  let bytes = 0;
  for (const file of files) {
    bytes += file.bytes;
    digest.update(`${JSON.stringify([file.path, file.bytes, file.sha256])}\n`);
  }
  return Object.freeze({
    algorithm: PAYLOAD_ALGORITHM,
    files: files.length,
    bytes,
    sha256: digest.digest('hex')
  });
};

module.exports = { MAX_RUNTIME_ENTRIES, PAYLOAD_ALGORITHM, inspectHarnessRuntimePayload };
