const buildChinesePdfSmoke = async (BrowserWindow) => {
  const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  try {
    const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>
      @page { size: A4; margin: 20mm; } body { font: 14pt 'Microsoft YaHei', 'SimSun', sans-serif; color: #222; }
      section { break-after: page; } section:last-child { break-after: auto; } h1 { font-size: 24pt; } td, th { border: 1px solid #777; padding: 12px; } table { border-collapse: collapse; }
      </style><body>
      <section><h1>第一页：中文字体验证</h1><p>DSH Desktop · 文档交付验收</p><p>中文、English、数字 1234567890，以及标点“”、￥、百分比 50%。</p><p>本文件为软件验收夹具，不包含真实业务数据。</p></section>
      <section><h1>第二页：表格与分页</h1><table><tr><th>检查项目</th><th>预期结果</th></tr><tr><td>中文字体</td><td>清晰可读，没有方框或乱码</td></tr><tr><td>分页</td><td>独立显示三页内容</td></tr><tr><td>表格</td><td>边框、内容完整</td></tr></table></section>
      <section><h1>第三页：交付边界</h1><p>验证 PDF 安全读取、中文渲染与分页。</p><p>PDF 预览不等于任意 PDF 编辑；Office 的结构检查不等于视觉验收。</p><p>验收结束 · 第三页</p></section>
      </body></html>`;
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    await window.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
    const pdf = await window.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, pageSize: 'A4' });
    const text = pdf.toString('latin1');
    const pages = (text.match(/\/Type\s*\/Page\b/g) || []).length;
    const embeddedFonts = /\/FontFile[23]?\b/.test(text) && /\/ToUnicode\b/.test(text);
    if (pages !== 3 || !embeddedFonts) throw new Error('Chinese PDF fixture requires three pages and embedded Unicode fonts.');
    return { pdf, pages, embeddedFonts };
  } finally { window.destroy(); }
};
module.exports = { buildChinesePdfSmoke };
