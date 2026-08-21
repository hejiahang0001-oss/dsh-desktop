# DeepSeek Harness 同源桌面项目工程参考

> 检索日期：2026-08-21  
> 目的：只研究明确基于 `deepseek-ai/deepseek-harness` 或 `@deepseek-ai/dsh` 构建的产品。  
> 证据边界：以下能力来自仓库 README、配置和代码索引；本轮没有逐个安装运行，因此不能把项目自述等同于本机实测。

> 定位说明：这些项目只用于 Harness 桌面封装、进程治理、扩展和发布工程参考。DSH Desktop 的产品对标对象是 Claude Code，不是这些社区项目。

## 1. 上游基线

- 官方仓库：[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)
- 许可证：MIT。
- 当前状态：官方明确标注为 developer preview，并提示可能发生破坏兼容性的变更。
- 官方运行方式：`npx @deepseek-ai/dsh web`，本地 Web UI 默认通过 loopback 地址提供。
- 核心架构：“一切皆插件”，由 Cordis 组合；会话、模型、工具、Agent loop、权限、人机交互、工作区和 Web Client 均属于 Harness 产品能力。

因此，桌面产品应把 Harness 作为运行时和产品能力底座，而不是重新实现一套聊天、会话、模型和权限系统。

## 2. 入选标准

只有同时满足以下条件的仓库才进入工程主参考集：

1. README、依赖或配置明确指向 `deepseek-ai/deepseek-harness` / `@deepseek-ai/dsh`。
2. 不只是“支持 DeepSeek 模型”，而是真正托管或扩展 Harness。
3. 有可运行桌面入口、安装包路线或完整构建说明。
4. 对 DSH Desktop 的架构、桌面体验或发布治理具有可复用价值。

## 3. 主参考项目

### 3.1 dataelement/dsh-desktop：最接近 MVP 的薄桌面壳

