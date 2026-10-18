# lulu 1.1.17 公开交付记录

## 当前事实与结论

截至 **2026-10-19 04:52:49（北京时间）**，本机保持 **lulu 1.1.17 / Harness 0.2.1-rc.2**；[v1.1.17](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v1.1.17) 已公开并按用户授权晋升为 **Stable / GitHub Latest release**。发行源码 CI、四资产远端身份、独立 Windows runner 匿名完整下载及最终 release/latest/tag 读回均通过，本次限定范围公开交付门禁闭合。

**本机网络完整下载未通过，不能写成全环境通过。** 原本机验证两次收到 HTTP 200 后各自超时，完整成功为 0/4；随后采用明确标识地点的 GitHub 独立 runner，4/4 完整响应校验通过。两份证据并存，原失败不删除、不重写。最终公开交付阶段的 Wiki 同步尚待执行与回读。

## 精确源码、CI 与合并

- 发行源码与 tag 提交：`c5a5a811f6afd932338669f2f5c76e0f27adedd2`，本轮精确 94 文件提交范围；沿用已验 qihsES 候选，没有重新构建二进制。
- [CI run 39153336024](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/39153336024) 精确绑定该 head SHA，三个 job 均 completed/success。干净 CI 总 1148，1142 通过、0 失败、6 跳过；无 vendor 环境的 6 项跳过不冒充本机既有 1148 通过、零跳过。
- [PR #85](https://github.com/hejiahang0001-oss/dsh-desktop/pull/85) 已合并为 `c0af2d492e3d2ecbf863708ed1dc2b9e86e355d6`；发行源码与合并提交的 tree 均为 `6fb8171d1add39d6619d09c55730c968886590ea`。tree 一致不是 CI 在 merge SHA 上重新运行，也不改变 tag 目标。
- 独立下载 workflow-only 提交为 `80aef48d2d07199d7e3f7087e18919e3d9956646`，不是产品发行源码提交；它只运行公开下载检查，不执行安装包。

## Release、latest 与 tag

最终官方读回的 Release ID 与 `/releases/latest` ID 均为 `416619407`，tag 均为 `v1.1.17`，`draft=false`、`prerelease=false`。轻量 tag 实际指向 commit `c5a5a811f6afd932338669f2f5c76e0f27adedd2`，不是仅根据 `target_commitish` 字符串推断。

首次公开时间 `published_at=2026-10-18T20:22:53Z`（北京时间 10 月 19 日 04:22:53），当时为 Pre-release。独立下载验证于 `20:49:57Z` 至 `20:50:18Z` 完成，当时 latest 仍为 1.1.12；之后才晋升 Stable，最终读回为 `2026-10-18 20:52:49 UTC`。不把最初公开时间或 runner 的 Pre-release 快照误称为 Stable 晋升时间。

晋升前后四资产 ID、名称、大小及 digest 保持一致，均为 uploaded；没有为 Stable 重新上传或替换内容。远端恰好四件，不发布 `latest.yml`。

| 资产 | GitHub asset ID | 字节数 | SHA-256 |
|---|---:|---:|---|
| DSH-Desktop-Setup-1.1.17.exe | 654151462 | 319524389 | 4513197f6178a5044ff510f465e6933a0e5df08e6dd53f77ebc74ce948722769 |
| DSH-Desktop-Setup-1.1.17.exe.blockmap | 654151466 | 332551 | e3b34cced9498bcd09413305014940a72280bc8143f4d3730ebb5dfbdbdaedd6 |
| DSH-Desktop-Portable-1.1.17.exe | 654151493 | 318738695 | 1aa2331ee6b0502eaead12984b2c3598bc2dff61fcf82b37f6ca513544b90880 |
| SHA256SUMS-v1.1.17.txt | 654151461 | 297 | 66e13afd4643296754b51890b11a0be9a35ced785f949012418427b3ba0b6029 |

## 匿名完整下载：本机失败与独立 runner 成功分别记录

原本机 `public-stream-Bh9ljA` 自然结束、退出码 1，时间为 `2026-10-18T20:23:14.040Z` 至 `20:43:17.927Z`。Setup 两次请求均收到 HTTP 200，但各自达到 600000 毫秒预算后报 `network-timeout`；没有完整成功资产，`fullNetworkBodiesVerified=false`。四份本地源的 sourceBefore/sourceAfter 大小及 SHA 全等、`localSourcesUnchanged=true`；这证明本地源未漂移，不证明本机公开下载通过。没有停止原任务或继续重试本机。

[独立 run 39165094959](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/39165094959) 的 attempt 1、verify job 和下载/上传凭证两个步骤均 completed/success；REST run 与 raw receipt 的 workflow 路径、提交、分支、run/attempt 身份一致。执行地点明确为 **GitHub windows-latest independent runner**，不是本机。

- 四个官方 canonical `releases/download/v1.1.17/` URL 均执行匿名完整 GET，实际重定向最终 HTTP 200；4/4 读到响应结束，字节数及 SHA-256 与上表全等，SHA256SUMS 三条内容核对通过。
- 无认证、无本地缓存复用、无 Range/304 取代完整体；不保存或执行 EXE，仅上传小型 JSON 凭证。流式验证用时 `21137` 毫秒，完成时间 `2026-10-18T20:50:18.3958519Z`。
- 回执明确 `localMachineDownloadVerified=false`、`localSourceBeforeAfterVerified=false`。本地源前后摘要属于上一份本机失败回执的独立证据，不由远端 runner 冒认。

## 回执索引

以下文件均位于仓库本地 `artifacts/upstream-checks/2026-10-18/release117/`；它们是保留的执行证据，不作为公开下载资产或产品文件提交。

| 证据 | 相对该目录的文件 | SHA-256 |
|---|---|---|
| 精确源码 CI | `ci-final-c5a5a81.json` | 9d57490e273f3763a4c200d0aeb0b2a612bfeeb6f4a3fa558477924a93db51b2 |
| PR 合并与 tree | `merge-tree-readback.json` | e76f16095e565b1a4842d5ac601278170256344b4363de9b501409f4b74ae4de |
| 最终 Stable/latest/tag | `stable-release-readback.json` | 79e29d9501cca3f405fb6b86f86fd56d47178c3473b7358ba8dca1a39a39d8d2 |
| 独立 run 与 jobs | `independent-run-39165094959.json` | 9fd9b36e5a3d110b12ce7d7293dfe52ca92820e079a1a43ab56cbf5bb58207b4 |
| 独立 runner 四完整响应 | `independent-runner-39165094959/verification.json` | e2a61f4610cb3db11ee828e7283da12b2b434df62c482181e2803b51c5d50f80 |
| 原本机下载失败 | `public-stream-Bh9ljA/verification.json` | defcb14cf9ab456a8ea77344ce90c9ba4dc22c6609ba661db15a0237c56662e8 |

## 已安装及资料保留证据保持

[本机安装与资料检查](LULU_1.1.17_INSTALL_RELEASE_2026-10-19.md) 来源已冻结，SHA-256 `86164cb3e07385655b2a5b843ffff21eab92ece06706ea2be619aa7030948da8`；其中未公开的表述属于当时安装检查点，本次不为公开结论改写原来源。

本机 16041 文件负载、111 个资料 ACL 项与 5 个祖先目录、首启 before、29 个原文件与 7 条草稿、密文 Key/代理/设置保留均沿用既有实证。唯一 365 字节新增代际已由官方 v3→v4 独立补证限定接受；原严格比较失败、备份 INCOMPLETE 和最初窄检查失败保留。集成仅撤销本次临停行，五工具握手通过，不新增真实任务或当前 Codex 会话热重载已验证的声明。

## 分发边界与后续

本次累计交付 1.1.15–1.1.17：新 lulu 形象、官方 Harness 0.2.1-rc.2 适配、重复桌面插件管理入口退役、设置导航/终端接线以及只读插件清单冷启动的有界重试。详细功能与历史失败见 [1.1.17 发布说明](RELEASE_NOTES_v1.1.17.md)。

本产品是 DeepSeek Harness 的非官方 Windows 桌面宿主；Stable 标签不构成 DeepSeek 背书或上游稳定 API 保证。支持证据限本机 Windows 11 x64；包未签名，仅手动安装，自动更新关闭。其他机器、Windows 10、所有历史升级组合及长期老化未验证；保留 blockmap 不代表差分升级或签名已通过。

SGTool/SogouExe 退出残留和已接受的既有主机权限风险继续单列，严格失败不改为全绿；不强杀用户进程、不关闭沙箱、不把风险接受写成问题修复。回退必须使用独立兼容备份，旧程序不能直接读取已迁移的活动资料。

后续仅为本阶段 Wiki 同步与最终文档归档：本来源冻结后由主流程执行 11 文件保护检查、apply 与 verify，实际通过后另记 Wiki 完成；此刻不预填同步成功，不重跑有效全测、构建或 Portable。
