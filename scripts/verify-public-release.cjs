const fsp = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const fs = require('node:fs');

async function verify(version, root = path.resolve(__dirname, '..')) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Expected an exact semantic version.');
  const names = [`DSH-Desktop-Setup-${version}.exe`, `DSH-Desktop-Setup-${version}.exe.blockmap`, `DSH-Desktop-Portable-${version}.exe`, `SHA256SUMS-v${version}.txt`];
  const downloadRoot = path.join(root, 'artifacts', `public-v${version}`);
  await fsp.mkdir(downloadRoot, { recursive: true });
  const hashFile = async (file) => { const hash = createHash('sha256'); for await (const data of fs.createReadStream(file)) hash.update(data); return hash.digest('hex'); };
  const rows = [];
  for (const name of names) {
    const localPath = path.join(root, 'dist', name), destination = path.join(downloadRoot, name);
    const expected = await hashFile(localPath), bytes = (await fsp.stat(localPath)).size;
    let error;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await fetch(`https://github.com/hejiahang0001-oss/dsh-desktop/releases/download/v${version}/${name}`, { signal: AbortSignal.timeout(180000) });
        if (!response.ok) throw new Error(`Public download HTTP ${response.status}`);
        await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(destination));
        const actual = await hashFile(destination), actualBytes = (await fsp.stat(destination)).size;
        if (actual !== expected || actualBytes !== bytes) throw new Error(`Downloaded artifact differs: ${name}`);
        rows.push({ name, bytes, sha256: actual, ok: true }); error = null; break;
      } catch (failure) { error = failure; }
    }
    if (error) throw error;
  }
  const result = { ok: rows.length === 4, version, authentication: 'none', assets: rows };
  await fsp.writeFile(path.join(downloadRoot, 'verification.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
if (require.main === module) verify(process.argv[2]).then((result) => console.log(JSON.stringify(result))).catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { verify };
