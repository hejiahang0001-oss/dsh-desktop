# lulu V1.1.14：安装后资料闭环与发行就绪检查

记录时间：2026-10-09（北京时间）。本页承接 [本机安装验收](LULU_INSTALLED_ACCEPTANCE_2026-10-09.md)，不改写旧报告的失败或历史时点。本轮仅新增验收与发行证据，冻结产品和安装包未改动。

## 已完成的本地交付

- 本机原路径已覆盖为 lulu 1.1.14 / Harness 0.2.1-alpha.1；Electron 43.5.0、Node 24.19.0、私有 PowerShell 7.6.6。保留原应用身份、会话、Key、代理和升级通道。
- 同一冻结候选已有完整源码 911/911、完整运行库及 Office 来源/功能、Setup/Portable、实际 UI/模型/权限、备份与覆盖安装证据。本轮核对输入摘要并复用，不重复全测和打包。
- 安装态独立交互补证通过：发送即时清空、实际官方 Stop、终止状态持久化、用户托盘正常退出；原失败观察器报告保留。
- 第二次真实资料窗口由用户托盘正常退出：原启动时间 `2026-10-08T16:49:42.408Z`，同次生命周期 `clean / explicit-exit`，原进程不再存在。没有用隔离测试的退出证据代替真实资料退出，也没有强杀。

## 首次启动后保留检查

`first-profile-kfC60a/comparison.json` 的 `accepted` 与 `mandatoryPreservation` 均为 true，并经独立只读重算一致：

| 检查范围 | 结果 |
|---|---|
| 原 28 份历史 | 全部字节与摘要不变，亦匹配安装前回滚清单 |
| 原 7 条草稿 | 全保留，修改/丢失/新增均为 0 |
| DPAPI 密文、Local State 原加密字段 | 保留；未解密或输出值 |
| 代理及备份 | 保留 |
| 原设置 | 原字节迁移至 `.imported`，不是无根据忽略差异 |
| 新 V4 历史 | 没有新增/变化项，无额外语义补审项 |
| 进程门禁 | 观察前后四次均为 0；输入及工具绑定一致 |

`live-ui-t9a56w` 提供单独 UI 证据：原工作区及 17 项会话目录可达、已配置加密 Key、当前选中草稿与保存状态一致。当前选中的是空上下文，不将它说成逐个打开了 7 条旧草稿。Chromium 启动后不要求 LevelDB 物理文件哈希不变；原完整备份保留。以上是指定保全边界，不是整个 profile 或整机安全证明。

## 恢复临停集成

仅移除 Codex `dsh_agent` 下本次临时加入的 `enabled = false` 一行（16 字节）；其他配置字节完全保留。实际 CLI `mcp get dsh_agent --json` 返回 `enabled=true`。配置摘要由 `1d1d9fa773d481092af7cccf888f63d0f379c15520ac2ff7dcd6246876f6fba0` 变为预先计算的 `5f308349d74fe7723fd315cf61174056b43516441b15c8445c7c9e07df8c85e3`。

新安装 Node 与既有集成服务的 MCP 初始化及 5 项工具目录握手已通过，未调用工具、未发送模型请求或读取连接状态。配置恢复不代表当前 Codex 客户端已热重载，也不扩大为远程工具端到端验收。

## 证据索引

以下路径均相对 `artifacts/stable-readiness-20261007/`，原始资料报告留在本地私有目录，不上传 GitHub。

| 证据 | SHA-256 |
|---|---|
| `install/first-profile-R7oZ2z/before.json` | `04d4d20c4deab7ef5abeb0394fc4bb67a863a4daf83fd5671c815652f796966b` |
| `install/first-profile-kfC60a/after.json` | `b54a8c858c6f323d3d288e727a6633fb09f4bab6eddeb94e02333a60f384c999` |
| `install/first-profile-kfC60a/comparison.json` | `f7fc7136002d3d7389b4772e905c7d0d7e40e03193215944f3353c132ecf28e2` |
| `test-T1UpRM/result.json` | `adf4079680eacf89edd5c5864797bfa47ee2708d5f93aab5554f5aec06c542a1` |
| 冻结 ASAR | `107169a5c8b36cbe809e6e2057b994a1c79b2d66660555e3e75339aa320adf2c` |

## 发行边界与下一步

本页写入时，源码提交/PR/CI、v1.1.14 标签、四资产公开 Pre-release 和匿名回下载尚未完成；不能将本地已安装当作公开交付或 Stable-ready。下一步按这个顺序完成，随后另记公开回执。Stable 仍为 v1.1.12，晋升必须单独明确命令。

保留的软件补充：软件优先的加密 Key、代理、Office/Wiki 校验与备份、Git Review、Windows 宿主保护。Agent、会话、权限、队列、文件与 Office 主能力使用固定官方内核，不重新接管官方输入/Stop 协议。

用户分别接受的显卡缓存宽权限与既有 Windows 祖先权限风险仍存在，原失败不改写，不修改 DACS/沙箱/系统 ACL。只承诺 Windows 11 x64 已验证；未签名，无 `latest.yml`，不承诺自动升级。Windows 10、其他电脑、长期老化和未覆盖 IME 边界仍未验证。噜噜素材分发权未独立核实，用户要求继续使用不等于已获得版权证明；本项目不是 DeepSeek 官方产品。
