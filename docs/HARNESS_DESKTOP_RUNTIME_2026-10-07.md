# lulu 0.2.1-alpha.1 桌面运行库装配

本轮接续私有 PowerShell 7 验收，继续同一 V1.1.14 候选，不另开版本。正式内核、已安装程序、公开发布与 Stable 均未切换。用户资料、Key、代理及系统音效服务未改。

## 固定输入与官方复用

- 2026-10-07T11:10:25Z 核对官方 Releases / 标签：最新仍为 `dsh-v0.2.1-alpha.1`，提交 `5badb15009ae1756c3afe0ae0cef1faafc290ccc`。不采用未发布分支提交。
- 候选 profile SHA-256：`d2fc99e31af460d331086fd24d7bf34846e226219f75e6f3977d9444f7b25909`；源码补丁 `793617936b76cc3a630b8e8eaa22043dfd727f3e38dd8e008f91fb76b94f77e3`。与上一轮 `build-O4JmVk` 成功构建逐项匹配，未重新构建相同输入。
- 使用官方 release pack、私有 Host 打包、native entry 打包和 `selectDesktopPackageClosure`。不继续将旧装配器的包数手改成新值；不复用官方 Electron 身份或覆盖 lulu 用户资料。
- 官方 `prepare-dsh` 顶层会清理输出、重新解析生产锁及准备另一套运行时，不能原样运行。复用其窄函数，另外保留我们已审查的安全依赖、完整 Office 引擎及私有 PS7。

## 已执行与保留的失败

1. `artifacts/stable-readiness-20261007/official-pack-DKlTwt/result.json`：六阶段全部真实退出 0，源码/锁/补丁前后不变；实际生成 321 个 DSH 包、私有 Host、9 个 vendor 包及 native entry，官方选择器输出 **289 个本地运行库包**。清单 SHA-256 为 `a6b105927126b7e25c9fc47787636921ff85f16d445d7a079ee65399fe636cc6`。这是运行库输入，不是 Setup/Portable 安装包。
2. 官方桌面装配专项 `desktop-assembly-jgsyOV`：9 文件 / 86 项，84 通过、2 项原 5000 ms 限制超时。打包结束后原文件原条件串行复测 `desktop-assembly-recheck-0VnaNs`：3/3 通过，未改断言、源码或超时；不将两轮拼成首次全绿。
3. 生产锁准备器先逐包核对真实 tarball 的依赖、peer、optional 和 workspace 打包改写，再复用官方 metadata。精确保留候选 registry 完整性、安全版本及补丁；8 份补丁全部归档，只有实际可达补丁进入生产配置。仅 Windows 专用构建配置排除 4 个非 Windows 的 node-addon-system optional，未改包本体或 Office optional。
4. `lock-BUSOnk` 首次离线解析失败：隔离 HOME 未共享已有 registry 元数据。包 store 存在不代表 metadata cache 可见。固定本进程 cache-dir 后 `lock-5RkeuS` 退出 0；无全局设置改动。后者报告 downloaded 0；前者的 289 次下载计数对应本地 `file:` tarball 导入，不能将 `--offline` 等同于已经观测证明零网络。
5. 第一份派生锁 SHA-256 `ad6cedae4a24c8da87a39440ac490f71316ef1c745b870bac07a04067f2905d7` 未通过完整语义验收。首次校验发现 pnpm 将 `file:./desktop-packages/` 规范化为 `file:desktop-packages/`；后续完整差异检查发现 `autoInstallPeers:false` 下 SDK、supports-color 及 sharp 的类型 peer 供应不足。未改旧目录 `derived-3OXCd8` 的 metadata、锁或原始 evidence，也未靠忽略 peer suffix 放行。

## 生产锁语义验收

