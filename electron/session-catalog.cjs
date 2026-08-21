const fsp = require('node:fs/promises');
const path = require('node:path');

const TRANSCRIPT_NAMES = new Set(['session.jsonl.zstd', 'session.jsonl']);

const readDirectories = async (directory) => {
  try {
    return (await fsp.readdir(directory, { withFileTypes: true })).filter((entry) => entry.isDirectory());
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
};

const scanSessionCatalog = async (sessionsRoot) => {
  const sessions = [];
  for (const projectEntry of await readDirectories(sessionsRoot)) {
    const projectDir = path.join(sessionsRoot, projectEntry.name);
    for (const sessionEntry of await readDirectories(projectDir)) {
      const sessionDir = path.join(projectDir, sessionEntry.name);
      let entries;
      try {
        entries = await fsp.readdir(sessionDir, { withFileTypes: true });
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw error;
      }
      const transcript = entries.find((entry) => entry.isFile() && TRANSCRIPT_NAMES.has(entry.name));
      if (!transcript) continue;
      const metadata = await fsp.stat(path.join(sessionDir, transcript.name));
      sessions.push({
        id: sessionEntry.name,
        encoding: transcript.name.endsWith('.zstd') ? 'zstd' : 'jsonl',
        updatedAt: metadata.mtime.toISOString()
      });
    }
  }
  sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
  return Object.freeze({
    available: true,
    count: sessions.length,
    latestUpdatedAt: sessions[0]?.updatedAt || null,
    encodings: Object.freeze({
      zstd: sessions.filter((session) => session.encoding === 'zstd').length,
      jsonl: sessions.filter((session) => session.encoding === 'jsonl').length
    })
  });
};

module.exports = { scanSessionCatalog };
