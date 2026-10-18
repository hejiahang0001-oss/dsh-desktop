# Harness 0.2.1-rc.2：lulu 1.1.17 适配与交付验收记录

日期：2026-10-17，续作至2026-10-18。正式源码和新 vendor 运行库已更新为 **1.1.17 / 0.2.1-rc.2**；本机安装仍为 **1.1.16 / 0.2.1-alpha.2**，公开 Pre-release 1.1.14、Stable 1.1.12 未变。本页不是新安装包或发布声明。

## 固定来源与范围

- 官方发布：[dsh-v0.2.1-rc.2](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.2)。提交 `687f282e8625c6b8d11ff58211a90524be2e4317`，GitHub 发布时间 `2026-10-17T08:16:33Z`；npm 发布时间 `2026-10-17T08:36:31.655Z`。
- 实际检查时间 `2026-10-17T10:08:32.887Z`，回执 `artifacts/upstream-checks/2026-10-17/rc1/rc2-check.json`。`rc1` 仅为发现新目标前建立的证据目录名，不表示采用 rc.1；原检查预期 rc.1 而失败的记录保留。
- 源码工作树 `artifacts/harness-source-0.2.1-rc.2-lulu`，从上述已发布提交建立；不用 master。与 alpha.5 比较为 13 个提交、465 个变更文件。GitHub compare 的 300 文件截断结果没有作为全量差异依据。
- 官方锁 SHA256 `4637cca3b89c4c8d5a147321710e597aa62ec2444a3772ab542be5690893dfe4`；外部 registry 1725 个 package / 1730 个 snapshot 与 alpha.5 相同。本轮只变更必要的内核包及本地 Cordis 版本元数据，不顺带升级 Electron、Node 或根 pnpm。
- 使用固定 Node 24.19.0、上游构建 pnpm 11.28.5；根项目 pnpm 11.19.0 不变。原 alpha.4/5 成功和失败证据保留，但不冒充 rc.2 的构建或运行证明。

## 官方能力与桌面保留决策

| 能力 | 本轮决定及行为边界 |
| --- | --- |
| 官方 DeepSeek Search / Fetch API 接入 | 新增 `dsh-web-deepseek-api`，可直接使用官方实现，保留默认关闭。它不是原有本地 HTTP Fetch 的同义替换；Search 独立计费，默认会携带最后一条用户问题的前 128 个 Unicode 字符；云 Fetch 会把完整 URL 发给 DeepSeek。未获新授权前不真实调用、不把内网或带令牌 URL 自动送出。 |
| 模型 1017 标签 | 采用官方 `dsh-client-ui-deepseek-model-label-1017`；只是适用模型的标签显示，不宣称更换模型或提高模型能力。 |
| 普通插件安装/启停/升级/卸载 | 沿用已完成的源码收敛：桌面重复操作退役，打开官方插件页，旧通用写 IPC 拒绝；仍待新包整体交付。当前没有另一套可删除的自研 Search 引擎，不为了“去重”误删安全补充。 |
| 历史桌面事务恢复、文件健康 | 保留：官方当前事务失败恢复不等于历史持久回退，后者仍校验原快照且不得覆盖后续人工或官方改动。 |
| 软件 Key、代理 | 保留 DPAPI 加密和软件配置优先策略。官方账号 token / 显式插件 apiKey 是不同路径，须分支核验，不能声称所有调用路径都自动等价。代理需实际 Host / HTTPS / 取消与失败关闭验证。 |
| Office / Wiki / Git Review / Windows 宿主 | 保留文件校验与备份、Git Review、私有 PS7、附件及沙箱保护。本轮源码测试不等于原生 Office、真实宿主或 Windows 权限已通过。 |

累计 alpha.3/4/5 的 Skill 刷新、终端发现/恢复与重试、Page Up、通知修复仍在目标范围；不能把 rc.1 的累计发布说明全部写成本轮 alpha.5→rc.2 新增。

## 已取得的 rc.2 专属证据

以下路径除明确写出外均相对 `artifacts/upstream-checks/2026-10-17/rc1/`。