- 新建 `artifacts/runtime-assembly-20261007/review/derived-Mp2zL7`，明确供应原候选锁已有的 `@modelcontextprotocol/sdk@1.31.0`、`supports-color@9.4.0`、`@types/node@22.20.0`。这是保留已验依赖上下文，不是增加产品能力、升级依赖或改变 sharp native 负载。
- `lock-yRRfi2` 退出 0；最终锁 SHA-256：`fd7bb776b899da07e2754585a9a8700c453f6a207d05e7168bfa417a14d4f1f5`。2026-10-07T11:26:10.860Z 的 `derived-Mp2zL7/lock-verification.json` 记录实际 verify 退出成功、289 个本地包、378 个 registry 节点、3 个生产补丁，源输入未变，且明确 `installAccepted:false`。
- 原 registry 节点 378 → 378，新增与缺失均为 0；版本、tarball SRI、patch hash 及非 peer 元数据没有漂移。共有 **16 项 peer metadata 编码变化、13 项 snapshot/context 编码变化**，不是原 snapshot 字符串完全不变。校验采用固定的逐项映射，不全局裁剪或忽略 peer suffix。
- SDK1.31.0 原包同时声明 own dependency 与 peer `zod`；pnpm 在本生产配置下去重 peer，实际 required `zod@4.4.3` 保留。ajv-formats3.0.1 同理保留 own required `ajv@8.20.0`，由原 optional peer 改为 required；任何遗漏或版本变化仍拒绝。其余 context 变化来自既有 supports-color9.4.0 的祖先传播；底层 debug→supports-color 原边没有新增版本。
- debug2.6.9、debug4.4.3 与 sharp0.35.5 的 meta-only optional peer 保持原 `*` 及 optional 标记。Local peer 的预期分类由 **重新核验 SRI 后的 289 个真实 tarball manifest** 及原 source importer 构造，不从实际派生 snapshot 反推；optional/meta-only 边仍必须完整存在。
- 校验器正常/拒绝矩阵 **34/34 通过、0 失败、0 跳过**，主线程已独立重跑确认。覆盖实际完整锁以及 SDK/zod 丢失、AJV 错误分类、未知 context、SRI 漂移、optional/meta-only 边遗漏、HCS patch 丢失、根依赖重定向等拒绝情况。
- 失败证据全部保留：第一份目录中的 `validation-failure-file-prefix.json` 与 `derived-initial-differences.json`；第二份目录中的 `validation-failure-sdk-duplicate-peer.json`、未规范化的 `derived-initial-differences.json`、分类修正前后的完整差异矩阵。逐例依据见 `artifacts/runtime-assembly-20261007/review/FINAL_LOCK_REVIEW.md`。

## 隔离生产安装与审计

- `artifacts/runtime-assembly-20261007/install-fYtjRD/result.json`：固定 Node 24.19.0 / pnpm 11.7.0，`install --prod --frozen-lockfile --offline --ignore-scripts --package-import-method=copy` 实际完成，退出 0、child 已 close、全部准备输入与生产锁摘要不变。日志 reused 601、downloaded 0、added 602；未执行生命周期脚本。这里只安装隔离依赖，未覆盖用户应用。
- `audit-OAigNr`：595 dependencies / 72 optional / 667 total，info/low/moderate/high/critical 均为 0；审计退出 0，锁与输入不变。零告警不代替 native/交互验证。
- 物化器首次扫描把业务类型声明 `dsh-spill-policy/lib/types/notice.d.ts` 误认为许可文件，尚未复制即失败。失败见 `payload-review/notice-preflight-failure.json`；只修声明/source-map 与官方过滤原因精确匹配的文件例外，NOTICE.txt、LICENSE、COPYING 等仍拒绝省略。7/7 回归通过，主线程独立重跑确认。
- 随后全树只读枚举 31,296 项，官方规则下计划复制 14,172 文件、省略 13,361 项，624 个许可命名项保留；被过滤的同名项只有上述 1,082 字节声明。枚举与物化不改变安装锁或正式运行库。

## 可分发运行库与退出保护

- `payload-review/materialized-On9oL4/result.json`：复用官方文件过滤、manifest 清理及运行库 descriptor，生成独立、无链接的 **14,173 文件 / 387,504,989 字节 / 289 shared packages** 运行库。整树校验通过，Office 733 文件摘要保留，源码及构建输入不变。descriptor SHA-256：`6213b8fcb71900eb1495ebde1b4e93e50f190691b65874f2dea091cb8774216a`。
- 这是 `artifacts` 内的可分发文件树，不是安装包，也没有替换正式 vendor。独立校验禁止把源工作区依赖当作打包态依赖、禁止遗漏 Windows Office、保留许可文件。
- `scripts/smoke-packaged-safe-exit.cjs` 窄修：ready 超时或返回无效身份时，关闭本次创建的 guardian 并等待真实 close；Job 句柄关闭清理其 owned 子进程。仅关闭 stdin 并不能停止旧 guardian 的循环。预先观察尚未提供给调用者的拒绝 Promise，避免失败报告被 unhandled rejection 打断；正常接口保持。
- 新 `test/packaged-job-launcher.test.cjs` 4/4 通过，主线程独立重跑确认 timeout / invalid identity / spawn error / normal 路径；这是模拟失败路径验证，不冒充真实 OS 进程树验收。完整源码回归另行记录。
- 原生验证器的取消门禁同时收紧：必须取消返回 true、ready/running、在 10 秒内返回并可继续输入；拒绝 20 秒自然结束、命令回显冒充实际输出。2 项纯门禁测试通过，不等同实际 PTY 已验。

