# DSH Desktop 执行进度

> 日期：2026-08-21  
> 当前构建：V0.3.7 Daily Build
> 状态：已直接覆盖 V0.3.6；桌面仓库与 Harness Workspace 已统一，真实单文件 Diff 闭环通过

## 本轮完成

1. 接入 rc.8 官方 Workspace/Session RPC，把 Windows 原生选择的仓库注册为同一路径 Workspace。
2. 显式注入 `DSH_CWD`，复用目标 Workspace 未归档空白会话；没有时创建并绑定新会话。
3. 启动时切换官方 UI 到目标会话，并修复已有用户数据下会话列表初始化导致的持久化竞态。
4. 原生“项目”菜单显示“Harness：已同步到 …”，便于直接核对桌面与 Agent 实际工作目录。
5. 自动化回归增至 48 项，新增回环 RPC、Workspace 采用、会话复用/创建、归档保护和启动稳定性测试。
6. 使用软件 Key 和 `DeepSeek-V4-Flash High` 完成两轮真实编辑，模型仅调用 Read/Edit，没有调用 PowerShell 或 Shell。
7. 第一轮 `alpha=1 → alpha=2` 经桌面“接受并暂存”写入 Git 暂存区；第二轮 `alpha=2 → alpha=3` 经“拒绝并恢复”回到暂存基线。
8. 构建 V0.3.7，完成 V0.3.6 非凭据快照后直接覆盖；安装版程序哈希、注册版本与 Harness smoke 全部通过。

## 验证证据

| 验证项 | 结果 |
|---|---|
| 单元/集成测试 | 48/48 通过 |
| 桌面与 Harness 路径 | 窗口、官方 Workspace、输入区和原生菜单均为 `v0.3.7-real-e2e-repo` |
| 真实 Key 文件修改 | 两轮 Read/Edit 成功，未调用命令行，未修改其他文件 |
| 接受并暂存 | 工作区和 Git 暂存区均为 `alpha=2` |
| 拒绝并恢复 | `alpha=3` 恢复为暂存基线 `alpha=2`，已有暂存内容保留 |
| 解包版 Harness | 随机回环端口 HTTP 200，Workspace 同步成功 |
| 正式安装版 Harness | 版本 0.3.7、HTTP 200、标题 `DeepSeek Harness`、Workspace 同步成功 |
| 软件 Key | 覆盖安装后仍为“已配置、软件优先”；未读取、显示或复制明文 |
| 会话持久化 | 覆盖安装后 8 个持久会话文件保留 |
| 安装包 | 158,432,047 字节；7-Zip 检查 `Everything is Ok` |
| 安装包 SHA-256 | `005C4F7FA224E71E1BDC284053F0BF6C998A424792F1F89BD7F0EBE9F77892E6` |
| V0.3.6 → V0.3.7 覆盖 | 安装器完成；注册版本 `DSH Desktop 0.3.7` |
| 安装一致性 | 正式与解包版 `app.asar` SHA-256 均为 `B7A17CFEE05BB63270AA4A360360C65422B73EEE0B45892CE14F1A2A2C83F1D2` |
| Harness 文件闭包 | 29,201 个文件，0 个重解析点；NSIS 介质含 29,278 个文件 |

## 安装与回滚

- 当前正式目录：`%LOCALAPPDATA%\Programs\DSH Desktop`
- V0.3.7 前完整快照：`backups/pre-v0.3.7-20260821-231507`
- 快照包含 V0.3.6 程序、非凭据用户数据和旧安装包。
- 快照共 60,387 个文件，重解析点 0 个，`.credentials.yaml` 0 个。
- 隔离真实验证仓库保留在忽略目录 `artifacts/v0.3.7-real-e2e-repo`；验证后已恢复用户原有“未选择仓库”状态。

## 未宣称完成

- 当前是最近单文件的安全审查闭环，不是独立多文件 Diff 面板；尚无批量接受/拒绝、Checkpoint 或 Rewind。
- Plan/执行模式的桌面级门禁尚未完成，仍主要复用官方 Harness UI。
- Workspace Write 下 `pwsh` 仍可能以 `3221225477 (0xC0000005)` 失败；应用准确报告失败，不自动切换 Full Access。
- 软件 Key 使用 Harness rc.8 的 `.credentials.yaml`；Windows 下依赖用户目录 ACL，尚未接入 Credential Manager/DPAPI。
- 自动更新、代码签名和 Harness 兼容矩阵流水线尚未完成。

## 下一优先级

1. 把最近单文件审查扩展为多文件 Diff 列表和逐文件接受/拒绝。
2. 补齐 Plan → 确认 → 执行的桌面级状态与权限门禁。
3. 验证真实多文件任务的测试、权限确认、取消和恢复路径。
4. 建立 Harness 版本兼容矩阵，持续跟踪 Workspace Write PowerShell 问题。
5. 下一 Daily Build 继续直接覆盖 V0.3.7，并保留不含凭据的 last-known-good 快照。
