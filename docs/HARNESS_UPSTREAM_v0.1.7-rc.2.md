# DeepSeek Harness 0.1.7-rc.2 对比与隔离适配证据

检查时间：2026-09-25T00:01:55.4311228Z（北京时间 08:01:55）。这是 V1.1.14 同一未发布候选的后续切片，不是完成换核或交付。

## 固定来源与版本

- 官方最新完整版本：`0.1.7-rc.2`；标签 `dsh-v0.1.7-rc.2`；提交 `477b4f420553e8a52c2fbccc464d7561b239c443`。
- 发布时间：2026-09-24T14:10:21Z（北京时间 22:10:21），预发布、非草稿。核对 22 Releases、23 标签和 27 个 npm 版本；npm next 指向 rc.2，latest 仍为 0.1.5-rc.3，不按 dist-tag 字面判断新旧。
- [官方发布](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.7-rc.2)；[相邻提交对比](https://github.com/deepseek-ai/deepseek-harness/compare/46a7f68b0922371ce7144b668b90e377d8e799f4...477b4f420553e8a52c2fbccc464d7561b239c443)。
- 干净分离检出：`artifacts/upstream-dsh-0.1.7-rc.2`。相邻 rc.1→rc.2 的本地全树统计为 3,429 文件、136,313 新增行、24,518 删除行；不是只改版本号，也不把网页截断列表当全量。
- 源码 workspace SHA-256：`39ab979fec4496d68219c6fb492fe828eb9035a33cf7d17478eac90d73cc691d`。
- 源码 lock SHA-256：`5d3980bcd2a0113101815aabfeb4f8a875d556a333521539b7f11d790f4a50aa`。
- 产品仍固定 `0.1.6-alpha.2 / ddefc45fbc7f8e46dd73185e68295696d1297887`，未改生产清单、锁、vendor 或安装版。探针使用官方已发布 npm 包，不是最终 source-build 运行库。

## 官方新增与桌面取舍

| 变化 | 采用或保留决定 | 行为及迁移边界 |
|---|---|---|
| API Key / 账号模型分离 | 使用官方新 provider；继续保留桌面加密凭据 IPC | 官方基础 bundle 保留 `llm-deepseek` entry id，模块改为 `dsh-llm-deepseek-api-key`；不能把新账号登录等同于软件 Key。 |
| 可配置快捷键、长对话发送修复、运行中启用工具、插件配置与写入恢复 | 优先使用官方主 UI 和插件实现 | 不新增第二套输入、排队或配置持久化；整页、全部插件热切换仍要实测。 |
| 跨重启定时提醒、分钟周期和历史 | 本轮不自动启用；不删除桌面后台任务 | 官方提醒默认关闭；桌面任务有 Workspace、Git Worktree 和权限边界，名称相近不代表语义相同。 |
| 官方桌面后台驻留和退出提示、安装与关联修复 | 只作为参考，不能算本 Electron 外壳已修复 | 宿主不同；仍保留本项目安全退出、安装态和 Portable 验收。 |
| 工作区内部 Windows 目录链接和 Office 预览增强 | 普通浏览/预览走官方；特权文件路径保护、Office/Wiki 校验备份继续保留 | 不能把官方浏览规则直接用于桌面特权写入，亦不能用预览成功替代交付与恢复校验。 |
| 时间上下文与 Inspector 默认策略变化 | 跟随已审查基础配置，不擅自开启实验能力 | 不启用自动评审/权限实验，不扩展 ERP、远程桥或 Computer Use。 |

普通预览、Queue/Steer/Stop 等原已交官方，本次没有为“追新”强删桌面保护代码。新 API-key provider 模块名变化的兼容判断已落实到真实 IPC 与请求 framing 检查，而非同名比对。

## 本次实际完成的隔离验证

独立 pnpm 11.7.0 workspace，直接依赖精确锁定；冻结锁安装、禁止 lifecycle scripts。rc.2 依赖组与产品工作区完全分离，26 个精确版本的 release-age 例外仅在探针 workspace，不关闭全局策略。

- 最终 `probe-test.tap`：**9 项、9 通过、0 失败/跳过/取消，1181.6253 ms**。
- 配置：真实 rc.2 app-boot、Settings、ConfigEditor 组合；支持的旧设置导入、Windows shell 映射、被拒字段原文保留、阻塞 rename 不丢旧文件、并发修订冲突拒绝，以及编辑后重启读取/隐去秘密字段而不清空它们。
- 凭据：实际桌面 `dsh-desktop-credentials` 子进程经真实 `dsh-credential-v1` IPC 连接实际 CredentialVault；使用 rc.2 CredentialProvider/API-key 插件。8 个子检查覆盖软件 Key 优先、三个环境层都不能在软件 Key 缺失时偷偷兜底、动态换 Key、清空、非法请求头拒绝、结构 grant 保留、清空后的模型目录与插件挂载。
- Messages framing：本地 mock fetch 验证 `/anthropic/v1/messages`、`x-api-key`、协议头与模型/stream 字段。模拟 HTTP 401 只证明认证选择和请求形状，不是成功模型回复、真实 API、SSE 或图像/工具全链路。
- 代理：验证当前桌面构造环境会移除继承 Key/代理并保留软件代理和 loopback NO_PROXY；**没有实测真实代理转发/CONNECT**。
- 主机存储采用临时 AES 测试实现，验证加密落盘及备份不含测试明文；**不冒充 Windows DPAPI、跨电脑或实际安装态验收**。从未读取用户 Key、配置或会话。
- 探针审计：**58 个依赖（51+7 optional），所有级别 0 已知发现**；这不是最终打包运行库审计。探针 lock SHA-256：`e65f682f7e9bd2511120c5e185c4827419c7b7feb2d89420a140e097056ffe44`。
- 昨日 rc.1 的 9 项 Session 结果仅保留为历史；今天没有宣称 rc.2 V4 全量存储/分页通过。9 月 23 日 621 通过/2 跳过也不改写为本日新内核验收。

## 发现的问题与审查

- 首轮 8/9：测试等待默认 logger buffer 的 warn 超时。源码确认 buffer 默认 level 1 不收 level 2 的 warn，而 boot 诊断另有 level 2；迁移已完成且原文/配置未损失。改为探针自有明确日志级别 exporter，并验证确切拒绝警告，未改产品日志或降低断言。保留 initial-probe-failure.json。
- 初次探针误选 yaml 2.8.2，审计报中风险 `GHSA-48c2-rrv3-qjmp`。仅将探针 YAML 对齐 rc.2 官方源码锁的 2.9.0，重建独立锁、冻结安装、测试及审计通过；保存 initial-probe-audit.json。不把自建探针问题归咎于官方 rc.2 或已安装程序。
- **Important**：三桌面插件仍缺声明 peer 范围，今天只验证凭据桥部分运行时契约；shell-env/tools、完整 Profile 和卸载不能由此自动签字。
- **Blocking（公开发布）**：Office Node API 对应可修改源码仍未定位；触发为随新包公开分发，影响为来源/可复现分发证据不完整。取得确切版本对应源码、核验路径/摘要/许可配套后再解除；不据此作违法结论。
- 局部审查没有对现有生产代码提出新修复；整体适配仍要求继续验证，不批准打包发布。

## Office kit 0.1.1 和上游回复

2026-09-25T00:17:57Z 复核：rc.2 workspace 固定 kit 与 win32-x64 为 0.1.1。Node API 包 39 文件（323,227 解压字节），gitHead 空、没有 src/sources/source maps；NOTICE 的 LibreOffice 字体数据源码链接不是 Node API 完整源码。声明仓库 `deepseek-harness/libreoffice-kit` 仍返回 HTTP 404。

- kit archive SHA-256：`c04c175a81d26c66f91d8e6a3aae883bf49c1306ea69a8fdf4e324cc758a39d5`；SHA-512 与 npm integrity 一致。
- 新 win32 包元数据为 730 文件、190,865,379 解压字节；较 0.1.0 的 340,979,793 字节缩小，但只查了元数据，未下载/运行新原生引擎，也不能推定安装包同等缩小。
- Q&A #7026 无新回复：仍仅 PerryLink 社区评论、authorAssociation=NONE、无采纳答案。没有重复发帖或替对方确认来源。
- [上游问答](https://github.com/deepseek-ai/deepseek-harness/discussions/7026)；[kit 元数据](https://registry.npmjs.org/@deepseek-ai%2flibreoffice-kit/0.1.1)。

## 当前交付状态及下一步

本次未改生产代码、未生成新运行库或桌面包、未覆盖安装或公开发布。既有安装 V1.1.13 / 0.1.6-alpha.1、原私有草稿及 Stable V1.1.12 沿用上次验证状态，本日未重新全验远端资产；V1.1.13 发布范围待决仍在。

V1.1.14 接着验证真实代理传输、shell-env/tools 与全部 Profile/卸载、rc.2 V4 持久化和冷分页；通过后再生成安全锁/source-build 运行库并验真实模型、Office、整包、Portable、覆盖/资料保留和匿名下载。不要每天从头重跑旧基线；发生实质变更才扩大验证范围。Office 来源未解前不公开产物，Stable 不自动更新。

本轮证据统一在 `artifacts/upstream-checks/2026-09-25-rc2/`；探针/夹具只含合成数据，原失败和源码检出保留。Obsidian 同步结果写入 PROGRESS 与 VALIDATION，并以最终 verification.json 为准。
