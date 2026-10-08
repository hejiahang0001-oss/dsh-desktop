# Harness 0.2.1-alpha.1 隔离构建与兼容验证（2026-10-06 晚间）

## 范围与状态

用户“继续”沿用本轮限定提议：允许隔离依赖安装、源码构建和兼容验证，不等于批准残余安全风险、替换正式 vendor、覆盖安装或公开发布。继续同一 V1.1.14 / lulu 候选。正式 Harness 仍为 0.1.6-alpha.2；没有操作已安装程序、真实 Key、会话、代理或发布通道。历史安装 V1.1.13、Stable V1.1.12 状态本轮未重新验收。

固定官方标签 `dsh-v0.2.1-alpha.1`、提交 `5badb15009ae1756c3afe0ae0cef1faafc290ccc`；项目 Node 24.19.0、源码 pnpm 11.7.0，桌面根 pnpm 11.19.0。源码目录 `artifacts/harness-021-final-replay`，不调用会写正式 vendor 的 `runtime:deploy`。

## 本轮必要变更

新生产审计发现 [source-map-js 公告 GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)（10 月 5 日复核）；1.2.1 存在恶意 indexed source map 的资源耗尽问题。只将该包固定为官方 [1.2.2](https://github.com/7rulnik/source-map-js/releases/tag/v1.2.2)，五个现有消费者版本范围均兼容。不改 Agent 循环、产品功能、权限和资料语义。

- 校验 npm SHA-512 / SHA-1 与 tarball；新包 SHA-256 为 `05c8cf8e7c3a6b56cada7668fe9342b10f4b625efc92aba9ba05b9e8fe4d71a3`。
- 4 个变更 JS 文件与发布提交 `0a1d334fd1e55a47df97fcd60a7915d46df3b08a` 相符；该发布也含 CSP 修复，不伪称只有一行改动。
- 每版本 10 个有界、无网络包级探针：1.2.2 十项通过；1.2.1 六项预期失败、四项兼容性通过。主线程独立复跑 20 个比较结果全部符合预期；旧版嵌套场景 2.5 秒超时后仅终止自建子进程。不是实际产品可利用性证明。
- 首次非零列 indexed fixture 在两个版本上都与原期望不同，原失败留存；改为共同支持的零列兼容对照，没有宣称修复旧版共同存在的该行为。
- lock 只新增精确 override、包版本/SRI、五处引用和快照键；规范化回旧值后逐字节等于旧锁。原四处源码补丁与供应链 release-age 政策未变，17 条精确覆盖。
- 写前备份：`artifacts/harness-021-build-20261006/before-adoption/`；独立审查 `review/adopted-source-map-inputs-review.md`，reverse patch check 通过。

新固定输入：

| 输入 | SHA-256 |
|---|---|
| lock | `520a36d57508c9069350c6fb67879c3396f451b7e0bd0e6732ed15294d8c8331` |
| workspace | `a40c4ead404e001449c8ae2629ca61dff4f5af1e1a0c41ee23611cd6853fc50b` |
| source.patch | `2737cdaa6e188847b43f6311dfceab7a7a16109c5b2fd2c9ce7a66264e66925d` |

## 实际执行证据

证据根 `artifacts/harness-021-build-20261006/`。执行器 `run.cjs` 校验精确来源/输入摘要、隔离 HOME/TEMP、拒绝根 `.env`、不继承真实凭据或代理、不使用模型、记录真实子进程 close/exit 及前后摘要。包导入为 copy，避免共享硬链接被构建写入。

- 原锁冻结完整安装 `install-8zUlzg`：exit 0；1,687 项供应链校验通过。安装的是隔离构建依赖，不是桌面应用。
- 原锁第一次完整 `build:official`：`build-KdtlZE`，11:16:42–11:24:46 UTC，exit 0，355 个客户端产物、4 个公开值，输入不变。Windows native-system 为官方 no-op，不冒称编译出 POSIX 原生件。构建警告保留。旧 source-map 锁的成功不替代修复后验证。
- 原锁生产审计 `audit-gv0JyW`：662 项，2 high，exit 1。
- 新锁生产审计 `audit-LdjqOa`：11:31:46.836 UTC，662 项，1 high，exit 1；source-map-js 告警消失，但 HCS 保留。profile 的 `promotionAllowed=false`、security blocked 不变。
- 新输入准备器专项：14/14，0 fail/skip，exit 0，12,177 ms；包括硬链接/目录链接拒绝、用户改动保留及失败回滚/并发保护。
- 新锁冻结安装 `install-BBk2S7`：11:31:22–11:35:53 UTC，exit 0，1,687 项供应链检查通过、输入不变；但结束后 Windows Office 原生可选包缺失，见下文。
- 新锁完整构建 `build-XGC3CJ`：11:36:23–11:37:56 UTC，exit 0，355 个客户端产物、4 个公开值，输入不变。
- 6 个独立叶子校验全部 exit 0：DSH 321 包、vendor 9 包的发布版本/排序；运行时 4 preset / 185 workspace 包闭包；唯一 dsh Node 启动入口；63 客户端包（58 动态/5 静态）；无可选依赖静态加载。最后一项只检查导入语义，不证明 Office 可选负载存在。
- 迁移全链首轮 `migration-g636N9`：59 文件、1,930 项；1,906 pass、14 fail、10 skip，exit 1。14 项均触发原 5 秒 timeout。此轮与后段 TypeScript 静态叶子检查有并发，不能排除本机负载影响。
- 仅复跑失败的 4 文件 `migration-recheck-LacK8H`：单 worker、5 秒原限制、原源码/断言不变；414 项中 413 pass、1 原有 skip、0 fail，exit 0。按文件名和案例名逐一匹配，原 14 个失败全部复测通过。仍保留首轮非零证据，不伪称有一次全链全绿；这证明专用串行条件下未复现，不证明已定位具体硬件/调度根因。
- 原 10 跳过为 9 项 POSIX flock/inode 语义（Windows 官方 skipIf）及 1 项 none 编码不适用的损坏压缩帧测试；没有新增跳过。Windows 锁单测 11 项实际执行通过。
- 编译产物 `built-JNXUqL`：7 文件、8 项，6 pass、2 fail、0 skip，exit 1。真实迁移 worker（成功/计数拒绝）、两进程写锁与持有进程崩溃后接管、源码/编译 runner、父子 scope、present 错误码均通过。两个 headless/source-shell 用例各依官方配置执行初次及两次重试，均返回无输出和 `3221225477 (0xC0000005)`，未得到 `CLI_TOOL_ROUND_TRIP`；不可当作工具执行成功或 sandbox-unavailable 允许分支。
- `result.json` 收集上述 15 次执行的真实退出/摘要和逐项测试状态；5 份正式配置/绑定输入与早间摘要完全相同，4 份新候选输入匹配 profile。所有上述构建/测试进程均已结束。

## 新发现与诊断边界

### Blocking：新核真实 PowerShell 工具路径异常

触发：空白隔离 home、官方 headless Loader 调用实际 Windows shell 工具。影响：两个严格 e2e 无法完成命令往返；即使源码能构建也不能晋升为可用新内核。当前退出码是观察事实，不把它直接归为权限、代理、杀毒或某个源码缺陷。

下一修复前先对比同环境直接 shell、官方 pwsh-local 与沙箱/runner 链，识别真正失败层；不关闭沙箱、放宽权限或改错误为成功。修复后须原两项严格用例通过，并保留失败对照，再接实际 lulu 宿主与交互。最小诊断材料位于 `shell-diagnosis/`，只有实际记录的对照才可升级根因结论。

已完成有界对照（每子进程25秒、真实close）：resolver实际选取的 Codex bundled pwsh 与系统 PowerShell5.1 直接调用都 exit0；官方 read-only restricted-token runner 运行 cmd 为0，而两种 PowerShell 都以0xC0000005退出。锁、workspace、resolver和runner摘要不变。不能只归罪于 Codex 附带 pwsh 的版本或位置。

追加一次官方 AclSandbox 原 API 的原生子进程 PID 取证：系统 PowerShell PID34284，11:49:43.179–11:50:02.310 UTC，退出0xC0000005。Application Error1000 的PID、路径和时间匹配，record120259故障模块为 NahimicOSD.dll2.2.25.0、offset0x14aa0，随后record120261为clr.dll。由此确认该叠加模块参与这次受限PowerShell崩溃，但不能断言是唯一根因或停服务必然修复。

只读核实 NahimicService 正运行、启动类型Auto。用户随后明确允许临时停止服务、一次对照后立即恢复，不卸载、不改开机启动、不关闭沙箱。主线程以 `temporary-service-check.ps1` 尝试时，当前进程非管理员，StopService 返回2（[Microsoft 定义：缺少必要访问权限](https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/stopservice-method-in-class-win32-service)）。未运行停服务后的探针；finally核验前后仍是Running/Auto、同一PID5532，系统状态未改。

实际证据为 `shell-diagnosis/service-check-27966c241246411cb22d99f9624d797b.json`，11:53:22–11:53:23 UTC，脚本exit1。`shell-diagnosis/REPORT.md` 保留停服务前冻结事实。当前缺的是 Windows 管理员执行权限，不是用户意图确认；不反复询问相同授权，也不自动提权绕过。需要用户在管理员PowerShell运行本轮脚本，它精确核对服务身份、try/finally恢复原运行状态并验证StartMode不变，探针有25秒限制。后续只根据真实子进程退出及sentinel判定，不以采集脚本exit0宣称Shell修复。

### Blocking：Office 原生可选包缺失

两次安装日志均有同一 Office tarball 的 error(23)/重试并最终 exit 0；第一次未保存即时负载快照，不推断其最终是否齐全。第二次安装结束后两次从 JS kit 锚定解析，Windows native 包及 package.json 均 `MODULE_NOT_FOUND`；对应 virtual-store 目录为空。固定 pnpm 对 optional fetching 错误允许 return，因此不能以 exit 0 验收此功能。Windows kit 要求 native，未证明可回退 WASM。

`review/office-optional-install-gap.md` 记录 pnpm 路径和解析证据。数字 23 来自日志压缩字段，未证明它是 CURLcode；小请求 HEAD 200、Range 206 不等于完整获取。

随后一次完整独立下载在 120 秒 / 100 MiB 上限内成功：89.419 秒，71,367,942 bytes，官方 SHA-512/SHA-1 匹配，主线程复读 SHA-256 `5cc9051e7d29a6dfe409bb3dbfcb931cbb1591709d83b84b404faf319a64d0ae`。包在 `review/office-full-download-WmskXU/`，没有解压、执行、补装或改共享 store。未复现原 error(23)，其原因仍未知；完整下载成功不等于依赖已补齐或 Office 功能通过。

后续从已校验包评估固定 pnpm 的隔离补装流程，保持冻结锁/供应链政策并核验实际 native 负载；再验证受控文档转换和现有校验备份语义，不以移除引擎绕过用户“保留完整能力”的决定。

`review/office-offline-recovery-review.md` 已排除“store add file:<tgz>后直接用registry锁离线安装”的不可靠捷径：pnpm11.7索引绑定摘要及pkgId，file身份不等于registry身份。该评审仅提供精确registry包入库/缓存检查的后续命令，没有写store或补装，也不能把offline标志当作无条件网络封禁。

## 官方复用与桌面保留

继续直接验证官方会话格式链、JSONL 持久化、写锁、PowerShell 与编译产物契约；本轮不新增重复实现，也不因名称相似删除不同安全语义的能力。软件优先加密 Key、代理、Office/Wiki 校验备份、Git Review、Windows 宿主保护全部保留。本轮不改 lulu UI 或重跑已有效的早间缓存专项/旧正式内核全量桌面测试。

## 未关闭门禁与下一步

`http-cache-semantics@4.2.0` 告警仍在；4.3.0 的审计消失但行为未满足要求，不采用。早间默认事件导出缓存不可达只覆盖限定路径，不等于完整产品安全豁免。Office 0.1.5 精确来源对应、角色公开分发授权均保持待核实。

本轮是隔离源码验证，不是完整新核适配。下一顺序调整为：先解 Windows shell 异常及 Office 原生负载缺失，再扩大 Windows 单元、实际新核宿主/插件、会话重启与默认自动化、软件 Key/代理、lulu 真实交互、模型、Office/Wiki、Setup/Portable、安装资料保留和公开下载验收。已完成的源码构建/输入保护/有效叶子不因每日触发从头重复。没有候选桌面安装包或 GitHub 草稿/公开交付，Stable 不动。

Obsidian 按 wiki-update 同步既有 DSH 项目，结果以 `artifacts/harness-021-build-20261006/wiki/main-verification.json` 的实际存在及内容为准；本页不能单独证明同步已完成。同步完成也不等于发行完成。
