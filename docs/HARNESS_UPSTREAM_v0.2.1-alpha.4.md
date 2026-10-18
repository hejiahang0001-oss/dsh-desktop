# Harness 0.2.1-alpha.4：隔离适配与官方能力收敛

## 当前范围（2026-10-16）

官方新增 alpha.3、alpha.4，适配目标固定为 **0.2.1-alpha.4**。这不是本机换核或公开交付完成：根版本/当前安装记录仍为 **lulu 1.1.16 / 0.2.1-alpha.2**，公开 Pre-release 1.1.14、Stable 1.1.12 不变。下一交付小版本拟 1.1.17，只有来源、构建和兼容验证闭合后才修改正式绑定。

1.1.16 原资料退出与保留已通过；隔离补测的强制清理、退出后历史及 ACL 未闭合仍保留在 [alpha.2 记录](HARNESS_UPSTREAM_v0.2.1-alpha.2.md)。官方声明修复不能追认旧失败为成功。新目标继续已有升级工作，不重新下载被删旧安装包，不重跑无关 Office/模型流程来替代缺口。

## 官方身份与检查

- 检查时间：`2026-10-16T08:16:55.969Z`（北京时间 16:16:55）。GitHub 28 个 Releases、29 个 tags 与 npm 元数据交叉核对；完整 semver 比较，不依据 alpha/rc 后缀排序。
- [alpha.4 Release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-alpha.4)：`dsh-v0.2.1-alpha.4`，`86a402200d95fecef4529d969836f1fe13c6cb0d`，发布于 `2026-10-15T13:40:02Z`，Pre-release。
- [alpha.3 Release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-alpha.3)：`2fbf4359b82fb94c03dcce0b831660d87f12ea5c`，发布于 `2026-10-14T13:32:15Z`。
- npm `@deepseek-ai/dsh` 的 `alpha=0.2.1-alpha.4`；`latest/next=0.2.0-rc.2` 是较旧完整版本。npm alpha.4 发布于 `2026-10-15T13:08:08.555Z`，完整性见 `artifacts/upstream-checks/2026-10-16/check.json`。未返回 gitHead，不据此编造 npm 提交；GitHub 标签与独立检出提供源码提交身份。
- 原始官方检出：`artifacts/harness-source-0.2.1-alpha.4`；适配 worktree：`artifacts/harness-source-0.2.1-alpha.4-lulu`。未采用 master 未发布提交。

## 官方替换与桌面保留

| 能力 | 决定与原因 | 新目标必须验证的边界 |
|---|---|---|
| 会话恢复、历史兼容、异常退出状态、存储卸载落盘 | 直接采用官方；不另加桌面“补成功”或重发逻辑 | 持久化并发、卸载 drain、正常退出、停止状态与再读；旧强制清理报告不算通过 |
| 输入框命令片段、滚动、模型推理等级、Office 回复交付 | 跟随官方 UI/工具；不接管官方 Steer/Stop/输入协议 | 命令与附件、会话切换、Office 预览引用和导出 |
| 聊天消息密钥遮罩 | 使用官方显示层 | 只遮罩已发送 UserText；复制/存储/模型输入仍是原文，不替代 DPAPI 和出口脱敏 |
| 普通插件兼容判断、安装/启停/更新 | 收敛到官方插件页；旧受控入口只按 peers、而官方优先 engines.dsh，语义不等价 | 旧安装/启停/通用 lifecycle IPC 拒绝；官方按需插件可更新，社区插件升级可能需先卸载再安装，不宣称完全相同的升级操作 |
| 历史桌面事务“最近可用状态回退” | 保留独立恢复入口，不属于重复能力；官方失败/取消回滚只覆盖当次安装，不保留我们的持久 LKG undo | 仅有效旧记录且当前版本/启停/完整快照相符时可用；保留原生默认取消、空闲互斥、确认后二次复核、重启验收和失败恢复。官方改写 Profile 后拒绝，不覆盖新内容 |
| 自定义插件索引 | 可随官方可选组件存在，保持默认关闭、索引为空 | 不自动启用实验 bundle、不加第三方源、不调用第三方安装 |
| 软件优先加密 Key、代理、Office/Wiki 校验备份、Git Review、托盘与 Windows 保护 | 保留桌面补充 | 官方软件优先顺序不等于 DPAPI；原资料、密文、代理与权限不可迁移或放宽 |
| 私有 PowerShell 与未发送附件生命周期 | 继续保留既有窄补丁 | 原 PS7 preimage 未变；附件 facade 增加命令恢复分支，需要组合验证，不能仅凭 patch 可应用判定兼容 |

