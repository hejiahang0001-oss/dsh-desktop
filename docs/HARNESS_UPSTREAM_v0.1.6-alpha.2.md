# Harness 0.1.6-alpha.2：V1.1.14 适配预检

检查时间：2026-09-18 08:02:52 +08:00。官方于 2026-09-17 13:30:16 UTC 发布预发布标签 `dsh-v0.1.6-alpha.2`，提交 `ddefc45fbc7f8e46dd73185e68295696d1297887`；npm `@deepseek-ai/dsh@0.1.6-alpha.2` 已存在。独立源码检出已核对同一提交且工作区干净。

当前产品和固定运行库**仍为 V1.1.13 / 0.1.6-alpha.1**，本页不是完成升级或发布的声明。准备分支为 `codex/v1.1.14-harness-alpha2`，未覆盖安装，未上传新产物，未改 Stable V1.1.12。V1.1.13 的便携验收失败和待定发布范围继续保留，不能由每日任务代替维护者作选择。

## 能力对比与取舍

以下“采用”均为目标决定，不代表已经在桌面新内核中验收。

| 官方变化 | 桌面取舍 | 行为和权限依据 |
|---|---|---|
| Word / Excel / PowerPoint 侧栏预览 | 确认新增引擎体积后采用官方转换及预览；不再开发另一套普通 Office 预览 | 转换成 PDF 不等于可编辑生成、结构安全校验或覆盖恢复；Office 工具、备份和摘要收据保留 |
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
- 完整源码测试结果及保留的未通过记录见 [VALIDATION](VALIDATION.md)；本次尚未重建安全锁文件、构建 alpha.2 运行库、执行新内核真实交互或打包安装。

## 新增依赖风险与待确认项

官方 `office-to-pdf` 依赖 `@deepseek-ai/libreoffice-kit@0.0.1`，其声明的 Windows x64 原生包为 `@deepseek-ai/libreoffice-kit-win32-x64@0.0.1`，MPL-2.0。2026-09-18 npm 元数据显示解压大小 **340,863,092 字节（约 325.1 MiB）**、2,050 个文件。它不是最终安装包下载增量；本次未下载引擎，未测压缩大小、冷启动及真实转换。

上游要求：声明了原生引擎的平台缺包即失败，不能悄悄退回 WASM 或删除该包后宣称完整 Office 预览。已询问维护者是否接受新增引擎体积；确认前保留 alpha.1 固定运行库，不改应用版本号。这里的等待与 V1.1.13 发布范围决定是两件事。

确认后按顺序继续：固定 alpha.2 安全锁和运行库来源 → 验证官方插件卸载/包管理与宿主保护 → Office 原生引擎、字体/中文三格式预览及退出回执 → 全量与物理依赖审计 → 包、安装、资料/凭据保留 → 合格产物的公开下载验证。既有 Portable 失败不能因新内核发布而作废。

## 可核对来源

- [官方发布](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.6-alpha.2)
- [固定提交比较](https://github.com/deepseek-ai/deepseek-harness/compare/0a15e36e7f82b6ed45af6fa9759f29b40dcd965d...ddefc45fbc7f8e46dd73185e68295696d1297887)；GitHub compare API 文件列表截断在 300 项，未把它当完整差异清单。
- [Client Session 引用语义](https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/.agents/notes/implemented/architecture/2026-09-15-client-session-references.md)
- [官方 Office 转换](https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/document/office-to-pdf/README.md)
- [官方改动摘要的覆盖范围](https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/deliverables/workspace-changes/README.md)
- [插件管理权限与失败语义](https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/boot/plugin-manager/README.md)
- [Windows Office 引擎元数据](https://registry.npmjs.org/@deepseek-ai%2Flibreoffice-kit-win32-x64/0.0.1)