## 本轮实际回归与组件结果

- 根 `pnpm test`：`source-tests-7cKbFt` 实际 710 项 / 707 pass / 1 fail / 2 原有 skip，319.9 秒，输入前后不变。唯一失败为认证 fixture 记录了两次 token 重试，而断言期望一次；不涉及 Key 泄露，日志中的 token 是固定合成测试值。源码与超时均未改，原失败文件独立复测 `auth-recheck-mODeUv` 4/4，327 ms；首轮全量仍记录失败，不合并成“710项全绿”。
- 后续确认生产 `establishHarnessSession` 本来就允许认证 transport 重试；首轮日志没有错误时序，不推定唯一原因是 2 秒 timeout。仅 `test/harness-session-read-host.test.cjs` 改为阶段顺序断言：token 可连续重试、probe 可连续重试、inventory 仍严格一次；Cookie、history 仅 IPC、跨 origin 拒绝仍保持。新增 3 允许/7 拒绝矩阵及 token/probe 两种确定性单次失败重试。`auth-retry-regression-aa25bc00` 红测 4 pass/3 fail、绿测 7/7；主线程独立重跑 7/7，291 ms。生产认证文件/超时未变，测试 SHA `80bb408adfb55986b4230e11022d07dfef43d346425c179732916cb0390765c8`。
- 修正后的独立完整 `pnpm test`：`source-tests-zUHqQ7/result.json` 实际 **713 项 / 711 pass / 0 fail / 2 原有 skip / 0 cancelled**，278.7 秒、exit0，child 已 close，准备前后源码快照一致。pnpm 测试选择的 Codex Node 与项目固定 Node 24.19.0 字节摘要一致，仅作测试执行器，不纳入产品分发。此前 710 项首轮失败及 4/4 原条件复测继续保留，本轮通过不改写旧结果。
- 新 Job 四项失败路径 mock 和既有 Windows Job 实际退出/driver终止/后代清理用例均在上述全量中通过。另一个并行专项曾在 Add-Type/csc 清理阶段挂住并被有界终止，13 通过/1 文件级失败；仅清理其精确测试进程，未改音效服务。这一并行专项来自子代理工具输出转述，没有单独落盘原始日志，不能冒充可独立复核的原日志；其失败不替换主线程有文件证据的实际 OS 验收结果，也不抹除。
- `payload-review/native-LYK6PD`：实际新树通过 HCS 强制重验证/MCP exports、sharp 像素编解码、Office DOCX/XLSX/PPTX 原生转换、只读/ConstrainedLanguage PTY 中文、取消及下一次输入。取消 858.63 ms，下一输入 230.26 ms，无运行器参数替换。8 个 Job 进程全部退出，activeProcesses=0、guardian exit0。
- 原生分组首轮 4/5，通过项目不得被唯一失败掩盖，也不得算整组全绿。失败为 `node-addon-require-builtin` 的官方缓存物化被测试 hook 拒绝。四组对照确认源与缓存同 SHA `e23ba1b0c33c63940625aa954011b53c66d855f7dfac75b29c829b25e06f20df`；原缓存+原 hook 失败，其余源/无 hook 对照可加载 internal loader，非 Node ABI 或负载缺失。后续仅对精确、同摘要私有 native 缓存放行，其他模块边界保留。
- Office 内容复核只读取已生成 PDF，未重复转换：`native-LYK6PD/pdf-content-verification.json` 核对 **Word 2 页、Excel 1 页、PPT 3 页**、全部中文标记及 Excel `123.45`。Aptos/Aptos Display 缺失记录保留（发生字体替代）；这不等于任意用户 Office 文件视觉完全一致。
- 首次消费者预检还发现 CJS resolver 不能解析 pi-ai 的 import-only exports。按真实 import/require 模式修复测试器，12 个解析边与 3 项回归通过，未改新树。SDK 仅明确为 genai 可选 peer 的入口可达，不声称生产实际调用。真实保留文件 263 项原字节一致、4 个 manifest 按官方清理一致、595 个声明/map按官方省略；完整 Office 733 项另验。

