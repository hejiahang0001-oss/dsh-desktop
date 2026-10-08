# lulu V1.1.14：安装前备份与归档补测检查点

## 官方及交付身份

2026-10-08 00:03:23Z 核对官方 Releases、26 个标签及 npm：最高已发布版本仍为 **0.2.1-alpha.1**，标签 `dsh-v0.2.1-alpha.1`、提交 `5badb15009ae1756c3afe0ae0cef1faafc290ccc`，与本地固定运行库相同。npm 的 latest/next 为 0.2.0-rc.2，不据通道名降级，不采用 master 未发布代码。

- 官方：[固定版本](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-alpha.1)。安全检查记录：`artifacts/upstream-checks/2026-10-08/heartbeat-000323.json`。
- 源码/最终包：lulu 1.1.14 / Harness 0.2.1-alpha.1。既有 911 项源码和最终双包分项证据复用，不重新打包或重复模型流程。
- 本机仍为 DSH Desktop 1.1.13，Stable 仍为 1.1.12；本轮没有安装或发布。
- 旧安装目录进程已实际归零。Codex `dsh_agent` 曾按用户批准临时停用；因本轮不安装，现已仅撤销该开关，配置摘要恢复到停用前的精确字节，CLI 解析 `enabled=true`。连接本身未重新测试，不声称已建立会话。私有备份沿用 [前一检查点](LULU_MCP_INSTALL_CHECKPOINT_2026-10-08.md)，不整份覆盖其他新设置。

## 私有备份：初次失败，不冒充可用回滚点

首次真实备份命令自然结束 **exit 1**，安全错误码 `windows-metadata-operation-failed`。旧安装程序、用户原资料均未覆盖。

`backups/pre-v1.1.14-p5bjE4` 中已复制 24,990 个程序文件、48 个语义文件、5 个受保护原字节副本及 6 个 LevelDB 文件；复制期间的哈希和源一致性步骤已完成，随后最终 Windows 元数据步骤失败。`rollback-manifest.json` 虽提前写了 `complete:true`，但 **INCOMPLETE.json 与失败退出优先，不能视为备份完成**。

原失败目录、manifest、INCOMPLETE 全部保留，未重跑全量复制、未删除标记。密文/Local State/代理配套数据仅保存在私有本地目录，未解密，用户内容和逐文件清单不进入 Wiki/Git/发行包。

### 根因与最小修正

对完全相同的备份树使用真正的 Windows PowerShell 5.1.26100.9444 及原工具窄环境，只读复现：普通路径在递归枚举阶段抛 `System.IO.DirectoryNotFoundException` / HResult `-2147024893`。唯一改为 Windows 扩展路径后，28,519 项枚举、10 个长路径 ACL 读取和根 ACL 内存转换通过；最大原路径长 281 字符。

manifest 到失败标记仅 2.966 秒，排除 300 秒超时。首次试用 shell 参数得到的是 PowerShell 7.6.5，该结果不作为 PS5 证据。

最小修正仅将 `privateAcl` 已通过非链接路径校验的绝对路径转换为 `path.toNamespacedPath`，不改 ACL 白名单、凭据策略或进程门禁。原工具源码已留快照。真实合成长路径 fixture 先复现同一错误，修正后安装工具专项 **24/24、零失败/跳过**，包含实际 Set-Acl/Get-Acl 和链接根拒绝。首次 fixture 过短造成的断言失败也保留，不冒充产品回归。

安全摘要：`artifacts/stable-readiness-20261007/install/backup-20261008-result.json`。原始失败仍不是通过；旧备份需单独完整内容/ACL/源一致性补证后才有资格支持安装。

### 真实独立补证已通过

`recover-incomplete.cjs` 经主控及独立代码审查、13 项合成测试后执行一次真实核验，**exit 0 / recovery-attested**。28,519 项全树 ACL、24,990 程序副本及当前原安装、48 原语义资料、5 保护副本与 6 LevelDB 文件一致，额外语义文件为 0。原 helper 实际运行仍因 `backup-incomplete` 拒绝，原标记与 manifest 未改；单独新建私有完成证明，未重拷用户负载。

