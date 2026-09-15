# Harness 0.1.6-alpha.1 与 DSH V1.1.13

固定 [官方 tag](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.6-alpha.1)，提交 `0a15e36e7f82b6ed45af6fa9759f29b40dcd965d`。本轮只升级 Harness，Electron、Node 和 pnpm 版本保持不变；桌面 Stable 仍为 V1.1.12。

## 官方替换与桌面保留

| 能力 | 本轮决定 | 边界 |
|---|---|---|
| 多终端 | 主入口转到官方 Sidebar | 公共导航服务打开；不使用私有 UI 状态 |
| 助手读取终端输出 | 保留明确标注的兼容终端 | 官方 follow 会取得独占输入控制，不能当成只读快照；继续逐次授权、限量和脱敏 |
| 归档恢复 | 使用官方 Settings 页面 | 实际取消归档和重载验证通过，不另做恢复界面 |
| 附件、普通预览、present | 延续官方实现 | Office 结构校验、备份、可恢复回执不是同一能力，继续保留 |
| MCP resources | 使用随内核提供的官方插件 | 需要配置服务，不声称所有外部 MCP 均已验证 |
| 额外原始会话日志 | 桌面显式关闭 session-log-deepseek.enabled | 不影响用户主动发送的消息及正常模型工具结果 |
| Key、代理、Git Review、Office/Wiki、工作树任务、安装生命周期 | 保留最小桌面宿主实现 | 不因官方新增相邻能力直接删除用户正在使用的保护 |

## 适配中发现的问题

旧桌面自动检查点按 textarea 和占位文案猜测聊天输入，遇到官方终端会截走回车。V1.1.13 改为只认可官方聊天卡中的输入，发送按钮也只在该卡内寻找；行为测试与真实 PTY 回执均覆盖此问题。

官方 Queue/Steer 的键盘绑定从 InputBar 移入 editor/view-binding；这里只更新所有权测试定位，不接管官方提交协议。Session 仍称 V3，不代表旧内核能接受新事件，升级前资料须独立备份。

## 来源与验证

- 294 个固定来源发布包：285 DSH + 9 Cordis，不修改上游业务源码。
- 八项精确安全依赖补丁在新锁文件重建；物理包审计与整个上游开发依赖审计分开。
- [Windows 运行库构建](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/34992044265)；具体摘要、测试与未验收范围见 [VALIDATION](VALIDATION.md)。
- 不启用 Browser Use、Computer Use、Auto review、远程桥，也不迁移到官方桌面壳。后续先 V1.1.14 恢复/便携性能，再 V1.1.15 老化，V1.2.0 双机 Beta。