| 阶段 | 实际结果与固定回执 |
| --- | --- |
| 六层适配补丁 | 40 个后像和 16303 个源码输入独立核验一致。最初重放在成功应用后，因把新增依赖误认为 devDependency 而断言失败；不重做或改写失败。`replay-verification-rc2-0B6tf8/result.json` SHA `0d33129da0b0e4e81f7ea9d715a638bb5eba9878d152ec7f68d1802ed57cfd93` 单独闭合。 |
| 源码冻结安装 | `source-install-online-l90c31/result.json` SHA `245d8e4204fe44e9aa2e36b06a9145af9384954785b6bd0c11aef6afa6fd42a2`；固定锁、禁用生命周期脚本、真实 exit/close 0，全部源码输入不变。 |
| 源锁生产图审计 | `source-audit-9LYxBI/`：640 项，已知漏洞各级均 0。不是最终桌面运行库审计。 |
| 源码专项及测试工具补正 | 原 `rc2-tests-all-v2S7Vr/`：714 项中 700 通过、13 失败、1 项官方 Windows 条件跳过；另私有 PS7 dispatch 5/5。13 失败由测试用网络拦截器误判 Undici 的逻辑主机名和空 path 参数导致，原报告保留。新 guard 仍只允许数字回环地址或实际返回回环地址的原 custom lookup，无公网 DNS 后备。 |
| 网络受影响项补测 | `rc2-tests-v2-networkRegression-hOJiQ3/`：6 个文件、104/104 通过、0 跳过，包含原失败的 13 项；未改上游源码、未发模型或付费工具请求。guard 自身 20/20，包括真实本地 HTTP 与恶意 lookup 拒绝。不能将两次运行伪装成一次全量绿；POSIX 权限跳过仍不代表 Windows ACL 已验。 |
| 官方构建 | `controlled-build-rc2-LLh3fU/result.json` SHA `a6a77f7920a3ebd72716236ca5427e3046118b677ecf002ed159ed1b3f169edd`；9 gate / 0 失败 / 0 跳过、自然 exit/close 0。325 个客户端产物及源码前后完整比较通过。官方 Windows native-build 步骤是 no-op，不能记为实际原生编译或运行。 |
| 组件打包 | `controlled-pack-rc2-Z2D8w8/result.json` SHA `6757c813e123c680ed1d654137ca1b584bc577222bd2cf8a3399e6bcd5546d5b`；6 阶段、304 包 / 23347795 字节，逐包 SHA/SRI/manifest/导出实字节校验，16303 源输入不变。**这是组件 TGZ，不是 Setup/Portable。** |
| 生产闭包清点 | `runtime-lock-review-rc2/inventory-8I19Hb/inventory.json` SHA `6e7d92a3d22cdff84088e6422fd621876a75bc3195d58f8035da686cf1829666`：304 本地包、373 registry 项，27 条 peer 边中 22 已解析、5 未解析 optional；未解析必需项 0。 |
| 首次运行库准备（历史） | `runtime-lock-review-rc2/derived-7R888N/preparation-evidence.json` SHA `c1c3b35a595176c925cdd97b69e629827320517f0f5289eb0c46c1b0f3a99da3`；304包、3个活动补丁、12个精确provider。下文的锁审查未放行这一候选；原目录和回执保留。 |
| 修正准备及新锁 | `runtime-lock-review-rc2/derived-jwzFus/preparation-evidence.json` SHA `ce98893c805c694fdbc6cf499b599bc70b6065eb21de8e0116cc5bb3c29afedf`；schema 2、317准备输入、16983来源输入。新锁 SHA `36560fc0a45074fd1a1bf08b4c34cd537be199c034eead40b5a38b6c4aaf8796`，`lock-generation-z246Np/result.json` SHA `250113df2ee18c333f0259edca0238a4dbc6819d2c4cc0442103ae0d8ae644d1`，自然exit/close 0，输入不变。 |
| 新锁独立技术审查 | `derived-jwzFus/lock-verification.json`（位于runtime-lock-review-rc2）SHA `c631382510088953cf3a6092b3173936862f5d75b4e65198dbd3b618535b2045`：304唯一上下文、1937精确有向边、373 registry metadata/snapshots均与独立来源模型一致；零metadata/context例外。未宣称重现pnpm不透明context哈希算法。 |
| 隔离生产运行库安装 | `runtime-lock-review-rc2/runtime-install-z8ofq0/result.json` SHA `67233d71d7e6f3894d94a3fb8fbe3a77fb92e6e27f5594a683bcda37e5c3d8db`；固定pnpm、frozen/offline/copy、禁用生命周期脚本与pnpm hooks，真实exit/close 0；新锁及全部准备/来源输入不变。此处“安装”仅指隔离依赖目录，不是覆盖用户桌面程序。 |
| 隔离运行库审计 | `runtime-lock-review-rc2/runtime-audit-CEuacU/result.json` SHA `8346a5b4acee94fb98ff54a4ec5c12e1872284ebcc5ad978682a597b2053188e`：603项生产依赖、各级已知漏洞均0，真实exit/close 0，锁及输入不变；不使用audit忽略项。 |
| 新运行库组装及独立回验 | `runtime-payload-review-rc2/materialized-IF7QVK/result.json` SHA `5fb36d76e6511b8a7d6dc0afe37003625630e3baf594b2917ecc451e1cdf17ba`：14790文件、391551993字节、304shared、Office733文件，输入未变；描述符SHA `3660a0494ae0f5971973b16177f5fd3d5dc9c5dde344a94aeddf5d7f5e56d971`。独立只读verify实际exit0，观测 `runtime-payload-review-rc2/independent-verify-IF7QVK.json` SHA `9dd9e742956ac17f5aa98607dd5663b231b34b52d0289a05cfa6f531258ef65a`。 |
| 实际原生/Office/PTY | `runtime-live-review-rc2/native-TsBYCo/runtime-verification-report.json` SHA `3679c5b5adebd8eac02f9d151f37ea2fd9398b1e2d87437b70dc2a9e32f089f9`：5类实际运行通过，DOCX/XLSX/PPTX分别2/1/3页，中文和表格123.45核验；PS7受限语言/写入拒绝、858ms取消及248ms后续输入通过；Job root-exit0、activeProcesses0、guardian-exit0，输入和描述符不变。仅固定Node运行，不冒充Electron或安装版。 |
| 认证Host和历史恢复 | `runtime-host-review-rc2/run-7QSbK3/result.json` SHA `46a3840a82da275401df20c1a342a8cabb623c7e3b1ccc28d8903f125c418f23`：5项通过，真实Supervisor及launch worker两次启动、认证HTTP/插件读取、无prompt创建隔离会话、重启恢复同会话3条合成事件；未读真实资料或发送模型请求。两次由现有Supervisor限定自己的进程树停止，实际exit/close均1并记录owned-stop；这不是托盘自然退出或后代独立清空证明。 |

