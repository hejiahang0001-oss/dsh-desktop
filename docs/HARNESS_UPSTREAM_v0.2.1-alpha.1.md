# Harness 0.2.1-alpha.1 — 2026-10-04 静态契约评估与隔离适配入口

本页记录官方发布身份、源码契约和迁移风险，**不是完整适配或交付通过证明**。继续同一未发布的 V1.1.14 候选；lulu（原 DSH Desktop）视觉改造保留。正式运行时绑定仍为 **0.1.6-alpha.2**，没有因本页评估而替换 vendor、覆盖安装或改变 Stable。

## 1. 官方身份与证据范围

2026-10-04 08:00–08:18（UTC+8）主线程核对官方 GitHub Release、精确标签及 npm 发布元数据：

| 字段 | 核对值 |
|---|---|
| 完整版本 | `0.2.1-alpha.1`，高于之前目标 `0.2.0-rc.2` |
| 标签 | `dsh-v0.2.1-alpha.1` |
| 提交 | `5badb15009ae1756c3afe0ae0cef1faafc290ccc` |
| GitHub 发布时间 | `2026-10-03T06:42:19Z`，Pre-release |
| npm 发布时间 | `2026-10-03T04:53:22.343Z` |
| npm 通道快照 | alpha=`0.2.1-alpha.1`；next/latest=`0.2.0-rc.2` |
| npm tarball SHA-1 | `4f0727d2b8b62d798cfbb5d5df0c797671a3a888` |
| 官方源码包管理器 | `pnpm@11.7.0`；不改变桌面项目固定的 pnpm `11.19.0` |

