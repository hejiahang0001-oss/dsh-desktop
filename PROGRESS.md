# DSH Desktop 执行进度

> 日期：2026-08-30
> 当前构建：V0.8.0 产品 Latest（Git 分支、提交与 PR 交付入口）
> 状态：V0.8.0 已完成实现、回归、覆盖安装、PR/CI 和 GitHub Pre-release 全部门禁；下一步推进 V0.9.0 托盘通知与更新回退准备，V0.5.4 继续保持 Stable 和 GitHub 正式 `Latest release`

## V0.8.0 本轮进展

1. 新增独立、沙箱化的 Git 交付中心：集中查看仓库路径、分支、HEAD、上游、领先/落后、已暂存、未暂存、未跟踪、冲突和最近八次提交。
2. 提交入口只接受 1–200 个可见字符的单行说明，只提交已经暂存的内容，不自动暂存、不推送；原生确认默认取消，并在确认后再次核对完整状态指纹。
3. Agent、待确认/排队消息、安全终端、Side Chat、代码检查点、工作树或数据备份繁忙时拒绝提交，避免多个写入面同时操作同一仓库。
4. 对受支持的 GitHub origin 读取当前分支公开 PR 和 checks/status；网络内容有大小、数量和超时上限，Renderer 只收到文本与不透明链接编号，外部检查地址不会被直接开放。
5. 没有 Git、不是 Git 仓库、私有仓库需要认证或 GitHub 暂不可用时，只将交付中心标为不可用；聊天、Office、Excel 和 Wiki 继续正常使用。
6. 已通过完整源码回归 299/299、生产依赖审计（0 个已知漏洞）、真实 GitHub 公共状态读取及真实 Electron 渲染检查；截图中 6 个状态卡、最近 8 次提交和禁用的无暂存提交按钮均正确。
7. 首个解包候选的前 12 项 smoke 通过，但 Git 窗口 smoke 错把打包后的 `app.asar` 当作仓库而超时；产品功能未报错、该候选未安装/发布。修复后每次建立独立临时 Git 仓库并验证含空格路径，最终解包版和已安装版均完成 13/13。

### V0.8.0 当前门禁

