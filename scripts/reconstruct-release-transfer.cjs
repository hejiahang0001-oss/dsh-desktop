// Reconstruct pre-built, pre-verified release bytes; never execute the payload.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const reconstruct = (directory, expected) => {
  const root = path.resolve(directory), manifestFile = path.join(root, 'manifest.json');
  assert.ok(fs.statSync(manifestFile).size <= 8 * 1024 * 1024);
  const manifest = JSON.parse(fs.readFileSync(manifestFile));
  assert.equal(manifest.schema, 1); assert.equal(manifest.targets.length, expected.length);
  const literals = fs.readFileSync(path.join(root, 'literals.bin'));
  assert.equal(sha(literals), manifest.literalsSha256);
  const pool = new Map();
  const safeName = name => { assert.match(name, /^DSH-Desktop-(?:Setup|Portable)-\d+\.\d+\.\d+\.exe$/); return path.join(root, name); };
  assert.ok(manifest.bases.length <= 2);
  for (const base of manifest.bases) {
    const bytes = fs.readFileSync(safeName(base.name));
    assert.equal(bytes.length, base.bytes); assert.equal(sha(bytes), base.sha256); pool.set(base.name, bytes);
  }
  const results = [];
  for (const [index, target] of manifest.targets.entries()) {
    assert.equal(target.name, expected[index].name); assert.equal(target.sha256, expected[index].sha256);
    assert.equal(target.bytes, expected[index].bytes); assert.ok(target.bytes <= 512 * 1024 * 1024);
    assert.ok(target.blocks.length <= 100000);
    const output = Buffer.alloc(target.bytes); let cursor = 0;
    for (const block of target.blocks) {
      const source = block.source === '$literal' ? literals : pool.get(block.source);
      assert.ok(source); assert.ok(Number.isSafeInteger(block.offset) && block.offset >= 0);
      assert.ok(Number.isSafeInteger(block.length) && block.length > 0);
      assert.ok(block.offset + block.length <= source.length && cursor + block.length <= output.length);
      source.copy(output, cursor, block.offset, block.offset + block.length); cursor += block.length;
    }
    assert.equal(cursor, output.length); assert.equal(sha(output), target.sha256);
    fs.writeFileSync(safeName(target.name), output, { flag: 'wx' }); pool.set(target.name, output);
    results.push({ name: target.name, bytes: output.length, sha256: sha(output) });
  }
  return { ok: true, byteExact: true, executedPayload: false, targets: results };
};
if (require.main === module) {
  try { console.log(JSON.stringify(reconstruct(process.argv[2], JSON.parse(process.argv[3])))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { reconstruct };