源输入内容摘要为 `413e05f06e8ab1e9c668c24d8185dfac7ff0731fa8e7ea52602bbce7f488a940`。派生源锁摘要 `5f786c8af40763e2f2400da0e162065a7dc489ac28c87c2891c59948b9876a3b`。来源链新增显式 `source-frozen-v1` 格式分支，保留原 schema-1 原件，不能改写旧回执来冒充 schema-2。

## 最终源码复验与生产锁差异

- 增加测试驱动的有界 stderr、阶段和提前退出诊断，不改生产 Job，也未放宽 5000 / 25000 毫秒及后代退出限制。纯 fixture 8/8 后，`root-observed-211505/test.log` 的最终完整 `pnpm test` **1045/1045 通过、零失败/跳过**，耗时318605.44毫秒，日志 SHA256 `d7d3a6a02dcd46ce4e6d0b034b24e4b89ec8545d89e5f5231bfb3dfde90e89a9`。独立复核一致；原1036/1037失败保留，根因未证实，不把诊断增强称为产品修复。
- 首次候选锁：`runtime-lock-review-rc2/derived-7R888N/lock-generation-XA4DDU/result.json` SHA256 `fc15a2dd1f9c1d4f1dc9f91765b3d85c0234f59c1242093797795041f5604ef2`；pnpm自然exit/close0、317准备输入和16962来源输入保持，未实体安装该候选。锁 SHA256 `c657642f6b9b339748af93bce54f997ec1e9e3315eb6aea7c3cdd89f7395012e`，严格审查未放行，证据保留。
- 首次候选的15个registry包peer范围被额外parent pin收窄；373个registry snapshots本身与来源完全相同。固定pnpm的`omitPeersFromDependencies`在根provider已存在时，先移除普通依赖中与peer重叠的项；据此校正验证模型解释本地worktree包及3个transitive集合差异，不加例外。新准备实际只去掉23条不必要parent pins，保留725条其余pin和12个精确root providers；新锁已通过独立技术审查，旧候选/回执不改写。
- 上述23条不能全部称为原manifest的“peer-only”：22条没有普通/optional依赖重叠；唯一 `@modelcontextprotocol/sdk@1.31.0>zod` 的普通依赖与peer都为 `^3.25 || ^4.0`，由上述固定pnpm和根zod4.4.3条件投影为peer。另debug/sharp的3项为官方锁归一化出的optional peer，不能伪称原manifest显式声明。新准备须逐项绑定原声明和分类，不能笼统删除其他依赖。

## 正式源码接入

2026-10-18 完整来源链只读预检通过后，应用4文件精确补丁并部署新目录 `vendor/harness-desktop-0.2.1-rc.2-attachment-1`。14790文件、304共享包、完整Office和私有PS7复核通过，部署命令实际退出0；旧vendor和已安装程序未覆盖。观测记录 `promotion-review-rc2/observed-deployment.json`，原始输入及补丁固定在同目录 `proposal-inputs.json`。身份/篡改拒绝定向测试32/32；许可证生成器新增原始source-frozen来源分支，不再误写alpha.2或旧包等价证明。

