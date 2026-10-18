# lulu 私有 PowerShell 7：来源、隔离验证与产品接入

2026-10-07。继续同一 V1.1.14 / Harness 0.2.1-alpha.1 候选。用户已明确允许把微软官方 PowerShell 7 作为 lulu 私有运行时；不是复制 Codex 私有二进制，不改变系统 PowerShell、全局 PATH、音效设置或沙箱权限。Stable 未晋升。

## 固定来源与完整性

- 微软官方 `PowerShell/PowerShell`，`v7.6.6`，提交 `f260eb9c31ec72c5282f98e5ea24d9be4f8d7536`，tag object `fe2f984794c6e67ba4d61722ce4b09256b0ec363`。Release ID 385023724 / asset ID 551207033。实际运行版本 7.6.6 Core X64 / .NET 10.0.12。
- 官方 ZIP 106328873 字节，SHA-256 `02fe458be20493fbdf43f61ea20610b811ee6c738ab1676c61b9cfcd1a33c860`；658 原始文件，展开 256625143 字节。101.4031 MiB 是 ZIP 体积，尚不能据此声明最终安装包增量。
- `pwsh.exe`、System.Management.Automation.dll、hostfxr.dll、coreclr.dll 四个签名均 Valid Microsoft；带时间戳。Git tag 本身 unsigned 是另一事实，不能混同 Authenticode。
- 完整负载保留 MIT LICENSE.txt、ThirdPartyNotices。可信应用 profile 固定整个 manifest SHA `2c50c31fc5b7ed15cab154bbfe3255749fb37f6b44cd62c8bfa7aede0508d5c4` 和 exe SHA `bfb46af89433268872ddb43d1ca7a3f433452ee91ed356a9786940f90118e285`。拒绝缺失、额外 DLL、篡改、大小写碰撞、目录链接/硬链接及路径逃逸，不回退 PATH。
- 来源证据在 `artifacts/powershell-runtime-20261007/REPORT.md`、`acquire-8b5a5bc32b08495586eb99e6d60c2e07/`、`verified-NEoWpH/`；ZIP 防护 17/17。第一次传输被误判停滞并中断，104953208 字节部分包与失败更正保留；不能由 Windows 未关闭文件的实时长度推断网络无进度，后续没有第三次完整下载。

主线程独立复验并复制至新私有目录 `vendor/powershell/7.6.6/win32-x64`；658 文件全摘要一致，source resolver 成功（`artifacts/powershell-host-20261007/real-payload-Mobfjj/`）。这不是本机已安装程序的替换。

## 原权限下的单变量结论

| 条件 | 实际结果 | 结论 |
|---|---|---|
| 微软 PS7，无前导、原 ACL/Job，无额外缓解/console | 0xc0000005，无输出 | 换版本本身不修复本机崩溃 |
| 仅加 extension-point 创建期缓解 | 不崩溃，但 PowerShell stdout 仍 CP936，emoji 丢失；修正探针后 ERROR_COUNT=0 | 防注入与编码是两个问题 |
| 再加独占隐藏 console，确认只有 runner PID 后设 65001；无编码前导 | 中文/emoji、native stdout/stderr、管道精确 UTF-8 无 BOM、CLM、ERROR_COUNT=0 | 有效组合；不能省略权限/退出验证 |

探针曾有 `$Error.Clear()` 被 CLM 禁止，已移除并单独重跑；这是夹具错误，不作为修复产品的成果。证据分别是 `baseline-P8DYG8`、`baseline-mitigation-Cq1xyD` / `baseline-mitigation-7y6Ptu`、`baseline-mitigation-private-6guaod`。主线程使用私有 vendor 的同摘要 exe 独立复跑 `baseline-mitigation-private-OK9Eju` 通过。均在 `artifacts/powershell-shell-20261007/`。

组合矩阵 `matrix-mitigation-private-P7bj7S` **10/10**：实际 scrubbed env、cwd、中文错误 exit7、只读拒绝写入、工作区授权写入、文件重定向无 BOM、CLM 类型构造拒绝、直连/显式/环境代理、kill-on-close 与真实 LocalSubprocessRuntime abort/terminate 后所有已知子进程退出。ACL 只约束写入，不把读访问/网络说成被隔离。Nahimic 始终 Running/Auto、共享 console 及候选源码摘要前后一致。