- 仓库：[dataelement/dsh-desktop](https://github.com/dataelement/dsh-desktop)
- 关系证据：README 明确说明它打包本地 DeepSeek Harness Web 体验，并固定 `@deepseek-ai/dsh@0.1.0-rc.6`。
- 产品路线：自动启动本地 Harness、分配随机 loopback 端口、等待就绪、加载完整官方界面；工作区仍由 Harness 管理。
- 桌面职责：子进程生命周期、日志、用户数据目录、Windows/macOS 打包。

应借鉴：

- 第一版不要重写 Harness UI 和核心能力。
- 安装目录与用户数据目录分离，升级不能删除 profile、插件和会话。
- 用随机 `127.0.0.1` 端口和 readiness check，而不是写死服务端口。

### 3.2 salathleizhang/deepseek-harness-desktop：进程监督与发布门禁样板

- 仓库：[salathleizhang/deepseek-harness-desktop](https://github.com/salathleizhang/deepseek-harness-desktop)
- 关系证据：仓库从官方 Harness 演进，桌面包以受监督子进程运行 `dsh web`，不重写 Web GUI。
- 运行架构：Electron Main → Harness Supervisor → 内置 Node + `@deepseek-ai/dsh` → 随机 loopback Web UI。
- 稳定性：单实例、就绪等待、异常退出指数退避重启、优雅停止、日志、深链。
- 发布方式：捆绑平台 Node 运行时和 Harness closure；安装包执行真实 packaged-app smoke 后才发布。

应借鉴：

- 把 Harness Supervisor 作为 V0.2 的核心工程，而不是直接在 Electron 主进程调用模型 API。
- 安装版 smoke 必须验证“应用启动—Harness 就绪—页面 HTTP 200/完成渲染”，不能只验证 exe 存在。
- 桌面宿主和上游 DSH 版本保持明确映射。

### 3.3 lencx/Minke：产品化工作台与受控 Overlay 样板

- 仓库：[lencx/Minke](https://github.com/lencx/Minke)
- 关系证据：README 定义为 “A native desktop workspace for DeepSeek Harness”；`config/harness-runtime.json` 固定官方仓库 commit、`@deepseek-ai/dsh@0.1.0-rc.7` 和自有 Harness overlay。
- 产品路线：在对话旁提供文件、终端、Web 工具和原生桌面动作；应用数据收口到清晰的本地目录。
- 发布范围：Windows、macOS、Linux；安装包带校验和。

应借鉴：

- DSH Desktop 的开发者工作台能力应以 Harness overlay/client plugin 扩展，而不是另起一套前端和会话协议。
- 右侧 Diff/File/Preview 与底部 Terminal/Test 属于独立工作面，不能挤进聊天气泡。
- 固定上游 commit 与 package version，建立运行时大小和文件数预算。

### 3.4 anywhere-labs/deepseek-harness-desktop：Cordis 原生桌面层与回滚样板

- 仓库：[anywhere-labs/deepseek-harness-desktop](https://github.com/anywhere-labs/deepseek-harness-desktop)
- 关系证据：`dsh-plugin-desktop` 直接在 Electron Main 中启动 Host Cordis 根，并让桌面能力继续参与普通 Cordis 组合。
- 产品路线：兼容模式原样承载官方 Web surface；高级模式通过 Client plugin/slot 提供桌面布局，不暴露原始 Electron API。
- 稳定性设计：profile 选择、pending generation、last-known-good、失败回滚、受管插件安装与取消。

应借鉴：

- V0.2–V0.3 先提供“兼容模式”，V0.4 以后再启用产品化高级布局。
- profile 或插件更新必须先快照，启动成功后才提交为 last-known-good。
- 原生能力通过窄接口或 Harness service 暴露，禁止给 Renderer 开放通用 Electron/Node 权限。

### 3.5 ChisaAlter/Deepseek-Harness-Desktop：桌面工作台深度样板

- 仓库：[ChisaAlter/Deepseek-Harness-Desktop](https://github.com/ChisaAlter/Deepseek-Harness-Desktop)
- 关系证据：仓库包含官方 Harness vendor 基线，README 当前声明固定 `0.1.0-rc.7` 和对应 commit。
- 产品能力：右侧工作区 surfaces、文件树、Git diff、终端、托盘、自动更新、插件启动恢复等。

应借鉴：

- “会话 + 文件/Diff + 终端/预览”是桌面开发工作台的核心布局关系。
- 用户必须看得见 Agent 改了哪些文件，并能进入差异或回滚路径。
- 关闭窗口、后台任务、托盘状态和更新恢复属于桌面产品主流程，不是装饰性功能。

### 3.6 Deepseek-Harness-EAC：插件生态和自愈能力的边界参考

- 仓库：[zouyuxuan122/Deepseek-Harness-EAC](https://github.com/zouyuxuan122/Deepseek-Harness-EAC)
- 关系证据：README 明确把官方 `deepseek-ai/deepseek-harness` 和 `@deepseek-ai/dsh` 封装为 Windows/Linux 桌面客户端。
- 产品能力：内置运行时、便携版、托盘通知、插件市场、插件快照/修复/回滚、客户端和 Harness 双重更新。

应借鉴：

- 插件安装、Harness 升级和桌面升级必须有用户确认、快照和失败回退。
- Windows 便携版和诊断/事故报告对试点用户有实际价值。

谨慎点：

- 功能和皮肤范围很大，且部分皮肤采用非商业许可，不能直接作为 DSH Desktop 1.0 的范围或资产来源。
- 只借鉴治理机制，不复制其全部插件、皮肤和功能集合。

## 4. 明确排除的项目类型

- Chatbox、Cherry Studio 等普通多模型客户端：支持 DeepSeek API，但不是 DeepSeek Harness 产品。
- Abu Cowork：README 明确说明稳定版本仍使用自有 Harness，DeepSeek Harness 只是正在集成的目标。
- BitFun：社区讨论说明 ACP 接入 DSH 尚未交付，不能算已基于 DSH。
- 只有安装脚本、没有稳定桌面宿主和产品界面的仓库：可参考打包，不进入工程主参考集。
- 仅同名、空壳、简单 fork 或没有运行证据的仓库：不作为路线依据。

## 5. 对 DSH Desktop 工程实现的最终取舍

### 采用

1. 以薄桌面壳启动并监督官方 Harness。
2. 固定上游 tag/commit，捆绑 Node 与 Harness runtime。
3. 第一阶段原样加载官方 Web UI，先保证全部 Harness 能力可用。
4. Claude Code 对标的开发者工作台能力通过 profile、bundle、Host plugin 和 Client plugin/slot 增量实现。
5. 桌面端负责单实例、窗口、托盘、通知、文件选择、更新、诊断和进程恢复。
6. 插件和上游更新采用快照、last-known-good 与失败回滚。

### 不采用

1. 不在 Electron 中重新实现模型适配、Agent loop、会话、权限和工作区。
2. 不以 `localStorage` 维护另一套正式项目数据。
3. 不直接 fork 并长期魔改整套 Harness Web UI；优先使用官方插件与 slot 扩展面。
4. 不在 1.0 前建设完整插件市场、皮肤市场或多平台功能大全。
5. 不把社区 README 中的自述能力当作本产品已验证能力。

## 6. 对当前本地原型的影响

当前工作目录的 `package.json` 只有 Electron 与打包依赖，没有 `@deepseek-ai/dsh`；`electron/main.cjs` 直接调用 Chat Completions；项目和对话状态由 Renderer 自己维护。

因此当前 V0.1.1 应重新定义为“桌面视觉与安装原型”，不能定义为“已经基于 DeepSeek Harness 的产品基线”。下一迭代的首要目标不是扩展自建聊天功能，而是完成 Harness runtime 接入和架构纠偏。
