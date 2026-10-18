# lulu 缓存创建链路跟踪 — 2026-10-08

## 当前结论

本轮推进同一 V1.1.14 / Harness 0.2.1-alpha.1 的 Windows 隔离验收，没有修改产品、替换安装或发布。两个缓存文件的创建者已定位为候选 lulu 的 GPU 子进程；宽权限最终由哪一层引入仍未证实，不具备 Stable-ready。

- 用户确认已勾选 Drop Filtered Events；启动前只读核对已保存的 `DestructiveFilter=1` 和精确隔离目录规则。沿用当前设置，未用旧 PMC 覆盖。保存的 PMC SHA256：`b129106e2fd4f83e524065ae5edb89771705f443fcc9695e2d373509fde3b3e9`。
- 仅微软签名 Procmon 提升权限，测试脚本保持非管理员、原沙箱、空白隔离资料。使用 `/Runtime 210` 硬上限；单次测试实际驻留 180011.092 ms，没有复制凭据或发出模型请求。
- 离线 `/NoConnect /OpenLog /SaveAs1` 导出，不附加 `SaveApplyFilter`，也不解析网络符号。XML 的 24,715 条保留事件全部位于指定测试目录，范围外事件为 0。进程/模块元数据不是额外文件事件，不输出或同步原始命令行、身份及完整日志。

## 观察证据与因果边界

| 项目 | 已观察结果 |
|---|---|
| 创建者 | `DSH Desktop.exe` PID 25632，父 PID 440（本轮候选根进程），`--type=gpu-process`，Medium 完整性 |
| 创建时间 | 本地 19:38:00.6466399 与 19:38:00.6584603，两次 CreateFile SUCCESS / OpenResult Created |
| 写入 | 两次成功 WriteFile，各 26 字节；最终两文件也各为 26 字节 |
| Intel 模块 | `igd10iumd64.dll`，Intel Corporation，27.20.100.9664，出现在创建及写入调用栈 |
| 虚拟化模块 | `ObjectVirtualizeDll_x64.dll`，DataCloak / DACS，2.2.10055.16，出现在创建调用栈；仅模块参与有证，不认定其导致异常 |
| 最终权限 | 两个文件仍各含四条显式 FullControl 宽权限，共八条；预建目录身份未变，原全树验收仍失败 |
| SetSecurity | 本次已保留的缓存事件中没有 SetSecurity 记录，不能据此证明创建时就设置了宽 ACL |

采集事件时间为 19:35:20.7757342–19:38:50.4754297。它覆盖了两个文件的创建/写入，但由于启动前校验开销，早于候选三分钟驻留结束约八秒；不声称覆盖完整生命周期或排除结束前的其他权限变化。没有“关闭 DACS/驱动”对照，没有证明 Intel 或 DACS 是宽权限的唯一原因，也没有证明真实用户凭据泄漏。

## 退出与证据保护

- 原测试结果为 `final-full-tree-acl-failed`，不修改失败结果、不增加白名单、不事后修缓存 ACL。Job 回收属于诊断清理，不是正常托盘退出验收。
- 本轮候选根进程确认消失，最终 DSH/Procmon 进程数均为 0；离线导出进程也已结束。
- 日志只保存在本地私有诊断目录，不上传原始 PML/XML。管理员采集生成的 PML 最初由 Administrators 所有、DACL 仅允许当前用户和 SYSTEM；本轮只把该诊断文件的所有者规范为当前用户，已核对 DACL 和文件摘要不变。没有修改被测缓存文件。
- 当前已安装 EXE 版本独立读回为 `1.1.13`；未覆盖安装、未公开发布、未执行 Stable 晋升。既有 Stable V1.1.12 状态保持。

## 下一步

1. 优先设计覆盖完整驻留且在文件创建后即时读取 ACL 的最小对照，区分初始 ACL、后续变化及 DACS 虚拟化影响；不再重复只预建目录的对照。
2. 不擅自停用 DACS、驱动或安全策略，不为通过验收默认关闭硬件加速；需要另一环境或系统设置变更时单独确认。
3. 根据新增因果证据选择最小修复；之后补归档的原生托盘退出/退出后历史冷读，再复核私有备份与占用、覆盖安装、资料/凭据保留和公开下载门禁。

## 可回读来源

- 安全摘要：`artifacts/stable-readiness-20261007/runtime-acl/trace-checkpoint-20261008.json`。
- 原始本地资料：`runtime-acl/trace-20261008/capture-c36f848d.pml`、同名 `.all.xml`、`cache-probe-yE6xyB/report.json`，完整摘要记在安全摘要中。原始资料不进入 Wiki 或 Git。
- 汇总器：`runtime-acl/summarize-trace-20261008.ps1`；原 probe SHA256：`941d27c048483dded0b9db60447d39c52309bcb546c28414a2115a2bdbc2f255`。
- [微软配置/停止说明](https://learn.microsoft.com/en-us/troubleshoot/windows-server/system-management-components/identify-cause-of-wmi-shutdown)、[微软 Runtime 示例](https://learn.microsoft.com/en-us/troubleshoot/windows-server/backup-and-storage/windows-server-mpio-troubleshooting)。离线导出参数另核对本机微软签名 Procmon 4.11 内置帮助。

本文为本轮冻结来源；Obsidian 同步结果另记 PROGRESS，不事后改写本快照。
