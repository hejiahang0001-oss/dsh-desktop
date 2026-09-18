# Harness 0.1.6-alpha.2：V1.1.14 适配与验收

检查时间：2026-09-18 08:02:52 +08:00。官方于 2026-09-17 13:30:16 UTC 发布预发布标签 `dsh-v0.1.6-alpha.2`，提交 `ddefc45fbc7f8e46dd73185e68295696d1297887`；npm `@deepseek-ai/dsh@0.1.6-alpha.2` 已存在。独立源码检出已核对同一提交且工作区干净。

维护者已明确接受新增 Office 引擎体积，源码候选切换为 **V1.1.14 / 0.1.6-alpha.2**；固定 Windows 运行库构建、物理依赖审计、621 项源码测试及真实 Office 侧栏预览通过，但这不是完整桌面交付声明。本机仍为 V1.1.13 / alpha.1，分支为 `codex/v1.1.14-harness-alpha2`，未生成本版桌面安装包、未覆盖安装、未公开新安装包，Stable V1.1.12 不变。V1.1.13 的便携验收失败和待定发布范围继续保留，不能由每日任务代替维护者作选择。

## 能力对比与取舍

以下“采用”表示能力取舍；Office 预览已经完成源码态真实验收，其余项目的完成范围分别以验证记录为准。

| 官方变化 | 桌面取舍 | 行为和权限依据 |
|---|---|---|
| Word / Excel / PowerPoint 侧栏预览 | 已接受引擎体积，采用官方转换及预览；不再开发另一套普通 Office 预览 | 转换成 PDF 不等于可编辑生成、结构安全校验或覆盖恢复；Office 工具、备份和摘要收据保留 |
| 每轮文件改动卡片和逐文件比较 | 可作为官方只读观察入口；不删除 Git Review / 检查点 | 官方摘要与副本随 Host Session 销毁，重启后旧轮次无比较；无 Git 时只覆盖文件工具，且可能包含期间人工修改；不是持久接受/拒绝或回退事务 |
| 插件页、配置及热启停、运行时卸载 | 官方通用列表和配置优先；桌面受控安装暂保留 | 影响整个 Profile；安装脚本审批按包名持久化且以宿主用户权限运行；必须先验证固定 pnpm、加密 Key、代理、桌面插件清理与失败回退 |
| 侧栏 Subagent、计划卡、布局与终端连接保持 | 使用官方界面，不再建同等列表/预览 | 桌面任务和交接仍需明确会话身份；独立后台任务不等同于侧栏会话 |
| 多实例 Client Session、Provider 与引用所有权 | 适配桌面导航桥并验证同 ID 的不同 generation | 不再读取旧的 `list.current/currentAddress`；不扫描目录猜操作目标，不因打开预览而激活 Agent |
| 重启后 Inbox 恢复、菜单键盘、文件引用、Windows 控制台闪现修复 | 随固定新内核接受，真实回归后才列“已完成” | 继续使用官方 Queue/Steer/Stop；不以源码测试代替用户插话/拖入验收 |
| Web 用户终端不受 Agent 沙箱限制 | 保留“用户手动终端”与“助手受控读取”边界 | 不将用户终端升级为助手可任意写入的工具；保留兼容终端逐次授权和脱敏读取 |
| 默认模型与 Creator 插件机制改变 | 对配置迁移单独验收，不自动启用实验能力 | 不宣称移除的 Flash 默认项仍可用；不扩大到 Browser Use、Computer Use、ERP 或远程桥 |

## 已完成的源码准备

- 复核官方 `packages/api/session-controller/src/client/contract/sessions.ts`、`sessions/service.ts`、`contract/snapshot.ts` 和 Client Session 引用设计。新目录仍有 `list.phase/byId`，但不再有全局当前会话字段。
- 首轮回归先暴露旧入口拒绝新契约；修复后新旧接口 16/16 专项通过。新版本从桌面诊断取得明确目标，验证 `retainedBy.mainView`、公开 `binding()` 和 Session `openState`，不读取私有 UI 状态、不创建引用或启动 Agent。
- 文件授权返回后复核同一 binding；同 ID 重新加载、切换、双 mainView 过渡、子代理、加载失败、卸载、并发过期请求均拒绝继续导航。alpha.1 路径保持兼容。
- 原导航准备阶段完整源码为 613/613；新的运行库和 Office 门禁证据分开记录于 [VALIDATION](VALIDATION.md)，不沿用旧结果代替本次验收。
- alpha.2 的 Profile resolver 不再查找共享 `profiles/node_modules`。真实启动先复现三个桌面插件缺失，再将其移到官方原生查找的 `DSH_HOME/node_modules`；链接路径拒绝、旧副本保留回归及真实启动通过。此为宿主适配，不修改上游应用代码，也不表示插件 HMR/全 Profile 变更已经验收。
- PDF.js 随官方移至 `client.pdf.js` 懒加载文件，许可检查改为核验实际发布文件而非跳过检查；599 个物理包身份与十份 PDF 嵌入许可已记录。上游源码允许的改动仅为摘要精确匹配的安全 workspace/lock 两文件。
- 最终完整源码 621/621，失败与跳过均为 0。真实侧栏原有五种预览、中文 DOCX 2 页、XLSX 1 页和 PPTX 3 页均通过，逐页文字、截图及源文件不变已核实；没有调用模型，也没有把该结果外推为打包态或安装态验收。

