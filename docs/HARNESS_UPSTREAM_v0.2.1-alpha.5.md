# lulu：Harness 0.2.1-alpha.5 更新与隔离适配

检查日期：2026-10-17（Asia/Shanghai）。下一交付仍拟为 **1.1.17**；本记录不代表本机已经换核、已有新安装包或已发布。lulu 是非官方 Windows 宿主，不暗示官方背书。

## 官方来源与目标

- 官方 [Release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-alpha.5) 与标签：`dsh-v0.2.1-alpha.5`，完整版本 `0.2.1-alpha.5`。
- 标签提交：`1517a4dbca0a2789ff1d41ba439600f8547d23fa`；发布时间 `2026-10-16T12:23:28Z`。
- npm `@deepseek-ai/dsh@0.2.1-alpha.5` 发布时间 `2026-10-16T12:31:49.659Z`；SRI `sha512-ehpWvmRskdQp+CXO66BeK2HBYB0PQitwdWY13VzUVaspPSFxk0E+cZtvQhDPgc77ZeREbz9InXQzfDJjQ2Wy7g==`。npm 未提供 gitHead，不补造对应关系。
- 本次 Release/tag/npm 检查结束于 `2026-10-17T00:06:52.707Z`。npm latest/next 仍为 `0.2.0-rc.2`，不能只比较 rc/alpha 后缀或只看 latest。
- 全量 Git 差异：alpha.4 → alpha.5 共 586 文件、3129 行增加、1117 行删除；多数为版本及快照。GitHub compare API 返回的 300 文件列表被截断，不作完整差异清单。
- 新隔离目录：`artifacts/harness-source-0.2.1-alpha.5-lulu/`。旧 alpha.4 源码、9 gate 构建及 302 包集证据保留，不拿旧包冒充 alpha.5，也不再为旧目标新增生产负载。

## 官方替换、桌面保留与迁移风险

| 变化 | 采用方式 | 保留及风险 |
| --- | --- | --- |
| 插件启停后的 Skill 菜单刷新 | 直接采用官方跨会话缓存失效及迟到请求处理 | 桌面 `skill.list` 的 RPC 转换不是重复缓存；不另建菜单状态机 |
| 多终端发现、恢复、失败重试 | 直接使用官方共享 inventory、单飞查询、显式重试与连接重置逻辑 | 已有终端缺失时不能静默新建 Shell；桌面确认、Session/Workspace/PID 复核及输出脱敏保留 |
| 折叠右栏时 Page Up 横向位移 | 采用官方 `overflow: clip` 修复 | 不删除处理文件树、Git Review 和原生底栏占位的 lulu 样式，两者不等价 |
| 模型标签扩展 | 采用官方 `conversation.input.model.label` slot | 非交互标签不接管模型选择或凭据权限；保留品牌主题 |
| 账号通知与堆叠 | 直接使用官方账号页面 | 可选元数据、非 UUID ID、空到期时间和 notices 数组有接口变化；本地未发现直接消费者，不替代 DPAPI Key |
| PTC/SDK 提示与 persona | 采用官方 function-body/REPL/Python 提示及参数契约 | 不新建执行器，不放宽工具审批或沙箱 |
| 官方 Windows 签名与发布设施 | 不复制官方 runner 计划任务、COS 发布身份或签名凭据 | lulu 的 NSIS/Portable、备份、覆盖和 GitHub 发布验收保持独立 |

普通插件安装、启停、升级、卸载已在本项目未交付源码中转向官方；历史桌面事务的持久最近可用状态回退仍保留，因为官方当次失败/取消恢复不是等价替代。本次没有识别出另外可直接删除的独有实现。软件优先加密 Key、代理、Office/Wiki 校验与备份、Git Review、私有 PowerShell、附件所有权及 Windows 宿主保护全部保留。

**Important：官方终端 Web E2E 仍在 Windows 条件跳过。** 源码单测不能替代 Windows 上的多终端重载、Host 重启、连接恢复、缺失终端不重复启动及输入不重放实测。账号通知只用合成响应测试；本轮没有读取 API Key 或调用真实模型。

## 依赖与来源适配