真实官方 Context/SandboxPolicy/LocalSandbox/LocalSubprocess/SandboxPwshExecutor/tool-pwsh 的限定接缝 **7/7**（`harness-RX5NUN/evidence.json`）：中文/CLM、工具结果、非零退出/错误呈现、拒写、无 approver 升权 fail-closed、timeout 和 caller abort。这里仍通过 artifact 子类去前导、诊断 preload 承载缓解；没有用它替换正式插件，也不称为完整产品接入。

## 产品代码与打包部分

新增固定源获取脚本、profile、`electron/powershell-runtime.cjs` 完整性解析器；大小写不敏感清除继承/overrides 中的 `DSH_DESKTOP_PWSH`，尚未给旧正式内核注入该值。

package.json 已列入私有资源及 app.asar 内可信 profile。afterPack 增加核对 app.asar 中 profile/loader 字节及完整负载的门禁；不允许只打包 exe 或把可信清单放在 DLL 旁即视为可信。解析器及打包/相邻发布测试 **26/26**；真实负载+小型 app.asar 的打包叶子 `package-leaf-de7P6M` 正向通过，篡改其自建测试副本后正确拒绝。它不是完整 Electron 构建、Setup、Portable 或安装态测试。开发时遇到 asar Windows 路径分隔符错误，已按实际库 API 修正并复测，未放宽断言。

后续采用窄 source.patch：用户显式 shell 路径优先，已验私有 PS7 只作为默认；仅最终选到同身份/摘要的私有 exe 时省去旧编码前导。保留官方 ConfigEditor、timeout/output-budget 保存、审批、Job、取消、输出分类。不覆盖整个高优先级 config，避免用户设置保存被 overlay 阻断；不复制官方终端实现。

## 接入审查与真实组合复验

上段“省去前导”必须同时满足**实际 provider 返回专用原生选项、完整尾部 argv 未变**。不能只凭配置为受限模式或调用过 confine 判断。FullAccess 的真实对照 `powershell-shell-20261007/fullaccess-cc8JBf` 证明：省前导为 CP936/emoji 乱码，保留官方前导则 PowerShell/native stdout/stderr 与管道精确通过。自定义 runner、其他 provider 和显式其他 shell 路径保持原语义。

原生非交互提案 `powershell-native-proposal-20261007/review.patch` 固定 `ef57882217f15654a1d2b1be4600975fdfc6f8f82a3611b17a1453c8511a970f`，40/40 + 严格20文件通过，实际独立 runner `real-C8nP5L` 成功。新进程保持 restricted token、挂 Job 前暂停、成功分配 Job 后才恢复；创建后清理失败不先执行命令。控制 FD7 和 stdio 原样继承，不使用任意子进程环境开关。

默认选择/消费者 A3（`powershell-host-20261007/proposal-source.patch`，`feefa68eca03e0ed64a3c69ff1a26f1bf00a8efc6c118492f811e1f8da3712b4`）22/22、严格4文件通过；最终 provider glue（`powershell-provider-20261007/review.patch`，`92076b368dd4d5096f13fdb64aa869d6bc5f6b0ae2b20bc798a5e6c337c0abdf`）24/24、严格3文件通过。两种精确 argv 分别生成 command/PTY 参数，不改自定义 runner。所有完整性读取增加已观察大小+1的上界及前后 inode/size/mtime/ctime/nlink 比对；不把这些静态检查称作永久文件锁。

真实非交互组合 `powershell-provider-20261007/integration-hHDDpz` **6/6**，以及纳入最终PTY CP提案后的 `integration-rUvOqU` **7/7**：实际 executor/provider/native、UTF-8与无BOM、工作区写入/外部拒写、caller abort、timeout和子树退出、PS承载FD7的EOF、Node原协议65536字节往返，后者增加真实FullAccess。没有方法猴补或旧executor子类，只有隔离TS编译/包路径装载。11个已观察目标/后代PID退出、所有Context清理无错误，共享console、Nahimic和候选源码摘要未变。PS不消费Node控制协议，不能把“带FD7启动”写成PS协议往返。

真实官方 runner 的 `workspace-write` 为 **FullLanguage**，`read-only` 为 **ConstrainedLanguage**；上游 `sandbox-windows-acl/README.md:192` 和 `tests/runner.spec.ts:81–100` 已说明可写temp的AppLocker探针机制。这是原有语义，不是新补丁升权；旧 `tempDir:null` 诊断不能外推全部模式。实际外部写入仍EPERM。

