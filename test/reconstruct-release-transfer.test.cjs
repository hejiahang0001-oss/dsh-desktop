const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createHash } = require('node:crypto');
const { reconstruct } = require('../scripts/reconstruct-release-transfer.cjs');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-byte-test-')); t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const base={name:'DSH-Desktop-Setup-1.1.10.exe',bytes:3,sha256:sha('ABC')};
  const target={name:'DSH-Desktop-Setup-1.1.11.exe',bytes:4,sha256:sha('ABCD'),blocks:[{source:base.name,offset:0,length:3},{source:'$literal',offset:0,length:1}]};
  const manifest={schema:1,bases:[base],targets:[target],literalsSha256:sha('D')};
  fs.writeFileSync(path.join(root,base.name),'ABC');fs.writeFileSync(path.join(root,'literals.bin'),'D');
  const save=()=>fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify(manifest));save();
  return{root,target,manifest,save};
}
test('transfer reconstructs byte-identical data without executing it',t=>{const f=fixture(t),result=reconstruct(f.root,[f.target]);assert.equal(result.byteExact,true);assert.equal(result.executedPayload,false);assert.equal(fs.readFileSync(path.join(f.root,f.target.name),'utf8'),'ABCD');});
test('transfer refuses out-of-range chunks before writing a target',t=>{const f=fixture(t);f.target.blocks[0].length=20;f.save();assert.throws(()=>reconstruct(f.root,[f.target]));assert.equal(fs.existsSync(path.join(f.root,f.target.name)),false);});
test('transfer requires independently supplied target hashes',t=>{const f=fixture(t);assert.throws(()=>reconstruct(f.root,[{...f.target,sha256:sha('wrong')}]));});
test('transfer never overwrites an occupied target path',t=>{const f=fixture(t);fs.writeFileSync(path.join(f.root,f.target.name),'preserve');assert.throws(()=>reconstruct(f.root,[f.target]));assert.equal(fs.readFileSync(path.join(f.root,f.target.name),'utf8'),'preserve');});
