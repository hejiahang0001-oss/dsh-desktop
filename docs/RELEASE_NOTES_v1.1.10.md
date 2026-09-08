# DSH Desktop V1.1.10

DeepSeek Harness `0.1.3-alpha.2` 适配与官方文件流程收口。已按维护者确认补充最小依赖安全修复，完成实际运行库审计、打包态和安装态验收，并公开为 Latest / Pre-release；Stable 保持 V1.1.0。发布证据见[验证记录](VALIDATION.md)。

## 范围

- 固定官方 `dsh-v0.1.3-alpha.2`，提交 `82a5fd61a7cf5c293cec4bdff68f455398d685e9`；不跟随浮动 latest，不同时升级 Electron、Node 或 pnpm。
- 适配 Session v2 与冷读历史接口、persona 前后缀配置和软件代理优先级；历史读取不得自动激活 Agent。
- 新文件统一使用官方附件、拖拽、图文混排和上传状态；移除重复的“导入工作区”按钮及空导入栏。保留旧文件引用和草稿恢复，不迁移或删除用户文件。
- Word/Excel/PPT 格式 Skills、安全检查、真实文件及备份收据继续可用；它们是按需格式工具，不接管官方附件和产物卡片。官方通用文件能力不等于任意 Office 排版保证。
- 固定七项同主版本安全补丁：js-yaml 4.3.1、protobufjs 7.6.5、fast-uri 3.1.6、ip-address 10.3.1、hono 4.12.34、@hono/node-server 1.19.15、qs 6.16.0；构建来源明确记录 `desktop-security-1` 和锁文件摘要。
- 随官方升级获得长会话性能、断线恢复、子代理队列/Steer/Stop、自动滚动、Windows 子进程清理及 Open In 改进。

## 数据与兼容边界

- Session 迁移保留旧 generation，但这不意味着旧版本能读取新格式或升级后的新增消息。覆盖安装前必须保存独立回滚数据；不得直接让旧内核操作升级后的活动资料目录。
- 软件管理的 API Key 仍保持最高优先级和原有加密存储，不复制到普通备份或终端环境。
- 官方反馈提交可能携带相关会话内容，仅在用户主动提交反馈时发生；普通对话不等于提交反馈。
- Office 恢复界面、Portable 冷启动优化和 24 小时老化不属于本次升级，不宣称已完成。

## 验证状态

完整源码测试 585/585 通过；固定运行库安全审计、会话迁移/冷读、打包文件一致性、生命周期及安全退出通过。本机已覆盖安装 V1.1.10，官方附件 GUI 和真实 DeepSeek Excel/Word 读取通过；旧会话、设置和加密 Key 保持不变。四项资产全部上传并核对大小及摘要后，已公开 [V1.1.10](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v1.1.10)；匿名完整下载 4/4、下载的校验清单 3/3 通过。详细证据见 [验证记录](VALIDATION.md)。
