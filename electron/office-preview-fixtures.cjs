const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

// Synthetic acceptance documents only; never read personal Office documents.
async function createOfficePreviewFixtures(workspace, skillsRoot) {
  const specifications = [
    { format: 'docx', skill: 'word-docx', create: 'createDocument', pages: 2, marker: '原生Word预览验收', pageMarkers: ['原生Word预览验收', '第二页中文分页验收'], spec: {
      title: '原生Word预览验收', author: 'DSH Desktop', sections: [
        { kind: 'paragraph', text: '中文金额 123.45，原始文件不可被预览修改。' },
        { kind: 'table', table: { rows: [['项目', '金额'], ['文档验证', '123.45']] } },
        { kind: 'pageBreak' },
        { kind: 'heading', level: 1, text: '第二页中文分页验收' }
      ]
    } },
    { format: 'xlsx', skill: 'excel-xlsx', create: 'createWorkbook', pages: 1, marker: '原生Excel预览验收', pageMarkers: ['原生Excel预览验收'], spec: {
      title: '原生Excel预览验收', sheets: [{ name: '中文汇总', columns: [30, 18], rows: [
        [{ value: '原生Excel预览验收', style: 'title' }],
        ['项目', '金额'], ['明细甲', 100], ['明细乙', 23.45],
        ['合计', { formula: 'SUM(B3:B4)', cached: 123.45, style: 'total' }]
      ] }]
    } },
    { format: 'pptx', skill: 'powerpoint-pptx', create: 'createPresentation', pages: 3, marker: '原生PPT预览验收', pageMarkers: ['原生PPT预览验收', '第二页中文表格', '第三页中文图表'], spec: {
      title: '原生PPT预览验收', slides: [
        { layout: 'title', title: '原生PPT预览验收', subtitle: '中文、表格与原生图表' },
        { layout: 'content', title: '第二页中文表格', elements: [
          { kind: 'table', x: 1, y: 1.5, w: 10, h: 3, rows: [['项目', '金额'], ['明细甲', '100'], ['明细乙', '23.45']] }
        ] },
        { layout: 'content', title: '第三页中文图表', elements: [
          { kind: 'chart', type: 'column', x: 1, y: 1.5, w: 10, h: 4, categories: ['甲', '乙'], series: [{ name: '金额', values: [100, 23.45] }] }
        ] }
      ]
    } }
  ];
  const results = [];
  for (const item of specifications) {
    const specPath = `office-preview-${item.format}.json`;
    const name = `官方Office预览-${item.format}.${item.format}`;
    await fs.writeFile(path.join(workspace, specPath), JSON.stringify(item.spec), { flag: 'wx' });
    const tool = require(path.join(skillsRoot, item.skill, 'scripts', `${item.skill}.cjs`));
    await tool[item.create]({ workspace, specPath, outputPath: name });
    const bytes = await fs.readFile(path.join(workspace, name));
    results.push({ name, format: item.format, expectedPages: item.pages, marker: item.marker, pageMarkers: item.pageMarkers,
      bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  return results;
}

module.exports = { createOfficePreviewFixtures };