## 实际原生与宿主验收通过

- `payload-review/native-7DS2eI/runtime-verification-report.json`：窄修测试 hook 的官方 native 缓存规则后，**五组实际原生验证全部通过**。缓存只允许官方 loader 加载、路径各级无链接、源与目标均为单链接普通文件且 SHA 相等的精确 `.node` 文件；未放宽任意外部模块加载。新树、descriptor、准备输入前后不变。
- 五组覆盖 HCS 强制重验证/MCP exports、sharp 精确像素编解码、Koffi/Windows builtin internal loader、DOCX/XLSX/PPTX 原生 PDF 转换与内容回读、真实只读 CLM 终端中文/取消/继续输入/dispose。8 个 Job 进程退出，root exit0、activeProcesses=0、guardian exit0。Office 页数 2/1/3、中文与数值通过，Aptos 字体替代仍明示。验证范围是固定 Node 24.19.0 的物化 Windows 原生组件，不是 Electron UI 或用户安装态。
- `host-review/acceptance-fCq5dy/report.json` 绑定已通过的安装、物化、原生证据和实际锁摘要；报告 SHA `ef355fc85dbb3c15a005c70e1099391b0289e3e397d20ae3037d0956f10a4a81`。没有由启动器退出码推定组件成功。
- `host-review/run-EjGTcp/result.json`：2026-10-07T11:57:00Z–11:57:15Z 真实启动隔离新核。使用正式 Supervisor 的 artifact 副本，唯一代码差异为版本常量 `0.1.6-alpha.2 → 0.2.1-alpha.1`；驱动固定正式 process-host、私有 PS7、loopback/random-port、隔离 HOME/工作区。认证及只读插件、创建空会话、重启后恢复同一会话与 history 摘要全部通过。合成会话 3 events、throughSeq=2；模型请求 0，不使用用户 Key 或资料。
- 两次持有的 process-host 对象都已观测退出（停止后的 exitCode=1 原样记录，不冒充自然退出0）；Supervisor 已请求 owned tree 停止。驱动没有逐个跟踪所有后代退出，故 `descendantExitIndependentlyObserved:false` 保留。主线程随后独立读取 `Win32_Process`：`host-review/run-EjGTcp/process-readback.json` 在 11:58:20Z 未发现包含本次唯一路径的 node/pwsh 进程；这是单时点残留检查，不是所有后代全生命周期跟踪。运行库全树与源输入最终均未变。

## 仍需完成

官方闭包/生产锁、冻结安装/审计、无链接运行库与实际 native/完整 Office、隔离宿主认证/会话恢复及当前根源码全量均已完成。本轮不从头重做这些有效验收。接下来：正式 Supervisor 与打包接线及对应回归 → 完整 UI、真实模型与 Key/代理/Office/Wiki/Git Review → Setup/Portable、覆盖前备份及安装态资料保留 → 根据用户既有授权与全部发布门禁判断交付。没有本轮 Stable 发布动作。

旧 Supervisor 的版本常量和 PS7 注入确有接线差距，见 `artifacts/runtime-assembly-20261007/host-review/REPORT.md`；隔离适配器已验通过，不代表正式桌面已经换核。正式 pin 仍未修改，profile 的 `promotionAllowed:false` 未绕过。多轮历史分页/迁移、完整模型操作、签名、其他电脑和长期老化不能由空会话 smoke 推定。

## 知识与交付状态

本记录为本轮 Wiki 同步的冻结来源；实际写入及独立回读结果由 `artifacts/runtime-assembly-20261007/wiki/final-verification.json` 记录，并回写 PROGRESS/VALIDATION，不能仅凭本段认为已同步。没有下载新官方版本、覆盖安装、GitHub 资产上传或公开发布；本机显示旧版本仍符合实际状态。
