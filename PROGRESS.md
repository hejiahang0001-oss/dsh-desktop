# DSH Desktop 执行进度

> 日期：2026-08-22
> 当前构建：V0.4.1 Daily Build
> 状态：已直接覆盖 V0.4.0；同工作区受控 PowerShell 终端、布局持久化和安装版验证完成

## 本轮完成

1. 在 Harness 下方增加全宽“终端”面板，右侧 Git 审查面板自动在终端上方收口，不建立第二套 Agent 或会话状态。
2. 每条命令使用当前 Harness Workspace 作为工作目录，并在原生确认框中显示完整工作区与命令；默认按钮为“取消”。
3. 固定使用 Windows PowerShell 绝对路径、`shell: false` 和编码命令；单次命令最多 4,096 个字符且不接受换行/控制字符。
4. 软件管理的 `DEEPSEEK_API_KEY` 从终端子进程环境中按大小写不敏感方式移除；验证没有输出或复制 Key 明文。
5. 输出经过 ANSI/OSC 与控制字符清理，单次执行最多 200,000 字符；Renderer 显示缓冲再次有界。
6. 一次只运行一条命令，支持停止整个 Windows 进程树和 5 分钟超时；工作区切换、应用退出前会先停止命令。
7. 命令结束后保守刷新 Git 保护基线，避免把用户通过终端产生的修改误判为可一键拒绝的 Agent 变更。
8. 终端支持 160–420px 拖动/键盘调节、清空、关闭和聚焦；`Ctrl+Alt+T` 显示/隐藏，`Ctrl+Alt+K` 聚焦。
9. 工作台状态升级到 schema v2，保留旧审查面板开关/宽度，并新增终端开关/高度持久化。
10. 自动化回归增至 63 项；真实 PowerShell 工作目录、Key 隔离和长任务进程树停止均通过。
11. 构建 V0.4.1，在不含凭据的快照后直接覆盖 V0.4.0；注册版本、安装一致性、Harness smoke、会话、Key 和正式界面检查通过。

## 验证证据

| 验证项 | 结果 |
|---|---|
| 单元/集成测试 | 63/63 通过 |
| 真实 PowerShell | 在隔离工作区运行成功；`DEEPSEEK_API_KEY=False`；未泄露测试值 |
| 真实停止 | 30 秒长命令在完成前停止，整个进程树结束 |
| 原生确认 | 显示精确工作区与命令；`defaultId=1`、`cancelId=1`，默认取消 |
| 终端边界 | 命令 4,096 字符；输出 200,000 字符；单任务；5 分钟超时 |
| 布局持久化 | `Ctrl+Alt+T` 隐藏/恢复；Harness 重载后隐藏状态保留并可再次恢复 |
| 正式安装版 | 版本 0.4.1；随机回环端口 HTTP 200；标题 `DeepSeek Harness`；Workspace 同步成功 |
| 软件 Key | `configured`、`managed-file`、`software-first`；环境变量被忽略；终端环境排除 Key |
| 会话持久化 | 覆盖安装后 9 个 zstd 会话可识别 |
| 安装包 | 158,447,590 字节；7-Zip `Everything is Ok`；29,278 个文件 |
| 安装包 SHA-256 | `164C6DA7603A45C3D90F14AC663B0CCCCDF725CBC01B7B4F59AF755E8A14239D` |
| V0.4.0 → V0.4.1 覆盖 | 安装器退出码 0；注册版本 `DSH Desktop 0.4.1` |
| 安装一致性 | 安装版与解包版 `app.asar` SHA-256 均为 `6E8AD04C2E28A5027A3AFDF18CB4A15BF324E71B52583125DB93FEEA51DD8E9F` |
| Harness 文件闭包 | 29,201 个文件，0 个重解析点 |

## 安装与回滚

- 当前正式目录：`%LOCALAPPDATA%\Programs\DSH Desktop`
- V0.4.1 前快照：`backups/pre-v0.4.1-20260822-133000`
- 快照包含旧程序、非凭据用户数据和旧安装包，共 31,827 个文件、897,588,019 字节。
- 快照中 `.credentials.yaml` 为 0 个、重解析点为 0 个。
- V0.4.0 前可用快照继续保留在 `backups/pre-v0.4.0-20260822-120413`。

## 未宣称完成

- 当前终端是受控单命令运行器，不是持久交互式 PTY；不支持交互提示、终端标签页、Shell 会话状态和完整 ANSI 渲染。
- Harness 页面重载前产生的历史终端输出不会回放，但原生命令仍可停止且当前状态会恢复。
- 尚未包含文件树、从 Diff 跳转代码位置、应用预览和命令面板。
- 紧凑/最大化布局尚未完成完整视觉矩阵。
- 尚无自动 Checkpoint、会话级 Rewind 和完整 Plan 取消/恢复状态视图。
- Harness Workspace Write 的 `0xC0000005` 上游风险仍存在；集成终端不自动提升 Harness 权限。
- 软件 Key 仍使用 Harness rc.8 的 `.credentials.yaml` 与 Windows 用户目录 ACL，尚未接入 Credential Manager/DPAPI。
- 自动更新、代码签名和 Harness 兼容矩阵流水线尚未完成。

## 下一优先级

1. 继续 V0.4.2，增加与当前 Workspace 同步的文件树和文件查看，并从 Diff 跳转到文件。
2. 在文件树基础上补终端多标签/持久 Shell 的技术验证；未通过安全门禁前不冒充完整 PTY。
3. 补齐 1024×720、最大化、高对比度和键盘焦点视觉矩阵。
4. 增加应用预览和命令面板，再进入 V0.5 Checkpoint/Rewind。
5. 下一 Daily Build 继续直接覆盖 V0.4.1，并保留不含凭据的 last-known-good 快照。
