const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

test('ICO conversion contains a non-square mascot within each transparent square frame', () => {
  const source = fs.readFileSync(path.join(root, 'scripts/create-lulu-icon.cjs'), 'utf8');
  assert.match(source, /module\.exports.*fitIconFrame/);
  const { fitIconFrame } = require('../scripts/create-lulu-icon.cjs');
  assert.deepEqual(fitIconFrame(192, 208, 256), { width: 236, height: 256, left: 10, top: 0 });
  assert.deepEqual(fitIconFrame(192, 208, 16), { width: 15, height: 16, left: 0, top: 0 });
  assert.deepEqual(fitIconFrame(100, 50, 32), { width: 32, height: 16, left: 0, top: 8 });
  assert.deepEqual(fitIconFrame(50, 50, 32), { width: 32, height: 32, left: 0, top: 0 });
  for (const args of [[0, 20, 16], [20, -1, 16], [NaN, 20, 16], [20, 20, 0]]) {
    assert.throws(() => fitIconFrame(...args), /dimensions/);
  }
});

test('the packaged ICO has nine bounded PNG frames while blue-background artwork stays a reference', () => {
  const icon = fs.readFileSync(path.join(root, 'build/icon.ico'));
  const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
  assert.equal(icon.readUInt16LE(0), 0);
  assert.equal(icon.readUInt16LE(2), 1);
  assert.equal(icon.readUInt16LE(4), sizes.length);
  let offset = 6 + sizes.length * 16;
  for (let index = 0; index < sizes.length; index++) {
    const entry = 6 + index * 16, size = sizes[index], bytes = icon.readUInt32LE(entry + 8);
    assert.equal(icon[entry] || 256, size);
    assert.equal(icon[entry + 1] || 256, size);
    assert.equal(icon.readUInt32LE(entry + 12), offset);
    const frame = icon.subarray(offset, offset + bytes);
    assert.equal(frame.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(frame.readUInt32BE(16), size);
    assert.equal(frame.readUInt32BE(20), size);
    assert.equal(frame[25], 6, 'RGBA color type retains alpha');
    offset += bytes;
  }
  assert.equal(offset, icon.length);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.ok(!manifest.build.files.includes('assets/lulu/reference-full.png'));
});