| 门禁 | 当前结果 |
|---|---|
| 核心与安全测试 | 完整源码回归 299/299；生产依赖审计 0 个已知漏洞；索引对象哈希变化回归通过 |
| 真实窗口 | 1539×1085 物理像素截图可读，无裁切；无暂存内容时提交按钮禁用 |
| 打包与覆盖安装 | 最终安装包 184,103,790 字节；静默覆盖退出 0 并注册 V0.8.0；解包/已安装 13/13、终端隔离、Wiki 基础和真实 DeepSeek 历史导入均通过；28 个语义数据文件始终逐字节一致 |
| PR / CI / GitHub | 实现 PR [#53](https://github.com/hejiahang0001-oss/dsh-desktop/pull/53) 与 smoke 修复 PR [#54](https://github.com/hejiahang0001-oss/dsh-desktop/pull/54) 均合并，主分支 CI [33278583044](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/33278583044) 三项通过；[V0.8.0](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.8.0) 为非草稿 Pre-release，远端与匿名公开回下载 3/3 摘要、清单 2/2 均通过；V0.5.4 仍为正式 Latest/Stable |

## V0.7.0 本轮进展

1. 帮助菜单与命令面板新增“导出脱敏诊断报告”“备份 DSH 数据”“验证 DSH 备份”三项固定操作，Renderer 不接收任意路径或文件写入能力。
2. 诊断 JSON 只包含桌面/Electron/Node/Harness/pnpm 版本、工作区显示名、会话和运行状态计数、凭据状态与代理是否启用；明确不含 Key、代理地址、完整工作区路径、会话正文和日志正文。
3. 备份只收集会话、工作区/Wiki 设置、受支持插件 Profile 清单和语义 Local Storage 文件；软件 Key 文件、代理设置、缓存、日志、依赖、运行时和瞬态 LevelDB 日志均排除。会话正文按原样保存，可能包含用户曾输入的敏感内容，不将“未复制凭据文件”误表述为全文脱敏。
4. 创建备份前拒绝运行中的 Agent、终端和 Side Chat，经原生默认取消确认后短暂停止 Harness、刷新存储、写入新的版本化目录，并逐文件核对大小和 SHA-256 后恢复 Harness。
5. 备份验证拒绝缺失、篡改、超限、链接、凭据型路径、父目录跳转、Windows 备用数据流和保留名；不会执行备份中的任何内容。V0.7.0 先提供创建和验证，重启时事务恢复按计划后续实现。

### V0.7.0 当前门禁

| 门禁 | 当前结果 |
|---|---|
| 备份与诊断核心 | 通过：固定语义路径白名单、软件凭据文件/代理/日志排除、会话正文不脱敏提示、逐文件哈希、清单外文件/篡改/危险路径拒绝和诊断脱敏已覆盖 |
| 原生入口与 IPC | 通过：三项固定帮助菜单/命令入口、原生目录/保存选择和主框架 IPC 校验已覆盖 |
| 源码与生产审计 | 293/293 通过；支持/IPC/版本专项 9/9；生产依赖无已知漏洞；语法和差异检查通过 |
| 打包与覆盖安装 | 最终安装包 184,095,531 字节，SHA-256 `EC39183251FD08E7BCE58076332A018F3CE2D7BED2B851D97ACF9323A4D2EE69`；静默覆盖退出码 0，Windows 登记 V0.7.0 |
| 包体与更新边界 | 解包版/安装版均 `packageReady: true`、零重解析点；相对 V0.6.5 复用 99.4112%；安装包未签名，自动更新继续关闭 |
| 最终运行回归 | 解包版和安装版 12/12、固定终端、Wiki 基础均通过；安装版真实 DeepSeek 两回合通过；GPU 截图环境错误由软件渲染原样复验通过 |
| 数据保留 | 28 份语义文件在覆盖安装和全部最终回归前后逐字节一致；最终安装/解包 app.asar 哈希均为 `B898EC0E60BB3A5205547F0F313156F5BF01430402CD0E5CA8DDFA75B02F72B7` |
| PR / CI / GitHub | 实现 PR [#51](https://github.com/hejiahang0001-oss/dsh-desktop/pull/51) 与主分支 CI [33276406947](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/33276406947) 三项均通过；[V0.7.0](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.7.0) 为非草稿 Pre-release，精确指向 `70e5644d271ba6c6bea849da825b4d2743ceeb2b`；GitHub 3/3 资产摘要与匿名公开回下载 3/3 哈希、清单 2/2 均通过，V0.5.4 仍为正式 Latest/Stable |

## V0.6.5 本轮进展

1. Wiki 中心新增 DSH 历史批量导入：只列出当前工作区普通、非空会话；运行中会话不可选，每次最多选择 8 个。
2. Renderer 只接收随机不透明选择标识、标题、时间、状态和计数，不接收 Harness 真实会话编号、短期源令牌、历史路径或正文。
3. 桌面通过固定 Harness `session.list` / 分页 `session.history` 读取完整持久内容，只保留用户和助手文本；排除 Subagent、工具、思考、系统指令、图片和非文本块。
4. 私钥、DeepSeek 风格 API Key、Bearer Token 和凭据赋值在进入 Agent 前遮蔽；短期源位于用户数据目录，30 分钟到期并定时清理，重新加载会话、切换工作区或保存后立即作废。
5. `/wiki-history-ingest dsh` 只允许固定预览、会话读取、页面读取、规格校验、确认保存和精确清理命令；历史正文视为不可信资料，不得扩展权限或触发外部操作。
6. Wiki 写入支持指纹去重、已有页面哈希合并、人工页面保护、敏感内容二次确认、跨进程写锁、事务归档、写后校验和失败回退。

### V0.6.5 当前门禁

| 门禁 | 当前结果 |
|---|---|
| 历史导入核心与桌面接入 | 通过：不透明/陈旧选择、运行会话拒绝、ISO/数字时间、分页、文本过滤、凭据遮蔽、大小/过期限制、去重、人工页保护、并发锁、回滚、危险路径和窄 IPC 已覆盖 |
| 完整源码与生产审计 | 289/289 通过；生产依赖无已知漏洞；语法与 `git diff --check` 通过 |
| 固定 Harness / 真实模型 | source、packaged、installed 三层 `skill.list` 发现五个可由模型调用的 Wiki 用户 Skill；真实 DeepSeek 三层两回合完成预览、读取、校验、后续明确确认和保存，确认前零写入，测试凭据未进入 Agent，短期源已清理 |
| Skill 规范检查 | Harness 实际发现和调用通过；通用 Skill Creator 校验器不接受 Harness 所需的 `user-invocable` / `disable-model-invocation` 元数据方言，因此以固定 Harness `skill.list` 与真实 Agent 验收作为发布依据 |
| 打包与覆盖安装 | 安装包 184,089,462 字节，SHA-256 `5B89D3B43F15E46D2EA38B6FBFDDDBE99FE7D66EA90B29BAEBB74E82D806382E`；静默覆盖退出码 0，Windows 登记 V0.6.5 |
| 包体与更新边界 | 解包版与安装版均 `packageReady: true`、零重解析点；相对 V0.6.4 复用 99.3904%；安装包未签名，自动更新继续关闭 |
| 已安装回归与数据 | 11/11 GUI、固定终端、Wiki 基础和真实模型历史导入均通过；安装目录 `app.asar` 与解包目录同哈希；28 份无凭据语义文件在安装前、安装后和全部回归后逐字节一致 |
| PR / CI / GitHub | 实现 PR [#49](https://github.com/hejiahang0001-oss/dsh-desktop/pull/49) 与主分支 CI [33272267115](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/33272267115) 三项均通过；[V0.6.5](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.6.5) 为非草稿 Pre-release，精确指向 `6726f29847f564a5657dcfdfda013be129f2f75e`；GitHub 3/3 资产大小与摘要、公开回下载 3/3 哈希和清单 2/2 均通过，V0.5.4 仍为正式 Latest/Stable |

V0.6.5 发布门禁已完成，下一步进入 V0.7 试点与开发交付。Stable V0.5.4 不变。

## V0.6.4 本轮进展

1. 内置第五项 Wiki Skill `/wiki-update`：固定当前桌面工作区作为项目源，只把用户已选择并初始化的 Markdown 知识库作为写入目标。
2. 新增有 Git/无 Git 双模式增量检查：Git 可用时记录 HEAD 和祖先关系；Git 不可用时按受限文件清单、大小和 SHA-256 比较。`.env`、凭据/私钥、依赖、构建产物、二进制、大文件和临时同步规格均不进入清单。
3. 新增项目页面合并与来源治理：页面只能位于当前项目总览、`concepts`、`skills`、`references`；更新前必须读取并提交现有 SHA-256；未纳入清单的人工页面绝不覆盖；页面写明源文件和 extracted/inferred/ambiguous 比例，并保留人工审核生命周期。
4. 新增事务保存和回退：保存前重复核对源指纹、Git HEAD 和页面哈希；显式确认后才写入；同步更新 `.manifest.json`、`index.md`、`log.md`、`hot.md`，并在 `_archives/dsh-project-sync` 保存恢复副本，失败时恢复原文。
5. Wiki 中心新增“检查当前项目增量”和“让 Agent 整理并同步”，命令面板与工具菜单新增 `/wiki-update` 入口；渲染层只接收计数和固定状态，不接收任意文件或命令执行能力。

### V0.6.4 当前门禁

| 门禁 | 当前结果 |
|---|---|
| 项目同步核心 | 12/12 通过：无 Git、敏感/依赖/超限排除、首次创建、增量更新、重复执行拦截、陈旧源拒绝、失败回滚、并发写入锁、人工页保护和 Windows 特殊路径拒绝 |
| Wiki 桌面与包治理专项 | 11/11 通过：第五项 Skill、窄 IPC、命令入口和固定工具包清单完整 |
| 完整源码与生产审计 | 279/279 通过；生产依赖无已知漏洞；语法与 `git diff --check` 通过 |
| 固定 Harness / 真实模型 | source、packaged、installed 三层发现四个可由模型调用的 Wiki 用户 Skill；真实 DeepSeek 两轮同步在源码和最终安装版均通过，固定工具最迟在第 2 次调用使用，总调用不超过 7 次，`.env` 未进入调用或知识库 |
| 打包与覆盖安装 | 最终安装包 184,077,501 字节，SHA-256 `1BFC8BDF230D7B1A26910E7A5B717D59C2373DCC50409E15FEB119B49F0DFEC8`；静默覆盖退出码 0，Windows 登记 V0.6.4 |
| 包体与更新边界 | 解包版与安装版均 `packageReady: true`、零重解析点；相对 V0.6.3 复用 99.4482%；安装包未签名，自动更新继续关闭 |
| 已安装回归与数据 | 11/11 GUI、固定终端、Wiki 基础和真实模型同步均通过；安装目录 `app.asar` 与解包目录同哈希；28 份无凭据语义文件在安装前、安装后和全部回归后逐字节一致 |
| 上游 Harness | 2026-08-30 再核对 npm：`latest`/`next` 均为 `0.1.1-rc.2`，因此本版无需替换；GitHub 的 `0.1.2-alpha.1` 作为 V0.7 前兼容性候选单独验证，不直接越过 npm 正式分发标签 |
| PR / CI / GitHub | 实现 PR [#47](https://github.com/hejiahang0001-oss/dsh-desktop/pull/47) 与主分支 CI [33267481828](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/33267481828) 三项均通过；[V0.6.4](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.6.4) 为非草稿 Pre-release，精确指向 `6fdb27cc5db67195c291a86d562ca60335c60110`；GitHub 3/3 资产大小与摘要、公开回下载 3/3 哈希和清单 2/2 均通过，V0.5.4 仍为正式 Latest/Stable |

下一步进入 V0.6.5 DSH 历史批量导入。Stable V0.5.4 不变。

## V0.6.3 本轮进展

1. 新增原生 Wiki 中心：每台电脑由用户选择本地 Markdown 知识库；可只创建缺失结构，不覆盖已有页面、索引或配置。
2. 新增来源可追溯查询：固定离线工具限制查询长度、扫描文件数和单页大小，排除 `_raw`、`_staging`、`_archives`、`.obsidian` 与 Git 元数据，并返回页面路径和记录来源。
3. 新增当前会话结论保存：只读取当前已完成 Harness 会话中的助手文本，用户选择并可编辑一条结论；保存前展示目标、来源和敏感检查，经原生默认取消确认后新增 `synthesis` 页面，并校验页面、`index.md` 和 `log.md` 三项事务结果。原始会话保持只读，同名页面不覆盖。
4. 内置 `llm-wiki`、`wiki-setup`、`wiki-query`、`wiki-capture` 必要子集，固定 Wiki 工具/配置路径由桌面进程注入，软件 Key 不传给 Wiki 工具；基础能力不依赖 Git、Python、QMD、Obsidian 或 Codex 安装。

### V0.6.3 当前门禁

| 门禁 | 当前结果 |
|---|---|
| 完整源码 | 271/271 通过；生产依赖审计为 0 个已知漏洞；语法和差异空白检查通过 |
| 固定 Harness / 真实模型 | source、packaged、installed 三层 `skill.list` 均发现 `wiki-setup`、`wiki-query`、`wiki-capture` 且可由模型调用；真实 DeepSeek `/wiki-query` 实际调用固定工具并返回页面路径与来源，临时凭据副本已删除 |
| 无 Git / 路径 / 保存 | 中文与空格路径在无 Git 环境完成初始化、查询和保存；已有核心文件保留；同名页不覆盖；敏感内容需再次确认；临时不可用知识库路径不会被清空 |
| 原生界面 | 源码、打包态和最终已安装版 Wiki smoke 均为 `ok: true`，4 个能力组件、1 条来源查询结果和 7 个窄 IPC 动作齐全；已安装截图的 GPU 路径出现 `UnknownVizError` 后以软件渲染重跑通过 |
| 打包与覆盖安装 | `DSH-Desktop-Setup-0.6.3.exe` 为 184,066,457 字节，SHA-256 `8F622125D6B3989B742EFF886769213F93F0AF2570C636A877FE008F84050132`；静默覆盖退出码 0，Windows 登记 V0.6.3 |
| 包体与更新边界 | `packageReady: true`，零重解析点，固定 pnpm 11.19.0、Word/Excel/PPT 和 5 个 Wiki 必需文件完整；相对 V0.6.2 复用 99.4657%。安装包仍未签名，自动更新继续关闭 |
| 已安装回归 | 10/10 既有 GUI smoke、固定终端两命令与凭据隔离通过；最终安装目录 `app.asar` 和 Wiki Skill 均与解包目录哈希一致，最终已安装 Wiki/Harness 查询与保存再次通过 |
| 覆盖安装与数据 | 安装前、安装后、回归后和最终重建覆盖后 28 份无凭据语义文件逐字节一致，含 15 份会话；回滚备份 `backups/pre-v0.6.3-20260829-195636` 含上一版三项资产且无重解析点 |
| PR、CI 与 GitHub | 实现 PR [#45](https://github.com/hejiahang0001-oss/dsh-desktop/pull/45) 与主分支 CI [33253419641](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/33253419641) 三项均通过；[V0.6.3](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.6.3) 为非草稿 Pre-release，精确指向 `b8db00ae48d630344bf3f641608e33ad062c553c`；远端 3/3 资产摘要和公网重下载哈希一致，清单 2/2 通过。V0.5.4 仍为正式 Latest/Stable |

接下来按 V0.6.4 项目知识增量同步、V0.6.5 DSH 历史批量导入顺序推进，再进入 V0.7 试点；安全和上游兼容性阻断仍优先。网页研究、复杂文档、QMD 和 Obsidian 界面控制保留为后续扩展候选。

完整范围与验收要求见 [桌面版迭代计划](DSH_DESKTOP_ITERATION_PLAN.md) 的“V0.6.3–V0.6.5：Wiki 适配计划”。V0.5.4 Stable 保持不变。

## V0.6.2 本轮进展

1. 真实用户环境确认 DSH 从 Windows Explorer 启动时无法使用 Codex 私有 Git，电脑正常用户/系统 PATH 也没有 `git.exe`；当前工作区本身是有效仓库根目录，因此根因是自动检查点依赖未满足，而不是 `/excel-xlsx` 或 Harness 命令失败。
2. 自动检查点请求现在携带固定来源标记；来源为 `automatic` 且检查点不可用时，渲染层静默跳过提示，不阻止也不改写正常发送。
3. 手动“立即创建代码检查点”、历史和恢复入口仍保留明确状态反馈，Git 可用时的自动检查点、去重、敏感路径排除和会话关联逻辑不变。

### V0.6.2 当前门禁

| 门禁 | 当前结果 |
|---|---|
| 自动提示专项 | 红灯测试已证明旧实现会显示不可用提示；实现后检查点与命令面板专项 5/5 通过 |
| 完整源码 | 261/261 通过；生产依赖高危审计 0 项；语法、差异空白检查通过 |
| 打包与覆盖安装 | `DSH-Desktop-Setup-0.6.2.exe` 构建成功并静默覆盖，Windows 登记 V0.6.2；安装器 184,048,484 字节，SHA-256 `B4E5364F081E748A754647CA5FCD1833C8F215434EE855DB86B9D041F4A9A1CF` |
| 完整运行时 | unpacked 10/10、已安装版 10/10 与真实两命令终端通过；发布治理 `packageReady: true`，零重解析点，pnpm 11.19.0 与 Word/Excel/PPT Skill 齐备 |
| 无 Git 已安装版 | 使用正常 Windows PATH 启动安装版并确认 `git.exe` 不可解析；点击聊天框、输入 `/excel-xlsx` 并延迟复核均无黄色 Git 提示，命令候选正常出现且未发送消息 |
| 覆盖安装与数据 | 安装前、安装后和完整 smoke 后 27 份无凭据语义文件逐字节一致；回滚备份 `backups/pre-v0.6.2-20260826-213117` 已建立 |
| PR、CI 与 GitHub | 实现 PR [#43](https://github.com/hejiahang0001-oss/dsh-desktop/pull/43) 三项 CI 通过并合并为 `3af68ef9d39eaf489164394855b57e73b1604829`；主分支 CI [32977360705](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/32977360705) 三项通过；[V0.6.2](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.6.2) 为指向该提交的非 Draft Pre-release，远端 3/3 大小/摘要和公开重下载哈希一致，清单 2/2 通过；V0.5.4 仍为正式 Latest |

## V0.6.1 本轮进展

1. 定位到官方 Harness 的 `steer` 是“下一步处理”而非立即打断：正在执行的模型或工具步骤不结束时，补充消息会停留在队列，看起来像“插话后没有回应”。
2. 纯文本 `Ctrl+Enter` 现在通过同一个官方 Harness 会话先请求取消当前回合，确认回合空闲后再提交完整补充内容；不创建第二套 Agent loop，不让渲染页面指定会话编号。
3. 官方界面中的“插话发送”按钮改为读取 Harness WebSocket 下行保存的完整排队消息，移除精确队列项、请求中断并重新提交，避免使用界面截断预览或重复发送。
4. 附件、斜杠命令、引用、超过 8000 字或非当前工作区会话继续使用原生路径或失败关闭，避免为了立即中断而损失结构化内容。

### V0.6.1 当前门禁

| 门禁 | 当前结果 |
|---|---|
| 可靠插话专项 | 10/10 通过，覆盖直接插话、排队完整正文、慢取消、会话/工作区竞态、输入边界和渲染捕获路径 |
| 完整源码 | 261/261 通过 |
| 真实 DeepSeek | 最终证据 `artifacts/v0.6.1-reliable-interrupt/real-agent-smoke-final.json` 为 `ok: true`；真实会话记录 1 个 aborted 回合，并收到直接和排队两种指定回复；临时凭据副本已清理 |
| 打包与包体 | 安装包 184,048,445 字节，SHA-256 `8B344A63EDB18ED955A3826E7A12AC8EC3DEE8C09945B16E4B81818EFEF523CB`；blockmap 188,952 字节；固定终端、pnpm 11.19.0 和三项 Office Skill 完整；0 重解析点；相对 V0.6.0 可复用 99.4478% |
| 覆盖安装与数据 | 静默覆盖退出码 0，Windows 登记 V0.6.1；27 份无凭据语义文件在安装前、安装后和完整 smoke 后逐字节一致；回滚备份 `backups/pre-v0.6.1-20260826-140553` 已逐文件复核 |
| 已安装版 | 10 项 GUI、终端 smoke 均通过；Office 截图在本机 GPU 捕获返回 `UnknownVizError` 后以 Electron 软件渲染重跑通过，3 张 Office 卡、3 个集成节点和 3 个按钮完整；安装树只比解包树多正常卸载器，`app.asar` 摘要一致 |
| PR、CI 与 GitHub | 实现 PR [#41](https://github.com/hejiahang0001-oss/dsh-desktop/pull/41) 三项 CI 通过并合并为 `4d7a3fa33b80522c488d12fc8308d9165d3e5f08`；主分支 CI [32937889326](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/32937889326) 三项通过；[V0.6.1](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.6.1) 为指向该提交的非 Draft Pre-release，远端 3/3 大小/摘要和公开重下载哈希一致，清单 2/2 通过；V0.5.4 仍为正式 Latest |

## V0.6.0 本轮进展

1. 新增本机隔离的 Office 交付中心，统一展示 Word、Excel、PowerPoint 三项能力的组件就绪度、可编辑结构、严格边界和固定调用入口。
2. 三个按钮只调用现有 Harness 主输入框中的 `/word-docx`、`/excel-xlsx`、`/powerpoint-pptx`，不接收任意命令、路径、包名或可执行输入，不复制 Agent loop。
3. 同屏标出隔离 worktree、Tasks/Subagents 和扩展/pnpm 集成链，强调并行工作、扩展状态和 Office 输出都绑定当前工作区。
4. Office 状态检查仅核对软件随附的六个固定 Skill/工具文件，拒绝缺失、空文件和符号链接；不读取 Skill 正文、API Key、会话内容或用户文件。

### V0.6.0 当前门禁

| 门禁 | 当前结果 |
|---|---|
| Office 交付中心专项 | 13/13 通过；本机窗口、固定 IPC、三项 Skill 保持、缺失即关闭与任意标识拒绝均有测试 |
| 完整源码与生产审计 | 251/251 通过；生产依赖审计无已知漏洞；主进程语法与 `git diff --check` 通过 |
| 真实界面与集成矩阵 | 解包和安装版 10 项 GUI + 终端矩阵全部通过；Office 中心为 `ok: true`，仅 2 项固定 API、3 张 Office 卡片、3 个集成节点与 3 个可用按钮；顶部和滚动后底部的 1524×1085 视觉检查无裁切或重叠 |
| Office 真实打开 | Word、Excel、PowerPoint 16.0.19127.20302 均以独立进程启动对应 DOCX/XLSX/PPTX 并保持响应；只关闭本轮新建进程，原有 Office 进程保持不变 |
| 打包与完整性 | 安装包 184,045,391 字节，SHA-256 `863A10686ABBB317E2AD564CB4F1E9E07848ED930721626459945D7062F0BEAF`；blockmap 188,843 字节，SHA-256 `6177FEF8701C0F14BD038B3ED210A641D5C805D99DE27C5C1F1CB76A2C28EB4C`；清单 2/2 本地一致 |
| 覆盖安装与数据保留 | 静默覆盖退出码 0，Windows 注册 V0.6.0；安装版包含解包版全部等长文件且仅多正常卸载器，二者零重解析点、`app.asar` 哈希一致；27 份无凭据语义文件覆盖前后及安装版完整 smoke 后逐字节一致 |
| PR/CI 与远端资产 | 实现 PR [#38](https://github.com/hejiahang0001-oss/dsh-desktop/pull/38) 与证据 PR [#39](https://github.com/hejiahang0001-oss/dsh-desktop/pull/39) 的 CI 均三项通过；[#39](https://github.com/hejiahang0001-oss/dsh-desktop/pull/39) 合并为 `80e9be76476f312b2baf427221c0c9174e5a18a0`，main CI [32897953354](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/32897953354) 三项通过；[V0.6.0](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.6.0) 非草稿 Pre-release 精确指向该提交，远端 3/3 摘要、公开 HTTP 200 与清单 2/2 均通过，V0.5.4 仍为正式 Latest |
| 本地版本保留 | V0.5.22 三份旧发布资产在与覆盖前备份逐项等长同哈希后移入回收站；本地保留 V0.5.4 Stable 与 V0.6.0 Latest，旧资产仍可从回收站、备份或 GitHub 恢复 |

## V0.5.22 本轮进展

1. 增加官方 Harness 可发现、用户与模型均可调用的 bundled `/powerpoint-pptx` Skill；工具菜单和固定命令面板只向官方输入框写入 Skill 命令。
2. 增加固定离线 PPTX 引擎：支持可编辑文本、形状、表格、柱形图/条形图/折线图/饼图、内嵌 Excel 图表数据、工作区 PNG/JPEG、真实母版、Title/Content 两套版式、页码和逐页演讲者备注。
3. 增加完整文本节点的精确替换、全有或全无语义、默认不覆盖和带 `.dsh-backup-*` 回滚副本的显式覆盖。
4. 严格检查拒绝外部关系模式、绝对外部 Target、外链、宏、OLE 和 ActiveX；拒绝工作区逃逸、链接/联接、伪装图片、超限规格和异常大图表数值。
5. 真实软件 Key 验收中，Harness Agent 成功生成 3 页 PPTX：1 个表格、1 个原生图表、1 个内嵌工作簿、3 页备注、1 个母版和 2 套版式，正常结束并通过独立严格检查。
6. Microsoft PowerPoint 16 已启动维护者验收文件和 Agent 产物且保持响应；PPT Master 完成交付包检查与严格逐页转换，4/4 + 3/3 页视觉检查无裁切和重叠。

### V0.5.22 当前门禁

| 门禁 | 当前结果 |
|---|---|
| PPTX 核心与安全 | 已完成；文本、形状、表格、图表、图片、母版、版式、备注、替换、回滚和严格风险检查均有测试 |
| 真实 Harness 发现 | `artifacts/v0.5.22-powerpoint/source-skill-discovery.json` 为 `ok: true`；`skill.list` 返回 `powerpoint-pptx`、`modelInvocable: true` |
| 真实 Harness Agent | `artifacts/v0.5.22-powerpoint/real-agent-smoke.json` 为 `ok: true`；生成 PPTX 20,601 字节，SHA-256 `8119092C0D302EBBF7BBEB9F014418B15E0A1CEA65B2242BC096E5163B0FF662` |
| PowerPoint 与逐页视觉 | 本机 Office 16 保持响应；PPT Master 包检查通过，严格转换 0 诊断；维护者 4/4 页、Agent 3/3 页无裁切或重叠 |
| 源码回归 | 聚焦门禁 41/41、全量 247/247、生产依赖审计 0 个已知漏洞、`git diff --check` 通过 |
| 解包与安装版 | 29,793 个解包文件、692,792,809 字节；安装版逐项等长且只多正常卸载器，0 缺失/大小差异/链接；两套十类 smoke 与三项 Office Skill 发现均通过；`app.asar` SHA-256 `85D365B2579AAA2C645F8280681BABACE42B9D16DE78D472A5E64ED7B3AB81F2` |
| 安装包与差分 | 安装包 184,041,512 字节，SHA-256 `D682772B9AC1AE2E18127848C031B960B6A6877159A4A1C6C8A8E6B6B5B886A1`；blockmap 188,964 字节，SHA-256 `9D2EE4C628AC7BC4735FAB5DBC568B4A7B8FF7F51D4D5C6EE37020A945B87491`；从 V0.5.21 复用 182,986,303 字节（99.4266%） |
| 覆盖数据与回滚 | 静默覆盖并登记 V0.5.22；前后 27 个状态/会话/Profile 语义文件逐字节一致；回滚点 `backups/pre-v0.5.22-20260826-033037` 不含凭据且 0 链接 |
| PR 与 CI | 实现 PR [#36](https://github.com/hejiahang0001-oss/dsh-desktop/pull/36) 三项 CI [32888306493](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/32888306493) 通过并以 `d227731f5b6824e2df1a69da0b9018c58410781b` 合并；主分支 CI [32888445447](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/32888445447) 三项通过 |
| 发布与远端资产 | [V0.5.22 Pre-release](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.5.22) 非草稿并指向实现合并提交；远端三项大小/digest 匹配，公网安装包 HTTP 200 且长度准确，干净回下载 3/3 摘要与清单 2/2 通过；GitHub 正式 Latest 仍为 V0.5.4 |

## V0.5.21 本轮进展

1. 增加官方 Harness 可发现、用户与模型均可调用的 bundled `/excel-xlsx` Skill；工具菜单和固定命令面板只向官方输入框写入 Skill 命令。
2. 增加固定离线 XLSX 引擎：支持多 Sheet、文本/数字/布尔/日期/公式、样式、列宽、合并单元格、筛选、冻结窗格、CSV 导入和自动勾稽表。
3. 增加明确单元格更新、公式缓存失效、全量重算标记、默认不覆盖和带 `.dsh-backup-*` 回滚副本的显式覆盖。
4. 严格检查覆盖公式错误、共享/数组/数据表公式结构、风险公式、外部链接、连接、查询表和宏；拒绝工作区逃逸、链接/联接、重复更新、超限规格和网络/DDE 类公式。
5. 真实软件 Key 验收中，Harness Agent 成功生成 3 Sheet、69 单元格、10 公式的 XLSX，正常结束并通过独立严格检查。
6. Microsoft Excel 实际打开维护者验收文件和 Agent 生成文件；发现并修复 XML 元素顺序与条件格式颜色两个兼容问题。最终无修复提示，公式重算、筛选、冻结、样式、勾稽和 CSV 文本保真均通过。

### V0.5.21 当前门禁

| 门禁 | 当前结果 |
|---|---|
| 专项自动化 | Excel、UI、Harness Supervisor、Word 保持与发布治理 38/38 通过 |
| 全量源码 | 233/233 通过；生产依赖审计无已知漏洞；`git diff --check` 通过 |
| 真实 Harness 发现 | `artifacts/v0.5.21-excel/source-skill-discovery.json` 为 `ok: true`；`skill.list` 返回 `excel-xlsx`、`modelInvocable: true` |
| 真实 Harness Agent | `artifacts/v0.5.21-excel/real-agent-smoke.json` 为 `ok: true`；生成 XLSX 5,970 字节，SHA-256 `E9A02920CEAD1A84D0FDC5A3E50ECD5E75B90B377D7560016F37094AB8E539D5` |
| 最终 Excel 文件 | Microsoft Excel 打开与重算通过；3 Sheet、17 公式、3 筛选、3 冻结窗格；总额 2,940、勾稽差异 0、状态 OK；CSV `001` 和公式样文本保真 |
| 安全审核 | 工作区/链接/大小/公式/外链/连接/查询表/宏限制已实现；临时 Key 副本在隔离 Harness Home 中使用并自动清理 |
| 解包与安装版 | 29,791 个解包文件、692,728,208 字节；安装版逐项等长且只多正常卸载器，0 缺失/大小差异/链接；两套十类 smoke 和源码/打包/安装版 `excel-xlsx` 发现全部通过 |
| 安装包 | `DSH-Desktop-Setup-0.5.21.exe`；184,026,194 字节；SHA-256 `16A67381E798A01A1B107BA00861D78021B50250012B71CE6A545FAA0EB673A0`；blockmap 188,874 字节，SHA-256 `8249192B195150243670609B991FEC586720D8CB772529F86C6BB0007D1B471A` |
| 差分与签名 | V0.5.20→V0.5.21 复用 182,967,366 字节，99.4246%，预计下载 1,058,828 字节；unsigned，自动更新继续关闭 |
| 覆盖数据与回滚 | 静默覆盖退出码 0，Windows 登记 V0.5.21；前/安装后/完整 smoke 后 27 个语义文件清单 SHA-256 均为 `D4DC1C46139CE2237846FFE28AA40D4F13E915CF11CD8AB7E6EA73F30C61F35D`；回滚点 `backups/pre-v0.5.21-20260826-020523` 已核验且无凭据副本 |
| PR 与 CI | 实现 PR [#34](https://github.com/hejiahang0001-oss/dsh-desktop/pull/34) 三项 CI [32882802354](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/32882802354) 通过并以 `bd75fcb6a0e2038761a257bc3d696b372eba6607` 合并；主分支 CI [32882923123](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/32882923123) 三项通过 |
| 发布与远端资产 | [V0.5.21 Pre-release](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.5.21) 非草稿并准确指向实现合并提交；三项资产远端大小/digest 与本地一致，公开安装包 HTTP 200；干净回下载三项摘要全部匹配且校验清单 2/2 通过；GitHub 正式 Latest 仍为 V0.5.4 |

## V0.5.20 本轮进展

1. 增加官方 Harness 可发现、用户与模型均可调用的 bundled `/word-docx` Skill；工具菜单和固定命令面板可把 Skill 命令写入官方输入框，不建立第二套 Agent 循环。
2. 增加固定离线 DOCX 工具，支持标题/副标题、1–3 级标题、段落、项目符号、编号、表格、PNG/JPEG 图片、分页、页眉页脚和可编辑 OOXML。
3. 增加精确文本替换：任一查找项未命中则整体失败，重复查找规则失败关闭；默认不覆盖，明确覆盖先生成同目录回退副本。
4. 规格、图片、输入和输出限制在当前工作区；拒绝路径穿越、符号链接/联接、伪装图片、远程 URL、超限规格、DOCX、条目和图片。
5. ZIP 在解压前校验中央目录、条目数量、单项大小和 96 MiB 总声明解压大小；输出写入临时文件并独立回读结构后才替换目标。
6. 真实软件 Key 验收中，官方 Harness 会话进入运行态、调用 `/word-docx`、生成规格与 DOCX、正常结束并通过独立检查；Key 只复制到验收临时 Harness Home，结束后自动清理，未写入报告或工作区。
7. Microsoft Word 已实际打开基础、修改、真实 Agent 和图片验收文件；无修复提示和兼容模式，中文、三页分页、图片比例、表格、页眉页脚与替换标记可见。

### V0.5.20 当前门禁

| 门禁 | 当前结果 |
|---|---|
| 专项自动化 | Word、Harness Supervisor 与发布治理 32/32 通过 |
| 全量源码 | 216/216 通过；版本、Word、安全、恢复、UI、IPC 与既有桌面能力全部纳入 |
| 生产依赖 | `pnpm audit --prod --audit-level moderate`：无已知漏洞 |
| 真实 Harness 发现 | `artifacts/v0.5.20-word/source-harness-skill.json` 为 `ok: true`；`skill.list` 返回 `word-docx`、`modelInvocable: true` |
| 真实 Harness Agent | `artifacts/v0.5.20-word/real-harness-agent.json` 为 `ok: true`；运行态与正常结束均确认，生成 DOCX 4,992 字节，SHA-256 `D42D3E0DA725E65D62DD28900992A02E5175BCAA955F08109F84390EE2C4899E` |
| 最终 Word 文件 | 修改版 67,167 字节；12 个 OOXML 条目、27 个段落、1 张表格、1 张 PNG、精确替换 1 次；Microsoft Word 三页视觉验收通过 |
| 安全审核 | 增加 96 MiB 预解压总量上限、图片签名/尺寸/数量/总量限制、重复替换拒绝、软件独占运行时变量和安装包必需 Skill 文件门禁 |
| 解包与安装版 | 29,789 个解包文件、692,676,394 字节；安装版逐项等长且只多正常卸载器，0 缺失/大小差异/链接；十类 smoke 与安装版 `word-docx` 发现全部通过 |
| 安装包 | `DSH-Desktop-Setup-0.5.20.exe`；184,012,614 字节；SHA-256 `0815951648E4376CE7B4AFF6630A44946CFF6984CC9E2C85A0EA85B387C561FC`；blockmap 188,877 字节，SHA-256 `9176D8C43513C8B638856190752C094381A08F1AA471936C6490205AA9911128` |
| 差分与签名 | V0.5.19→V0.5.20 复用 182,988,030 字节，99.4432%，预计下载 1,024,584 字节；unsigned，自动更新继续关闭 |
| 覆盖数据与回滚 | 静默覆盖退出码 0；前/安装后/完整 smoke 后 27 个语义文件清单 SHA-256 均为 `D4DC1C46139CE2237846FFE28AA40D4F13E915CF11CD8AB7E6EA73F30C61F35D`；回滚点 `backups/pre-v0.5.20-20260826-000034` 已核验 |
| PR 与 CI | 实现 PR [#32](https://github.com/hejiahang0001-oss/dsh-desktop/pull/32) 三项 CI [32872710785](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/32872710785) 通过并以 `1917277853d73e7b5b7be886735b83ab541867af` 合并；主分支 CI [32872841947](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/32872841947) 三项通过 |
| 发布与远端资产 | [V0.5.20 Pre-release](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.5.20) 非草稿并准确指向合并提交；三项资产远端大小/digest 与本地一致，公开安装包 HTTP 200；干净回下载三项摘要全部匹配且校验清单 2/2 通过；GitHub 正式 Latest 仍为 V0.5.4 |

## V0.5.19 本轮进展

1. 将“扩展健康”升级为统一“扩展中心”，固定展示 Skills、Plugins、Hooks、MCP 四类能力的来源、作用域、权限、版本、活动/禁用/失败数量与边界说明。
2. 实时状态直接读取固定 Harness 官方 Typert Remote `pluginInventory/list`，不维护第二份加载状态；响应、地址、方法、参数、数量、名称和超时均有界，非随机 IPv4 回环地址失败关闭。
3. 真实 rc.2 Harness 已确认 165 个加载项、136 个活动、0 个失败；Skill 相关模块 7 个、4 个活动。固定运行时同时确认官方 Skill、MCP 客户端和插件清单包版本均为 `0.1.1-rc.2`。
4. MCP 客户端包已就绪但真实清单当前为 0 个活动项；界面明确这不等于已配置 MCP 服务。固定上游没有独立 Hooks 清单或生命周期接口，桌面版不把普通插件、安装脚本或扫描到的文本冒充 Hooks。
5. 保留既有已验证插件的安装、升级、卸载、启停和最近可用回滚闭环；Renderer 仍没有任意包名、registry、版本、路径、pnpm 参数或配置正文输入。
6. 界面只展示有界元数据，不读取 Skill 正文、插件配置、Hook 脚本、MCP 密钥或会话内容；新增固定命令面板入口和窄 `openWindow` IPC。

### V0.5.19 当前门禁

| 门禁 | 当前结果 |
|---|---|
| 定向自动化 | 扩展中心、固定闭包与本地 UI 10/10 通过 |
| 全量源码 | 201/201 通过；版本、功能、安全、恢复、UI、IPC、语义数据与既有桌面能力全部纳入 |
| 真实 Harness | `artifacts/v0.5.19-source-harness-final.json` 为 `ok: true`；165/136/0，Skills 7/4，MCP 包就绪且活动项为 0，Hooks 边界明确 |
| 窄数据面 | 只读官方清单；最多 512 项、名称最多 256 字符、异常阶段归一化、问题最多展示 16 项 |
| 真实界面 | 1419×1025 解包版实拍已核对；Skills/MCP 为“已就绪”、Hooks 为“上游未提供”、Plugins 在无实时连接的固定 smoke 中为“实时未连接”，路径使用普通用户文案 |
| 生产依赖 | `pnpm audit --prod --audit-level moderate`：无已知漏洞 |
| 解包包体 | 29,787 个文件、692,626,330 字节；`app.asar` 1,271,116 字节；Harness 29,233 个文件；pnpm 454 个文件、19,001,803 字节；0 reparse point、0 重复 PTY、0 外平台终端文件、0 PDB |
| 解包运行 | 桌面、真实 Harness、IPC、PDF、上下文、扩展中心、工作树、任务/子代理、Side Chat、真实 PTY 十类 smoke 全部通过 |
| 安装包 | `DSH-Desktop-Setup-0.5.19.exe`；183,999,047 字节；SHA-256 `2913E2FC1C9DC7BDE5D2D3014F428272D3506D5440687D4AEC8AB93C7FADE6A6`；blockmap 189,055 字节，SHA-256 `C6B627EFE5E63899E5E05B61DF32AA808495E0EDDAD6839689D3D185EE51DC9F` |
| 差分与签名 | V0.5.18→V0.5.19 复用 183,054,366 / 183,999,047 字节，99.4866%，预计下载 944,681 字节；unsigned，自动更新继续关闭 |
| 覆盖与安装版 | 安装器退出码 0，注册 `DSH Desktop 0.5.19`；安装版含解包版全部 29,787 文件并只多正常卸载器，0 缺失/大小差异/链接；安装/解包 `app.asar` 摘要均为 `B2F16F7D80676446A834CECA6DD2B96F1183C82AE6070930FF6928F21DE60F03` |
| 安装版运行 | 与解包版相同十类 smoke 全部通过；安装版扩展中心 1419×1025 实拍与解包版一致 |
| 覆盖数据与回滚 | 覆盖前、覆盖后和安装版完整 smoke 后 27 个语义文件逐项 0 差异，清单 SHA-256 均为 `D4DC1C46139CE2237846FFE28AA40D4F13E915CF11CD8AB7E6EA73F30C61F35D`；回滚点 `backups/pre-v0.5.19-final-20260825-213155` 含 V0.5.18 三项发布资产，0 哈希差异、0 凭据命名文件、0 reparse point |
| PR 与 CI | 实现 PR [#30](https://github.com/hejiahang0001-oss/dsh-desktop/pull/30) 三项 CI [32857098053](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/32857098053) 通过并以 `53df6dc3765c36c56e480369723d9531053ffbcc` 合并；主分支 CI [32857243413](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/32857243413) 三项通过 |
| 发布与远端资产 | [V0.5.19 Pre-release](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.5.19) 非草稿并准确指向合并提交；三项资产远端大小/digest 与本地一致，公开安装包 HTTP 200；干净回下载三项摘要全部匹配且校验清单 2/2 通过；GitHub 正式 Latest 仍为 V0.5.4 |

## V0.5.18 本轮进展

1. 新增 Side Chat：`Ctrl+Shift+S`、Agent 菜单和命令面板从当前已完成普通 Harness 会话建立独立会话；非空会话使用官方 `session.fork`，空会话在同一 Workspace 使用官方 `session.create`。
2. 建立前后核对主会话目录、运行/确认/队列状态、Plan 与权限投影；主会话运行、等待确认、选择子代理、目录不一致或期间发生状态竞争时失败关闭。
3. Side Chat 通过官方 `/permission workspace-write` 写路径固定为 Workspace Write / Ask，并等待持久权限投影确认；真实 Harness 测试发现命令回执可能先于投影到达，现已按上游投影作为最终事实源。
4. Side Chat 使用唯一非持久 Electron 分区，不共享主窗口的会话选择、cookie、缓存或本地存储；窗口关闭时清理临时分区，但保留 Harness 会话记录供审计。
5. Side Chat Renderer 不获得 DSH 桌面 IPC、Node、webview、弹窗、下载或外部导航；仅允许来自准确 Harness 主框架的清洗后剪贴板写入。
6. 宽屏自动并排，关闭后恢复主窗口原尺寸/最大化/全屏状态；顶部固定显示独立会话、Workspace Write / Ask 与“代码修改使用隔离工作树”的边界提示。
7. 安装版首轮 smoke 发现 Chromium 会在真实 `Preferences` 中轮换非业务 `electron.media.device_id_salt`；九类 Electron smoke 现统一在应用就绪前切换到各自隔离 `userData`，避免测试再触碰维护者真实 Profile。

### V0.5.18 当前门禁

| 门禁 | 当前结果 |
|---|---|
| 上游所有权 | 仅使用官方 Workspace、session create/fork/rename/prompt/history/list 与权限投影；不复刻 Agent loop |
| 主会话保护 | 会话 id、cwd、运行、等待、队列、Plan 和权限前后核对；Side Chat 有独立选择存储 |
| Renderer 边界 | 非持久独立分区；Context Isolation、Sandbox、无 Node/DSH IPC、无外部导航/弹窗/webview/下载 |
| 真实 Harness | 固定 rc.2 真实启动、空主会话创建独立 Side Chat、`workspace-write` 权限投影确认通过 |
| 真实窗口 | Electron 43 主/侧选择不同，侧栏隐藏、权限横幅可见、无 desktop API；截图已核对 |
| 自动化与审计 | Side Chat 专项 6/6、全量源码 196/196；生产依赖无已知漏洞；代码审核补齐异步权限投影、子框架导航和 smoke Profile 隔离 |
| 解包包体 | 29,787 个文件、692,604,565 字节；`app.asar` 1,249,351 字节；pnpm 454 个文件、19,001,803 字节；0 reparse point、0 重复 PTY、0 外平台终端文件、0 PDB |
| 解包与安装版运行 | 桌面、真实 Harness、IPC、PDF、上下文、扩展、工作树、任务/子代理、Side Chat、真实 PTY 十类 smoke 均通过 |
| 真实视觉 | 最终解包版与安装版 Side Chat 截图均确认权限横幅、单列内容、隐藏重复侧栏和独立会话文案可见 |
| 安装包 | `DSH-Desktop-Setup-0.5.18.exe`；183,995,185 字节；SHA-256 `605DF28C7149D8AF535CACA9BDD6817C2163BE51270686E255B53EBB0876F33D`；blockmap 188,939 字节，SHA-256 `989D0A696A26264BF9EEF93573F492DDFFAF3C1E317FB702D963A03C62012EA6` |
| 差分与签名 | V0.5.17→V0.5.18 复用 183,106,241 / 183,995,185 字节，99.5169%，预计下载 888,944 字节；unsigned，自动更新继续关闭 |
| 覆盖安装 | 最终安装器退出码 0，注册 `DSH Desktop 0.5.18`；安装版含解包版 29,787 个文件并只多卸载器，0 缺失/大小差异/链接；安装/解包 `app.asar` 摘要均为 `6BAB9C0A346AEBCAD50259F697481895FF73D001E06C4E8B5E1CF1BBE773AF3D` |
| 覆盖数据与回滚 | 最终覆盖前、覆盖后及隔离安装版 smoke 后 27 个语义文件、14 个会话、2 个 Profile 文件逐项一致，清单 SHA-256 均为 `D4DC1C46139CE2237846FFE28AA40D4F13E915CF11CD8AB7E6EA73F30C61F35D`；回滚点 `backups/pre-v0.5.18-final-20260825-201721` 为 0 哈希差异、0 凭据命名文件、0 reparse point，并保留 V0.5.17 三资产 |
| PR 与发布 | 实现 PR [#28](https://github.com/hejiahang0001-oss/dsh-desktop/pull/28) 三项 CI 通过并以 `aca28b52719ee221912a6d90075c6c87733cf67b` 合并；主分支 CI [32848268778](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/32848268778) 三项通过；[V0.5.18 Pre-release](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.5.18) 非草稿并准确指向该合并提交 |
| 远端资产 | 三项资产的远端大小和 GitHub SHA-256 digest 与本地一致；公开安装链接 HTTP 200；回下载三资产逐文件复算摘要全部匹配，校验清单 2/2 通过；GitHub 正式 Latest 仍为 V0.5.4 |

## V0.5.17 本轮进展

1. 新增本地沙箱“任务与子代理”窗口和 `Ctrl+Shift+A` 入口；主任务、直接/嵌套子代理、运行状态、等待确认和当前会话后台任务集中可见。
2. 子代理树只来自 Harness `subagent.list`，最多 32 项、5 层；普通会话 fork 不进入树。打开记录使用目录确认的直接父子地址，不把子代理当成普通会话激活。
3. 只有 continuable 子代理且直接父任务可用时才能提交 1–8000 字补充消息；发送前再次核对父、子、模式，成功只表述为“进入 FIFO 队列”，不宣称已经执行完成。
4. 只有运行中的 continuable 子代理显示中断入口；Windows 原生确认默认取消，确认后再次核对子代理仍在运行。Harness 返回 `accepted: true` 只显示“中断请求已受理”，不宣称子代理已经停止，也不删除队列消息。
5. 后台任务继续使用上游 `session/jobs` 在官方 UI 中形成的只读镜像；窗口不自建任务注册表、不提供上游尚未定义的人类强杀，并隐藏命令中的 Key、Token、Password 和 `sk-*` 形态。
6. 结合会话 `cwd` 与当前 DSH 工作树显示“当前工作树/其他目录/未记录”，多个运行任务共用目录时明确提示风险，但不擅自迁移正在运行的任务。

### V0.5.17 当前门禁

| 门禁 | 当前结果 |
|---|---|
| 上游所有权 | Harness 会话目录、`subagent.list/prompt/interrupt` 和官方后台任务镜像为唯一事实源；不复刻 Agent loop |
| Renderer 边界 | 本地沙箱、Context Isolation、无 Node Integration、禁止导航；六项窄桥接能力，子代理操作只提交 24 位短期内部标识，补充消息最长 8000 字 |
| 地址与语义 | 每个打开/补充/中断操作重新核对直接父、子和模式；一次性子代理只读；accepted 不等于完成或停止 |
| 凭据与正文 | 不读取子代理 transcript 正文；后台命令中的 Key/Token/Password/Secret、Bearer 和 `sk-*` 形态先隐藏 |
| 工作树关联 | 基于 Harness 持久会话 `cwd` 与当前 DSH 工作区核对；共享工作目录只告警、不迁移 |
| 自动化与审计 | 全量源码 190/190、任务/UI 专项 7/7 通过；生产依赖无已知漏洞；代码审核补充阻止已结束子代理的过期中断请求 |
| 解包包体 | 29,787 个文件、692,578,430 字节；`app.asar` 1,223,216 字节；pnpm 454 个文件、19,001,803 字节；0 reparse point、0 重复 PTY、0 外平台终端文件、0 PDB |
| 解包与安装版运行 | 桌面、Harness、IPC、PDF、上下文、扩展、工作树、任务/子代理、真实 PTY 九类 smoke 均通过 |
| 真实视觉 | 最终解包版与安装版 1539×1085 截图已核对；层级、共享目录提示、补充消息输入与发送按钮、固定动作、只读后台任务和状态说明可读 |
| 安装包 | `DSH-Desktop-Setup-0.5.17.exe`；183,991,125 字节；SHA-256 `F9A6478C2A99CC99644F21A5A704EE493500FDF0B81BC6F2FB54C6DA30EB22CD`；blockmap 188,963 字节，SHA-256 `3BF702905D416C251AA6C4DA697C23D9DEB61049B293D8E5F330CB7D556C95BA` |
| 差分与签名 | V0.5.16→V0.5.17 复用 182,962,134 / 183,991,125 字节，99.4407%，预计下载 1,028,991 字节；unsigned，自动更新继续关闭 |
| 覆盖安装 | 安装器退出码 0，注册 `DSH Desktop 0.5.17`；安装版含解包版 29,787 个文件并只多卸载器，0 缺失/大小差异/链接；安装/解包 `app.asar` 摘要均为 `BC7413B26F890B8045BA0916F00EE10BE00AB55D347D9F204DC41395A6935614` |
| 覆盖数据与回滚 | 覆盖前、覆盖后及安装版 smoke 后 27 个语义文件、14 个会话、2 个 Profile 文件逐项一致；回滚点 `backups/pre-v0.5.17-20260825-175915` 含 V0.5.16 三资产，0 哈希差异、0 凭据命名文件、0 reparse point |
| 发布状态 | [PR #26](https://github.com/hejiahang0001-oss/dsh-desktop/pull/26) 已合并；PR CI 32837455967 与[主分支 CI 32837559866](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/32837559866) 三项检查全部通过；[v0.5.17](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.5.17) 为指向 `23e955aeae79ce89b8579e1b9e2475b245827d6d` 的非 Draft Pre-release；三个远端附件大小和 SHA-256 逐项一致，公开安装包返回 HTTP 200 与 183,991,125 字节；V0.5.4 仍为 Stable 与正式 Latest |

## V0.5.16 本轮进展

1. 新增本地“隔离工作树”窗口和 `Ctrl+Shift+W` 入口，列出同一仓库的工作树、分支、提交、修改数、归属和可用状态。
2. 新建操作只生成 `dsh/worktree-*` 分支与软件数据目录下的固定路径，不接收任意分支、目录或 Git 参数；Git 子进程不继承软件 DeepSeek Key 或 Git 执行覆盖变量。
3. 外部工作树仅展示和切换，不允许软件回收；软件以原子所有权记录证明创建来源，只有目录、分支和记录同时匹配且当前未打开、路径真实健康时才能回收，仿冒命名仍保持外部只读。
4. 回收有未提交修改的工作树前先写入私有 `refs/dsh/checkpoints/*` 恢复点，再复核状态指纹；确认期间有任何变化即拒绝回收。工作树目录回收后分支和提交继续保留。
5. 创建、切换、回收均使用 Windows 原生默认取消确认；切换会安全停止当前预览并让 Harness 重新绑定目标工作区。
6. 发布门禁全部完成；代码审核补充确认后仓库绑定、Git 执行覆盖隔离、总数上限、恢复点复用、原子所有权、仿冒只读、失败回收恢复和可信视觉截屏。PR、主分支 CI、Pre-release 与远端三资产核验均通过。

### V0.5.16 当前门禁

| 门禁 | 当前结果 |
|---|---|
| 固定输入面 | Renderer 只有 24 位 opaque 工作树 id；无分支、路径、命令或 Git 参数输入 |
| 所有权边界 | 外部工作树只读；路径、分支和原子 owned 记录必须同时匹配，仿冒命名不可回收；删除中状态失败关闭 |
| 恢复边界 | 脏工作树先建私有恢复点，随后再次校验完整状态指纹；分支不删除 |
| 凭据隔离 | Git 子进程移除 `DEEPSEEK*` 与 Git 目录、索引、对象、配置和 SSH 执行覆盖变量 |
| 自动化与审计 | 最终源码 183/183、工作树/UI 专项 9/9；生产依赖无已知漏洞 |
| 解包包体 | 29,787 个文件、692,524,327 字节；`app.asar` 1,169,113 字节；pnpm 454 个文件、19,001,803 字节；0 reparse point、0 重复 PTY、0 外平台终端文件、0 PDB |
| 解包与安装版运行 | 桌面、Harness、IPC、PDF、上下文、扩展、工作树、真实 PTY 八类 smoke 均通过；工作树真实完成脏状态恢复点、安全回收和分支保留 |
| 真实视觉 | 最终 1539×1055 截图已核对；修复 DOM 已更新但浏览器尚未绘制导致的加载态截屏，最终卡片、状态和固定按钮可见 |
| 安装包 | `DSH-Desktop-Setup-0.5.16.exe`；183,982,493 字节；SHA-256 `FF87D8D55892899EAF12CFF9C2DC0720663BCAF627412491E075E9B5F0C590F8`；blockmap 188,923 字节，SHA-256 `6FF72CA24ADCE1F556DF3DE9464548142BC7EF52F83CAD17CD1763A0D6312176` |
| 差分与签名 | V0.5.15→V0.5.16 复用 182,912,276 / 183,982,493 字节，99.4183%，预计下载 1,070,217 字节；unsigned，自动更新继续关闭 |
| 覆盖安装 | 退出码 0，注册 `DSH Desktop 0.5.16`；安装版含解包版 29,787 个文件并只多卸载器，0 缺失/大小差异/链接；安装/解包 `app.asar` 摘要均为 `9ED240A572ECABEF5A65DF56AD81F22AFD2C0BD3D3D9A2B3BB1583A6356B64EB` |
| 覆盖数据与回滚 | 27 个语义文件、14 个会话、2 个 Profile 文件覆盖及 smoke 后逐项一致；回滚点 `backups/pre-v0.5.16-20260825-134010` 含 V0.5.15 三资产，0 哈希差异、0 凭据命名文件、0 reparse point |
| 发布状态 | [PR #24](https://github.com/hejiahang0001-oss/dsh-desktop/pull/24) 已合并；[主分支 CI 32820893222](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/32820893222) 通过；[v0.5.16](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.5.16) 为指向 `4266f248340d8378ad29b4bd4efb2176eef6c5e9` 的非 Draft Pre-release；三个远端附件大小和摘要逐项一致，公开安装包返回 HTTP 200 与 183,982,493 字节；V0.5.4 仍为 Stable 与正式 Latest |
| 本地安装包整理 | `dist` 中 V0.5.15 安装包、blockmap 和 SHA 清单与回滚点逐字节核对后移入 Windows 回收站；本地只保留 Stable V0.5.4 与产品 Latest V0.5.16 的安装资产，V0.5.15 仍可从回收站或 `backups/pre-v0.5.16-20260825-134010` 恢复 |

## V0.5.15 本轮进展

1. 固定目录仍只有 `@nonamelego/dsh-catppuccin`，并把允许版本收紧为已分别审核的 `0.3.0` 与 `0.3.1`；Renderer 只能提交 Profile、目录 id 和 `install/upgrade/uninstall/rollback` 四个枚举动作。
2. 每次生命周期操作先原子写入 `prepared/running/applied/committed` 持久事务；快照只包含 `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`，逐文件限制 8 MiB、合计限制 16 MiB，并保存字节数、SHA-256 和内容。
3. 提交后保存一个可验证的最近可用状态，用户可在扩展窗口执行回退；回退完成后当前状态成为新的回退点，因此可撤销刚刚的回退。
4. 启动恢复优先读取主事务，损坏时读取原子备份；只对逐字节命中 applied 状态或能证明仅插件字段变化的 running 状态自动回退。发现外部清单编辑、未知版本、越界包目录或无效事务时封锁 Profile。
5. 修复真实 pnpm 演练发现的边界：`dsh plugin remove` 在最后一个依赖被移除时会删除整个 `dependencies` 字段；生命周期读取现在把缺失字段安全视为空依赖，而不是误报 Profile 无效。
6. 覆盖安装语义数据门禁新增 Profile 的三份 pnpm 清单、启停事务和生命周期事务/最近可用记录，但继续排除 `node_modules`、凭据和瞬态日志。

### V0.5.15 最终门禁

| 验证项 | 当前结果 |
|---|---|
| 全量自动化 | 最终版本号源代码套件 174/174 通过；覆盖生命周期、并发事务占用、UI、IPC、语义数据、恢复和既有桌面能力 |
| 真实 pnpm 生命周期 | 使用打包资源完成 `0.3.0`→`0.3.1`、模拟崩溃启动恢复、升级回退、卸载回退和再次回退；22 个受控子进程检查全部隔离软件 Key 并优先使用随附 pnpm |
| 冲突保护 | applied 字节快照、running 插件字段归一化、原子备份恢复通过；外部清单字段变化时拒绝自动覆盖 |
| 生产依赖 | 无已知漏洞 |
| 解包包体 | 29,785 个文件、692,356,703 字节；`app.asar` 1,109,110 字节；pnpm 454 个文件、19,001,803 字节；0 reparse point、0 重复应用 PTY、0 外平台终端文件、0 终端 PDB |
| 解包运行 | 桌面、Harness HTTP/工作区、IPC、PDF、上下文、扩展健康、真实 PTY 七类 smoke 通过；扩展窗口显示 1 个固定目录和 1 个安装入口 |
| 真实生命周期 | 解包资源和安装版资源分别完成固定安装、升级、崩溃恢复、卸载和双向回退；22 个子进程观察均确认 Key 隔离与随附 pnpm `11.19.0` |
| 差分与签名 | V0.5.14→V0.5.15 可复用 183,045,581 / 183,973,500 字节，99.4956%，预计下载 927,919 字节；unsigned、NotSigned、`verifyUpdateCodeSignature=false`，自动更新继续关闭 |
| 安装包 | `DSH-Desktop-Setup-0.5.15.exe`；183,973,500 字节；SHA-256 `BFBC4FEB21512AA24D67ABB553DF9B67FE1BB68575D7A8C089586B96CAB00BDA`；blockmap 188,904 字节，SHA-256 `237DA59196A96E8919E249F25DB7191BB252003F16E390E1A969676F804F968D` |
| 覆盖安装 | 退出码 0，注册版本 `0.5.15`；安装版包含解包版 29,787 个原始文件并只多正常卸载器；安装/解包 `app.asar` 摘要均为 `A5F58150E4FA1602A2DA10DEBA64BEAB807CC07A1DDD7ADFD4F3CC067A994DF9`；0 reparse point |
| 安装版运行 | 桌面、Harness、IPC、PDF、上下文、扩展健康和真实 PTY 七类 smoke 全部通过；安装版资源再次完成完整真实插件生命周期 |
| 覆盖数据 | 覆盖前、覆盖后及安装版 smoke 后均为 27 个语义文件、14 个会话、2 个插件 Profile 文件；逐项完全一致，聚合摘要均为 `5770CFD30539FDDAAB931FB715EE114570385F984A0E73E5706E89BF3BFAF30D` |
| 回滚点 | `backups/pre-v0.5.15-20260825-122152`；27 个语义文件、14 个会话、2 个插件 Profile 文件逐项一致，0 个凭据命名文件、0 reparse point，并保留 V0.5.14 三件发布资产 |
| 发布状态 | [PR #22](https://github.com/hejiahang0001-oss/dsh-desktop/pull/22) 三项检查和[主分支 CI 32809740429](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/32809740429) 均通过；[v0.5.15](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.5.15) 为非 Draft 的 Pre-release，目标提交 `b938107b4865a054b71f087630b5172a45485ee7`；三项远端资产大小/摘要一致，安装包直链 HTTP 200 且 `Content-Length` 为 183,973,500；V0.5.4 仍为正式 Latest |
| 本地清理 | V0.5.14 安装包、blockmap 和摘要清单与回滚点逐项哈希一致后送入 Windows 回收站；本地 `dist` 只保留 Stable V0.5.4 和产品 Latest V0.5.15 发布资产，可从回收站或回滚点恢复 V0.5.14 |

### V0.5.15 后计划调整

1. V0.5.16 进入 Git worktree：先交付软件创建、列出、切换和安全回收隔离工作树的闭环，不提前混入 Tasks/Subagents。
2. worktree 必须绑定仓库、分支、目录、所有者和状态；删除前检查未提交变更，默认进入回收站或保留可恢复点。
3. V0.5.17 再把任务和 Subagent 绑定到经过验证的 worktree，避免多个 Agent 串用同一工作目录。

## V0.5.14 本轮进展

1. 内置并固定 pnpm `11.19.0`，用软件随附 Node.js 启动；发布治理核对 wrapper、空配置、package manifest、launcher、distribution、license、版本与无 reparse point。
2. 扩展健康窗口新增“已验证安装目录”，当前只提供 `@nonamelego/dsh-catppuccin@0.3.1` 到 Web Profile；Renderer 没有包名、版本、registry、路径或 pnpm 参数输入。
3. 安装前使用 Windows 原生默认取消确认并再次核对 Profile、固定闭包、兼容状态和运行忙碌；安装后重启 Harness，只有固定版本、锁文件完整性、边界、Patch、平台、Peer 与启用状态全部正确才提交。
4. 插件子进程移除软件 Key、系统 PATH、`NODE_OPTIONS`、Node TLS/模块劫持变量、Corepack/pnpm 变量和继承的 `NPM_CONFIG_*`；固定 `ComSpec`/`PATHEXT`，只保留固定 pnpm/Node/Windows 路径、TLS、固定 registry、空配置、忽略脚本、精确版本、`$DSH_HOME/.pnpm-store` 和软件选择的无凭据代理。
5. 首次真实回滚暴露两项问题：pnpm remove 不接受 add 阶段的 CLI flags，且 hoisted 包会在只恢复清单后残留。现已把策略固定在环境变量中，remove 不再携带无效参数，并在恢复清单前执行固定 prune。
6. 修复后新的隔离事务完成真实安装、兼容验证、remove/prune 与回滚；三份受跟踪 Profile 文件摘要逐字节恢复，插件目录移除，Key 标记未进入数据目录。
7. 代码审核补充回滚失败门禁：无法确认恢复时不再误报“未提交可见变更”，并在当前进程持续封锁该 Profile，等待 V0.5.15 的持久启动恢复。

### V0.5.14 当前门禁

| 验证项 | 当前结果 |
|---|---|
| 全量自动化 | 167/167 通过；覆盖受控环境、固定目录、任意输入拒绝、回滚失败封锁、真实验证器、UI、包体和发布治理 |
| 生产依赖 | 无已知漏洞 |
| 解包包体 | 29,785 个文件、692,326,513 字节；pnpm 454 个文件、19,001,800 字节；0 reparse point、0 重复应用 PTY、0 外平台终端文件、0 终端 PDB |
| 解包运行 | 桌面、Harness、IPC、PDF、上下文、扩展健康、真实 PTY 七类 smoke 通过；Harness HTTP 200；扩展窗口显示 1 个已验证目录和 1 个安装按钮 |
| 真实受控安装 | `@nonamelego/dsh-catppuccin@0.3.1`、pnpm `11.19.0`、固定 registry、忽略脚本、Key 隔离、固定 PATH、兼容 verified、remove/prune 与三份 Profile 文件逐字节恢复均通过 |
| 差分与签名 | V0.5.13→V0.5.14 可复用 178,965,564 / 183,969,223 字节，97.2802%，预计下载 5,003,659 字节；unsigned、NotSigned、`verifyUpdateCodeSignature=false`，自动更新继续关闭 |
| 安装包 | `DSH-Desktop-Setup-0.5.14.exe`；183,969,223 字节；SHA-256 `A394AB263423309A9F6C022C27A11F9737D3E6B25A76AAB5912F6EB0A91DC2FB`；blockmap SHA-256 `50405F8E31A919DFF31F9C08E542B80DF1806BAF1569C0576DFE916E420F1DCA` |
| 覆盖安装 | 退出码 0，注册版本 `0.5.14`；安装版包含解包版 29,787 个原始文件并只多正常卸载器；`app.asar` 安装/解包摘要均为 `051254B7703B767EEC7FAB494A96AE362460B3C25A02573D35FD686F7AD00DE4`；0 reparse point、0 终端 PDB |
| 安装版运行 | 桌面、Harness、IPC、PDF、上下文、扩展健康、真实 PTY 七类 smoke 全部通过；安装版资源再次完成真实受控插件安装与回滚 |
| 覆盖数据 | 覆盖前后均为 25 个语义文件、14 个会话；逐项完全一致；规范化路径/内容聚合摘要均为 `0C473FC78E8801581734BDCD37B0A4F04B5750F526593DE58528497A46897233` |
| 回滚点 | `backups/pre-v0.5.14-20260825-105431`；25 个语义文件哈希一致，0 个凭据命名文件、0 reparse point，并保留 V0.5.13 三件发布资产 |
| 发布状态 | [PR #20](https://github.com/hejiahang0001-oss/dsh-desktop/pull/20) 三项检查和[主分支 CI 32803918073](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/32803918073) 均通过；[v0.5.14](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.5.14) 为非 Draft 的 Pre-release，目标提交 `e6e96ee82f6ebef33d18409e3dd53f385e93b3aa`；三项远端资产大小/摘要一致，安装包直链 HTTP 200；V0.5.4 仍为正式 Latest |
| 本地清理 | V0.5.13 安装包、blockmap 和摘要清单在回滚点摘要核对一致后送入 Windows 回收站；本地 `dist` 只保留 Stable V0.5.4 和当前 Latest V0.5.14，可从回收站或回滚点恢复旧资产 |

### V0.5.14 后计划调整

1. V0.5.15 优先将安装事务写入持久 journal，覆盖进程崩溃后的启动恢复；不能把 V0.5.14 的进程内回滚当作崩溃恢复。
2. 插件升级/卸载必须复用真实发现的 remove/prune 顺序，并增加 store/残留目录检查、last-known-good 选择与 Profile/lock/Patch/数据一致性证据。
3. V0.5.14 只开放一个已验证扩展；扩充目录必须逐包固定版本、完整性、许可证、Patch、平台、Peer、脚本和真实回滚证据。

## V0.5.13 本轮进展

1. `app.asar`/`app.asar.unpacked` 曾被生产依赖自动收集规则重复打入完整 `node-pty` 和 `node-addon-api`，其中包含非 Windows 平台预编译物；实际终端只从 `resources/terminal` 的独立 Win-x64 运行时加载。V0.5.13 只排除这组有解析证据、外置替代和 smoke 覆盖的冗余内容。
2. 排除 xterm 的 TypeScript 源码、source map 和未使用 ESM 构建；保留实际页面加载的固定 UMD JS、CSS 与许可证。
3. 新增有界发布治理：gzip blockmap 最大输入/解压/文件/块数限制、逐块多重集复用计算、PE Certificate Table 结构检查、包体重复/跨平台/PDB/reparse point/终端必需文件检查。
4. V0.5.11→V0.5.12 的真实 blockmap 显示 181,350,275 / 183,289,373 字节可复用，复用率 98.9421%，理论差分下载 1,939,098 字节；这证明 blockmap 有价值，但桌面自动更新仍未启用。
5. 当前安装器没有嵌入 Authenticode 证书，`verifyUpdateCodeSignature` 仍为 false；即使未来出现证书块，也必须显式验证可信证书链、预期 Publisher 和 Stable/Pre-release 独立更新通道，否则自动更新继续失败关闭。

### V0.5.13 当前门禁

| 验证项 | 当前结果 |
|---|---|
| 治理单测 | 6/6 通过；覆盖重复块计数、压缩输入边界、PE 证书表、自动更新失败关闭、包体重复与固定排除清单 |
| V0.5.12 发布回填 | [v0.5.12](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.5.12) 为非 Draft 的 Pre-release；三个资产状态、大小与摘要一致，安装包直链 HTTP 200；主分支 CI 32794365753 通过；V0.5.4 仍为正式 Latest |
| 全量自动化 | 159/159 通过；生产依赖审计无已知漏洞 |
| 解包包体 | 29,331 个文件、673,292,351 字节；较 V0.5.12 减少 39 个文件、11,904,570 字节；`app.asar` 从 6,818,148 降至 1,046,561 字节 |
| PTY 治理 | 应用内重复 PTY/Node Addon 为 0；独立终端 19 个受控包文件、1,661,537 字节，必需文件齐全、0 外平台、0 PDB、0 reparse point；真实连续命令/Key 隔离 smoke 通过 |
| 差分更新 | V0.5.12→V0.5.13 可复用 179,039,823 / 180,063,440 字节，复用率 99.4315%，预计下载 1,023,617 字节 |
| 签名门禁 | PE Certificate Table 为 unsigned，Windows Authenticode 为 NotSigned，`verifyUpdateCodeSignature=false`；可信证书链、预期 Publisher 和独立更新通道也未验证，自动更新 `automaticUpdateReady=false` |
| 安装包 | `DSH-Desktop-Setup-0.5.13.exe`；180,063,440 字节；SHA-256 `FE1AF65E08FC641E0937E8D045B06934087C31CE58DF7959144BE11FAA486AE1` |
| 覆盖安装 | 已直接覆盖 V0.5.12；注册版本 `0.5.13`；安装目录 29,334 个文件，只比当前解包目录多正常卸载器；核心 `app.asar` SHA-256 为 `8C069093DDEEC9BEDA097C5EC6430226554951865023189292184254AB8FE7DA` |
| 安装版运行 | 桌面、Harness、IPC、PDF、上下文来源、插件健康和真实 PTY 七类 smoke 全部通过；Harness HTTP 200，第三方扩展兼容已验证，终端连续命令和 Key 隔离通过 |
| 覆盖数据 | 覆盖前后均为 25 个语义文件、14 个会话；0 项变化，聚合摘要均为 `046A2EB027B3C6179CB80D84D481464B9416E5113DD656315C35CB7120B59CE4` |
| 回滚点 | `backups/pre-v0.5.13-20260825-092028`；25 个语义文件逐文件哈希一致，0 个凭据命名文件、0 reparse point，并保留 V0.5.12 三件发布资产 |
| 本地清理 | V0.5.12 安装包、blockmap 和摘要清单在备份摘要复核一致后送入 Windows 回收站；本地 `dist` 保留 Stable V0.5.4 与当前 V0.5.13，旧资产可从回收站或回滚点恢复 |
| V0.5.13 发布状态 | [PR #18](https://github.com/hejiahang0001-oss/dsh-desktop/pull/18) 与主分支 CI 32798154665 三项均通过；[v0.5.13](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.5.13) 为非 Draft 的 Pre-release，目标提交 `86f0de6d81c0d5e7b4b8db496b8284c7461c3970`；三项远端资产大小/摘要一致，安装包 HTTP 200；V0.5.4 仍为正式 Latest |

### V0.5.13 后计划调整

1. 若排除规则未让 `app.asar.unpacked` 冗余归零，禁止继续扩大删除范围，回到 electron-builder 依赖收集规则定位原因。
2. 保留 `compression: store`，优先保证高 blockmap 复用与可回退更新，不为缩小完整安装包牺牲小版本差分效率。
3. V0.5.14 才开放固定 registry/固定版本/忽略脚本的受控 pnpm 安装；V0.5.13 不增加任意安装入口。

## V0.5.12 本轮进展

1. 选择第三方 MIT 扩展 `@nonamelego/dsh-catppuccin`，固定验证 `0.3.0` 与 `0.3.1` 及各自 registry 完整性摘要；不把社区插件静默内置给普通用户。
2. 扩展健康目录新增安全兼容检查：固定/浮动 registry、本地/Git 来源、Bundle Patch 边界、Web/Host 平台、Peer 依赖和真实安装钩子；Renderer 只接收有界计数与状态，不接收依赖规格、脚本文本、Patch 正文、配置、凭据或任意路径。
3. Windows Junction 形式的 Harness 共享回退 Peer 只有在真实目标仍位于固定运行时中时才允许；指向其他位置继续失败关闭。
4. 新增真实隔离验证器，固定使用官方 `dsh plugin --profile web add`、`--save-exact` 和 `--ignore-scripts`，不接受任意包名、版本或 pnpm 参数。
5. 七阶段真实验证已通过：0.3.0 安装并写入状态、重启持久化、禁用后插件路由 404 且 Harness 根页面 200、重新启用、升级 0.3.1、回退 0.3.0、再次升级 0.3.1；每阶段固定闭包均为 432/432、兼容状态均为 verified，状态数据全程一致。

### V0.5.12 当前门禁

| 验证项 | 当前结果 |
|---|---|
| 定向自动化 | 10/10 通过；含兼容分类、Peer 范围、Junction 固定运行时边界、健康目录、UI 与真实验证器契约 |
| 全量自动化 | 152/152 通过；生产依赖审计无已知漏洞 |
| 真实插件 | `0.3.0 → 0.3.1 → 0.3.0 → 0.3.1`；七阶段全部通过，最终版本 0.3.1 |
| 数据与凭据 | 使用新的隔离 `$DSH_HOME`；安装脚本忽略；软件 Key 未转发；真实用户 Profile 未修改 |
| 解包/安装 | 六类解包版与安装版 smoke 全部通过；注册版本 `0.5.12`；安装目录 29,371 文件，只比解包版多正常卸载器；0 reparse point、0 终端 PDB |
| 安装包 | `DSH-Desktop-Setup-0.5.12.exe`；183,289,373 字节；SHA-256 `9D594631A435E0281FA7BB5DDB6546E3DFC1FD18EA78C8933DAB338EC57992B0` |
| 安装一致性 | `app.asar` SHA-256 `1195FF068947213202012F27EB93B0CC8C344F254275C463A14EE3674D37DE11`；安装/解包一致 |
| 覆盖数据门禁 | 覆盖前后 25 个语义文件、14 份会话，聚合 SHA-256 均为 `046A2EB027B3C6179CB80D84D481464B9416E5113DD656315C35CB7120B59CE4` |
| 覆盖前快照 | `backups/pre-v0.5.12-20260825-082557`；25 个语义文件、3 个 V0.5.11 回退发布文件、0 凭据文件、0 reparse point |
| 发布状态 | 本机覆盖与安装版门禁已通过；GitHub PR/主分支 CI 和 Pre-release 三资产远端核验待执行 |

### V0.5.12 后续版本调整

1. V0.5.13 先做包体治理、增量更新和签名评估；不按文件名猜测删包。
2. V0.5.14–V0.5.19 依次完成受控 pnpm 安装、插件生命周期、worktree、Tasks/Subagents、Side Chat 和统一扩展中心。
3. V0.5.20、V0.5.21、V0.5.22 分别交付 Word、Excel、PPT；V0.6.0 做统一打包、覆盖、回滚与发布验收。

## V0.5.11 本轮进展

1. 只对 Profile `dependencies` 中已经安装、可安全解析且声明 `dsh.bundle` 的外部扩展显示启用/关闭按钮；固定基础层与 Web 层无启停入口。
2. 关闭只从 `dsh.profile.bundles` 有序列表移除扩展，包与依赖继续保留；启用只把已安装扩展恢复到加载列表，不运行 pnpm、不下载代码、不执行安装脚本。
3. 变更使用 Windows 原生确认，默认与关闭均取消；Agent、待确认操作、终端或检查点任务活动时失败关闭。
4. 写入前建立不含配置正文的事务日志，并由共享原子 JSON 写入器生成已刷新、已重读的 `package.json.bak`；写后重读验证。
5. Harness 重启后重新扫描固定闭包、Profile 健康与目标启用状态；失败自动恢复原清单并再次重启。进程中断时，下次启动按前后哈希与备份三方一致性恢复；冲突编辑不覆盖。
6. 新增可重复安装包组成基线，分别统计 `app.asar`、Harness、外置 Node、隔离终端与 Electron shell；本版只测量，不删除未经闭包验证的依赖。

### V0.5.11 最终验证

| 验证项 | 当前结果 |
|---|---|
| 定向自动化 | 12/12 通过；覆盖提交、回退、崩溃恢复、冲突编辑保护、固定层拒绝、越界拒绝、包体分类与 UI/IPC 契约 |
| 全量自动化 | 146/146 通过；生产依赖审计无已知漏洞；PR、修复 PR 与主分支三项 Windows CI 全部通过 |
| 真实启停范围 | 当前 Web Profile 无外部依赖，因此真实软件不显示可误触的启停按钮；两个固定扩展层均为 `profileManaged=false`；固定闭包 432/432 联接正常 |
| 真实窗口 | 打包 smoke 显示 1 个模拟外部扩展按钮、4 项窄桥接、固定层无按钮、配置/补丁正文不泄露；1419×1025 截图可读 |
| 安装包 | `DSH-Desktop-Setup-0.5.11.exe`；183,287,290 字节；SHA-256 `0248B40A294A55ABD831F2DEC8E18BC0BBB78868E25BA51CB2935FC7810DAA3B` |
| 安装一致性 | `app.asar` SHA-256 `AAB77D8D41638CD5A11BBE437A29048F36A000C8CE388D7322CDE4028CE79A59`；解包 29,370 个文件，安装目录只多正常卸载器；0 reparse point、0 独立终端 PDB |
| 覆盖数据门禁 | 覆盖前后 25 个语义数据文件、14 份会话，聚合 SHA-256 均为 `046A2EB027B3C6179CB80D84D481464B9416E5113DD656315C35CB7120B59CE4`；0 瞬态/受限文件 |
| 覆盖前快照 | `backups/pre-v0.5.11-20260825-035234`；33 个文件、14 份会话、0 个凭据副本、0 reparse point |
| 包体基线 | 解包 653.44 MiB：Electron shell 362.66 MiB、Harness 193.99 MiB、外置 Node 88.72 MiB、`app.asar` 6.49 MiB、终端 1.59 MiB；安装包 174.80 MiB |
| 发布完整性 | [v0.5.11](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.5.11) 为非 Draft 的 Pre-release；三个远端附件大小/摘要一致并返回 HTTP 200；[主分支 CI 通过](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/32769830303)；V0.5.4 仍是 GitHub 正式 `Latest release` |

### V0.5.11 门禁问题与计划调整

1. 第一次扩展窗口打包 smoke 在 432 包闭包扫描尚未完成时只等待两帧，截图仍处于加载态而失败；未安装、未发布该候选。
2. PR #14 改为最多 15 秒等待“1 个 Profile + 1 个外部扩展按钮”的真实就绪条件；修复后重新走 CI、正式打包、六类解包/安装 smoke、覆盖和远端核验。
3. V0.5.12 必须使用实际第三方扩展验证安装、启停、重载与迁移；在真实插件未选择前，不把模拟夹具结果说成第三方插件兼容完成。

## V0.5.7–V0.5.11 五版本连续迭代验收

| 版本 | 核心能力 | 发布结果 |
|---|---|---|
| V0.5.7 | 权限中心、代理变更确认、统一敏感路径策略 | Pre-release，覆盖/安装/远端门禁通过 |
| V0.5.8 | 上下文来源可见性、规则候选边界、正文不泄露 | Pre-release，覆盖/安装/远端门禁通过 |
| V0.5.9 | 原子状态、已验证备份恢复、语义数据门禁、三层 CI | Pre-release，覆盖/安装/远端门禁通过 |
| V0.5.10 | Profile、扩展层、pnpm 外部依赖与 432 包闭包健康 | Pre-release，覆盖/安装/远端门禁通过 |
| V0.5.11 | 外部扩展安全启停、失败/中断恢复、包体基线 | Pre-release，覆盖/安装/远端门禁通过 |

本地安装目录现为 V0.5.11；`dist` 只保留 Stable V0.5.4 和当前 Latest V0.5.11 的安装包/Blockmap。V0.5.8–V0.5.10 的九个旧发布文件在逐一核对备份 SHA-256 后删除，可从对应覆盖前快照恢复。

### V0.5.11 后计划调整

1. V0.5.12 集中验证实际第三方扩展的安装、启停、运行时重载、Profile 数据迁移和跨版本回退，不把未安装插件伪装成已验证能力。
2. V0.5.13 再基于真实包体分类处理重复依赖、增量更新和签名评估；每项删除必须通过固定闭包、六类 smoke 与覆盖数据门禁。
3. Stable 仍固定 V0.5.4，只有用户明确命令才晋升。

## V0.5.10 本轮进展

1. 工具菜单新增本地“扩展健康”窗口，分别展示固定 Harness 运行时闭包、共享回退链接、本机 Profile、按顺序加载的扩展层和 Profile 声明的外部依赖。
2. 解析顺序对齐固定 Harness `0.1.1-rc.2`：扩展层先从软件安装解析、再从 Profile 解析；Profile 外部依赖由其 pnpm `node_modules` 与 Harness 维护的父级回退解析。
3. 对固定 `@deepseek-ai/dsh` 的 dependencies 与 peerDependencies 做有界 BFS，逐包核对 `$DSH_HOME/profiles/node_modules` 联接是否指向当前安装的精确目标。
4. Renderer 只接收包名、版本、来源和健康状态，不接收依赖规格、插件配置、补丁正文、凭据、会话内容或任意路径；Profile 定位使用主进程发放的短标识。
5. 新增包名校验、Profile/包数量上限、1 MiB 清单上限、realpath 范围校验、精确页面 IPC 和打包截图 smoke。
6. 对本机已安装 V0.5.9 的真实数据核对结果为固定闭包 432/432 联接正常；Web Profile 两个扩展层均从软件随附运行时解析，无外部依赖。

### V0.5.10 最终验证

| 验证项 | 当前结果 |
|---|---|
| 定向自动化 | 7/7 通过；覆盖闭包、链接、Profile、越界链接、包名、元数据边界与窗口契约 |
| 全量自动化 | 138/138 通过；生产依赖审计无已知漏洞；PR 与主分支三项 Windows CI 全部通过 |
| 真实固定闭包 | 已安装 Harness `0.1.1-rc.2`：432 个预期包、432 个正确联接、0 缺失、0 指向异常 |
| 安装包 | `DSH-Desktop-Setup-0.5.10.exe`；183,283,849 字节；SHA-256 `58BCC13747A8C0B8C15562E55774136F2EFFEFB40103D87AC5615F53A1E67F3C` |
| 安装一致性 | `app.asar` SHA-256 `B5CF61BB69E95E5655019E437112A7E5AD0007C85CF3DFF0A6BBACEF17FF432D`；解包 29,370 个文件，安装目录只多正常卸载器；0 reparse point、0 独立终端 PDB |
| 覆盖数据门禁 | 覆盖前后 25 个语义数据文件、14 份会话，聚合 SHA-256 均为 `046A2EB027B3C6179CB80D84D481464B9416E5113DD656315C35CB7120B59CE4`；0 瞬态/受限文件 |
| 覆盖前快照 | `backups/pre-v0.5.10-20260825-030739`；33 个文件、14 份会话、0 个凭据副本、0 reparse point |
| 发布完整性 | [v0.5.10](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.5.10) 为非 Draft 的 Pre-release；三个远端附件大小/摘要一致并返回 HTTP 200；[主分支 CI 通过](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/32765450366)；V0.5.4 仍是 GitHub 正式 `Latest release` |

### V0.5.10 后计划调整

1. V0.5.11 只对 Profile 明确声明的外部扩展提供安全启停，不允许关闭软件固定基础层；变更前备份、变更后健康检查，失败自动回退。
2. 插件安装/更新继续交给上游 `dsh plugin` 与 pnpm，不在桌面 Renderer 暴露任意包名、版本或命令输入。
3. 安装包瘦身先记录 `app.asar`、Harness 运行时、Electron 和终端四类占用基线，不在同版删除未经闭包验证的依赖。
4. Stable 仍固定 V0.5.4，只有用户明确命令才晋升。

## V0.5.9 本轮进展

1. 工作区、工作台布局和代理设置统一使用同一原子 JSON 存储：唯一临时文件、文件刷新、候选重读、同目录替换和父目录刷新。
2. 每次覆盖前只把可解析的旧主文件写入 `.bak`，并在替换前重新读取验证；损坏主文件不会污染 last-known-good 备份。
3. 启动时主文件损坏可回退到有效备份，再经相同原子路径修复主文件；失败与成功路径均清理临时文件。
4. 写队列按调用顺序串行化，快速调整面板或连续保存设置时不会由更早的异步写入覆盖新状态。
5. 新增语义用户数据快照，只哈希固定状态、Harness 会话/目录和 LevelDB 数据文件；凭据、密钥、链接、LOG/LOCK 等瞬态文件不进入快照。
6. Windows CI 拆为 quality、production security、package and semantic-data contracts 三层；实际 Electron 打包和覆盖安装仍使用本地固定运行时门禁。

### V0.5.9 最终验证

| 验证项 | 当前结果 |
|---|---|
| 定向自动化 | 18/18 通过；覆盖原子替换、备份恢复、失败清理、并发顺序、语义快照、三个 Store 与 CI 契约 |
| 全量/CI | 134/134 通过；PR 与主分支 quality/security/package-smoke 三项 Windows CI 全部通过 |
| 安装包 | `DSH-Desktop-Setup-0.5.9.exe`；183,278,120 字节；SHA-256 `CE7E91D4398C0D27117148F5DA705CBDFAEF04EE67404B65B8DEECF4AEE4B3ED` |
| 安装一致性 | `app.asar` SHA-256 `2D1C549070147878C54383989D5CACD1CD47AD8A85DE347933F6A3EC8BF7E36B`；解包 29,370 个文件，安装目录只多正常卸载器；0 reparse point、0 独立终端 PDB |
| 覆盖数据门禁 | 覆盖前后 25 个语义数据文件、14 份会话，聚合 SHA-256 均为 `97E5BD26637BCF08424D8ED01B222A3B4E1778BD75E21A75E392BDA609CF5CCE`；0 瞬态/受限文件 |
| 覆盖前快照 | `backups/pre-v0.5.9-20260825-023053`；32 个文件、0 个凭据副本 |
| 发布完整性 | [v0.5.9](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.5.9) 为非 Draft 的 Pre-release；三个远端附件大小/摘要一致并返回 HTTP 200；V0.5.4 仍是 GitHub 正式 `Latest release` |

### V0.5.9 后计划调整

1. V0.5.10 复用 V0.5.8 的只读窗口模式，展示固定 Profile、pnpm 依赖闭包、运行时联接和插件依赖健康，不开放写操作。
2. V0.5.11 在健康视图稳定后增加安全启停、失败关闭和故障恢复，并记录安装包瘦身的真实基线。
3. 稳定化中新增一个小版本 V0.5.12：集中处理插件启停后的运行时重载、数据迁移和回退演练，避免把启停与瘦身都塞进同一版。
4. Stable 仍固定 V0.5.4，只有用户明确命令才晋升。

## V0.5.8 本轮进展

1. 工具菜单新增独立本地“上下文来源”窗口，展示 Code preset、桌面中文策略、项目规则候选链和 Harness 持久会话层，不复刻 Agent loop。
2. 规则发现严格对齐固定 Harness `0.1.1-rc.2`：全局 Harness Home，加项目根到当前工作区逐层的 `AGENTS.md`、`CLAUDE.md`、`AGENTS.local.md`、`CLAUDE.local.md`。
3. 主进程只读取有界文件元数据，不读取规则正文、隐藏系统提示、凭据、模型输入或对话内容；可按大小标出超过 Harness 1 MiB 单文件上限的候选，内容去重与总预算纳入范围明确留给 Harness 判定。
4. Renderer 只能提交主进程发放的短期内部标识定位已发现规则，不能输入任意文件路径，也没有读取或修改规则的 IPC。
5. 窗口保持 sandbox、Context Isolation、无 Node Integration、禁止导航和新窗口；工作区变化时立即关闭并清空旧标识映射。新增真实打包窗口 smoke，检查精确三项桥接能力、两份候选、正文不泄露和截图尺寸。

### V0.5.8 当前验证

| 验证项 | 当前结果 |
|---|---|
| 定向自动化 | 3/3 通过；覆盖 Harness 顺序、仅元数据、工作区令牌重置、本地窗口与窄 IPC |
| 全量自动化 | 128/128 通过；生产依赖审计无已知漏洞；主分支 Windows CI 通过 |
| 解包/安装 | 桌面、Harness、IPC、PDF、上下文窗口五类 smoke 全部退出码 0；注册版本 `0.5.8` |
| 数据保留 | 14 份会话及 29 个已选用户数据文件覆盖前后 SHA-256 完全一致 |
| 真实界面 | 1359×965 最终窗口截图可读；2 个规则候选、三项窄桥接能力与正文不泄露门禁通过 |
| 安装包 | `DSH-Desktop-Setup-0.5.8.exe`；183,277,540 字节；SHA-256 `7EFD2B18B5ABD10EAE24923303FA05EDB35C0993815EB7AE5F3E75704DDB47DC` |
| 安装一致性 | `app.asar` SHA-256 `8666CBEF8312262934A43E1AE545DD715EEDFD9244E7DCE27B4484CE2360E7CE`；解包 29,370 个文件，安装目录只多正常卸载器；0 reparse point、0 独立终端 PDB |
| 覆盖前快照 | `backups/pre-v0.5.8-20260825-015249`；32 个文件、14 份会话、0 个凭据副本；旧 0.5.7 本地发布物可从该快照恢复 |
| 发布完整性 | [v0.5.8](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.5.8) 为非 Draft 的 Pre-release；3 个远端资产大小/摘要一致，安装包直链 HTTP 200；[主分支 Windows CI 通过](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/32757364699)；V0.5.4 仍是 GitHub 正式 `Latest release` |

### V0.5.8 后计划调整

1. V0.5.9 优先统一 JSON 状态的临时文件、刷新、原子替换和已验证备份，并把真实语义数据快照纳入 CI/覆盖门禁。
2. V0.5.10 在只读上下文窗口的安全模式上增加插件 Profile 与依赖健康视图，不提前开放可变插件操作。
3. V0.5.11 再增加安全启停、失败关闭和故障恢复，并建立安装包瘦身与增量更新的可重复基线。
4. Stable 仍固定 V0.5.4；只有用户明确下达“更新 Stable”命令后才启动晋升验收。

## V0.5.7 本轮进展

1. 工具菜单新增 Windows 原生权限中心，集中显示 Harness 当前权限模式、待确认数量和桌面固定边界；允许/拒绝仍完全由 Harness 处理，桌面版没有新增第二套授权规则。
2. 代理设置在主进程规范化并比较前后值；真实变化必须经过 Windows 原生确认，默认按钮和关闭动作均为取消。取消不保存、不应用代理、不重启 Harness；无变化也不重启。
3. 文件面板与 Git Checkpoint 改为复用同一敏感路径策略，逐路径组件、大小写不敏感地阻止 `.env`、凭据目录、密钥和证书路径。
4. 文件树不能再展开 `secrets/` 等敏感目录，搜索不会进入这些目录；`secrets/token.txt`、`CrEdEnTiAlS/api.txt` 的文本和媒体预览均失败关闭。
5. 审查发现旧 Git pathspec 的 `secret*` 会误伤 `secretary-notes.md`；已改为大小写不敏感且组件精确的排除规则，并用真实临时 Git 仓库验证敏感文件不入快照、普通文件仍正常捕获。

### V0.5.7 当前验证

| 验证项 | 当前结果 |
|---|---|
| 测试先行 | 新测试先复现缺少权限中心、代理确认和嵌套敏感路径问题；实现后针对性测试通过 |
| 全量自动化 | 125/125 通过；覆盖原生代理确认、统一敏感路径、真实临时 Git 仓库和既有功能回归 |
| 代码审查 | `code-review-excellence` 审查未发现发布阻断项；1 个敏感 pathspec 过宽问题已整改并回归 |
| 生产依赖 | `pnpm audit --prod --audit-level moderate`：无已知漏洞 |
| 解包/安装 | 解包版与安装版桌面、Harness、IPC、PDF smoke 全部退出码 0；注册版本 `0.5.7`；29,370 个包内文件完整 |
| 数据保留 | 软件 Key 引用、14 份会话和 7 项持久状态摘要不变；LevelDB 仅轮换瞬态日志，5 个数据文件摘要不变 |
| 真实界面 | 权限中心可读且关闭默认安全；代理确认默认取消；Esc 后未保存并把界面恢复为“直连” |
| 安装包 | `DSH-Desktop-Setup-0.5.7.exe`；183,272,852 字节；SHA-256 `CEE81340F8CFEFA22A32487454D2DE57FC1A061B976DFB648C119DB4AF537A17` |
| 安装一致性 | `app.asar` SHA-256 `BC3745B0554C1E6E90BA1A5F499DE8B90E8E1A4D0C7C74E3107375F90ED31E62`；安装目录只多正常卸载程序；0 reparse point、0 terminal PDB |
| 覆盖前快照 | `backups/pre-v0.5.7-20260825-002436`；33 个文件、14 份会话、0 个凭据副本 |
| 发布完整性 | [v0.5.7](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.5.7) 为非 Draft 的 Pre-release；3 个远端资产大小/摘要一致，安装包直链 HTTP 200；[主分支 Windows CI 通过](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/32754200198)；V0.5.4 仍是 GitHub 正式 `Latest release` |

### V0.5.7 后计划调整

1. 敏感路径误伤问题说明后续界面必须继续只展示有界元数据；V0.5.8 因此优先增加上下文来源可见性，但不读取或泄露规则正文、隐藏提示和凭据。
2. 覆盖安装会正常轮换 LevelDB 瞬态日志，不能再用整个用户目录哈希判断数据是否保留；V0.5.9 因此改为语义数据快照，并统一桌面状态的原子写入、备份和恢复门禁。
3. 插件链路先建立可观察性再开放写操作；V0.5.10 只读核对 Profile、固定扩展层、pnpm 依赖闭包和共享回退链接。
4. V0.5.11 仅允许启停 Profile 明确声明且已安装的外部扩展，并增加原生确认、运行忙碌门禁、失败回退和中断恢复；固定基础层保持不可变。
5. Stable 继续固定 V0.5.4；上述版本只推进产品 Latest/Pre-release，除非维护者明确下达 Stable 晋升命令。

## V0.5.6 本轮完成

1. Electron 从 `35.7.5` 固定升级到 `43.4.1`；Electron 官方 Windows x64 压缩包在打包前校验 SHA-256 `C2EF9A5F65472C34D14BD3E67B7D14E66B0C01F124ABA45263D6A4232160E13A`。
2. 外置 Node.js `24.19.0`、DeepSeek Harness `0.1.1-rc.2` 和 PTY 依赖保持不变，避免把桌面内核、Agent 行为和 Shell 行为混在一次升级中。
3. 下载脚本改为 `.partial` 临时文件、最多 3 次重试、哈希与 `electron.exe` 双校验，通过后再原子替换目标；真实网络中断留下的损坏文件不会再冒充完整运行时。
4. 对照 Electron 36–43 破坏性变更复核窗口、Preload、权限、导航和 IPC；旧 API 扫描未发现命中，主窗口继续保持 sandbox、Context Isolation、无 Node Integration 和受限导航。
5. Electron 41 起 PDF 不再产生独立 WebContents，因此增加真实 PDF 渲染 smoke：生成有效 PDF、用主窗口同等安全偏好加载、通过桌面合成截图检查查看器视觉信号，并保留截图人工核对。
6. PDF 验收首次发现 CSP 会让查看器空白；去除仅测试页上的错误限制后，确认真实 Harness 页面不发送 CSP，PDF 工具栏、缩略图和正文均正常显示。主窗口只为内置 PDF 查看器启用 `plugins: true`，其他安全偏好未放宽。
7. V0.5.6 已直接覆盖本机 V0.5.5；Stable 标签、Stable 安装包和 GitHub `Latest release` 继续保持 V0.5.4。

### V0.5.6 当前验证

| 验证项 | 结果 |
|---|---|
| 自动化 | 119/119 通过；含固定版本、下载恢复、IPC sender/frame、终端 owner、真实 Windows PTY、PDF 文件边界和既有功能回归 |
| 生产依赖 | `pnpm audit --prod --audit-level moderate` 未发现已知漏洞；Electron 已进入官方最新三个稳定大版本支持窗口 |
| 解包运行 | 桌面、Harness、IPC security 与 PDF smoke 均退出码 0；V0.5.6；Electron 43.4.1；Harness HTTP 200、标题 `DeepSeek Harness`、Workspace 同步成功 |
| PDF 真实视觉 | 1000×754 桌面合成截图显示 Chromium PDF 工具栏、缩略图和正文；深色查看器像素信号 `0.3363`，高于自动门禁 `0.08` |
| IPC 能力矩阵 | Harness 页面仅 `openWindow`；本地终端窗口仅 `getState/onOutput/onState/resize/start/stop/write`；1449×875 终端截图视觉正常 |
| 正式覆盖 | 安装器退出码 0；Windows 注册项 `DSH Desktop 0.5.6`；安装版四类 smoke 均退出码 0 |
| 数据保留 | 软件 Key 引用、14 份会话文件集合及桌面、工作台、代理、Preferences、Harness 设置摘要在覆盖前后完全一致 |
| 安装包 | `DSH-Desktop-Setup-0.5.6.exe`；183,271,349 字节；SHA-256 `9DD8855634955F12996F2DF6A57CF42F2A3D9B32AF3782A2536299D0C1F7C893` |
| 安装一致性 | 解包版 `app.asar` SHA-256 `374C7050C8CBB1B085E66C36636D22AA73B66FC048A68C0BE68EE610CDE21DEC`；29,370 个包内文件，安装目录只额外包含卸载程序，0 reparse point、0 terminal PDB |
| 覆盖前快照 | `backups/pre-v0.5.6-20260824-224757`；含 V0.5.5 安装器和 14 份会话数据；0 个凭据副本 |
| 发布完整性 | [v0.5.6](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.5.6) 为非 Draft 的 Pre-release；远端安装包大小/摘要一致，下载直链 HTTP 200；[主分支 Windows CI 通过](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/32744187437)；V0.5.4 仍是 GitHub 正式 `Latest release` |

### V0.5.6 后计划调整

1. V0.5.8 增加项目规则、Harness 记忆与本轮上下文来源视图，只允许查看或操作用户可控来源。
2. V0.5.9 统一桌面持久状态的临时文件、刷新、原子替换和已验证备份，并补 quality/security/package-smoke 三层 CI 与语义化用户数据门禁。
3. V0.5.10 增加插件 Profile 与依赖健康视图，核对固定 pnpm store 和上游插件依赖的一致性。
4. V0.5.11 增加安全启停插件、故障插件恢复，并建立安装包瘦身与增量更新的可验证基线。
5. Stable 仍固定 V0.5.4；只有用户明确下达“更新 Stable”命令后才启动晋升验收。

## V0.5.5 本轮完成

1. 持久 PowerShell PTY 从 Harness 页面内嵌面板迁移到只加载打包本地资源的独立安全窗口；窗口保持 sandbox、Context Isolation、无 Node Integration 和受限导航。
2. Harness Renderer 只保留固定的“打开/聚焦安全终端窗口”动作，不再获得终端启动、写入、调整、停止、状态或输出能力。
3. 终端 IPC 只接受独立窗口的精确主框架，并把活动 PTY owner 绑定到 `webContents.id`、`processId` 和 `routingId`；窗口关闭、导航或 Renderer 丢失时停止终端。
4. 所有原先未校验的工作区、诊断和 Harness IPC 统一经过精确主窗口、主框架和 URL 策略；预览 iframe 与其他 Renderer 默认拒绝。
5. 安装包增加真实 IPC 安全 smoke：Harness 端只能看到 1 个固定动作，本地终端端只能看到 7 个预期能力，同时生成真实渲染截图供视觉核对。
6. V0.5.5 已直接覆盖本机 V0.5.4；Stable 标签、安装包和 GitHub `Latest release` 均未改动。

### V0.5.5 当前验证

| 验证项 | 结果 |
|---|---|
| 自动化 | 118/118 通过；含精确 IPC sender/frame、终端 owner、真实 Windows PTY 和既有功能回归 |
| 生产依赖 | `pnpm audit --prod --audit-level moderate` 未发现已知漏洞；该结果不覆盖 Electron 35 的运行时支持风险 |
| 解包运行 | 桌面、Harness 与 IPC security smoke 均退出码 0；V0.5.5；Harness HTTP 200、标题 `DeepSeek Harness`、Workspace 同步成功 |
| IPC 能力矩阵 | Harness 页面仅 `openWindow`；本地终端窗口仅 `getState/onOutput/onState/resize/start/stop/write`；旧内嵌终端资产未打包 |
| 真实视觉 | 安装包实际渲染 1449×875 安全终端截图；中文、状态、按钮、PTY 区和安全提示完整可见 |
| 正式覆盖 | 安装器退出码 0；Windows 注册项 `DSH Desktop 0.5.5`；安装版三类 smoke 均退出码 0 |
| 数据保留 | 14 份会话文件集合摘要不变；软件 Key 引用及桌面、工作台、代理、Preferences、Harness 设置摘要均不变 |
| 安装包 | `DSH-Desktop-Setup-0.5.5.exe`；162,583,825 字节；SHA-256 `A22184C1A0435EAD94502B4991F38B895299D4781C57F4C44F34360296F668AA` |
| 安装一致性 | 安装版与解包版 `app.asar` SHA-256 均为 `71BE2CE32EE1029E4AFF6FC1148F8D3D66BC647890DDDE085A047A26E818A90D`；安装目录 29,369 个文件、0 reparse point、0 terminal PDB |
| 覆盖前快照 | `backups/pre-v0.5.5-20260824-200843`；31 个文件；含 V0.5.4 安装器和 14 份会话数据；0 个凭据副本 |
| 发布边界 | V0.5.4 继续为正式 Stable；V0.5.5 不创建 GitHub Release/Pre-release，待 V0.5.6 把 Electron 升入受支持线后再恢复公开 Latest 发布 |

### V0.5.5 后计划调整

1. V0.5.6 优先把 Electron `35.7.5` 升级到受支持稳定线，并完整回归窗口、Preload、预览、PTY、打包与覆盖安装；这是恢复公开 Latest 发布的阻断门禁。
2. V0.5.7 已完成权限中心、代理原生确认与统一敏感路径策略；权限语义继续来自 Harness，不建立第二套授权体系。
3. V0.5.8–V0.5.11 按“上下文来源可见 → 原子状态与 CI → 插件健康 → 安全启停与恢复”拆成四个可独立验收的小版本。
4. Stable 仍固定 V0.5.4；只有用户明确下达“更新 Stable”命令后才启动晋升验收。

## V0.5.4 本轮完成

1. 新代码检查点可关联当前普通 Harness 会话及其最近一个已完成回合；临时 API 失败不会阻塞代码检查点或用户发送。
2. `Ctrl+Alt+H` 历史中明确区分“会话回合”“已关联但尚无完整回合”和“仅代码”三种状态。
3. 历史底部提供“只恢复代码”和“建立会话分支”两个独立动作；Enter 继续只恢复代码，不暗中改变会话。
4. 会话分支只调用 Harness 官方 `session.fork(sessionId, atSeq)`，并在切换前重新验证源会话、工作区、父子关系和非 subagent 来源。
5. 会话 ID、回合序号、commit、tree、index tree 和 ref 继续只留在主进程私有边界，Renderer 只获得布尔能力摘要。
6. 建立会话分支不恢复代码、不改变真实 Git 索引、不移动 HEAD，也不改写或截断原会话。
7. 发送前重新核对最近检查点是否属于当前选中会话；用户切换会话后会先建立新的关联检查点再继续发送。
8. 实机发现 Harness 页面启动自动聚焦输入框会误建无完整回合的检查点；最终版改为只响应真实点击、输入或发送，页面自动聚焦不建点。
9. 旧检查点、空会话、运行中会话、跨工作区、subagent、损坏 ref 和无法验证的分支响应全部失败关闭，仍可保留原有代码恢复能力。

### V0.5.4 当前验证

| 验证项 | 结果 |
|---|---|
| 自动化 | 114/114 通过；含会话关联、官方 fork 边界、私有元数据、双操作 UI、启动自动聚焦抑制和既有恢复/代理/复制回归 |
| 解包运行 | 桌面 smoke 与真实 Harness smoke 均退出码 0；V0.5.4；HTTP 200；标题 `DeepSeek Harness`；Workspace 同步成功 |
| 真实会话分支 | 从 1 个已完成持久会话建立手动检查点，界面显示“会话回合”；官方 API 产生 1 个普通子会话，父会话、同工作区和完整回合边界均核对通过 |
| Git 不变性 | 分支前后 HEAD、工作树 Diff、真实索引 tree 与 cached Diff 哈希完全一致；只新增 Harness 子会话，不执行代码恢复 |
| 真实桌面 | 1208×794 和 1024×720 均显示双操作；旧点及无完整回合点的分支按钮禁用；文件、Diff、终端和历史动作无裁切 |
| 启动时序 | 最终安装版加载到工作台前后 checkpoint item ref 数量及集合摘要保持 8，不再因页面自动聚焦产生多余项 |
| 正式覆盖 | 最终安装器退出码 0；注册项 `DSH Desktop 0.5.4`；安装版 Harness HTTP 200，标题 `DeepSeek Harness` |
| 数据保留 | 14 个会话；会话集合及 Key/桌面/v5 工作台/代理/设置哈希不变；8 个真实 checkpoint item refs 保留 |
| 安装包 | `DSH-Desktop-Setup-0.5.4.exe`；162,583,718 字节；SHA-256 `C07CF56B0D809F5D84655AD8513D02FCB77684A98D31420FB99036BD2CFD41F3` |
| 安装一致性 | 安装版与解包版 `app.asar` SHA-256 均为 `812D385BF6F27348A1C21BD75C2002C81BE39906F65D3E4A370C0ADBE5461003`；安装目录 29,369 个文件、0 reparse point、0 terminal PDB |
| 覆盖前快照 | `backups/pre-v0.5.4-20260824-135649`；23 个文件；14 个会话；0 个凭据副本 |
| 发布完整性 | [v0.5.4](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.5.4)；正式 latest、非 draft/prerelease；远端大小/摘要一致；latest 直链 HTTP 200；[Windows CI 通过](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/32697127999) |

### V0.5.4 后计划调整

1. 后续安全审核把 V0.5.5 调整为终端/IPC 隔离切片；原权限中心顺延到 V0.5.7。
2. 页面自动聚焦与 Harness 会话选择存在启动时序差异；V0.5.4 已禁止自动聚焦建点，并保留发送前会话复核。V0.5.8 稳定化继续覆盖重载、切换会话和分支后首轮发送。
3. 官方 fork 已验证只增加会话数据且不碰代码；后续版本仍不把“恢复代码 + 恢复会话”合并为一个模糊动作，避免扩大不可逆误操作面。
4. 当前真实仓库已有 8 个检查点 item refs，历史列表性能和键盘交互正常；接近 12 个后按 V0.5.8 计划复测，不提前引入可能过期的缓存。
5. 复核 `dataelement/dsh-desktop` 后继续保持 Claude Code 式编程工作台定位；V0.6 在插件市场之前先完成固定 pnpm store、Profile 一致性检查和故障插件恢复，V0.7 更新改为用户接受后才下载并支持跳过指定 Latest，移动端仍放在 1.0 以后。
6. V0.5.4 Stable 保持现名；V0.5.5 只形成独立品牌与无损迁移方案，具体名称经用户确认后才应用到后续 Latest，避免同名安装目录、快捷方式和公众认知冲突。

## V0.5.3 本轮完成

1. 模型菜单、`Ctrl+,` 和固定命令面板增加“网络与代理设置”，前台可选直连、Windows 系统代理或自定义 HTTP(S) 代理。
2. 软件在独立测试会话中连接 DeepSeek API，显示 HTTP 状态且不携带软件 Key；保存后统一重启 Harness，使页面和 Node 运行时使用同一有效路由。
3. 自定义代理只接受无账号密码的 HTTP/HTTPS origin；拒绝 SOCKS、凭据、路径、查询和 fragment，并固定绕过 `127.0.0.1`、`localhost` 与 `::1`。
4. Harness 子进程移除继承的大小写代理环境变量，只注入软件选择的 `HTTP_PROXY`、`HTTPS_PROXY`、`NO_PROXY` 和 `NODE_USE_ENV_PROXY`；集成终端不继承软件代理。
5. 网络设置写入用户数据目录的独立 `network-state.json`，不写安装目录，不与 API Key 混存；Agent 运行或等待确认时不允许切换网络。
6. 原全局权限拒绝策略改为仅允许当前随机回环 Harness 主页面的 `clipboard-sanitized-write`；剪贴板读取、子框架、其他来源和其他权限仍拒绝。
7. 增加 Windows 原生编辑菜单的撤销、重做、剪切、复制、粘贴和全选角色，键盘选区复制不再依赖隐藏菜单行为。

### V0.5.3 当前验证

| 验证项 | 结果 |
|---|---|
| 自动化 | 108/108 通过；含 URL/凭据边界、持久化、环境隔离、权限白名单、可访问 UI 和内置 Node 真实代理链 |
| 解包运行 | 桌面 smoke 与真实 Harness smoke 均退出码 0；V0.5.3；HTTP 200；标题 `DeepSeek Harness`；Workspace 同步成功 |
| 真实代理 | 内置 Node 访问无法直连的测试域名，只经本机 HTTP CONNECT 代理取得 `proxy-route-ok` |
| 真实桌面 | 1024×720 与最大化代理窗口无裁切；模型菜单显示当前模式；直连测试返回 DeepSeek API HTTP 401，证明未携带 Key 但网络可达 |
| 真实复制 | 打开已有持久会话并点击 Harness 复制按钮，界面显示“已复制”；验证过程未读取或输出剪贴板内容 |
| 正式覆盖 | 安装器退出码 0；注册项 `DSH Desktop 0.5.3`；安装版 Harness HTTP 200，标题 `DeepSeek Harness` |
| 数据保留 | 13 个会话；会话集合及 Key/桌面/v5 工作台/代理/设置哈希不变；4 个真实 checkpoint item refs 保留 |
| 安装包 | `DSH-Desktop-Setup-0.5.3.exe`；162,581,004 字节；SHA-256 `CFBCF77CD0AC028704FD42BEA3992C49067D31149D3B2C51B8998E00A01FD2A3` |
| 安装一致性 | 安装版与解包版 `app.asar` SHA-256 均为 `76D12AEACFAF70C47A140F76DCB15A77AAF022922E4ACA4BA538D414C86AB89C` |
| 覆盖前快照 | `backups/pre-v0.5.3-20260824-095123`；22 个文件；13 个会话；0 个凭据副本 |
| 发布完整性 | [v0.5.3](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.5.3)；远端大小/摘要一致；latest 直链 HTTP 200；[后续主分支 CI 通过](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/32683259791)；本地 108/108，CI 106 通过、2 项按无内置 PTY 环境跳过 |

### V0.5.3 后计划调整

1. 第二台电脑反馈表明“基础网络可配置”和“复制可靠”比新增恢复语义更阻塞使用，因此 V0.5.3 调整为跨环境兼容修复。
2. 原 V0.5.3 的会话/检查点关联顺延到 V0.5.4，不减少范围；权限界面、上下文来源和 V0.5 稳定化依次顺延到 V0.5.5、V0.5.6、V0.5.7。
3. 本版先覆盖无需认证的 HTTP(S) 代理。认证代理、SOCKS、PAC 诊断和按域路由等待真实反馈，不提前扩张保存凭据的安全面。
4. 复制问题通过最小权限修复，不建立桌面自有会话消息复制层；后续 Harness 升级需要继续回归其剪贴板权限名称和按钮反馈。
5. GitHub 干净 Windows 环境暴露出旧检查点预览同时读取 Git 索引时的偶发锁竞争；主分支已改为顺序读取并连续 5 轮专项、完整 108 项和远端 CI 通过，该稳定性修正随下一安装包带入。

## V0.5.2 本轮完成

1. `Ctrl+Alt+H`、视图菜单和固定命令面板增加“浏览代码检查点”，最多显示最近 12 个本地安全点。
2. 每个历史点显示来源、本机时间、最近标记、真实影响路径、Git 索引变化、回收站新文件和敏感路径保留摘要。
3. 历史核对只建立一次当前非敏感 Git tree，再与每个目标比较，避免为 12 个目标重复扫描和暂存完整工作区。
4. Renderer 只获得严格 checkpoint ID 与有界显示摘要，不获得 commit、tree、index tree、ref 或文件路径。
5. 选择恢复时主进程重新解析私有 ref，并要求 commit 与确认前预检一致；外部替换、伪造或损坏 ref 失败关闭。
6. 历史界面提供加载、空、忽略无效项、超范围、未变化、取消和失败状态，支持上下键、Enter、Escape、焦点循环与关闭后恢复原焦点。
7. 所选旧点继续复用 V0.5.1 的原生默认取消、safety point、回收站、敏感路径/索引保留、分支/HEAD 不移动和失败回滚。
8. GitHub CI 官方 Actions 升级为 `checkout@v7`、`setup-node@v7`，保留 Windows Node.js 24 测试。

### V0.5.2 当前验证

| 验证项 | 结果 |
|---|---|
| Git 核心 | 两个合法历史点排序与所选旧点恢复通过；伪造 ref 被忽略；Renderer 摘要不含 commit |
| UI/接口 | 固定命令、严格 ID、12 项上限、ARIA listbox/option、键盘与紧凑/强制色样式测试通过 |
| 自动化 | 100/100 通过 |
| 真实桌面 | 1024×720 与最大化窗口均无裁切；上下键、Enter、Escape、默认取消和取消后零恢复通过 |
| 正式覆盖 | 安装器退出码 0；注册项 `DSH Desktop 0.5.2`；安装版 Harness HTTP 200，标题 `DeepSeek Harness` |
| 数据保留 | 13 个会话；会话集合及 Key/桌面/v5 工作台/设置哈希不变；3 个真实 checkpoint item refs 保留 |
| 安装包 | `DSH-Desktop-Setup-0.5.2.exe`；162,576,040 字节；SHA-256 `03D98C21CADD6AEF324A5B9DBAB67086A34EDFE469EEF5F358064C300205B913` |
| 安装一致性 | 安装版与解包版 `app.asar` SHA-256 均为 `C5EEEE459A875F1D13C6EF74F33749A9B2AE606104341EC06FDD894B4E515681` |
| 覆盖前快照 | `backups/pre-v0.5.2-20260824-080459`；21 个文件；13 个会话；0 个凭据副本 |
| 发布完整性 | [v0.5.2](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.5.2)；远端大小/摘要一致；latest 直链 HTTP 200；[CI 通过](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/32675976172)，0 注释且无 Node 20 Actions 警告 |

### V0.5.2 后计划调整

1. V0.5.3 关联 Harness 会话节点与代码检查点，但继续区分“只恢复代码”和“从会话节点建立分支”，不改写历史会话。
2. 历史列表首版固定最近 12 个，先观察真实仓库性能和辨识度；搜索、分页、删除和云同步不提前扩张。
3. 当前 Git 快照只构建一次再比较多个目标；如果 12 点实机仍偏慢，下一版优先增加同一工作树状态下的短生命周期缓存，而不是降低安全核验。
4. 真实仓库 3 个检查点首次列表约 3 秒且后续交互即时，V0.5.3 暂不引入缓存；到 12 个真实点后再按实测决定，避免缓存造成恢复预览过期。

## V0.5.1 本轮完成

1. `Ctrl+Alt+R`、视图菜单和固定命令面板增加“恢复到最近代码检查点”。
2. 恢复前通过 Windows 原生提示展示影响路径、会进入回收站的新文件、保持不变的敏感路径和 Git 索引变化，默认选择取消。
3. Agent 运行/等待/排队或持久终端运行时禁止恢复，避免与写入中的工作区竞态。
4. 确认后先创建新的 safety checkpoint，再恢复代码工作树和原暂存区；分支与 HEAD 不移动。
5. 新增未跟踪代码先进入 Windows 回收站；`.env`、`.npmrc`、私钥和 secrets 等敏感工作树及当前敏感暂存状态均保持不变。
6. 恢复失败自动应用 safety checkpoint；成功后 safety point 保持为最近项，可立即再次恢复以撤销恢复。
7. 恢复成功后原位刷新文件树与 Git 审查，不重载 Harness 会话。
8. 恢复范围超过 500 路径时失败关闭；最近项选择器和会话 Rewind 不冒充本版能力。

### V0.5.1 当前验证

| 验证项 | 结果 |
|---|---|
| Git 核心 | 临时真实仓库已验证已跟踪/未跟踪恢复、回收站语义、敏感工作树与敏感索引保留、HEAD 不变、safety checkpoint 和 Windows CRLF |
| 原生交互 | 1024×720 解包桌面 `Ctrl+Alt+R` 展示原生摘要，“取消”为默认焦点；Enter 取消后 status/index 哈希不变 |
| 自动化 | 98/98 通过；含无变化精准预览、回收站失败回滚和 501 路径失败关闭 |
| 正式覆盖 | 最终安装器退出码 0；注册项 `DSH Desktop 0.5.1`；Harness HTTP 200，标题 `DeepSeek Harness` |
| 数据保留 | 13 个会话；会话集合及 Key/桌面/v5 工作台/设置哈希不变；2 个真实 checkpoint item refs 保留 |
| 安装包 | `DSH-Desktop-Setup-0.5.1.exe`；162,572,783 字节 |
| 安装包 SHA-256 | `2B235A1D463EBF203AA0967783CC3ECEBC7AB04D47F3334418B0645EB43D19E6` |
| 安装一致性 | 安装版与解包版 `app.asar` SHA-256 均为 `2B787A808BA46AE20CB29E7B999E433253CEE34AEC2CC1767FCD25256CA087B0` |
| 覆盖前快照 | `backups/pre-v0.5.1-20260824-042438`；21 个文件；13 个会话；0 个凭据副本 |
| 发布完整性 | [v0.5.1](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.5.1)；远端大小/摘要一致；latest 直链 HTTP 200；[CI 通过](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/32666336706) |

### V0.5.1 后计划调整

1. 恢复测试证明 Windows 工作树过滤会产生 CRLF，后续以 Git tree/规范化文本验证语义，不用原始换行误判失败。
2. 恢复后不重载 Harness，显式刷新文件树和 Diff，避免页面重载自动建立新检查点并覆盖“立即撤销”的 safety point。
3. V0.5.2 增加有界检查点历史、来源/时间/影响摘要和选择恢复；仍不允许任意 commit 输入。
4. V0.5.3 再接 Harness 会话分支/继续与代码检查点关联，区分“只恢复代码”和“从会话节点继续”。
5. 实机发现检查点内已有的未跟踪文件会被旧预览算法重复计数；V0.5.1 已改为临时 Git tree 对比，只提示和回收真正变化的文件。
6. GitHub CI 已通过，但平台提示 `actions/checkout@v4` 与 `actions/setup-node@v4` 的 Node 20 运行时弃用并临时强制到 Node 24；V0.5.2 先升级官方 CI Actions，再交付检查点历史，避免基础验证链累积技术债。

## V0.5.0 本轮完成

1. 新增 `GitCheckpointManager`，用临时索引、`write-tree`、`commit-tree` 和私有 refs 保存回合前代码状态。
2. 检查点不切换分支、不移动 HEAD、不改工作树和真实索引；独立 Git 测试已逐字节验证索引保持。
3. 工作树与索引树共同参与去重；相同状态沿用最近检查点，不产生重复 commit/ref。
4. `.env`、`.credentials*`、credentials/secrets、SSH 私钥、`.npmrc` 和证书密钥扩展名从快照排除，UI 只显示排除数量。
5. Harness prompt 输入框聚焦/输入时提前创建；识别到的发送按钮或 Enter 若遇到仍在创建的检查点，会先等待再重放发送。
6. Agent 忙碌结束后重新武装下一回合；`Ctrl+Alt+B`、视图菜单和命令面板提供手动入口。
7. 当前只接受 Git 仓库根目录，嵌套工作区失败关闭，避免越过用户选择范围。
8. 实机发现 ISO 时间直接截取会显示 UTC；菜单和提示改为按本机时区格式化，Git 元数据继续保留标准 ISO 时间。

### V0.5.0 当前验证

| 验证项 | 结果 |
|---|---|
| Git 核心 | 修改文件、新文件和 `.env` 排除通过；status/真实 index 前后相同；相同状态去重通过 |
| 自动化 | 97/97 通过 |
| 实机输入焦点 | 聚焦真实 Harness 输入框自动建立 1 个 private ref；检查点包含本轮未提交新文件，来源 automatic |
| Git 不变性 | 真实 index SHA-256 与 status SHA-256 建立前后完全相同；再次触发沿用最近检查点，ref 仍为 1 |
| 可见状态 | `Ctrl+Alt+B` 显示“代码未变化，沿用最近检查点。”；本机时区显示修正通过 |
| 正式覆盖 | 安装器退出码 0；注册项 `DSH Desktop 0.5.0`；Harness HTTP 200，标题 `DeepSeek Harness` |
| 数据保留 | 13 个会话；会话集合及 Key/桌面/v5 工作台/设置哈希不变；真实 checkpoint ref 保留 |
| 安装包 | `DSH-Desktop-Setup-0.5.0.exe`；162,570,692 字节 |
| 安装包 SHA-256 | `6705D2DC73A2EBE546D99CC7B996F5E52091A90457E13B00F4224BDE848A53DC` |
| 安装一致性 | 安装版与解包版 `app.asar` SHA-256 均为 `4263F41ED3ADA22F188995F94AB3DDB7AE2D4F6F7089B6B506C8067509657ED5` |
| 覆盖前快照 | `backups/pre-v0.5.0-20260824-035352`；21 个文件；13 个会话；0 个凭据副本 |
| 发布完整性 | [v0.5.0](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.5.0)；远端大小/摘要一致；latest 直链 HTTP 200；[CI 通过](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/32663110422) |

### V0.5.0 后计划调整

1. V0.5.1 读取当前已保存的工作树 tree 与原 index tree，恢复前先创建一个新的 safety checkpoint。
2. 恢复只允许当前 Git 根工作区，先显示将覆盖/移除的有界文件计数并做原生确认。
3. 敏感路径在检查点与恢复两端都排除，不能因“回退”覆盖用户的本地 Key/证书文件。
4. 实机证明输入框可能在脚本注入前已获得焦点，因此保留“安装后检查当前 activeElement”作为自动建立兜底；后续恢复 UI 不依赖该时序。

## V0.4.8 本轮完成

1. 工作台状态升级为 schema v5，新增 80%–140% 的持久界面缩放，0.1 步进并自动夹紧。
2. `Ctrl+=`、`Ctrl+-`、`Ctrl+0` 覆盖完整 Harness 与桌面工作台；“视图”菜单显示当前百分比。
3. `Ctrl+Alt+0` 一次恢复文件、预览、终端、审查面板开关、尺寸和 100% 缩放；关闭预览时先释放软件管理端口。
4. 缩放与重置同时进入固定白名单命令面板，不增加任意命令执行能力。
5. 760 CSS 像素以下终端有效高度限制为 210px，文件、预览与审查头部同步收紧；用户保存的大窗口高度不被改写。
6. 增加 `--smoke-window-size=1024x720` 的有界实机烟测入口，只影响测试启动窗口。

### V0.4.8 当前验证

| 验证项 | 结果 |
|---|---|
| 自动化 | 93/93 通过 |
| 1024×720 实机 | 100% 三面板完整；140% 侧栏覆盖与 210px 紧凑终端可用；重置恢复默认；审查列表焦点环可见 |
| 正式覆盖 | 安装器退出码 0；注册项 `DSH Desktop 0.4.8`；Harness HTTP 200，标题 `DeepSeek Harness` |
| 数据保留 | 13 个会话；会话集合及 Key/桌面/v5 工作台/设置哈希覆盖前后相同 |
| 安装包 | `DSH-Desktop-Setup-0.4.8.exe`；162,567,003 字节 |
| 安装包 SHA-256 | `975137816DAE921ED17FE996A4EF32BF2DEC787C9B7466DA8CECB121B1D76764` |
| 安装一致性 | 安装版与解包版 `app.asar` SHA-256 均为 `C4FFF9BF5634F71A7B061D679A5DDCE91E77F92B4D82327E7D9ED5CB75C7ED28` |
| 覆盖前快照 | `backups/pre-v0.4.8-20260824-032305`；21 个文件；13 个会话；0 个凭据副本 |
| 发布完整性 | [v0.4.8](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.4.8)；远端大小/摘要一致；latest 直链 HTTP 200；[CI 通过](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/32661461695) |

### V0.4.8 后计划调整

1. 若紧凑窗口通过，V0.5.0 不再继续做视觉扩张，直接进入自动代码检查点。
2. 自动检查点只保存 Git 对象与有界元数据，不切换分支、不改变用户工作树或索引。
3. V0.5.1 的恢复必须在恢复前再建立安全检查点，并对工作树覆盖进行原生确认。
4. 140% 下 CSS 视口会进入既有窄屏覆盖模式，实机验证比仅按物理窗口宽度判断更可靠；后续紧凑测试同时覆盖 100% 与最大缩放。

## V0.4.7 本轮完成

1. 增加 `Ctrl+Shift+P` 和“视图 → 打开命令面板…”，不另建项目、会话或 Agent 体系。
2. 固定白名单收纳 11 个已有工作台动作：聚焦对话、新建 Harness 会话、切换/聚焦文件、应用预览、终端、Git 审查，以及重载 Harness。
3. 支持搜索、上下键选择、Enter 执行、Escape/遮罩关闭和关闭时恢复原焦点。
4. 命令输入不会进入 Shell、文件 API、IPC 或 JavaScript 求值；面板只调用既有受限接口。
5. 增加 ARIA 对话框、列表框、选项和活动项语义，以及紧凑窗口、强制色和减少动态效果样式。
6. 实机用“文件搜索”过滤并按 Enter 后，面板关闭且左侧文件搜索框得到焦点；Escape 关闭通过。
7. 修复动作失败时原焦点引用过早清空的问题。
8. 版本一致性测试集中读取 `package.json`，避免日更版本号散落在预览/终端测试中。

### V0.4.7 当前验证

| 验证项 | 结果 |
|---|---|
| 自动化 | 90/90 通过 |
| 解包版实机 | V0.4.7、13 个会话、软件 Key 已配置；命令面板搜索、Enter 与 Escape 通过 |
| 正式覆盖 | 安装器退出码 0；注册项 `DSH Desktop 0.4.7`；Harness HTTP 200，标题 `DeepSeek Harness` |
| 数据保留 | 13 个会话；会话集合及 Key/桌面/工作台/设置哈希覆盖前后相同 |
| 安装包 | `DSH-Desktop-Setup-0.4.7.exe`；162,566,222 字节 |
| 安装包 SHA-256 | `2B9842ED34CF2525AF96EE50C52325C1C24D771D61428F44206ADF6690E6A99F` |
| 安装一致性 | 安装版与解包版 `app.asar` SHA-256 均为 `3E34EA7ED4B317A4C91C9564E4C488BD4279366B42DE8340B8FA6511C2FA2018` |
| 覆盖前快照 | `backups/pre-v0.4.7-20260824-025712`；21 个文件；13 个会话；0 个凭据副本 |
| 发布完整性 | [v0.4.7](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.4.7)；远端大小/摘要一致；latest 直链 HTTP 200；[CI 通过](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/32660139810) |

### V0.4.7 后计划调整

1. V0.4.8 把布局重置和界面缩放加入同一命令入口，并按 1024×720 实机烟测收敛面板裁切。
2. V0.4.6 的全运行时备份耗时过长；V0.4.7 起保留上一版安装包、会话/状态小型快照和不含凭据的哈希证据，完整 V0.4.6 last-known-good 继续保留。
3. 实测发现 `harness/profiles` 仍嵌入自己的 `node_modules`；后续快照明确排除整个 profiles 运行时闭包，只保留 sessions、storages、设置和桌面状态。误生成的局部快照已送入 Windows 回收站，可恢复。
4. V0.5.0 先交付自动代码检查点；V0.5.1 再交付显式确认的恢复，避免一次版本同时放大保存与破坏性恢复风险。

## V0.4.6 本轮完成

1. 在现有文件 Quick Look 中增加 PNG、JPEG、WebP、GIF 和 PDF 专用预览，不建立第二套文件入口。
2. 图片支持适合窗口与 25%–400% 缩放；PDF 支持上一页、下一页、直接页码、适合窗口和 50%–300% 缩放。
3. 图片上限 24 MiB、PDF 上限 40 MiB；路径越界、链接/联接、疑似凭据、内容签名错误和跨类型伪装继续阻止。
4. 真实桌面发现 `app-screenshot.png` 内容实际为 JPEG；策略调整为受支持图片间的扩展名误写可按真实 MIME 打开并提示，图片/PDF 跨类型不放行。
5. PDF 从受限 iframe 改为 Chromium 隔离的本机 `embed` 渲染，实际一页 PDF 的文字与页面可访问状态均已读取成功。
6. 修复图片模式误显示 PDF 页码控件的问题；最终图片模式只显示缩放/适合窗口。
7. 自动化回归 87/87 通过；正式安装版 Harness HTTP 200，标题为 `DeepSeek Harness`。
8. V0.4.6 已直接覆盖 V0.4.5；13 个会话、软件 Key、桌面状态和工作台状态哈希全部保持一致。

### V0.4.6 验证证据

| 验证项 | 结果 |
|---|---|
| 单元/集成测试 | 87/87 通过 |
| 图片实机 | 1208×794 JPEG 内容以 `.png` 文件名打开，显示真实格式提示；PDF 控件已隐藏 |
| PDF 实机 | 一页 PDF 实际渲染并读取到 `DSH PDF Preview 0.4.6` |
| 正式安装版 | Harness 随机回环 HTTP 200；注册项 `DSH Desktop 0.4.6` |
| 数据保留 | 13 个会话；Key/桌面/工作台状态哈希覆盖前后相同 |
| 安装包 | `DSH-Desktop-Setup-0.4.6.exe`；162,563,961 字节 |
| 安装包 SHA-256 | `62EABBEB2A652B60B25B0F0DDA05AD460464C301D05483A6D34AEA4A18424EB5` |
| 安装一致性 | 安装版与解包版 `app.asar` SHA-256 均为 `C14FF9CFD33D297BCE637D533C9F8B75C9CB62B32F2B37572200AEE3A44A68F5` |
| 覆盖前快照 | `backups/pre-v0.4.6-20260824-021839`；58,560 个文件；786,634,659 字节；0 个凭据副本 |

### V0.4.6 后计划调整

1. V0.4.7 继续交付全局命令面板与快捷键帮助。
2. 版本号测试改为集中读取当前 manifest，避免连续日更时散落的旧版本断言。
3. 后四版改用“上一版安装包 + 每版用户状态快照”作为回滚点，不重复复制完全相同的离线运行时闭包。
4. V0.4.8 增加布局重置、1024×720、界面缩放和完整焦点矩阵。

## V0.4.5 已完成

1. 在现有 Harness 工作台中增加应用预览层，不新建窗口、Agent 或聊天入口；文件、预览、终端和 Harness 继续使用同一仓库。
2. HTML Quick Look 增加“应用预览”，由软件在随机 `127.0.0.1` 端口提供当前工作区 HTML、CSS、JavaScript、图片、字体、JSON、SVG 和 WASM 资源。
3. 可连接已经运行的 `127.0.0.1`、`localhost` 或 `::1` HTTP/HTTPS 开发服务器；支持端口简写、重新加载、浏览器打开、停止和离线监控。
4. 软件管理的端口在停止、关闭面板、切换仓库或退出时释放；外部开发服务器只连接和监控，不会被 DSH Desktop 结束。
5. 预览限定回环地址，拒绝凭据、远程地址、Harness 自身 origin、父目录跳转、链接/目录联接、工作区外路径、疑似凭据文件和超过 32 MiB 的托管文件。
6. 预览 iframe 使用独立 loopback origin 和 sandbox；Renderer 仍保持 sandbox、context isolation 和无 Node integration，子框架不能调用桌面 IPC。
7. 面板显示未启动、连接中、可用、离线、失败和已停止状态，并明确标识来源、端口以及端口由软件还是外部服务管理。
8. 新增 `Ctrl+Alt+P` 开关、`Ctrl+Alt+L` 聚焦，面板开关进入工作台 schema v4 并在 Harness 重载和软件重启后恢复。
9. 自动化回归增至 85 项；真实桌面验证发现并修复 Electron 35 `will-frame-navigate` 事件签名兼容问题，避免本机 iframe 被误拦截。
10. 普通窗口和 2560×1392 最大化窗口均实际渲染 `index.html`；停止后随机端口已确认不可访问。
11. 解包版与正式安装版均通过 V0.4.5、`zh-CN`、Windows 安全存储、随机回环 HTTP 200、标题和 Workspace 同步烟测。
12. V0.4.5 已直接覆盖 V0.4.4；原有 13 个会话、软件 Key、桌面状态和工作台状态均保留。

## 验证证据

| 验证项 | 结果 |
|---|---|
| 单元/集成测试 | 85/85 通过 |
| 工作区 HTML | `index.html` 及相对资源在随机回环端口实际渲染 |
| 端口生命周期 | 停止后端口不可访问；切换仓库、关闭面板和退出均接入释放路径 |
| 外部服务边界 | 仅允许本机回环；外部端口标记为非软件所有，只监控、不结束 |
| 桌面布局 | 1208×794 普通窗口与 2560×1392 最大化窗口通过；文件、预览和终端无裁切 |
| 正式安装版 | V0.4.5、`zh-CN`、`safeStorage=true`；Harness `0.1.1-rc.2`；随机回环 HTTP 200；Workspace 同步成功 |
| 会话持久化 | 覆盖安装后仍为 13 个会话 |
| 用户状态 | 软件 Key、桌面状态与工作台状态哈希在覆盖前后保持一致；未读取或输出 Key 明文 |
| 安装包 | `DSH-Desktop-Setup-0.4.5.exe`；162,561,775 字节 |
| 安装包 SHA-256 | `733F68A1A3F48F65BFA73B50C8136A1AF6D1675785FF92E1030FD82D6F1B4EA7` |
| 直接覆盖 | 安装器退出码 0；Windows 注册项 `DSH Desktop 0.4.5` |
| 安装一致性 | 安装版与解包版 `app.asar` SHA-256 均为 `4F83979629DE9B407AA4B4FBB34EE56F1B842355AE357A75CEA7E4427BD5D615` |
| 预览资源 | 安装版 `app.asar` 包含 `preview-manager.cjs`、`workbench-preview.js` 和 `workbench-preview.css` |
| 安装闭包 | 解包版 29,368 个文件；安装版 29,369 个文件；0 个重解析点；0 个终端 PDB |

## 安装与回滚

- 当前正式目录：`%LOCALAPPDATA%\Programs\DSH Desktop`
- V0.4.5 覆盖前快照：`backups/pre-v0.4.5-20260824-011037`
- 快照包含旧程序和非凭据用户数据，共 62,379 个文件、1,006,226,877 字节。
- 快照中 `.credentials.yaml` 为 0 个；软件 Key 仍只保留在用户数据原位置。
- V0.4.4 及更早版本前的可用快照继续保留，不覆盖历史回滚点。

## 未宣称完成

- 本版应用预览仅覆盖工作区 HTML 与已有本机开发服务器；图片/PDF 专用查看、设备尺寸预设、开发者工具和远程 URL 未完成。
- 当前只有一个持久 PTY；尚无终端标签页、分屏、Shell 配置选择或终端会话快照。
- 文件查看仍是有界只读文本预览，不是代码编辑器；没有保存、多标签编辑和语法服务。
- 尚无自动 Checkpoint、会话级 Rewind 和完整 Plan 取消/恢复状态视图。
- 搜索不读取文件内容，也未实现完整 `.gitignore` 语义。
- rc.8 曾出现 Harness Workspace Write `0xC0000005`；本轮没有用计费模型重测该路径，因此不宣称 rc.2 已修复。
- 软件 Key 仍使用 Harness `0.1.1-rc.2` 的 `.credentials.yaml` 与 Windows 用户目录 ACL，尚未接入 Credential Manager/DPAPI。
- 自动更新、代码签名和 Harness 兼容矩阵流水线尚未完成。

## 下一优先级

1. V0.4.6 增加图片/PDF 专用预览和清晰的加载失败、过大文件与不支持格式状态，完成应用预览切片。
2. V0.4.7 增加命令面板、快捷键帮助和布局恢复入口。
3. 补齐 1024×720、高对比度、文本缩放和完整键盘焦点视觉矩阵。
4. 下一 Daily Build 继续直接覆盖 V0.4.5，并保留不含凭据的 last-known-good 快照。
5. V0.6 内置固定版本、隔离运行的 pnpm，由原生插件管理器代办安装、升级、卸载、启停和回滚。
