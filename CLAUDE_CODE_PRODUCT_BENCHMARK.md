# DSH Desktop 对标 Claude Code 产品能力基线

> 核对日期：2026-08-21  
> 对标对象：Claude Code CLI 与 Claude Code Desktop 的 Code 工作区。  
> 技术底座：DeepSeek Harness。  
> 证据来源：仅使用 Claude Code 官方文档；没有把第三方评测或宣传文章当作产品事实。

## 1. 对标结论

DSH Desktop 要对标的不是 Claude 的视觉风格，而是 Claude Code 的工作闭环：

`打开代码仓库 → 建立独立会话 → 理解/规划 → 申请权限 → 修改代码 → 运行命令和测试 → 审查 Diff → 接受、拒绝或回退 → 恢复/分支/并行继续`

官方资料：

- [Claude Code Desktop 快速开始](https://code.claude.com/docs/en/desktop-quickstart)
- [Claude Code Desktop 完整说明](https://code.claude.com/docs/en/desktop)
- [Claude Code 工作机制](https://code.claude.com/docs/en/how-claude-code-works)
- [Checkpointing](https://code.claude.com/docs/en/checkpointing)
- [Permissions](https://code.claude.com/docs/en/permissions)
- [Claude Code 扩展体系](https://code.claude.com/docs/en/features-overview)

## 2. 产品能力拆解

| Claude Code 能力 | DSH Desktop 应实现的产品含义 | 规划版本 |
|---|---|---|
| 本地项目/仓库 | 选择本地目录，Agent 与终端共享同一工作目录 | V0.3 |
| 独立持久会话 | 每项任务有独立上下文、状态和文件变化，可继续、重命名、归档 | V0.3 |
| Stop & steer | Agent 执行中可停止、补充要求并继续，而不是等待整轮结束 | V0.3 |
| Plan mode | 只读理解与规划，明确批准后再修改 | V0.3 |
| 权限模式 | Ask、允许规则、拒绝规则和高风险确认 | V0.3 / V0.5 |
| 实时工具过程 | 展示读取、搜索、编辑、命令、测试和等待确认状态 | V0.3 |
| 可视化 Diff | 按文件审查修改，支持接受、拒绝和定位原文件 | V0.3 |
| 集成终端 | 与 Agent 使用相同工作目录和环境，用户可并行运行命令 | V0.4 |
| 文件查看/编辑 | 从对话或 Diff 跳到文件，支持代码查看与必要的直接编辑 | V0.4 |
| 可调整工作区 | Chat、Diff、File、Terminal、Preview、Plan、Tasks、Subagent 分栏可调整 | V0.4 |
| 应用预览 | HTML、PDF、图片和本地开发服务器在工作台内预览 | V0.4 |
| Checkpoint/Rewind | 自动记录 Agent 文件编辑，可回退代码、会话或两者 | V0.5 |
| 会话恢复/分支 | 继续原会话或从某一点建立新分支，不污染原任务 | V0.5 |
| 项目规则与记忆 | 加载 AGENTS.md/项目规则，形成可审计的本地项目记忆 | V0.5 |
| 并行会话/Worktree | 多任务在隔离 Git worktree 中并行，避免代码冲突 | V0.6 |
| Subagents/Tasks | 显示子 Agent 和后台命令，支持查看状态、消息和停止 | V0.6 |
| Side Chat | 临时追问，不污染主会话上下文 | V0.6 |
| Skills/Plugins/Hooks/MCP | 可发现、配置、启停和审计扩展能力 | V0.6 |
| Git/PR 工作流 | 分支、状态、提交、PR 检查结果和失败定位 | V0.7 |
| 定时任务 | 周期性代码审查、依赖检查等自动任务 | V1.1+ |
| Remote/SSH/Cloud | 在远程机器或云环境继续同类会话 | V1.1+ |
| Computer Use | 在明确授权下操作桌面 GUI | V1.2+ |
| 移动端派发/跨端继续 | 从其他设备发起或监控桌面任务 | V1.2+ |

## 3. 1.0 必须达到的能力

### Agent 编程闭环

- 打开本地仓库并创建会话。
- Agent 可以读取、搜索、编辑文件，运行命令与测试。
- 用户可以选择 Plan、Ask 或受控自动执行模式。
- Agent 执行中可停止、纠正和继续。
- 所有修改进入可视化 Diff，并能接受、拒绝或回退。
- 会话、计划、工具过程和文件变化可以恢复。

### 桌面工作台

- 左侧是项目、会话和并行任务。
- 中间是会话、计划与权限交互。
- 右侧或底部按需打开 Diff、文件、终端、预览和任务面板。
- 面板可调整大小、关闭和恢复，并保存布局。
- 键盘优先：命令面板、终端快捷键、停止、返回和焦点切换。

### 安全和可恢复性

- 高风险命令、越界写入和外部操作明确确认。
- 自动 checkpoint，支持按会话恢复。
- 并行任务默认使用隔离 worktree。
- Harness、插件或桌面更新失败可回滚。
- 日志、诊断和共享内容默认脱敏。

### 扩展能力

- 支持 Harness 的 Skills、Plugins、Hooks、MCP 和 Subagents。
- 扩展的安装、启停、权限和来源可见。
- 项目规则与本地记忆可查看、编辑和关闭。

## 4. 1.0 之后再做

- SSH、云端和远程环境。
- PR 自动修复和自动合并。
- 定时任务与复杂后台自动化。
- Computer Use。
- 手机派发和跨设备会话迁移。
- 企业级 SSO、集中策略和组织权限。

这些功能属于 Claude Code Desktop 的扩展形态，但不是本地桌面编码主闭环成立的前提。

## 5. 不对标的内容

- 不复制 Claude 品牌、配色、图标或文案。
- 不强行实现 Claude 专属账户、云基础设施和商业订阅逻辑。
- 不把聊天、KPI 仪表盘或行业场景包装当作 Agent 编程能力。
- 不为了功能数量牺牲执行透明度、权限控制和可恢复性。

## 6. 对现有概念稿的处理

- A/B/C ERP 概念稿退出产品主线，只作为已归档的视觉探索。
- 当前通用 `index.html` 可保留窗口、主题、双语和基础安全代码参考，但其自建项目/聊天逻辑不进入正式产品。
- 正式工作台重新围绕项目、会话、计划、工具过程、Diff、文件、终端、预览和任务状态设计。
