const PERMISSION_LABELS = Object.freeze({
  'read-only': 'Read Only',
  'workspace-write': 'Workspace Write',
  'danger-full-access': 'Full Access',
  unknown: '未检测'
});

const buildPermissionCenterDialog = ({ agent = {}, terminalActive = false } = {}) => {
  const permissionMode = Object.hasOwn(PERMISSION_LABELS, agent.permissionMode)
    ? agent.permissionMode
    : 'unknown';
  const upstreamAvailable = permissionMode !== 'unknown' && agent.canOpenPermission === true;
  const pendingCount = Number.isSafeInteger(agent.pendingCount) && agent.pendingCount > 0
    ? Math.min(agent.pendingCount, 99)
    : 0;
  const canFocusPending = upstreamAvailable && agent.canFocusPending === true && pendingCount > 0;
  const buttons = [];
  const actions = [];
  if (canFocusPending) {
    buttons.push('定位待确认操作');
    actions.push('focus-pending');
  }
  if (upstreamAvailable) {
    buttons.push('打开 Harness 权限模式');
    actions.push('open-permission-mode');
  }
  buttons.push('关闭');
  actions.push(null);
  const closeId = buttons.length - 1;
  const pendingLine = pendingCount > 0
    ? `待确认：${pendingCount} 个待确认操作，最终允许或拒绝由 Harness 处理。`
    : '待确认：当前未检测到待确认操作。';
  const options = Object.freeze({
    type: permissionMode === 'danger-full-access' ? 'warning' : 'info',
    title: '权限中心',
    message: `当前 Harness 权限：${PERMISSION_LABELS[permissionMode]}`,
    detail: [
      pendingLine,
      '',
      '权限边界',
      '• Agent 的读写、命令和逐次确认由 Harness 权限模式管理；桌面版不会自动放宽权限。',
      '• 文件面板与检查点统一排除凭据、密钥和私钥路径。',
      `• 交互终端：${terminalActive ? '运行中' : '未运行'}；终端不继承软件托管的 DeepSeek API Key。`,
      '• 剪贴板仅允许当前 Harness 主页面发起写入，不允许读取。',
      '• 代理修改必须经过 Windows 原生确认，取消后不会保存或重启 Harness。'
    ].join('\n'),
    buttons,
    defaultId: closeId,
    cancelId: closeId,
    noLink: true
  });
  return Object.freeze({ options, actions: Object.freeze(actions) });
};

module.exports = { buildPermissionCenterDialog };