- 两个官方版本的 1725 个 registry package 及 1730 个 snapshot 内容全部一致，无新增/移除/版本/SRI 变化；pnpm 仍固定 `11.28.5`。只新增三条本地开发依赖连接，账号模块另声明对既有 `util-values` 的生产 peer。
- 继续使用现有固定 Node `24.19.0`；不升级 Electron、根 pnpm 或其他依赖组。
- 六层受审补丁在新官方原像上独立 Git index 重放，再与实际候选逐字节比较，40 个后像一致。独立严格内存重放复核通过；33 个既有文件原像不变、6 个新增文件在两个 tag 都不存在、仅锁文件原像变化。
- 官方新锁 SHA256 `952ca2f79998660dc690b739078a5d6052bc7c5c2193714b918b9d720baaeaba`；新派生锁 `a12d2048e4a4b72049c590db3859d41b5eb43e086707fe4bab934cc008ddc3e1`。与受审 alpha.4 派生锁的语义差异严格只有三条官方本地连接；HCS 4.3.0 补丁及 fflate 0.8.3 保留。
- 新 `runtime/harness-021-alpha5/profile.json` 使用明确的 `lockReplay` 证据类型，保持 `promotionAllowed=false`、`preflightOnly=true`；不伪造 pnpm 锁生成记录。

## 本轮验证与保留失败

证据根目录：`artifacts/upstream-checks/2026-10-17/`。

| 项目 | 当前结果与证据 |
| --- | --- |
| 官方检查 | `check.json`、`releases.json`、`tags.json`、`npm.json`；已核完整版本及提交 |
| 能力/依赖独立审查 | `capability-review.md`、`dependency-comparison.json`；586 文件差异范围，第三方依赖无增量 |
| 六层来源重放 | `source-replay-alpha5-i89xgt/result.json`；40 后像通过，正式四项绑定摘要保持 |
| 独立重放审查 | `replay-review.json`；无 Blocking，补丁与锁语义符合新原像 |
| 派生源锁生产图审计 | `source-audit-IJCRzp/result.json` 及 stdout：640 项，所有已知漏洞级别为 0；不等于未来物化桌面闭包审计 |
| 冻结安装 | 离线 `source-install-4w2NNm` 真实 exit 1，缺 `@lexical/extension` 元数据，输入未变；保留失败。同锁 `source-install-online-v1zaca` 完成 1401 包、下载 0，真实 exit/close 0，16,254 源码输入前后不变；SHA256 `495abd4cb6e971a656f685a57d4223876373a8fb43f166992b205e9599417547` |
| 官方影响域源码专项 | `all-Ebc4rm` 精确执行 37 文件，1016 通过、1 跳过、0 失败；Vitest exit 0，但严格零跳过控制器 exit 1 / `ok=false`，不得写成全绿。独立 `source-test-review.json` 保留并复核原回执、日志和输入 |
| 安全消费者 | `security-consumers/run-B2Rkfh/result.json`：28 HCS 策略、5 loopback 缓存消费者、2 Office 依赖 ZIP fixture 通过，三子进程 exit/close 0、零跳过、16,254 输入保持；自然解析新候选的补丁 HCS4.3.0 / fflate0.8.3。SHA256 `03ee254a1acdc46aafb810940592803badf2019a4611f74d170f3f78df3203d1`。不代表 Office 原生、Worker 预览或正式闭包已验 |
| 新候选完整构建 | `controlled-build-alpha5-3hvGDh/result.json`：9 gate / 真实 exit-close 0，16254 源码与固定输入不变，12614 个输出共187372433字节，323客户端产物的固定版本/提交元数据通过；SHA256 `e91756e2e1229f67412ab2e797f35a30b5944bb5e2893ae55af23aa7051e6af9`。Windows native addon 阶段为官方 no-op，不等于原生加载或宿主运行 |
| 新组件包集 | `controlled-pack-alpha5-geM6OY/result.json`：六阶段真实exit/close0，16254源输入及固定依据不变；302包逐包核对名称/版本/字节/SHA256/SRI和打包来源，合计23320191字节。描述符SHA256 `a856543abb3d29c0dd047483269b08f497ee8bd5ca3ff5b872efe187720eaf32`，回执SHA256 `40a403b7216b235040f427b19978a93a6d2e33453b3aaa322d0815d8ae5a4944`。native entry四个JS/类型导出在实际TGZ内核对，但未称为原生运行通过；六阶段及控制器均已自然结束 |
| 生产闭包只读清单 | `runtime-lock-review-alpha5/inventory-l0gH5P/result.json`：实际源码选择器得到302本地包、373 registry identity/snapshot、748精确父级边、27 registry peer 边，无解析缺口或版本冲突；account → util-values 的必需本地 peer 已纳入。脚本及16254源输入前后核验通过，未安装/派生生产锁，未批准任何旧15/3 peer改写规则。inventory SHA256 `a531ed5b9dd2ed33171e333595fcfd582d22fee7a992f30eb1fcd16da3c768c2`，执行回执SHA256 `9fa7ff3289e4d31fb4cec67db0795ef0ad8254eff5df70e745ee47f4645f4ba2` |
| 新闭包工具准备 | `runtime-lock-review-alpha5/pure-tests-dumlyD/result.json`：56/56纯契约测试及两项语法检查通过，所有子进程实际status0；回执SHA256 `df8b3359213dd286665942350f81bc4dfb9d83db0703fa2e820c785748abc806`。新prepare按实际schema1校验新build/pack，validator默认零peer例外，provider草案仍待技术评审。审查中修正了build绝对cwd与pack相对cwd的区别，并增加真实固定回执回归；没有重写旧回执。尚未调用prepare/派生生产锁/安装，工具纯测试不等于闭包实测 |