源码依据：新目标 `packages/boot/app-boot/src/plugin-compatibility.ts`、`src/profile.ts`，`packages/session/session-persistence-jsonl/src/storage.ts`，`packages/client/ui-secret-mask/README.md`；桌面 `electron/desktop-credential-host.cjs`、`controlled-plugin-installer.cjs`、`plugin-compatibility.cjs`。`api-remote-access` 是官方非 owner API 权限控制，不是恢复已排除的远程命令桥；Windows 宿主仍仅回环监听。

## 依赖分组与复用边界

本轮不升级 Electron/Node/pnpm/Office 基础引擎。lulu 宿主 Electron **43.5.0**，不是上游桌面的44.7.0；项目 pnpm11.19.0 与上游源码构建 pnpm11.28.5 分开固定。Node24.19.0、Office kit0.1.5、Koffi3.1.1、sharp0.35.5、native loader0.1.9 的相关锁身份未变；匹配内容摘要的下载/原生缓存可复用，但仍需新负载和新宿主冒烟。

实际依赖变化包括 pi-ai/telemetry1.1.0、undici8.11.2、持久化 p-limit/yocto-queue；HMR 直接 watcher 从 chokidar4 转5，需单独验证 ESM、Windows 路径、热重载和释放。官方源码桌面组件闭包估计 298→302（不是打包通过），不引入 CUA/macOS 能力。完整差异见 `artifacts/upstream-checks/2026-10-16/dependency-review/review.md` 与 `comparison.json`。

## 本轮实际证据

| 阶段 | 结果 | 不代表什么 |
|---|---|---|
| 既有桌面源码基线 | `test-iLkE28/result.json`：976/976，零失败/跳过，405 项输入前后不变；根生产审计5项无告警 | 不是 alpha.4 构建或新插件入口改动后的最终测试 |
| 原官方源锁生产审计 | `source-audit-OVaRD9`：641项，HCS high、fflate moderate，失败保留 | 不是已物化桌面闭包；不抑制或忽略公告 |
| 原六层补丁预检 | `replay-Rj7va4`：旧安全 workspace/lock 上下文不适用，四层 PS7/附件补丁通过 | 初次 `replay-XPBgO6` 因输出缓冲不足无效，单列保留，不作为根因 |
| 最小安全补丁迁移 | `replay-asaoPj`：新安全 patch + 原四层共5层重放通过；有限纯测试5/5；32个 preimage 核对 | profile 仍 preflightOnly，不是可部署来源链 |
| 应用到独立适配源码 | `candidate-application.json`：5层、39文件；根版本、锁、正式内核与部署绑定摘要保持 | 未修改 vendor 或已安装应用 |
| 新锁派生 | 离线 `source-lock-nacWik` 缺 @agentclientprotocol/sdk 缓存元数据，原输入不变；联网 `source-lock-online-az2zVB` 完成，仅锁文件改变；`patch-preflight/lock-review.json`确认15处语义变化仅HCS/fflate修复 | 不以命令退出0替代独立审查；不复用 alpha.2 lock patch |
| 派生源锁审计 | `source-audit-VbY217`：640项生产图、零已知告警，命令退出0、源码输入未变 | 不替代未来实际桌面生产闭包审计 |
| 六层来源配方 | `source-recipe-XiUneb/result.json`：独立最小预像/index重放6层，40个后像与实际源码原始字节一致，自测4/4；profile固定所有摘要且仍preflightOnly | 一次历史helper并发修改导致摘要漂移的自测失败保留；不可变历史副本恢复为原摘要，不回滚新安装执行器；不当完整构建或部署通过 |
| 固定依赖安装 | `source-install-7alYJu`缺pkg；单包校验补缓存后`source-install-GQiOyO`缺lefthook；停止逐包循环，`source-install-online-TNucwl`冻结联网一次成功，364 workspace/1401包，1376复用/21下载，源锁不变 | ignore-scripts，不执行原生准备或安装钩子；原失败不改写；安装成功不等于新目标测试通过 |
| 插件退役初轮测试 | 根全量`test-IsS6no` 983/983、零失败/跳过、输入不变；独立评审发现唯一LKG回退不应删除，现已恢复专用受控入口 | 983项不是后续回退修正后的完整全测；不能因绿灯忽略行为语义遗漏 |
| 最终插件影响域 | `plugin-final-PZtzqR/result.json`：10个文件、65/65，零失败/跳过，代码输入不变；独立审查未见新增Blocking。覆盖旧IPC拒绝、官方导航约束、历史回退确认/互斥/复核与失败恢复，含官方改写Profile后拒绝覆盖旧记录 | 不是最终完整根测试、真实插件安装/回退或新内核重启；提交/发布前仍须最终全测 |
| 初轮真实开发态渲染 | `plugin-surface-r8xoQn` exit0，实际Electron渲染、受限preload/旧按钮消失/配置正文隐藏通过，进程已退出；截图发现旧权限提示文案需同步修正 | 合成Profile、无模型/真实资料；不是官方面板导航、回退交互、打包或安装态；`plugin-surface-preflight.json`保留测试器误用上游Electron版本的启动前断言失败 |
| 修正后真实开发态渲染 | `plugin-surface-o1tcTK/report.json`：源码输入不变、Electron自然退出、实际DOM/截图通过；“打开官方插件页”移到首屏，旧写入按钮为0，专用历史区保留。`plugin-surface-1MfQNH`的DOM通过但初帧空截图保留，测试采图改为等待双动画帧后才得到最终实图 | 无历史记录的合成Profile只验证隐藏回退按钮；不代表真实官方页导航、历史回退或安装态验收 |
| 新内核源码专项 | `dependency-review/contracts-summary.json`：18文件，521通过、0失败、1跳过；插件93、持久化267、HMR22、凭据112、附件27；各组16,231个源码输入前后不变，未运行原生准备/完整构建 | 唯一skip为官方credentials-local的POSIX 0644权限案例在Windows条件跳过，不替代Windows ACL/DPAPI。未验证完整上游测试/coverage、构建后的worker、附件编解码/拖拽、真实模型和打包 |

