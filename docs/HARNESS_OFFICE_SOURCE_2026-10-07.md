# Harness / Office 来源核查 — 2026-10-07

本轮沿用 V1.1.14 / lulu 与已有 0.2.1-alpha.1 候选，只推进 Office 来源材料核查。不升级固定内核，不重做昨日构建、测试、安装或服务对照。

## 官方更新检查

北京时间 2026-10-07 14:42:50，官方 GitHub Releases、标签的完整版本排序与 npm 版本交叉核对：仍为 `dsh-v0.2.1-alpha.1` / `5badb15009ae1756c3afe0ae0cef1faafc290ccc`。Release 时间 `2026-10-03T06:42:19Z`；npm alpha 为 0.2.1-alpha.1，latest/next 为 0.2.0-rc.2。没有新发布目标，不采用 master 未发布代码，也不另开桌面版本。

官方来源：[Harness Releases](https://github.com/deepseek-ai/deepseek-harness/releases)、[Office 仓库](https://github.com/deepseek-ai/dsh-libreoffice-kit)。Office master 仍为 `b19bb73c74ed893b8a5d1716d32df32a113ed31b`；HCS 最新仍是此前已评估的 4.3.0，不重复其旧专项。

## 本次新增证据

核查对象为昨日从官方 registry 下载并保留的 `@deepseek-ai/libreoffice-kit-win32-x64@0.1.5`。未再次下载大包，也没有解压落盘或执行包内代码。

- 整包 SHA-256：`5cc9051e7d29a6dfe409bb3dbfcb931cbb1591709d83b84b404faf319a64d0ae`；SHA-512 与既有官方 registry 元数据完全匹配，检查后再次计算整包摘要一致。
- 归档 735 个普通文件、190,868,740 bytes；`prebuilds.json` 声明的 **733 个文件 SHA-256 全部吻合**，包括二进制、来源文件和所列许可证。此为包完整性，不是独立构建证明。
- `sources/` 共 **90 个文件**，包含 64 个原生补丁、Core 来源声明、构建配置/脚本、worker 源码、聚合补丁与资源裁剪信息。三类许可材料的清单及摘要存在；本轮不作完整法律合规裁决。
- `core-source.json`、`core.json`、prebuild 清单共同指向 [LibreOffice/core 提交 bce0998](https://github.com/LibreOffice/core/commit/bce0998afefdbc355585ca324285661a2170ba77)，Core 版本记为 26.8.0.3；官方 API 可读取此提交，Office 公开树的 `engine/core` gitlink 也完全一致。
- 用 Git blob 算法逐文件对比固定公开树：**81 相同、4 不同、5 无同路径**。没有只凭文件名或版本字符串判定对应。

## 差异被限定到具体文件

主线程再次读取 4 个包内文件和固定公开提交的原始字节，独立核对两端 Git blob；排除 BOM/CRLF 后仍有实质差异：

| 随包来源相对公开树的差异 | 观察到的内容 |
|---|---|
| `engine/native/worker.cxx` | 设置线程 DPI awareness；失败时报 unavailable，注释说明 96-DPI 栅格坐标 |
| `engine/native/build-helper.mjs` | Windows helper 增加链接 `user32.lib` |
| `engine/native/configure.mjs` | buildPlatform 参数增加 `--disable-cli` |
| `engine/ui-resource-policy.mjs` | 增加 `svt/ui/tabbuttonsmirrored.ui` |

无同路径的 5 项为 `core-source.json`、`core.json`、`payload-shaping.json`、`core-changes.patch`、`engine/native/patches/0069-native-virtual-printers.patch`。它们实际存在于包内并通过摘要检查，不能称为缺失源码；其中的构建元数据、聚合补丁以及额外 0069 补丁需按其用途进一步审查。

`buildIdentity.recipe` 与随包 `engine/build-identity.mjs` 文件本身的摘要相同，不把这一字段误当作全部配方或二进制的独立证明。机器报告中的 `verified=true` 表示本次检查执行及所列断言通过，不表示所有公开源码一致、Office 功能或发行通过。

## 决策与能力边界

1. 来源门禁由泛称“0.1.5 精确来源未核实”细化：**明确 Core 提交可获取、附带来源材料存在、包完整性、81 份公开配方一致**已有证据。不再以缺少 tag/gitHead 或未独立重建整个 Office 作为这一层材料不存在的理由。
2. 未关闭的是上述具体差异/额外补丁的来源及构建声明检查，以及完整原生功能和发行验收。差异本身不是恶意证据；也不把同一包内部的声明与摘要当作相互独立的构建认证。
3. 官方转换/预览/重算引擎仍是优先复用方向；本次没有新增或删除功能。软件优先加密 Key、代理、Office/Wiki 校验与备份、Git Review 和 Windows 宿主保护不动。
4. 昨日 Windows native 可选包尚未补装的问题未被这次归档校验修复；真实 Office 转换、shell 受限语言/编码与同权限因果对照、HCS 安全、角色授权及 Setup/Portable 等门禁仍保留。

## 验证与交付状态

- 固定 Node 24.19.0 执行 `inspect-office.cjs`，实际 exit0；来源比对独立复核，代码审查为带非阻断意见通过（必须保持 verified 字段的上述边界）。
- 正式 package/lock/workspace、runtime manifest/patch 五项摘要与昨日证据一致；候选 profile/lock/source.patch 保持未变，promotionAllowed 仍 false。
- 无新全量测试、依赖审计、构建、模型调用、原生代码执行、服务操作、安装、上传或公开发布；本轮不是新核完整适配。Stable 不变。
- 下一步针对 4 处改动及 0069 补丁核对配方语义，再按冻结锁补齐隔离 native 负载、做受控文档与 DPI/取消/拒绝场景验收；不等待一个标签代替实际检查，不自动采取永久停服务或降低沙箱的方案。

原始证据：`artifacts/upstream-checks/2026-10-07/check-064250.json`、`inspect-office.cjs`、`office-source-verification.json`；旧包、昨日失败和原始来源记录保留。Obsidian 按 wiki-update 合并既有项目，实际同步结果以本日 `wiki-office-source/main-verification.json` 为准。
