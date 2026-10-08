# lulu V1.1.14 安装态验收（2026-10-09）

本机已从 V1.1.13 覆盖为 **lulu V1.1.14 / Harness 0.2.1-alpha.1**，仍使用原安装目录与原资料身份。安装态窄交互及原资料启动检查通过；首次启动后保留复核、集成恢复与公开发行尚待闭合。**未公开发布，Stable 仍为 V1.1.12，尚不宣称 Stable-ready。**

## 1. 安装与安装前后保全

- NSIS 实际执行于 2026-10-08T14:48:15Z–14:52:01Z，exit 0；原目录 current-user 覆盖，没有嵌套安装。安装器时间和完整运行库验证来自本轮工具结果；不虚构独立安装器日志。
- 安装后的产品身份 lulu / 1.1.14.0；桌面和开始菜单 lulu 快捷方式指向原安装位置。EXE SHA256 `b59a499c848d00ba6382bd2a362e85567af38624626744506878c3ab7f1db2c4`，ASAR `107169a5c8b36cbe809e6e2057b994a1c79b2d66660555e3e75339aa320adf2c`，与冻结候选相同。16:47:35Z 再次定向核对并记录 `install/installed-identity-receipt.json`。
- 已安装 Harness 14,173 文件与 PowerShell 7.6.6 的 658 文件完整性通过。安装后、首次原资料启动前，原48项资料、5项保护状态、6项LevelDB、旧程序回滚副本及其28,519项ACL复核通过。未解密或输出密钥。
- 安装前后各108项选定资料/祖先元数据，缺失、新增、ACL/owner、类型/链接、身份、文件元数据差异均为空。原私有快照保留在 `backups/install-acl-vhAyu0` / `backups/install-acl-nxuso9`，comparison SHA256 `d51c46070c91319c643189149cdab4fb10d88493775c7e16288a89433d22730f`。
- 用户分别接受的显卡缓存及既有祖先权限风险没有被修复或改写为通过；本次比较只证明选定边界未被安装放宽，不证明整机或有效访问绝对安全。

## 2. 两项窄交互已闭合

最终 `install/narrow-NOsHi8/report.json` 的 functionalAccepted/fullRuntimeAclPassed/ok 均 true：

- 实际 Ctrl+Enter 插话后，在 Stop 前即时保存草稿已清空的断言。
- 点击官方 Stop 后，同一会话 running=false、pending=0、turnOpen=false，队列/审批/活动任务为零；关闭后官方历史 provider 验证精确第二条请求只有一次入列，且确由用户停止。
- 用户从托盘“退出 lulu”；同次 lifecycle 为 clean / explicit-exit，root、Job、guardian 均正常归零，原密文与配套状态及测试输入不变。

早先 `narrow-5vYAmk` 与 `narrow-5IdJNR` 失败保留，不算正常退出，也不冒充成功。第二轮精确定位为 Dock 收起点击；最终观察到首个样本 busy=true、按钮disabled，下一样本才就绪。修复的是外部观察器等待异步界面完成的缺口，未修改产品或冻结安装包。7/7 观察器回归通过；只补这条两请求链路，没有重跑 Office、审批、归档或911项源码测试。

## 3. 原资料首次启动

- `install/first-profile-R7oZ2z/before.json` 已生成，SHA256 `04d4d20c4deab7ef5abeb0394fc4bb67a863a4daf83fd5671c815652f796966b`。保全工具经独立审查和9/9合成测试；28份旧历史逐项绑定原清单，原密文只比较摘要。
- 安装程序于 2026-10-08T16:49:41.7829630Z 正常启动原资料。看到的恢复通知属于旧1.1.13未正常退出记录，不是本轮新崩溃；不自动重发旧任务。仅确认信息性恢复说明与官方预览版说明，没有改 Key/代理/权限或发送消息。
- `install/live-ui-t9a56w/report.json`：只读安装态身份、原工作区同步、configured+encrypted Key、17个会话目录记录、当前草稿/附件一致性全部通过，无可见弹窗。当前选择是新增空白上下文，不能据此声称所有旧草稿均在UI逐一恢复；全部旧草稿的选区比较另由退出后保全处理。
- 原生UI打开并收起安装态“兼容终端”，实际本地 terminal.html、未启动状态和PowerShell交互入口可见；没有启动shell或发命令。实际PTY能力复用相同冻结负载的既有证据。
- **待正常退出后执行 before/after 保全比较**：允许 Chromium 非密钥字段及合法原子写变化；原28历史、原Key密文、已有加密主密钥、代理语义、全部旧草稿必须保留。新V4若出现，单独核验迁移语义，不以“升级预期”自动通过。

## 4. 集成与发行状态

- `install/mcp-handshake-result.json`：新安装Node及SDK完成本机dsh_agent协议握手，发现预期5工具；零工具调用、零模型请求、未读取用户连接令牌。临停配置的单行恢复仍待原资料退出后执行，不能把握手当作配置已经恢复或远程协作验收。
- 剩余：原资料正常退出与迁移保留、精确恢复dsh_agent、最终源码/PR/CI/tag绑定、四资产公开Pre-release及全新匿名回下载、现有Obsidian项目同步。
- 源码911/911、完整依赖/Office来源与native、双包负载和已绑定专项证据继续有效，不重建未变产物。源码、候选包、已安装、草稿和公开下载分别记账。
- 支持边界为已验证的Windows 11 x64；未签名、Windows 10、其他电脑、IME及长期老化不作已验证承诺。自动更新门禁仍false，不发布latest.yml；Stable晋升仍需单独明确命令。

除明确相对项目根的 backups 路径外，本页 `install/` 证据相对 `artifacts/stable-readiness-20261007/`。这些私有运行产物不随源码或安装包公开。