## 交互终端单独验证

真实官方 Backend/LocalSession/ACL/PS7 基线崩溃；创建期缓解后存活，但原 `[Console]::Write` 提示符被CLM拒绝，启动超时。仅对严格识别的私有PTY返回等价OSC字符串后，启动、连续中文/emoji和拒写通过，不放宽语言模式。

ConPTY 初始 CP936 下，PS自身Unicode和Node高层TTY写成功并不证明原始UTF-8字节正确。真正 `fs.writeSync` stdout/stderr 对照 `powershell-pty-native-proposal-20261007/native-proposal-KvglRC` 失败；独占ConPTY的CP65001变体 `powershell-pty-cp-proposal-20261007/native-proposal-GaRKwu` 成功（原始字节stdout/stderr、无BOM管道、CLM、restricted/not-elevated/in-Job/mitigation=1实际回读、拒写）。提案 `ebd2d0a7ab361a11744084120c72765f62f0df1966ab15ec294e2da8c2686887` 为9文件，58/58、严格21文件通过；不FreeConsole/AllocConsole，不替换stdio，仅在sole PID、CHAR/GetConsoleMode和同HWND校验后修改并读回，结束恢复时同样检查所有权。非交互入口 `real-FI73zv` 也复验通过。

完整PTY曾发现**取消后下一条命令不能执行**，保留 `powershell-host-20261007/pty-native-prompt-zc3DyP` 等失败。已证实原runner的 `SetConsoleCtrlHandler(NULL, TRUE)` 让子进程继承忽略Ctrl+C；最终补丁仅对已验私有PTY先注册runner自身SIGINT监听，再清除可继承忽略标志，清理到Job/console全部结束后才移除监听。普通与非交互路径不变。补丁 `acc2b378dcab0313a995e83eab3f0c51f1d75804d4e37830e370e3efc79ff2d8` 独立审查无Blocking/Important，独立11/11通过。

最终实际Backend/LocalSession/provider/native/A3组合 `powershell-pty-cancel-proposal-20261007/pty-actual-combined-VyB3H9/evidence.json` **7/7**：就绪、只读拒写、CLM、连续Unicode、native stdout/stderr与无BOM管道、中断后续命令和释放后目标PID退出。严格15文件TypeScript零诊断，全部自建PID退出，Context清理无错误。控制器自然退出0，不把释放时terminal的 `-1073741510` 写成shell正常exit0。probe曾漏dispose root Context，已修正夹具并自然退出，不将该次句柄残留误报为产品泄漏。node-pty初始PID0、只读PSReadLine历史警告及FullAccess PTY仍为独立边界，未顺带改动。

## 桌面源码与资源复测记录

- `source-tests-TyRvo3`：702项、697通过、3失败、2原有跳过；三项均为新增受管环境变量后的精确集合断言未同步，已修改并定向通过，原失败保留。
- `source-tests-C9YZzF`：706项、703通过、1失败、2原有跳过，输入快照未变；失败是新PowerShell法律说明已更新但发布治理摘要尚未同步。已按实际完整文件SHA更新固定值，不关闭法律校验；随后相关64/64通过。这不是将原完整运行改写为全绿。
- 修正后的完整根测试 `source-tests-UJMJUM`：**706项、704通过、0失败、2原有跳过**，exit0，输入快照不变；此结果早于下述候选输入整合，不冒充整合后的全量验收。
- 候选输入整合后的最终完整根测试 `source-tests-g3oZR9`：**706项、704通过、0失败、2原有跳过**，exit0，输入快照不变，399346ms。与依赖恢复/编译并行时速度明显下降；观察到空闲物理内存约621MiB后，只停止自建编译树 `build-YCXWH6`（exit1、输入未变）并改为串行，不关闭用户应用、不提高测试超时或降低断言。
- 最新完整资源leaf `package-leaf-V5rHbX`：658文件/256625143字节、app.asar可信profile/loader匹配、测试副本篡改拒绝，输入摘要不变。前次 `package-leaf-74NUZM` 是夹具未等asar写流完成，独立新进程读包字节正确；按实际库返回流补 `finished()` 后复验，不靠延时或放宽摘要断言。
- 新profile/source.patch整合后，精确新增文件白名单、重复声明拒绝及回滚/人工改动保护 **24/24** 通过；不允许任意新文件。

