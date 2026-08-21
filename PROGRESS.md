# DSH Desktop 执行进度

> 日期：2026-08-22
> 当前构建：V0.3.8 Daily Build
> 状态：已直接覆盖 V0.3.7；官方 Plan 门禁与真实多文件审查闭环通过

## 本轮完成

1. 原生 Agent 菜单接入 rc.8 官方 Plan 状态，支持进入 Plan、定位官方执行确认和退出 Plan。
2. `/plan` 快捷指令适配 rc.8 的命令选择与提交行为；桌面端连续发送两次 Enter，避免只选中命令而未真正进入 Plan。
3. 原生“变更”菜单从最近单文件扩展为最多 30 个文件的状态列表，显示待审、保护、已接受和截断统计。
4. 支持逐文件接受/拒绝，以及通过完整预检的批量接受/拒绝；任何受保护或不可用项都会阻止整批操作。
5. 拒绝操作继续以 Git 暂存版本为恢复基线，新文件进入 Windows 回收站；原有用户修改不被一键覆盖。
6. 使用软件 Key 和 `DeepSeek-V4-Flash High` 完成真实 Plan：修改 `alpha.txt`、`beta.txt` 并创建 `gamma.txt`，经官方“确认执行”后执行成功。
7. 三文件批量接受后均进入 Git 暂存区；第二轮真实模型把三文件从 2 改为 3，再批量拒绝，工作区恢复到暂存基线 2。
8. 自动化回归增至 50 项，覆盖 porcelain 重命名解析、变更统计、批量预检与操作、Plan 状态和命令执行。
9. 构建 V0.3.8，完成不含凭据的快照后直接覆盖安装；正式安装版哈希、注册版本、Harness smoke 和菜单视觉检查通过。

## 验证证据

| 验证项 | 结果 |
|---|---|
| 单元/集成测试 | 50/50 通过 |
| 真实 Plan | 官方 Plan 模式进入成功，官方 `exit_plan_mode` 卡片显示“确认执行”，批准后执行 |
| 真实多文件任务 | `alpha.txt`、`beta.txt` 修改，`gamma.txt` 新建，三文件内容均由 1/不存在变为 2 |
| 批量接受 | 三文件均进入 Git 暂存区，菜单统计为 3 个待审变更 |
| 批量拒绝 | 第二轮 2→3 的三文件修改全部恢复到暂存基线 2，已有暂存内容保留 |
| 正式安装版 | 版本 0.3.8；随机回环端口 HTTP 200；标题 `DeepSeek Harness`；Workspace 同步成功 |
| 安装版视觉 | 正式安装路径窗口正常；Plan 菜单为“已关闭/可进入”；模型菜单显示“软件 Key：已配置、软件优先” |
| 软件 Key | 状态 `configured`、来源 `managed-file`、策略 `software-first`；环境变量被忽略；未输出明文 |
| 会话持久化 | 覆盖安装后 9 个 zstd 持久会话可识别 |
| 安装包 | 158,435,283 字节；7-Zip 检查 `Everything is Ok` |
| 安装包 SHA-256 | `4F1124B398AD5EB4CA617618E8F992776B94CFFA9FD54BE1BED5000D03F8022C` |
| V0.3.7 → V0.3.8 覆盖 | 安装器退出码 0；注册版本 `DSH Desktop 0.3.8` |
| 安装一致性 | 正式与解包版 `app.asar` SHA-256 均为 `572FB792EAD949BAE49D3753E5C9D3CE57963DFD00107D1DD2337D7C6417AD36` |
| Harness 文件闭包 | 29,201 个文件，0 个重解析点；解包介质共 29,278 个文件 |

## 安装与回滚

- 当前正式目录：`%LOCALAPPDATA%\Programs\DSH Desktop`
- V0.3.8 前可用快照：`backups/pre-v0.3.8-20260822-015639`
- 快照包含旧程序、非凭据用户数据和 V0.3.7 安装包，共 31,507 个文件。
- 快照中 `.credentials.yaml` 为 0 个、重解析点为 0 个；源数据里的依赖目录联接按设计跳过，可由运行时重建。
- 一次中断的诊断复制已更名为 `backups/incomplete-pre-v0.3.8-20260822-014800`，它不是可用回滚点。
- 隔离真实验证仓库保留在忽略目录 `artifacts/v0.3.8-real-e2e-repo`；验证后桌面宿主状态恢复为“未选择仓库”。

## 未宣称完成

- 多文件能力目前位于原生菜单层级，不是常驻的独立 Diff/File 面板。
- 尚无自动 Checkpoint、会话级 Rewind 和完整的 Plan 取消/恢复状态视图。
- Workspace Write 下 `pwsh` 仍可能以 `3221225477 (0xC0000005)` 失败；应用准确报告失败，不自动切换 Full Access。
- 软件 Key 使用 Harness rc.8 的 `.credentials.yaml`；Windows 下依赖用户目录 ACL，尚未接入 Credential Manager/DPAPI。
- 自动更新、代码签名和 Harness 兼容矩阵流水线尚未完成。

## 下一优先级

1. 进入 V0.4，建立常驻 File/Diff/Terminal 桌面工作台，而不重复实现 Harness Agent loop。
2. 把多文件变更菜单升级为可定位具体 Diff 的右侧面板，并保留现有保护基线。
3. 完善 Plan 取消、失败、恢复和权限拒绝路径。
4. 建立 Harness 版本兼容矩阵，持续跟踪 Workspace Write PowerShell 问题。
5. 下一 Daily Build 继续直接覆盖 V0.3.8，并保留不含凭据的 last-known-good 快照。
