# lulu Stable 持续验收 — 2026-10-08

## 当前状态与执行纠偏

继续同一 V1.1.14 / Harness 0.2.1-alpha.1 候选，用户要求持续推进到 Stable-ready，并未要求在每个小检查点结束。此前把连续验收拆成多次阶段性收口，是执行组织失误；本记录不是目标完成或发布声明。有效证据继续复用，不重跑已通过的全量测试/构建，不再重复纯调用栈采集或私有目录预建实验。

本轮只修 artifacts 中的时间观察器，没有产品源码、包内容或默认安全策略变更。主控最近一次 12:36 只读复查：DSH/Procmon 均为 0 进程，已安装 FileVersion 仍为 1.1.13；未覆盖安装、未发布、未改变 Stable V1.1.12。

## 首次可读 ACL 的有效证据

有效实例 `runtime-acl/cache-first-acl-fliHfm`：实际驻留 180013.0373ms；观察器在启动前 ready、在诊断清理后结束，fullResidence 为 true，最大采样间隔 1035ms，读取失败 0。两个文件首次成功读取 ACL 时均不符合现有私有规则；输入摘要、预建目录身份未变。根进程已消失、guardian 已关闭，但属于 Job 诊断清理，guardian 退出码记录为 null，不算自然退出。最终仍为 `final-full-tree-acl-failed`，productAcceptance/naturalExitVerified 均为 false，没有复制凭据或调用模型。

这是“首次可读时已经非私有”的采样证据，不是原子创建瞬间的安全描述符证据；短暂状态可能落在采样间隔内，同路径也不证明同一文件对象。不能据此唯一归因 DACS、Intel 或证明真实 Key 泄漏。

旧实例 `cache-first-acl-Vgaaec` 的原报告虽然写有 temporalEvidenceComplete=true，但 maxSweepGapMs=186199，首读延后至驻留之外。主控已拒绝采信其时间完整性，原报告不改。观察器 PS5 标准输入读取阻塞经 artifact-only 修正，主控专项 10/10；独立合成 `observer-synthetic-qI4GAx` 为 2179ms、最大间隔 895ms、首次 ACL 早于 STOP、最终扫描晚于 STOP、exit 0、未强制清理、未启动应用。工具通过与产品权限失败分别记录。

## 同范围资料风险对照

按原扫描元数据规则的独立只读核对（本轮工具结果 3394d7）覆盖以下两个既有夹具，没有读取文件正文或修改 ACL：

| 范围 | cache-probe-yE6xyB | supplement-YfaH0F |
|---|---:|---:|
| 全根枚举项 | 176 | 191 |
| 违规路径 / ACE | 2 / 8 | 5 / 20 |
| profile 项 / 违规项 | 138 / 0 | 136 / 0 |
| Harness 项 / 违规项 | 37 / 0 | 36 / 0 |
| 会话项 / 违规项 | 7 / 0 | 6 / 0 |

违规仅为 profile 外 `LocalLow/Intel/ShaderCache` 两个 26B 文件；归档夹具还包括 LocalLow 及下两层目录。两夹具的 Local State、network-state.json、DPAPI 主文件及备份存在且未发现规则违规，legacy YAML 未见；均有既定 Chromium 网络能力的 30 路径/37 条允许 ACE。所有者和链接/硬链接违规均为 0。这里不复制原 SID、SDDL 或用户内容。

夹具重定向 HOME/USERPROFILE/LOCALAPPDATA 并检查整个隔离根，范围大于实际应用 profile。上述结果只能区分当前观察范围，不能自动等同全部产品资料漏洞，也不能升级为真实用户凭据、有效访问或完整生命周期安全通过。原全根 ACL 门禁仍开放，不删路径、不扩大白名单、不事后修权限来取得通过。

## 下一步执行顺序

1. 优先补真正未完成的归档原生退出及退出后官方冷读，复用已有真实会话，不再从模型工作流开始。归档 12 项 UI 已有通过，但不能替代同次 explicit-exit、root/Job/guardian 正常终态、历史完整性和最终权限门禁。
2. Computer Use 的 Sky 接口可用，但本轮 list_windows/list_apps 未提供可控制的托盘窗口；不使用 CDP Browser.close、进程终止或伪造退出冒充托盘操作。已异步询问用户能否在提示后点击“退出 lulu”，本记录时尚无回复；没有因此启动新归档实例。
3. 并行保留缓存权限的未决因果与适用范围，任何检查范围调整或产品修复都需有依据并独立审核；不关闭 DACS、驱动、沙箱或硬件加速。
4. 归档与权限门禁闭合后，复核现有私有备份时效/安装占用，完成覆盖安装、资料与密文保留及公开下载核验；知识记录不能代替这些步骤。Stable 晋升仍是独立明确操作。

## 冻结证据摘要

以下路径均相对 `artifacts/stable-readiness-20261007/runtime-acl/`；原始报告与观察记录留在本地，不作为 Wiki 复制来源。

| 证据 | SHA-256 |
|---|---|
| `cache-first-acl-fliHfm/report.json` | `b3ab8990013b6fae0ec5721298211145bfaae81ea314cc38863a2d58630a2b81` |
| `cache-first-acl-fliHfm/acl-observations.jsonl` | `c1e26b00efaf5e17e57d23b21db5148b4207df8829d3d7f882efe8c85450ca00` |
| `cache-first-acl-Vgaaec/report.json`（时间完整性拒绝采信） | `5814e0d08f7c649341022e56d182867b4cbb9fefa7baa4cf832989072e704a10` |
| `observer-synthetic-qI4GAx/report.json` | `c79ed8877af2efa08deb4eb9abe383e5bde0c0fedd40946d4d2f5029c1073fda` |

本文件为本轮唯一新增 Wiki 安全来源；原跟踪来源、失败报告与历史不改。Wiki 当前仅准备新事务，实写结果须另行回读记录，不由本文宣称完成。
