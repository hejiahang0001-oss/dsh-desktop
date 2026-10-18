# Harness 0.1.7-rc.1：相邻版本对比与隔离预检

## 固定身份与当前状态

- 检查时间：2026-09-24T00:02:59.8530601Z（北京时间 08:02）。完整核对 21 个 Releases、22 个标签与 26 个 npm 版本；最高完整版本为 `0.1.7-rc.1`，不是仅按 rc 后缀或 npm latest 选择。
- 官方 [dsh-v0.1.7-rc.1](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.7-rc.1)，提交 `46a7f68b0922371ce7144b668b90e377d8e799f4`，发布于 2026-09-23T13:30:24Z，Pre-release、非草稿。npm latest 仍为 0.1.5-rc.3，next 已指向 rc.1。
- 在既有 V1.1.14 未发布候选继续，不另起版本；分支保留 `codex/v1.1.14-harness-0.1.7-alpha2` 名称。当前源码固定内核仍为 `0.1.6-alpha.2` / `ddefc45fbc7f8e46dd73185e68295696d1297887`；新目标尚未换入产品运行库。
- 标签干净检出：`artifacts/upstream-dsh-0.1.7-rc.1`。workspace SHA-256 `0fb648159f4974e22205f0cd56363ca7a3ba5b2f094aec55976d38aac7530441`；lock SHA-256 `f561d4d2b02ca15f94fc9177500ab4646c38d847cf1c52ac50bd4022690d2f50`。
- 与昨日 `00102833dfaee1da9f48a3a8eae9d34005a75218` 的本地完整树差异：933 文件、13,851 行新增、3,101 行删除。GitHub compare 返回上限 300 文件，未把该截断结果当作完整比较。官方本版说明累计自 0.1.5-rc.3，不代表所有条目今天新增。

## 能力取舍与风险

| 范围 | rc.1 增量或延续 | 桌面决定 |
|---|---|---|
| Office | kit 和 win32-x64 引擎升至 0.1.0；官方 Skills 默认使用随包运行环境；预览缩放及表格交互继续完善 | 接入后采用官方转换/预览；仍保留结构安全、公式/交付校验、覆盖备份和恢复收据，不用“能预览”替代“可安全交付” |
| 插件 | 启动/安装增加 dsh peer 版本检查与精确版本豁免；GitHub 安装失败可改镜像重试 | 复用官方兼容检查；受控安装、权限与来源保护暂不删除，不自动授予豁免 |
| Windows 打开文件 | 官方原生打开与关联应用、Explorer 路径处理完善 | 可复用官方入口；原有桌面跨会话/工作区、敏感路径和导航保护保留，不能仅凭同名能力删除 |
| 对话与团队 | 过程展示、工具参数准备进度、Team 实时投影及交互修复 | 由官方主 UI 提供，不重建队列/复制/Steer；本轮没有可安全新增删除的桌面重复实现 |
| V4、Messages 与设置 | 相邻 alpha.2→rc.1 的 session-format、settings、llm-deepseek 源码未变（包版本变更）；累计破坏性要求仍有效 | 沿用昨日备份修复及迁移分析；软件加密 Key 优先、代理、Profile/恢复必须继续实测 |

隔离检查发现三个桌面桥接插件的 manifest 均无 dsh peer 声明，官方校验器返回“无不兼容记录”，不是证明可运行。将真实插件契约测试和核实后补充精确兼容声明列入下一步，不为通过检查加入豁免，也不在当前仍固定旧内核时随意填写新版本范围。

## 本次执行与证据

证据目录：`artifacts/upstream-checks/2026-09-24-rc1/`。

- 只准备独立 Session 探针依赖：pnpm 11.7.0，4 个精确直接依赖，27 包闭包；创建独立 workspace/lock 后冻结安装，安装脚本禁用。没有修改根 lock、产品 pin、vendor 或用户资料。
- 首次 pnpm 寻找到父 workspace，输出 Already up to date，但未安装探针；已保留记录并增加独立 workspace 边界。工具自动为 22 个精确 rc.1 包登记 release-age 条目，仅限该探针，不关闭全局策略。
- `session-probe/probe.test.mjs` 使用官方发布的 rc.1 Session/格式包，以及标签源码中的插件兼容函数。最终 `probe-test.tap`：**9/9 通过，失败/取消/跳过 0**。
- 覆盖：精确包身份；必须显式提供历史子会话事实；消息来源与工具结果 role 迁移；中断回合修复及引用序号重映射；已知/未知子会话保留；稀疏/未知必需事件/错误继承拒绝；真实 Session 对象的两层分支前缀与单一继承标记；V4 编解码重开；插件 peer 检查。
- 首次 8/9 的失败来自测试将 compact 期望为 compaction；标签源码明确映射为 compact-checkpoint。修正夹具期望后通过，保留 `initial-probe-failure.json`；不是产品缺陷修复，也未放宽校验。
- `probe-audit.json`：27 包生产依赖审计无已知发现。该 npm 探针闭包不是最终 source-build 运行库；9 项不代表真实磁盘持久化、冷读分页、完整 Agent 分支、Profile、模型或安装态通过。
- 复用昨日有效的旧固定内核源码基线：623 项中 621 通过、2 跳过、0 失败。本日无生产代码变更，不重复全量测试、旧 Office 预览或打包；保留昨日备份代码与其他用户修改。

## Office 来源与发布门禁

- rc.1 声明的 Node API `@deepseek-ai/libreoffice-kit@0.1.0` 仓库仍 HTTP 404、npm gitHead 缺失。实取归档 39 文件，含编译 JS、类型、README/NOTICE/LICENSE，未见 src/sources/source map；NOTICE 指向 LibreOffice Core 的字体数据，并不提供完整 Node API 对应源码。
- 归档 SHA-512 与 npm integrity 一致，SHA-256 `33169d16aa215c2dc12544862ef8aa59884b87b458db9e96a1f847eb86e52857`。Windows 引擎 0.1.0 本次仅查元数据：2,053 文件、340,979,793 字节解压体积；未下载/验证新的引擎载荷或安装包增量。
- [Q&A #7026](https://github.com/deepseek-ai/deepseek-harness/discussions/7026) 无新增回复：仍只有作者关联 NONE 的社区评论，无采纳答案。没有重复发帖、替用户采纳或把社区回复当作维护者来源确认。
- 对应源码未确认，公开门禁不解除；不作法律结论。安装 V1.1.13 / 0.1.6-alpha.1、既有 v1.1.13 私有草稿和 Stable V1.1.12 沿用上次状态，本次未修改且未重新全面验收远端资产。旧 v1.1.13 发布范围待决不被定时授权替代。

## 下一切片

1. 在隔离 Profile 中验证 settings.yaml 一次性导入/失败恢复，以及 Messages、软件 Key、代理和三个桌面插件真实组合；不迁移用户当前资料。
2. 新安全锁与 source-build 运行库固定后，验证真实持久化/锁、冷读分页、完整分支及真实模型交互；本次纯 Session 探针不可代替。
3. 对应来源、完整插件、Setup/Portable、备份覆盖及资料/凭据保留、公开下载等门禁仍逐项完成。没有打包、安装、推送、公开或 Stable 晋升；签名、其他机器与老化未验证。
4. 本次成果同步既有 Obsidian DSH 项目；同步验收另记 `verification.json` 与 VALIDATION，不将阶段性预检写成已交付。