## 新增依赖风险与待确认项

官方 `office-to-pdf` 依赖 `@deepseek-ai/libreoffice-kit@0.0.1`，其声明的 Windows x64 原生包为 `@deepseek-ai/libreoffice-kit-win32-x64@0.0.1`，MPL-2.0。2026-09-18 核对 npm 解压大小 **340,863,092 字节（约 325.1 MiB）**、2,050 个文件，下载档案 116,839,874 字节；两份 npm 档案 SHA-512 和原生包 2,048 项清单 SHA-256 已核验。最终安装包下载增量仍未测。

上游要求：声明了原生引擎的平台缺包即失败，不能悄悄退回 WASM 或删除该包后宣称完整 Office 预览。构建和发布治理已加入独立 Office 原生包内容门禁，完整保留许可、源码版本与补丁。体积选择已解决；V1.1.13 发布范围仍是独立的待定事项。

- 首次构建被实际依赖审计拦截：Office 引入的 `fflate@0.8.2` 存在畸形 ZIP64 无限循环（GHSA-px8p-9vwx-vf98）。沿用原有八项安全依赖修复，另精确固定 `fflate@0.8.3`；第二次构建 596 个包名审计无已知发现，302 个官方发布包身份一致。回归在受限子进程中复现旧版本超时、新版本拒绝异常 ZIP，同时保留中文 ZIP 正常读写。
- 隔离原生转换 DOCX/XLSX/PPTX 通过，取消与已有输出保护通过，源文件未修改；缺少 Aptos/Aptos Display 的提示已记录，不把转换成功等同于字体完全一致。
- Windows 长路径为已复现风险：同一原生可执行程序加载深层 pnpm 目录时报告文件名过长，短路径平铺目录成功。实际源码桌面的平铺路径已通过侧栏转换；安装态及任意自定义安装目录仍未验证。
- Office kit 所声明源码仓库返回 404。原生包包含 LibreOffice 固定版本、补丁、构建脚本与许可证，对应 LibreOffice 提交可访问；Node API 对应源码可获取性仍待核实，公开分发门禁保留。Windows 引擎另需 VC++ v14 Redistributable；本机存在不等于其他电脑具备。

2026-09-18 04:27:49 UTC，获得维护者授权后，已向官方 Q&A 提交 [Discussion #7026](https://github.com/deepseek-ai/deepseek-harness/discussions/7026)，询问对应 0.0.1 包的可获取源码、准确版本及下游分发说明。官方仓库 `has_issues=false`，README 指定反馈走 Discussions，因此没有创建 Issue 或到无关仓库发帖。提交后回读正文、仓库与 Q&A 分类一致；当时尚无回复或采纳答案。提问不等于官方已确认分发条件，原门禁保留。

下一步核实官方答复中的源码可获取性，继续剩余多会话/插件生命周期与真实模型交互门禁，再做包、安装、资料/凭据保留和公开下载验收。已有效的固定构建、下载、621 项全量测试和侧栏预览不从头重做。既有 Portable 失败不能因新内核发布而作废。

## 可核对来源

- [官方发布](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.6-alpha.2)
- [固定提交比较](https://github.com/deepseek-ai/deepseek-harness/compare/0a15e36e7f82b6ed45af6fa9759f29b40dcd965d...ddefc45fbc7f8e46dd73185e68295696d1297887)；GitHub compare API 文件列表截断在 300 项，未把它当完整差异清单。
- [Client Session 引用语义](https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/.agents/notes/implemented/architecture/2026-09-15-client-session-references.md)
- [官方 Office 转换](https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/document/office-to-pdf/README.md)
- [官方改动摘要的覆盖范围](https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/deliverables/workspace-changes/README.md)
- [插件管理权限与失败语义](https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/boot/plugin-manager/README.md)
- [Windows Office 引擎元数据](https://registry.npmjs.org/@deepseek-ai%2Flibreoffice-kit-win32-x64/0.0.1)