## 最终桌面源码与候选双包

- 正式绑定后首次全测 `artifacts/stable-readiness-20261007/test-6miXFL/` 为1069/1072，三个失败分别涉及品牌旧类名/版本约束、发布版本和许可证摘要。保留原失败；实际核对rc.2源码及编译产物后，仅更新噜噜装饰图标精确选择器与对应版本/来源约束，不放宽测试或按钮权限。
- 修正后新全测 `artifacts/stable-readiness-20261007/test-LQ2GNM/result.json` **1072/1072通过，零失败/取消/跳过**，测试162711.7372毫秒，退出0且跟踪输入不变。回执SHA256 `da5ef5ca6af8480e405213954f7d2592fa1bc899991fdf06130f06c5a6909a48`。此前1045是旧时点结果，不冒充本次最终全测。
- 根生产依赖图5项零告警；含开发构建链的337项仍有低3/中13/高22，与旧最终1.1.16审计报告字节相同，不宣称全图零漏洞。新rc.2独立生产运行库603项各级零已知漏洞；仍核对最终包是否泄入旧构建链，详见 `artifacts/upstream-checks/2026-10-17/rc1/root-audit-review.md`。
- 双包 `artifacts/stable-readiness-20261007/dist-wktxIa/` 已真实生成，构建退出0、输入不变，回执SHA256 `f130e4e248731787b6e8a343ba4a61d5e9c470e5feb831678146f15864880c29`。Setup为319522171字节/SHA256 `26c51531de24115f55d0eb94b7ae401f2629ffd336902fc59101b190804eece9`；Portable为318736461字节/SHA256 `37f88096f7c394c8b1ab861cbd8550f3759bab0a9407e3d32ce2c1b165f1559c`。**这只是候选包生成，不是安装、便携启动验收或公开发布通过。**
- 两处extraResources已与新vendor一致，exe SHA256 `6220ebd29565ceed40bf887d331c71e66bf7413f094105376d020ba04a7b4f17`、ASAR SHA256 `3328df9add552707877c30c50ad2cdef0cf7a20d755c4debdcd2213d7183502f`。许可证生成得到613个manifest身份、11种license；代码独立只读复核在指定范围未发现Blocking/Important，不替代以下运行验收。

## 最终包实际验收及新阻塞（2026-10-18）

