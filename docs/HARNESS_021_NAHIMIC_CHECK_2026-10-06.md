# Harness 0.2.1-alpha.1 — Nahimic 临时停止对照

时间：2026-10-06 20:40:59–20:41:03（Asia/Shanghai）。本页接续 [隔离构建记录](HARNESS_021_BUILD_2026-10-06.md)，不改写旧失败证据。

## 实际操作

用户已允许临时停止 NahimicService、一次对照后立即恢复，又明确要求代为执行。未向用户打开的终端注入命令；由普通命令执行通道使用 Windows 正常 RunAs 启动已核验脚本，没有自动点击权限界面或更改执行策略。

- 脚本 SHA-256：`9f3b8aa3ab5f618c768faee2d5b4bec8e220853e887b8ae98cac7c76fc6409a7`。
- 外层进程 PID15236 实际结束、exit0。StopService/StartService 都返回0；测试后服务恢复 Running，启动类型仍 Auto，PID5532→22624。主线程随后独立读取服务确认。
- 仅执行一次原生 PID 探针；没有卸载、修改自动启动、关闭沙箱、使用真实 Key 或覆盖安装。

## 结果与限制

RunAs 提升会话、服务已停止的组合条件下，官方 AclSandbox 仍为 read-only / zeroWriteGrants；系统 PowerShell 5.1 原生 PID2384 返回 `CLI_TOOL_ROUND_TRIP` 和 exit0。采集子进程 PID3720 真实 close、无超时；本次未复现 0xC0000005。

但 stderr 有两处 `CannotCreateTypeConstrainedLanguage`，出现在 UTF-8 前置语句，且有文本解码乱码。因此原始 `shellPassed=true` **仅代表脚本中较窄的 sentinel/退出/摘要判定，不代表无错误或完整 shell/编码兼容通过**。保留原 JSON，不把它改成另一份原始事实。

此前基线是非提升会话；本次提升令牌、PATH/启动环境同时改变，未做同权限配对控制，不能把差异直接归因于停 Nahimic。两次 native-pid 实际命令都为同一个系统 PowerShell 5.1，不能说“换用系统 PowerShell 修复了崩溃”；本次 selected 元数据变化不是实际 native 命令更换。Nahimic 模块参与旧崩溃已有 PID/事件证据，唯一因果仍未证。

执行前后 resolver、runner、候选 lock/workspace 四项摘要一致。此处未复跑原两项完整 e2e；Office 原生缺失、来源、安全和发布门禁仍开放，未换核、打包、安装、发布或更新 Stable。

## 原始证据

目录：`artifacts/harness-021-build-20261006/shell-diagnosis/`

- `service-check-329bdb35a3d14d858f417065b675f1ed.json`：本次停止/执行/恢复记录。
- `probe-ZO0KWb/evidence.json`：stdout/stderr、真实 close、超时状态、四项输入摘要。
- `probe-ZO0KWb/native-child.json`：原生 PID2384、exit0、read-only/zero grants。
- `service-check-27966c241246411cb22d99f9624d797b.json`：之前非管理员被拒，保持原样。
- `probe-mOZb2g/`、`REPORT.md`：之前崩溃与 NahimicOSD 事件，保持原样。

## 后续建议（尚未执行）

下一次若继续因果对照，管理员辅助应只负责服务状态，探针维持原非提升父进程、同一 shell 和环境；服务恢复后再独立确认。不要永久关闭音效服务或降低沙箱权限。

现脚本的25秒限制只覆盖其直接子进程，不构成整个采集器的绝对截止；StopPending 等异常恢复路径也应先加强再复用。本次实际已正常结束并恢复，不把潜在方法缺陷写成本次恢复失败。任何后续完整验收都应额外检查 stderr/编码初始化，不仅依赖 sentinel 和 exit0。

Obsidian 使用 wiki-update 增量回写现有 DSH 项目；同步结果以本次独立回读记录为准，不能由本页单独证明。