首次 Git fetch 停滞，核对 PID/命令/创建时间后只结束本轮 fetch 子树；限定 HTTP/1.1、浅标签及低速超时重试成功，没有改变全局 Git 配置。多项条件同时变化，不能认定 HTTP/2 是唯一原因。见 `fetch-note.json`。旧补丁的三条尾空白告警保留，没有为消除告警改变受审补丁字节。

此次源码单测的唯一跳过是 `packages/api/terminal-controller/tests/controller.spec.ts:571` 中固定 `/bin/bash`、stty 和 Tab 补全的交互用例，官方显式 `it.skipIf(process.platform === 'win32')`。独立审查确认该测试文件不是 alpha.5 新增修改；保留原严格门禁失败，不降低标准、不建立泛化跳过白名单。可继续独立构建，但它不能证明 Windows 交互 Shell 或终端恢复。Vite 会读取候选根环境文件，控制器已明确检查四种 `.env` 不存在并隔离 HOME/AppData/DSH_HOME，不继承 Key、代理或 NODE_OPTIONS。

## 实际交付状态与继续顺序

根源码版本及本机安装记录仍为 **1.1.16 / 0.2.1-alpha.2**；下一交付拟 **1.1.17 / 0.2.1-alpha.5**。公开 Pre-release **1.1.14**、Stable **1.1.12**，本轮未新增草稿、安装包、覆盖安装或公开发布。

源码冻结安装、37 文件影响域专项、安全消费者、完整构建及新包集已有本版本证据，不从头重跑。下一最小动作是技术审查 `runtime-lock-review-alpha5/prepare.cjs`、`lock-validator.cjs` 及provider草案，随后使用绑定的geM6OY新包集准备/派生生产锁；遇到实际peer差异另行审查，不能照搬旧版15项/3项白名单。再完成生产冻结安装与审计、原生/Office/真实Windows交互、来源格式专用分支、正式绑定和桌面全测；之后新Setup/Portable、私有备份覆盖、资料/密文/权限保留及公开下载验证。现有正式来源链只接收旧schema2，尚未接入新工具支持的原始schema1 build/pack，不能修改回执格式冒充兼容。已有1.1.16隔离正常退出、停止后历史及ACL缺口保留，不能被本次源码验证冲掉；需要用户正常退出或新的权限决定时再明确提示，不强制结束用户进程。

用户批准的三套旧 output 清理已于 10 月 16 日完成，不扩大删除范围、不转存 D 盘。后续构建前重新测量空间。Windows 11 x64、未签名、其他电脑与长期老化未验证的边界继续披露；Stable 不自动更新。

本轮组件打包单独核算磁盘预算：此前同范围 pack 的15秒采样最大下降77299712字节、受控目录62220509字节，新构建输出仅增76229字节。本次 artifact-only pack 采用4GiB启动门槛（不变2.5GiB运行底线+1GiB包预算+0.5GiB宿主波动余量），保留逐阶段/15秒复查、20分钟超时及受控子进程止损；不降低任何测试、字节校验或发布要求，不外推到闭包安装或NSIS。15秒样本不是瞬时峰值上界。见 `pack-space-budget.json`；原5GiB runner与测试证据保留，新 `controlled-pack-alpha5-budgeted.cjs` 的11项纯测试通过。

独立只读复核已重算83项绑定摘要及源码/输出清单，未发现 Blocking / Important；该复核不重跑构建，也不声称重新验过本机资料或远端发行状态。

包集另经独立逐包复核：6阶段/12日志、16254源文件、302 TGZ 字节/SHA256/SHA512 SRI/来源与名称版本均匹配，包名集合与本轮源闭包inventory完全一致；native四导出为普通非空文件（5132/3947/2263/865字节），唯一源码端生成物变化是允许的 `native/system/tsconfig.tsbuildinfo`。这项结论仅及组件产物，不等于生产安装/原生运行。