上述短路径除 `test-iLkE28`、`test-IsS6no` 位于 `artifacts/stable-readiness-20261007/` 外，均在 `artifacts/upstream-checks/2026-10-16/`；补丁报告位于其 `patch-preflight/`。完整记录保留原日志、摘要与失败，后续结果另补。源码专项总摘要SHA256：`05a29d47af0abe22b8bc39fc269f4484b806b6d17820a05788ec937d518c65fa`。

## 下一步与发布门禁

1. 派生锁审查、六层来源重放、冻结安装及无需完整预构建的5组官方契约测试已经完成，不重新下载依赖或重跑这些未变步骤。先解决下述空间门禁，再准备必要native/生成物、运行余下专项与完整构建/打包来源闭环；固定构建并发，避免新官方 DAG 根据 CI 标志放大并行。
2. 重复插件入口及独有历史LKG回退已在源码收口，65项最终影响域和开发态只读界面通过；仍需在实际Harness验证官方导航、历史回退重启与目标内核组合，不启用实验性插件市场。
3. 新来源/构建通过后正式绑定为下一小版本候选，再做新包、真实交互、Setup/Portable、私有备份覆盖及原资料/密文/权限保留。缺人工托盘操作时明确请求，不无人值守反复开窗口等超时。
4. 完整验收后才公开 Pre-release 并核对匿名下载；Stable 不自动更新。Windows11 x64、未签名、其他电脑及长期老化未验证等边界保持。

本次尚未发布；不得把新目标源码预检写成已安装、全部验收或 Stable-ready。Wiki 按本轮实际阶段同步，另记验证回执。

### 新的空间门禁

冻结安装后C盘约3.43GiB。未擅自删除用户要求保留的1.1.15及以后产物，也未转存D盘。已请求用户仅删除三套被最终候选取代的早期1.1.16 `output/`（`dist-SZqatc` 0.60GiB、`dist-YPbNuf` 1.67GiB、`dist-zDabGK` 0.60GiB，约2.87GiB）；保留各自验证日志、1.1.15、最终`dist-JNNUUW`及全部资料。尚未获答复，未删除。该请求只涉及构建产物，不是扩大系统清理授权。后续构建/双包/安装备份前需重新核空间。