证明 SHA256 `329d49142db8b3cafa708e47833dfb786914969c18a46443328ba2dbe592ec46`，主控另做字节/状态读回通过（工具证据 `1e3923`、`a27f6b`）。这只建立本次回滚快照的补充验收依据，不表示已安装；后续覆盖前须确认资料未在间隔内变化，覆盖后使用单独的 `verify-recovered` 完整保留核验，不能调用原 verify 并忽略失败。

## 归档恢复补测

用户已确认可以配合隔离实例的原生托盘退出。首轮 `archive/supplement-pwXkRC` 完成离线真实历史复制及官方冷读，进入实际 UI 后，准确选择原会话并成功归档一个会话；随后的“仅显示已归档”操作被无 Key 环境重新弹出的 API Key 引导遮挡，聚合结果仍为失败。

官方源码解释：当前会话归档会清空主视图，非空会话重置的 onboarding 完成状态因此开启新一轮引导。测试器现在每次可见操作前复用既有“稍后配置”按钮处理，不添加 Key、不写内部状态、不降低归档断言；纯契约 12/12 与语法检查通过，独立窄审无 Blocking/Important。

首轮因失败使用 owned Job 清理，不算正常原生退出；随后已独立确认其根进程消失。原失败报告、截图及原 workflow 总失败不改。

重试 `archive/supplement-NxoXw0` 的 **12 项归档/取消归档/刷新保留 UI 检查全部通过**。程序于 00:38:09Z 提示等待人工原生托盘退出，180 秒内未检测到正常退出，随后 owned Job 清理；00:41:14Z 聚合结果仍为 false。退出后历史冷读未执行，最终运行期 ACL 也未取得通过结论，不能把 UI 分项通过当作全部完成。根进程随后确认消失。两轮均 0 模型请求，源输入及原历史未改；安全摘要 `artifacts/stable-readiness-20261007/archive/summary-20261008.json`。等待用户新确认可及时操作的窗口后再补测，不在后续心跳无人值守重开。

## 能力边界和后续

### 新开放项：隔离运行期 LocalLow 权限来源

第二次归档测试的最终 ACL 未通过已窄化：PS5 实际完整取得 192 项元数据，失败在 `runtime-acl/scan.cjs:27` 的 capability 边界断言，**不是长路径枚举失败**。隔离根下 LocalLow 类目录的 5 个路径（3 目录/2 文件）出现 20 条额外 Allow ACE，权限为 FullControl；这些 SID 不匹配已审 Chromium capability，也不在明确 profile 下 Cache/Network/Shared Dictionary 的三个允许子树。异常路径长 113–196 字符。

目前没有证据将其归因 Chromium、显卡组件或其他来源，不扩大白名单，不改任何权限；profile 本身未枚举到额外拒绝项，不外推为用户凭据泄露。安全诊断摘要 `artifacts/stable-readiness-20261007/archive/acl-diagnosis-20261008.json`，目录名、逐项 SID 和用户内容不入知识库。下一步先核实生成来源和隔离语义，再安排用户在场的完整原生退出补测。

本轮不增删业务功能，也无新的官方能力替换决策。官方 Agent/会话/队列/权限/文件预览与 Office 路由继续使用；桌面加密 Key 优先级、代理、Office/Wiki 校验备份、Git Review 和 Windows 宿主保护保留。

后续先核实 LocalLow 权限来源，随后在用户新确认可及时操作时补归档恢复/真实原生退出、退出后历史冷读及最终运行期 ACL，再核对已补证备份的时效，做覆盖安装、首次启动前原资料/密文保全、安装态身份与真实交互，最后公开交付校验。dsh_agent 临停已撤销，下次执行覆盖须重新确认进程占用与临停窗口。Stable 不自动晋升；Windows 11 x64 为本次已确认支持范围，签名/跨机/长期老化没有新证据就不宣称通过。

Obsidian 使用现有 `projects/dsh-desktop` 项目合并；本文件作为冻结来源，最终同步及回读结果另存本轮 Wiki 事务验证文件，不通过修改来源本身来造成摘要过期。
