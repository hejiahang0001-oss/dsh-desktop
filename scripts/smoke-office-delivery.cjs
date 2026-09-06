'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const { createHash } = require('node:crypto');
const execute = promisify(execFile);
const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const main = async () => {
  const resources = path.resolve(argument('resources') || 'dist/win-unpacked/resources');
  if (!argument('output')) throw new Error('--output=<new evidence json> is required');
  const output = path.resolve(argument('output'));
  const workspace = `${output}.中文 workspace`;
  // Refuse to reuse previous evidence or a user's workspace.
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.mkdir(workspace);
  const node = path.join(resources, 'runtime', 'node.exe');
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => /^(?:SystemRoot|WINDIR|TEMP|TMP|COMSPEC)$/i.test(name)));
  env.PATH = path.dirname(node); // No Git, global Node, NODE_PATH or inherited API Key.
  const invoke = async (skill, command, args) => {
    const tool = path.join(resources, 'skills', skill, 'scripts', `${skill}.cjs`);
    const result = await execute(node, [tool, command, '--workspace', workspace, ...args], { cwd: workspace, env, windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 });
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.ok, true);
    return parsed;
  };
  await fs.copyFile(path.resolve(__dirname, '../docs/assets/social-preview.png'), path.join(workspace, 'image.png'));
  const specs = [
    ['word-docx', 'docx', { title: '中文交付验收', sections: [{ kind: 'paragraph', text: '生成、验证与回退' }, { kind: 'table', rows: [['项目', '结果'], ['检查', '通过']] }, { kind: 'image', path: 'image.png', alt: '本地验收图片', widthInches: 5 }] }],
    ['excel-xlsx', 'xlsx', { sheets: [{ name: '汇总', rows: [['金额'], [100], [200], [{ formula: 'SUM(A2:A3)', cached: 300 }]] }, { name: '明细', rows: [['金额'], [300]] }], reconciliations: [{ label: '金额核对', left: "'汇总'!A4", right: "'明细'!A2", tolerance: 0 }] }],
    ['powerpoint-pptx', 'pptx', { title: '交付验收', slides: [{ title: '中文图表', notes: '可编辑图表与备注验收', elements: [{ kind: 'chart', type: 'column', x: 1, y: 1, w: 5, h: 4, categories: ['甲', '乙'], series: [{ name: '金额', values: [100, 200] }] }, { kind: 'text', x: 7, y: 1, w: 4, h: 2, text: '生成后的文件仍然可以编辑' }] }] }]
  ];
  const formats = [];
  for (const [skill, format, spec] of specs) {
    const specName = `${format}.json`, fileName = `交付.${format}`;
    await fs.writeFile(path.join(workspace, specName), JSON.stringify(spec));
    const first = await invoke(skill, 'create', ['--spec', specName, '--output', fileName]);
    const firstBytes = await fs.readFile(path.join(workspace, fileName));
    assert.equal(first.delivery.sha256, sha256(firstBytes));
    const second = await invoke(skill, 'create', ['--spec', specName, '--output', fileName, '--overwrite']);
    const inspection = await invoke(skill, 'inspect', ['--input', fileName, '--strict']);
    assert.equal(inspection.safety.passed, true);
    assert.equal(second.delivery.visualValidation, 'not-performed');
    assert.equal(second.delivery.sha256, sha256(await fs.readFile(path.join(workspace, fileName))));
    assert.equal(second.delivery.rollback.sha256, sha256(firstBytes));
    assert.deepEqual(await fs.readFile(path.join(workspace, second.delivery.rollback.path)), firstBytes);
    formats.push({ format, receipt: second.delivery, inspection });
  }
  const result = { ok: true, resources, workspace, noGitOrGlobalNode: true, formats, visualOfficeReview: 'not-performed', realModel: false };
  await fs.writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ ok: true, formats: formats.map((item) => item.format), output }));
};

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
