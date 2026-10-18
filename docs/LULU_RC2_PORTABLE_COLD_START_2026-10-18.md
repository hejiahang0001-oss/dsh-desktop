# lulu 1.1.17：便携版冷启动清单超时修复

## 用户决定和交付边界

2026-10-18，用户已接受将 SGTool/SogouExe 退出残留记录为已知兼容风险，继续便携版、覆盖安装及 Stable 发布验收。原严格退出失败不改为通过，不恢复已取消的输入法对照，不改输入法或强杀用户进程。完成适用验收后晋升 Stable 已有单独授权。

本次继续同一个 1.1.17 / Harness 0.2.1-rc.2 目标，不另开版本，不升级其他依赖。官方标签、提交、能力替换及保留范围沿用 [rc.2 适配记录](HARNESS_UPSTREAM_v0.2.1-rc.2.md)。官方负责插件管理、模型、会话和主交互；桌面保留软件优先加密 Key、代理、Office/Wiki 校验备份、Git Review 和 Windows 宿主保护。

## 新发现与根因证据

最终候选 `dist-fA7r83` 的两次真实 Portable 启动均在 Harness 烟测返回 `This operation was aborted`；这不是已接受的退出残留，也不能由旧静态包检查替代。

在第三次真实 Portable 冷启动增加不暂停的内存请求观察后，捕获 `/api/pluginInventory/list` 于 **3011ms** 被内部 3 秒计时器中止；此前会话创建、权限设置、命名及列表请求均 HTTP 200。因此已确定失败请求及直接中止原因，尚未证明底层耗时来自哪个系统组件，不归咎于网络、DACS、输入法或磁盘。观察器只记录路径、耗时、HTTP 状态和错误栈，不记录正文、认证头或 Key，不修改原 ASAR。

一次复用解出程序的无暂停诊断中，同接口 HTTP 200 / 1117ms、541/541 运行库及原 Harness 烟测通过；它仅说明可正常返回，不能冒充真实 Portable 冷启动验收。前两轮暂停式观察器自身未到 HTTP 阶段的失败也保留，不混作产品结果。

证据路径相对 `artifacts/stable-readiness-20261007/portable/`：

| 证据 | 结论 / SHA256 |
|---|---|
| `harness-governance-GJ9knv/report.json` | 原 Portable 失败；`ca9468e78619047a86d52e500eb402f456888877953a686e1d05f8ee290a0320` |
| `harness-governance-I48syg/report.json` | 原包复验同样失败；`fc41e1b83890270fbe8c3c7d8dcf4fd94c870c2f7bb47284e307c4a86fd69188` |
| `harness-governance-observed-KXSPJB/report.json` | 真实冷启动的请求定位；`fead0f89d7571a090e51eb27481534a37c70fb19c3e68525be506365ad00e2c2` |
| `harness-request-diagnostic-64wJmD/report.json` | 解出程序诊断，非 Portable 验收；`1a829dfb08ba6ec4a77c03f609afb6f0deacca6de8cc48d170f2bb1896f857e7` |

## 最小修复与验证

仅修改 `electron/extension-center.cjs` 与对应测试：精确的只读 `pluginInventory/list`、空普通参数，且确为本次内部计时器产生的 AbortError 时，退避 250ms 后重试一次；默认两次各 3000ms，总预算最多 8000ms。响应体也受同一总预算约束。外部取消、网络错误、HTTP/业务/JSON/协议错误、其他端点和非空参数均不重试，第二次失败不再重试。

没有修改 smoke 判定来放行，没有延长其他请求、修改权限或关闭沙箱。回归由 RED（6通过/1失败）到 GREEN（14/14），相邻纯测试49/49，独立审查未发现 Blocking/Important。主控完整 `pnpm test` **1148/1148、零跳过、exit0**，407 输入前后不变：

- 回执：`artifacts/stable-readiness-20261007/test-TtRbCY/result.json`
- SHA256：`63c5a886166ebfd33dc3cbc171f02d435be8f19786d1aed84a29b8ecd5ade7fe`
- 当前修复源码 SHA256：`fede6f1362d9b98fb2f146c268ccc178ecbc2847faa661700a0d6414c814abc3`

三轮本次创建的短 TEMP 解压副本已按精确路径、报告、三镜像和无进程检查清理，每轮约2.43GiB；各自原始报告、合成资料、请求记录和清理回执保留，原安装包不动。副本可从原 Portable 再解出，不声称可恢复临时文件的原始身份。

## 新包实际Portable与退出风险

新qihsES实际Portable原启动器（不是手工展开模拟）两轮均完成产品功能，并证实展开镜像身份、主程序PID/创建时间、启动器exit0、主程序消失、原启动器清理解压程序、输入不变。Harness轮541/541运行库正常、196插件中168活跃/0失败，工作区/独立会话和插件清单正常；终端轮原八项全部通过，模型调用为0。