## 已整合候选与重建记录

主线程备份 `powershell-host-20261007/integration-ILcv4h` 后，将冻结15文件通过apply_patch整合到 `harness-021-final-replay`，每个后像均与已验FINAL_INPUTS.json完全一致。同步6组包README中英配对和记录；不改原Agent循环、锁文件、权限语义或正式vendor。新 `source.patch` SHA-256 为 `793617936b76cc3a630b8e8eaa22043dfd727f3e38dd8e008f91fb76b94f77e3`，4个新helper与既有HCS patch逐一列入固定profile。`replay-InBj12/result.json` 在新建干净的精确提交上运行实际准备器，**40个变更文件全部与候选一致**，输入前后不变；没有安装依赖。

重建 `build-vh6mB3` 未完成：原runner把pnpm 11配置误写成 `npm_config_verify_deps_before_run`，导致默认自动install；隔离HOME又改变store位置并重新创建候选node_modules。主线程停止自己启动的进程树，保留退出1与完整日志；正式程序、用户资料和candidate lock/workspace未改，不能声称安装态依赖未触碰。修正为实际读取的 `pnpm_config_verify_deps_before_run=error` 及固定既有store，依赖不一致应报错而非静默重装。恢复使用正常固定锁/offline/copy安装 `install-offline-JO8RBh`，不force、不手改依赖；恢复结果及自然字节核验须另行记录。源码反向补丁/重放成功不代替依赖恢复。

恢复 `install-offline-JO8RBh` 于09:32:03Z自然exit0，包下载0，lock/workspace不变；供应链元数据仍联网校验，不能把offline称为完全无网络。独立只读 `dependency-recheck-20261007/read-kEicE5/result.json` 通过：Office733/733、sharp55/55、MCP807/807摘要，HCS两个cacheable-request与telemetry自然解析和patched index摘要均与既有证据一致，安装态锁与固定profile一致。首轮检查错误地要求目录含patch_hash字符串，已按实际字节和历史路径纠正；原失败保留，不改依赖迎合检查。

最终新输入官方完整构建 `harness-021-build-20261006/build-O4JmVk/command.json`：09:35:34–09:39:38Z，**exit0、355客户端产物**。前后profile/source.patch、完整Git diff、新增文件、lock/workspace摘要一致。此轮确实包含新增15文件，不引用旧build冒充；依赖不一致即报错的配置下没有隐式install。保留上游noExternal弃用及大chunk警告，未放宽构建规则。

先前失败的两条官方Loader用例，现以完整profile校验后的私有PS7路径仅注入候选测试进程：`private-shell-built-ekBbOM` **2/2、零失败/跳过、exit0**（09:39:51–09:40:26Z）。原测试文件/断言/超时未改：source工具用例和严格的headless Loader生产shell调用及会话持久化均通过。后者要求真实 `CLI_TOOL_ROUND_TRIP`，不以SandboxUnavailable分支代替成功。LLM使用官方mock；这不是带Key真实模型或Electron界面验收。正式HarnessSupervisor尚未激活此私有路径，不能称本机已使用新核。

## 尚未完成的门禁

1. 窄源码补丁、独立评审、PIPE/PTY实际组合、干净源重放、依赖恢复核验、新输入官方构建及两条原失败Loader用例已完成。不重复这些未变输入的验证；源码API注释门禁仍须在发行前补齐，不借行为通过豁免规范。
2. 复用官方Desktop闭包装配（源码manifest选择为289包，不等同发布全集或最终安装图），保留固定安全补丁和生产锁；更新宿主绑定并验完整桌面Loader/页面、软件优先Key、代理、Office/Wiki保护、Git Review及FullAccess PTY。
3. 完整 Setup/Portable、覆盖前备份、非强停安装、凭据/会话保留和公开下载验收。当前正式仍 alpha.2，没有新安装包或公开发行。
4. Windows 10 的具体支持版别、另一台电脑及长期老化未验，不从本机 Win11 推广结论或擅自改为 Win11-only；lulu 自身未验证签名不借微软运行时签名掩盖。

此前 Office、依赖、完整构建的有效证据见 [此前分层验收](HARNESS_STABLE_READINESS_2026-10-07.md)。本轮只复测改动影响面，不重新下载/全量构建同一未变输入。知识继续并入原 Obsidian `dsh-desktop` 项目；同步结果须以本轮事务回读为准。