- `package-117-xPYkGe/report.json` SHA256 `9a39d96499c349de06dce9490acf1f4d15f7a34b28419a3ebea3ac9160ef49cf`：静态负载、Windows身份和治理全部通过。Setup、Portable和解包目录均16041文件/1147293700字节，树摘要 `e50fdbd98dadb5c0e452df84692b8b36d9b2655ded3867d1068142db387ec951`。`portable/payload-H3x4hE/report.json`（位于stable-readiness目录）SHA `d1f7a8b3737798357f4beb3fc948b51cbdf14f3b2fc1c1bf7bf19ebefe9c1f05`。实际包带pnpm11.19.0、skills xmldom0.9.12，无额外ASAR运行库副本。未签名、更新签名校验/渠道分离尚未完成，不宣称安全自动更新就绪；局部差分基线是本机1.1.16，不冒充公开1.1.14差分。
- 真实隔离Electron启动 `electron-harness-Ks0TSA` 成功；`electron-brand-Yhp6KE` 浅/深/窄窗口图片解码和精确选择器有效，但截图仍有首次使用弹窗，**不认定无遮挡交互通过**。`electron-layout-F4G4IX/smoke.json` SHA `9a72f915dfbcd5e4548765bcd6977a9b76a2a0d1b96f35c378f654e0055022ec` 在15秒门禁失败。根因为测试只识别旧预览/API Key弹窗，遗漏官方“开始使用 / Get started”账号选择弹窗；官方该分支在alpha.2已存在，不归因于rc.2新增产品缺陷。严格Close动作候选及26/26纯测试在 `onboarding-review-rc2/`，**仅提案，未改根代码或候选包**；未知登录态/模态框仍拒绝，不改inert、不写Key。
- 最终包Office/Wiki非UI fixture已通过：`office-wiki-final117/run/result.json` SHA `34d74105a37dbf1a4a69e3fca942a64e5dbdceb878931d0be36122747c7a82fb`。DOCX/XLSX/PPTX严格校验、备份逐字节回读，XLSX公式缓存300、PPT原生图表及内嵌工作簿通过；合成Wiki五个Skill、查询、索引和幂等通过。两驱动自然exit/close0、128选定输入不变；不代表Office视觉或用户真实知识库同步。
- 已代用户实际执行限定权限测试，无需再询问这一授权。`model/approval-allow-mdjOgR/smoke.json`（位于stable-readiness目录）SHA `d534788f85346bc968a388cb7896af199861d817a9cf3dfeff9ddcb8f3372af8`：真实模型下拒绝未写、仅允许一次写随机标记均通过，工作区权限预设未变；原加密资料摘要不变。整项controller仍 `ok:false`：主进程0但Job未清空，随后限定自己的Job清理；ACL后置校验拒绝。不得只引用产品smoke的ok。
- 无模型独立安全退出也失败：`artifacts/v1.1.17-safe-exit-Fs1Vc4/safe-exit.json` SHA `5547c393f88a3cd8b3779f0aaac72cad4653a4249b4f0f3dd5a51c3ffebd7381`。主进程exit0时Job仍有1个成员，15秒未归零；guardian SIGTERM是失败清理。进程累计清单出现搜狗/SGTool，但没有退出后成员PID证据，**不能认定它们就是残留进程或宣称Nahimic根因**。下一步只增加Job成员PID/创建时间/进程名诊断，不放宽超时、不排除输入法、不强杀用户程序。
- ACL只读复核确认253路径中81路径有301条不合规ACE，均在隔离合成home的搜狗/LocalLow/NVIDIA范围；原规则继续失败。应用profile129路径中的会话、密文Key、Local State未见异常ACE，正常Chromium网络能力项符合原规则；该轮无代理状态文件，不冒称其ACL已验。未读缓存内容，创建者和跨用户实际影响未证实。私有证据 `model/approval-allow-mdjOgR/ACL-REVIEW-20261018.md` SHA `7ccdaa177b85f573afbd6a1ffc5b72466a0811d1a7bcdec912442b21d842c8c7`。此新增搜狗/LocalLow风险不属于此前仅显卡缓存和正式上级目录的接受范围；已单独询问，未获新决定前不覆盖安装。
- 备份/安装/资料保留的最小1.1.17工具副本与24项纯契约测试已准备在 `install-review-117/`，仅准备、未访问正式资料、未安装。代理sky原生交接提案已准备但未执行；不能借旧PowerShell UIA或旧包的通过来替代当前包验收。

## 当前仍未通过的门禁

- 根源码已取得上述最终1045/1045；原 `root-final-202646/test.log` 的driver-state等待5秒超时保留。未改代码的11/11补测和`guardian-startup-observation-XFtQVg`一次2.137秒自然启动，仅提供诊断，不证明旧失败原因，也不替代实际桌面退出验收。
- 新生产锁已独立审查且冻结离线安装、603项审计和实际运行库通过；11个registry provider只是在所选闭包各有唯一版本，不代表整个官方锁只有一个版本；新增optional peer不自动安装。
- 首次候选中loader 1.0.6的peer范围被parent override收窄，已由上述23条最小修正闭合；新锁保留来源的 `^0.1.9` 及optional语义，未增加metadata例外或修改TGZ。
- 固定Node下的rc.2原生加载、完整Office、受限PTY和认证Host已取得上表真实新证据（原生结束于2026-10-17T15:59:10Z，Host结束于16:10:46Z）。仍须完成Electron/完整桌面真实Key与代理、最终源码/交互、Setup/Portable、覆盖前备份及安装态资料/密文/权限保留、CI和公开下载。
- 旧 1.1.16 隔离退出/停止后历史/ACL 缺口未因本轮源码成功而消失。只承诺已验 Windows 11 x64；签名、其他电脑和长期老化仍按实际披露。

## 继续位置

直接复用本页已成功的rc.2来源链、运行库、1072全测、新双包和限定权限行为证据。先等待新增搜狗/LocalLow环境风险范围决定，并补充Job成员观测、收口onboarding测试契约；修正后仅对受影响代码及最终包重新验收，不重做内核来源链。不把已批准的随机标记权限测试再向用户索要授权，也不把新风险自动纳入旧批准。其后完成实际代理/交互/Portable/正常退出→备份覆盖及资料保留→公开Pre-release与下载验证。正式证据入口已最小增加prepare-schema2/receipt-schema1显式分支，122/122定向回归及独立审查通过，旧分支和后续门禁保留。Stable不自动更新。

本轮没有删除产物、修改主机权限、强停用户程序、覆盖安装或发布。Obsidian 同步结果单列在 PROGRESS/VALIDATION 的事务回执中；未取得回执前不声称知识闭环完成。