两轮最终Job各有一个SGTool.exe残留，故原严格 `ok=false`/CLI exit1保持；另以最终成员完整路径、SHA256和有效签名核对，独立 `acceptedKnownRisk=true` 只适用用户已接受的搜狗风险，不接受其他成员、功能失败或身份缺失。观察器使用非杀伤Job正常关闭句柄，未强杀残留、未修改输入法或产品默认沙箱。

- Harness原报告：`portable/harness-governance-qihses-nonkilling-28ZU1H/report.json`，SHA256 `7758ec3d0a03d1632b975215cc467e42b6acd4b8d5c846c353bad0ab51747772`。
- 同轮签名分类辅助因继承PowerShell Core模块路径导致Windows PowerShell模块自动加载失败；仅修辅助脚本显式加载自身系统Security模块，未重跑产品、未改原报告。独立补证 `signature-supplement-v2.json` SHA256 `fc5a0bb67846f005e64913b0fea9f9abf3483fbbf83837380ba59aed1567fc30`，重新核实历史末帧唯一残留，strict仍false、风险范围接受为true。
- Terminal报告：`portable/terminal-governance-qihses-nonkilling-QPJfcN/report.json`，SHA256 `7a0c1da7760234ecde341e2ef9d8159e9d2051f7d7fcee4c35f83631469423af`，八项true且风险分类当轮true。
- 上述路径均相对 `artifacts/stable-readiness-20261007/`。测试已结束，没有持续后台验收命令；不把自然保留的搜狗进程称作lulu后台测试。

## 实际状态与下一步

- 源码：1.1.17 / rc.2 含上述修复，完整源码测试通过；修复后的真实Portable两轮功能通过，严格退出失败按上节单列用户已接受风险。
- 候选：失败 fA7r83/output 已获用户明确授权并于2026-10-18T11:41:04Z删除，16046文件/1785910734字节（约1.66GiB）。原日志、摘要、1.1.15、最终已安装对应1.1.16及用户资料保留，不转存D盘；该套候选二进制不可原样恢复。
- 含修复的新双包 `artifacts/stable-readiness-20261007/dist-qihsES/output/` 已一次构建，407输入前后不变；完整内容治理 packageReady/payloadBinding 均为true，Setup、Portable与展开程序16041文件/1147305629字节逐项一致，负载树SHA256 `b4b3a008c70b2156e025d630a3aceec0015ecb11be0d7172345b70cb527da2f3`。构建回执SHA256 `d29df8c85b915432195ac022a08656ab69a15e4dd9ef5f62b09b963a2922f8c6`；治理回执SHA256 `bded37bec75faeb871b14101a98eaf44d7ef96ccde7ecc4531824f660008cb85`。包仍unsigned/automaticUpdateReady=false，不发布自动更新元数据；本地1.1.16差分基线不冒称公开1.1.14。
- 新Setup：319524389字节，SHA256 `4513197f6178a5044ff510f465e6933a0e5df08e6dd53f77ebc74ce948722769`；Portable：318738695字节，SHA256 `1aa2331ee6b0502eaead12984b2c3598bc2dff61fcf82b37f6ca513544b90880`。静态完整不等于真实Portable或安装验收。
- 安装：仍 1.1.16 / alpha.2。已按既有授权仅在Codex的dsh_agent段插入 `enabled = false` 一行（16字节），私有配置备份/精确差异校验通过；没有强杀占用。配置回执为 `artifacts/upstream-checks/2026-10-18/install117/config-handoff-disabled.json`。当前需用户完整退出并重开Codex，让持有旧安装运行库的6个Node正常退出，再做安装备份覆盖。尚未复制用户资料或覆盖程序；安装准备工具31项纯契约和目标摘要已更新为qihsES，不代表安装验收。
- 公开：Pre-release仍1.1.14、Stable仍1.1.12；本轮没有上传、发布或晋升。
- 下一步：用户完整重启Codex → 复核旧占用已释放 → 新私有备份与覆盖qihsES → 首启前/正常退出后资料、凭据和ACL保全 → 只恢复本次dsh_agent临停行 → 精确提交/PR/CI、资产与匿名下载 → 已授权Stable晋升。不重做已有效的构建、1148全测、模型权限或本次Portable。现有源码提交清单已准备，未经PR/CI/安装/公开核验不能声称Stable已交付。

Windows11 x64 为本次已确认支持范围；Windows10、其他电脑和长期老化不作已验证声明。未签名及既有已接受环境风险继续明确披露。Wiki 实写结果另记，不在此预先声明闭环。
