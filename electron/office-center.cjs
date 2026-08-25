const fsp = require('node:fs/promises');
const path = require('node:path');

const OFFICE_SKILLS = Object.freeze([
  Object.freeze({
    id: 'word',
    name: 'Word',
    extension: '.docx',
    skill: 'word-docx',
    tool: 'word-docx.cjs',
    accent: 'blue',
    summary: '报告、方案、纪要与图文文档',
    capabilities: Object.freeze(['标题与正文', '列表与表格', 'PNG / JPEG', '页眉与页脚']),
    boundary: '精确文本替换；不提供宏、修订模式或旧版 .doc。'
  }),
  Object.freeze({
    id: 'excel',
    name: 'Excel',
    extension: '.xlsx',
    skill: 'excel-xlsx',
    tool: 'excel-xlsx.cjs',
    accent: 'green',
    summary: '明细、分析、公式与勾稽工作簿',
    capabilities: Object.freeze(['多 Sheet', '公式与样式', '筛选与冻结', 'CSV 与勾稽']),
    boundary: '不执行宏、外链、Power Query 或网络公式。'
  }),
  Object.freeze({
    id: 'powerpoint',
    name: 'PowerPoint',
    extension: '.pptx',
    skill: 'powerpoint-pptx',
    tool: 'powerpoint-pptx.cjs',
    accent: 'orange',
    summary: '汇报、方案与数据图表演示文稿',
    capabilities: Object.freeze(['文本与形状', '表格与原生图表', 'PNG / JPEG', '母版、版式与备注']),
    boundary: '不提供宏、动画、SmartArt、音视频或旧版 .ppt。'
  })
]);

const boundedLabel = (value, fallback) => {
  if (typeof value !== 'string') return fallback;
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return normalized ? normalized.slice(0, 120) : fallback;
};

const resolveOfficeSkillRoot = ({ rootDir, resourcesPath, isPackaged }) => path.resolve(
  isPackaged ? resourcesPath : rootDir,
  isPackaged ? 'skills' : 'resources/skills'
);

const inspectRegularFile = async (filePath, root) => {
  const resolved = path.resolve(filePath);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return false;
  try {
    const rootInfo = await fsp.lstat(root);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) return false;
    let current = root;
    const parts = relative.split(path.sep);
    for (let index = 0; index < parts.length; index += 1) {
      current = path.join(current, parts[index]);
      const info = await fsp.lstat(current);
      if (info.isSymbolicLink()) return false;
      if (index < parts.length - 1 && !info.isDirectory()) return false;
      if (index === parts.length - 1) return info.isFile() && info.size > 0 && info.size <= 2 * 1024 * 1024;
    }
    return false;
  } catch {
    return false;
  }
};

const inspectOfficeCenter = async ({
  rootDir,
  resourcesPath,
  isPackaged = false,
  harnessReady = false,
  workspaceSynced = false,
  workspaceName = ''
}) => {
  const skillRoot = resolveOfficeSkillRoot({ rootDir, resourcesPath, isPackaged });
  const office = await Promise.all(OFFICE_SKILLS.map(async (item) => {
    const directory = path.join(skillRoot, item.skill);
    const [skillReady, toolReady] = await Promise.all([
      inspectRegularFile(path.join(directory, 'SKILL.md'), skillRoot),
      inspectRegularFile(path.join(directory, 'scripts', item.tool), skillRoot)
    ]);
    return {
      ...item,
      capabilities: [...item.capabilities],
      ready: skillReady && toolReady,
      status: skillReady && toolReady ? 'ready' : 'missing'
    };
  }));
  const readyCount = office.filter((item) => item.ready).length;
  return {
    available: readyCount === OFFICE_SKILLS.length,
    readyCount,
    total: OFFICE_SKILLS.length,
    harness: {
      status: harnessReady ? 'ready' : 'waiting',
      message: harnessReady ? 'Harness 已连接，可以写入固定 Skill 命令。' : '等待 Harness 主页面连接。'
    },
    workspace: {
      status: workspaceSynced ? 'ready' : 'waiting',
      name: boundedLabel(workspaceName, '当前工作区'),
      message: workspaceSynced ? '输出限定在当前工作区，并保留显式覆盖回退副本。' : '等待工作区与 Harness 会话同步。'
    },
    office,
    integrations: [
      { id: 'worktrees', title: '隔离工作树', detail: '修改型并行任务使用独立 Git 工作目录。', status: 'ready' },
      { id: 'tasks', title: 'Tasks / Subagents', detail: '任务树、补充消息与中断使用 Harness 官方接口。', status: 'ready' },
      { id: 'extensions', title: '扩展与 pnpm', detail: 'Skill、Plugin、MCP 与受控插件生命周期保持可见。', status: 'ready' }
    ]
  };
};

const isOfficeSkillId = (value) => OFFICE_SKILLS.some((item) => item.id === value);

module.exports = { OFFICE_SKILLS, inspectOfficeCenter, isOfficeSkillId, resolveOfficeSkillRoot };