来源：[官方 Release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-alpha.1)、[精确标签](https://api.github.com/repos/deepseek-ai/deepseek-harness/git/ref/tags/dsh-v0.2.1-alpha.1)、[npm 元数据](https://registry.npmjs.org/@deepseek-ai%2Fdsh)。npm 元数据未提供该版本的 `gitHead`，源码身份以已核验标签提交为准。

本页静态复核时使用的干净源码根为：

`artifacts/harness-source-0.2.1-alpha.1-independent/`

除特别标明旧源码外，下文路径和行号均相对此根在审查时的官方内容。此根的 HEAD 已核对为上表完整提交；后续它被用于真实候选输入准备验证，现含已记录补丁，不再是未修改的源码树。原始文件可通过固定提交的 Git blob 核对。

## 2. 能力归属和去重决定

| 官方变化/能力 | 决定 | 原因与边界 |
|---|---|---|
| 输入法、排队/目标停止恢复、草稿及引用保留、工具输出显示、插件样式恢复 | 优先复用官方 | 属于官方主对话所有权；逐项真实交互验证后接入，不再新增桌面同类实现。发布说明不等于本产品已验证 |
| 输入区统计从 `stats` 拆为 `activity` / `usage` | 迁移已有插件覆盖（如有） | `packages/client/ui-chat/src/client/apply.ts:284-292` 在 `conversation.composer.dock` 注册两个 ID，顺序分别为 0、1；不能仅根据显示名称删除桌面诊断 |
| Runtime invariant 插件和 `./invariant` 导出退役 | 删除实际存在的旧契约引用 | 退役的是上游注册表及 companion，不是桌面路径、凭据、权限或持久化安全检查；本页没有授权删除后者 |
| Automation 成为 Web 内置 | 复用官方服务/UI，先验证存量行为 | 新默认挂载可能恢复已有 active 任务；详见下节。不能将其描述为纯视觉变化 |
| OS 分配端口、`--public-url` | 保留桌面现有回环随机端口保护 | 桌面已有相应宿主边界；反向代理 URL 前缀不构成公网监听授权 |
| Agent 创建插件入口 | 可复用官方入口，保留桌面受控安装与权限检查 | UI 入口不能替代软件允许的安装来源、依赖和执行权限核验 |
| Claude Code Mods 兼容层、原始会话日志和开发诊断 | 不自动开启 | 实验能力及用户内容暴露不在默认迁移范围，不把名称相似当作成熟替代 |
| Key、代理、Office/Wiki 校验与备份、Git Review、Windows 宿主保护 | 继续保留最小桌面补充 | 官方同名能力尚不能证明行为、权限和数据语义等价 |
| 旧候选的 typed spy、自包解析、安全依赖覆盖 | 暂不删除 | 新源码没有吸收这些补丁；见第 4 节，需重放并重新验证 |

结论：本轮尚无证据支持立即删除新增的桌面业务实现。可以移除的是**已经退役且确实存在的上游契约引用/构建调用**，不能为了“去重”删去仍有独立安全意义的宿主能力。

## 3. Automation 默认变化：数据与执行语义

### 已核对事实

- `packages/bundle/web-app/cordis.patch.yml:135-140,389-390` 将 `schedule` 和 `ui-schedule` 默认挂入 Web 组合。
- `presets/standard.patch.yml:20-37`、`presets/ptc.patch.yml:20-37` 和 `presets/cordis.patch.yml:23-40` 声明时钟及提醒工具；路径均在 `packages/bundle/web-app/` 下。`minimal` 不声明这些工具，子 Agent 不因此获得提醒创建能力。
- `packages/boot/app-boot/src/profile.ts:206-209,667-673` 从 profile 的 bundle 列表删除已退役的 `@deepseek-ai/dsh-experimental-schedule-bundle`，保留其他 manifest 字段（`:634-644`）。官方测试 `packages/boot/app-boot/tests/profile.spec.ts:389-403` 验证其余字段保留。
- `packages/schedule/schedule/src/index.ts:154-164` 在服务启动时驱动已有任务；`src/runtime.ts:90-124` 对到期 active 任务恢复原 Session 的 Agent、追加 followup 并持久化。`src/storage.ts:36-40` 将缺省 status 的旧任务解码为 active。
- `packages/schedule/schedule/src/index.ts:165-185` 不将旧 session 日志提醒自动导入 Host 任务表；只警告需重新创建。
- Schedule 本身不新增网络监听器；Web 默认地址仍为 `127.0.0.1`（`packages/bundle/web-app/cordis.patch.yml:182`）。到期投递可能经正常 Agent 流程调用模型或工具，不能据此说“没有外部请求”。

### Important：停用过插件的存量任务可能恢复

触发条件：旧用户停用可选 automation bundle，但磁盘仍保存 active 任务；升级后 Web 默认挂载服务。

影响：启动新版本时可能恢复到期任务，触发正常模型/工具工作。空任务表不会凭空创建任务；inactive 任务不会按 active 投递。不能把“保留任务”简单等同于“保持原停用意图”。

处理与验收：先在独立数据副本中验证空表、active、inactive、停用 bundle 留存任务、过期循环任务、旧日志提醒及坏记录。新核不得直接对真实用户 home 做首次迁移试验；如需要改变用户原停用意图，须得到明确选择，而不是将定时适配授权当成授权恢复任务。

此外，官方 `writeProfileManifest` 使用直接 `writeFileSync`（`packages/boot/app-boot/src/profile.ts:624-625`），因此桌面覆盖前备份、语义摘要和恢复验证仍必须保留。

## 4. 旧补丁与依赖审计

对照 `runtime/harness-020-candidate/source.patch` 的静态结果：

| 补丁类别 | 新官方源码现状 | 决定 |
|---|---|---|
| 测试 spy 类型 | `packages/client/ui-sidebar-browser/tests/electron-harness.client.ts:23-24,35-36` 及 `packages/experimental/client-ui-voice-input/tests/audio-fixture.client.ts:11` 仍无旧补丁增加的函数签名 | 保留重放候选；用当前依赖和类型检查证明必要性，不能直接声称已通过 |
| 工作区 bundle 自引用解析 | `packages/test-support/client-runtime/src/assembly/bundle-roster.ts:134-144` 仍仅搜索 node_modules，没有读取锚点自身包名的分支 | 保留最小修复及回归测试；新版本不得用旧测试结果替代 |
| 已审计依赖安全覆盖 | `pnpm-workspace.yaml` 的 overrides 仍只有 yauzl、cosmokit、schemastery 原有项；锁仍包含旧补丁涉及的版本 | 重新审计、按精确来源生成安全锁；不可移除旧补丁后沿用其零漏洞结论 |

主线程本轮执行结果：

- 原始锁审计：663 项依赖，65 项告警，其中 22 high、36 moderate、7 low。
- 已将必要精确安全覆盖迁入新 profile 专用 `source.patch`，旧 `0.2.0-rc.2` 补丁及证据保留。使用 pnpm `11.7.0` 执行 `install --lockfile-only --ignore-scripts` 成功，**这只证明锁文件生成，不是实际依赖安装成功**。
- 新候选锁审计：662 项依赖，仅剩 1 项 high：`http-cache-semantics@4.2.0`；审计仍为 exit 1，候选安全状态为 **blocked**。
- registry 实时未发布 `4.2.1`；[GitHub Advisory GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp) 的 patched 版本显示 None。pnpm 报告中的 `>=4.2.1` 不能当作实际可安装修复。

本轮不加 ignore、不伪造版本、不降低审计标准，不生成完整安装包或发布。后续须在权威修复实际可用后验证，或对真实依赖路径提出另行评审的最小替代方案；不能把 65 降至 1 项描述为审计通过。

## 5. 构建验收：退役脚本并非通用门禁

旧源码 `artifacts/harness-source-0.2.0-rc.2/scripts/verify-built-package-invariants.mjs:39-73` 仅检查发布的 `./invariant` companion：

1. manifest 发布 `lib/invariant.js`；
2. plain Node 自引用可导入声明的文件闭包；
3. 无 default export，Loader 不折叠模块命名空间；
4. 有 name、注入 invariants，并导出 apply 函数。

新版本移除这些 companion 及对应 verifier，没有一对一替代。应按 `docs/upgrade-guide/v0.2.0-rc.2/remove-runtime-invariants/guide.zh.md:12-23` 删除已失效模块、profile ID 或调用，不重新实现已退役功能。

仍适用的官方构建后验证组合是 `build` → `publint` → `verify-node-next-types` → built-bin smoke，官方接线见 `scripts/run-gates.ts:391-397`：

- `publint` 检查发布视图及相对导入闭包（`scripts/publint-all.ts:125-138,198-202`）。
- `verify-node-next-types` 检查已构建类型消费契约；built-bin smoke 检查实际构建入口（`scripts/run-gates.ts:864-890`）。
- `release:verify --family dsh` 只校验版本家族、发布顺序、以及发布时的标签；不能替代构建、安装和交互验收。
- `check:ci:windows-complete` 的 observational 分组有 `allowFailure: true`（`scripts/run-gates.ts:588-594`）；必须逐项读取结果，不能以聚合退出码为零宣布全部通过。
- `release:verify-packed-install` 内部调用 npm install，主要验证包闭包及 `--version`。本项目使用 pnpm；不得未经适配直接执行该安装步骤，也不能把它当作真实 UI、Office 或用户资料保留验证。

## 6. Office 来源仍需精确对应

新源码的 Office kit 依赖范围为 `^0.1.5`，锁文件精确解析为 `0.1.5`（`packages/bundle/web-app/package.json:204`、`packages/skill/skill-office/package.json:40`、`packages/document/office-to-pdf/package.json:58`、`pnpm-lock.yaml:15324-15353`）。

主线程另行核查到官方源码仓库 [deepseek-ai/dsh-libreoffice-kit](https://github.com/deepseek-ai/dsh-libreoffice-kit) 已公开。已观察 master 为 `b19bb73c74ed893b8a5d1716d32df32a113ed31b`、清单版本 `0.1.3`；实际 npm kit 为 `0.1.5`，未获得可将其精确绑定的 gitHead、tag 或 release。**公开仓库可达是新证据，但不等于 0.1.5 引擎与源码对应已经核实。** 用户“保留完整能力、核实后发布”的选择不变。

## 7. 后续验收与当前状态

1. 在独立、固定提交源码上重放必要最小补丁并生成可复现锁，保存失败与成功证据；先解决审计告警/未发布修复版本，不对正式 vendor 下手。
2. 检查所有宿主 overlay、插件和构建入口，删除失效 invariant 引用，核对 stats 插槽、插件元数据和默认 profile 契约。
3. 对 automation 迁移做隔离夹具验证，再处理其他会话持久化、历史分页、终端插件和真实服务组合；官方升级新增行为不得由旧版证据背书。
4. 验证 lulu 视觉选择器和输入/排队/停止/拖放在新官方页面的真实行为，同时保留宿主 Key、代理和安全边界。
5. 完成适用源码测试、生产审计、官方构建后验证以及 NSIS/Portable 门禁；覆盖前备份，验证安装态和资料/凭据保留。DSH 正在运行时不强制结束用户进程。
6. Office 精确来源与形象公开使用权等发布风险仍未关闭；完整验收后按现有授权考虑 Latest/Pre-release，Stable 不自动改变。

本页编写时：已完成发布身份、静态契约复核和新候选锁生成，生产审计仍被 1 项 high 阻塞。尚未声称新内核实际依赖安装、构建、完整测试、真实模型、安装、公开下载或新内核 lulu 视觉验收通过。正式内核、已安装程序及 Stable 未由此次评估改变。Obsidian 同步状态由本轮主执行报告记录，不以本页存在替代同步成功。

## 8. 本轮可复现输入及证据

- `runtime/harness-021-candidate/profile.json` 固定新 tag/commit、原锁/工作区摘要、候选补丁/锁摘要，明确 `security.status=blocked`、`promotionAllowed=false`；旧020目录完整保留。
- `scripts/prepare-harness021-candidate.cjs` 只在精确干净检出应用已核验输入；新增10项回归通过，包括改动/未跟踪资料保留、路径/链接拒绝、损坏摘要、不适用补丁、workspace后像预检及正常准备。首轮9/10因系统Git autocrlf导致临时后像摘要差异，固定Git调用 `core.autocrlf=false` 后10/10；没有把该失败当上游功能缺陷。
- 在独立精确检出真实运行准备命令退出0；反向补丁只读检查退出0，锁/工作区SHA256分别为 `235cdab51c7f5541ba79a9784eb2c47cef414c2bd1ff5efdf04a8c802ebf437a` / `960f7da4d89a754dc028d1710b29d4c81521157ab730b11081992a573a590adb`，与profile一致。输入准备不是正式构建接入。
- 独立代码审查发现并修复两项 Important：硬链接输入可能使原位写锁影响外部文件，以及最终写锁失败可能留下截断/部分源码。现拒绝多硬链接，先写入/flush/校验唯一临时锁再原子替换；仅在精确后像无外部增量时回退补丁，否则明确partial并保留现场。新增故障注入后14/14通过，修复后在另一精确检出真实准备再次退出0。进程崩溃/底层磁盘故障不宣称完整事务保证。
- 初次共享旧浅克隆缺少父对象失败，随后官方独立克隆成功；没有修改/修复旧源码。首次锁生成因未发布的4.2.1失败后保留告警，不添加审计例外。

| 本地证据（相对 artifacts/） | 范围 |
|---|---|
| `harness-021-check-20261004.json` | 检查时点、完整版本、来源、Office来源变化及状态边界 |
| `harness-021-upstream-audit.json` | 原锁663项/65告警，exit1 |
| `harness-021-security-lock.log` / `harness-021-security-lock-retry.log` | 未发布修复失败与生成候选锁成功 |
| `harness-021-candidate-audit.json` | 新锁662项/1high，exit1，未通过安全门禁 |
| `harness-021-frozen-lock.log` | frozen lockfile-only，非安装证明 |
| `harness-021-preparation-tests.tap` | 新准备入口10/10回归 |
| `harness-021-preparation-tests-post-review.tap` | 审查修复后14/14，硬链接/替换失败/并发用户增量保护 |
| `harness-021-prepare-real.log` | 真实精确检出准备，installed/published/promotionAllowed均false |
| `harness-021-prepare-final.log` | 最终保护逻辑在另一精确检出的真实准备成功 |

完整桌面源码回归最终结果见 `VALIDATION.md`。首次pnpm调用选择了Codex Node而非项目固定Node，核对进程树后仅结束本轮测试树，原日志 `harness-021-desktop-tests.log` 为中断失败、不算通过；最终直接调用项目固定Node执行相同测试脚本，不能把旧正式绑定的源码回归当作新核完整验收。最初9/10临时后像失败仅留在对话工具输出，原TAP被后续验证覆盖；现已保留10/10 baseline并用独立post-review日志。

Wiki仍合并原 `projects/dsh-desktop`，不另建lulu重复库；独立回读结果见 `artifacts/harness-021-wiki-20261004/validation.json`（应实际存在且通过后才可称已同步）。没有执行新核UI/模型/真实用户资料迁移、整包或覆盖安装，不得据上述中间证据推定完成。
