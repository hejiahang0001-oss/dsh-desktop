# lulu 归档退出与历史补证闭环 — 2026-10-08

## 当前结论

用户已回复并实际通过托盘“退出 lulu”结束新隔离归档实例 `supplement-tqCGqX`。本次 12 项归档 UI 全过，root exit 0、Job active 0、guardian exit 0；同一次生命周期为 clean / explicit-exit，privateAclConfirmed=true，没有强制清理。退出后原测试器在历史冷读的旧精确计数断言失败，原报告仍保持 ok=false，不改写为成功。

独立离线补证 `post-exit-proof-k1Yzwa/proof.json` 已真实执行并通过。原报告中的 UI/原生退出/该次 ACL 与新历史证明共同关闭且仅关闭 `final-package-archive-recovery` 门禁；不宣布旧 workflow 聚合通过，不代表安装、公开下载、整个安全验收或 Stable-ready。

此前冻结 [持续验收记录](LULU_STABLE_CONTINUATION_2026-10-08.md) 的“尚待用户回复”是当时事实，现由本次实际退出更新；旧来源不修改。持续推进目标仍有效，不把本次文档记录当作目标完成。

## 为什么原精确计数拒绝了合法恢复

官方 0.2.1-alpha.1 的归档/取消归档只修改工作区 registry 的归档集合，归档同时移除 pin，不修改 Session header 或已有历史。真正打开并恢复会话时，若历史末尾不是 `session/end-seed`，官方 Session 构造器追加一个普通恢复边界 `data={}`，AgentLoop 随后通过写句柄持久化。官方恢复测试同时要求再次恢复时不重复追加该标记。

本次实际差异恰为原 69 条历史完整保留、尾部新增一个普通恢复标记，合计 70 条。旧契约将任何计数增长都视为失败，因此需独立窄补证，不能删除历史校验或允许任意新增事件。

本次通过的拒绝边界：原 69 条逐项/顺序/摘要完全相等；header 除既定 cwd 迁移外保持完全相等，继承数为 0；尾部必须恰好一条 `session/end-seed`，data 为空对象，seq=69，字段集合固定，时间为安全整数且位于本次已绑定的生命周期内。不接受额外消息/工具/turn、重复标记、原历史改值/改序、header/lineage 变化或任意 crash-repair 后缀。

官方代码依据：`packages/workspace/workspace/src/index.ts:363–407`；`packages/core/session/src/index.ts:610–617`；`packages/core/agent-loop/src/index.ts:852–864`；`packages/core/agent-loop/tests/resume.spec.ts:683–701`。本地核对的是固定 `artifacts/harness-021-final-replay/` 来源，未更新内核或产品。

## 离线证明的范围

- 精确绑定原 report、copy、request、expectation、ready、lifecycle 六份文件及最终 EXE/ASAR/descriptor；重验正常同次退出、12 项 UI、原资料与输入摘要。
- 官方 V4 provider 只打开新建私有目录中的输入副本和退出后副本，不打开原 profile，不复制或读取真实凭据，不启动应用，不调用模型。
- 原 69 条事件前缀、业务事件和迁移后 immutable header 一致；完整事件序列连续，只接受上述单个恢复标记。
- 真实证明的 source/copy/input/module 摘要及私有输出校验均通过；旧进程与精确候选 EXE 在前后均无持有者。独立复核时 39 份绑定输入摘要仍一致，原失败报告摘要未变。
- 专项合成 5/5 通过；旧契约对同一合法恢复标记输入的 70≠69 红例保留。工具测试不替代本次真实离线补证。

## 仍开放的门禁

本次应用约一分钟即由用户正常退出，未产生新的 LocalLow 缓存，因此该次全根 ACL 通过不能抵消此前三分钟空白探针的宽权限失败。缓存创建链、首次可读 ACL 及主机/夹具范围仍需按现有证据独立审阅；不关闭 DACS、驱动、沙箱或硬件加速，不据此删除缓存门禁。

主控 12:56 只读计数发现旧安装目录又有 9 个由 dsh_agent 使用的 Node 进程；未采集/公开命令行内容，未强杀或改配置。安装前仍须按已有授权流程重新解除占用并复核私有备份时效，随后完成覆盖安装、资料/密文保留及公开下载核验。本轮未覆盖安装、未公开发布、未改变 Stable；已安装 V1.1.13 与既有 Stable V1.1.12 状态保持。

## 冻结证据摘要

路径相对 `artifacts/stable-readiness-20261007/archive/`。仅本安全摘要进入 Wiki，不复制测试会话正文或原始日志。

| 证据 | SHA-256 |
|---|---|
| `supplement-tqCGqX/supplement-report.json`（原聚合 false 保留） | `3bd58db1693adc326bd4a96c7f55181d80951072c62a1aff895d8e32c983c983` |
| `post-exit-proof-k1Yzwa/proof.json`（独立历史补证 true） | `872ec4e38147eeba35f4f4683ed63e4cd2604aa3ce200956cba00138c81a3284` |
| `verify-post-exit-tqCGqX.mjs` | `e946c0c1b5506cc258a8c4c1199a36ee9865b8960e72320416377d201a681a00` |
| `post-exit-resume-contract.cjs` | `a6e63f8de2f20a9cbfd3eca3b74e4bfac6deb84390817f390fc395e5abd575fb` |
| `post-exit-resume-contract.test.cjs` | `232bbf1d69108c5bf088663e8a76ffa2171e7d43398cfe7d69bc98c64f0e6d77` |

Wiki 将把冻结的持续验收来源与本来源合并为一次增量；此前 `tx-m9f8ox` 仅影子已验证，未实写，不作为实际库的基线。本文件不宣称 Wiki 已写入，后续新事实另作增量。
