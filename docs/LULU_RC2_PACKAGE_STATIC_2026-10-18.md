# lulu 1.1.17：官方复核与替代包内容检查

## 官方版本

2026-10-18 08:03:55（北京时间）通过官方 GitHub Releases、标签和 npm 核对：31 个 Release、32 个标签中，最高完整版本仍为 **0.2.1-rc.2**，标签 `dsh-v0.2.1-rc.2`，提交 `687f282e8625c6b8d11ff58211a90524be2e4317`，发布于 `2026-10-17T08:16:33Z`。与当前源码固定内核完全一致，无新增发布标签，不采用未发布 master。

npm `@deepseek-ai/dsh` 的 next 为 `0.2.1-rc.2`，latest 仍为 `0.2.0-rc.2`，alpha 为 `0.2.1-alpha.5`；按完整语义版本比较，不将 dist-tag 名称或 rc 后缀单独作为升级依据。官方来源：[Release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.2)、[标签](https://github.com/deepseek-ai/deepseek-harness/tags)、[npm](https://registry.npmjs.org/@deepseek-ai%2Fdsh)。

检查回执：`artifacts/upstream-checks/2026-10-18/check.json`，SHA256 `7f43da193214ffb74f5299488819b17342e87ffe8dc6f85366ad6b4f9652e89c`；同目录保留 releases/tags/npm 原始元数据。

## 本轮唯一新增验收

沿用已存在的 `artifacts/stable-readiness-20261007/dist-fA7r83/output/`，不重新构建、安装依赖、执行源码全测、请求模型或启动 lulu。独立只读评审发现整套旧包装检查会重复提取/哈希两次，因此只执行一次现有 `scripts/release-governance.cjs`，补上前轮基本检查未覆盖的完整发行负载绑定。

实际退出码 0，`packageReady=true`、`payloadBinding.accepted=true`。Setup、Portable 和 win-unpacked 均为 **16041 文件 / 1147303710 字节**，逐文件一致，无缺失、多余或摘要差异。三者负载树 SHA256 同为 `bcb7a0727643d33cd88a065d8ca1abbfc965321dd2842dba5149ba9e41ab778a`。

通过的静态项目包括：lulu/1.1.17 Windows 身份、正式 rc.2 描述与内核负载、Office 引擎、私有 PowerShell、Node、pnpm、终端/宿主文件、桌面插件、Office/Wiki Skill 文件和许可证。旧 legacy 运行库路径不适用于当前 official-desktop-runtime 分支，不将它的未启用字段作为失败或冒充已验证。

命令依据为已安装 1.1.16 的 blockmap 与本次 1.1.17 双包，**不是公开 1.1.14 的差分验证**。检查器只运行固定 7-Zip 和只读版本信息 PowerShell；顺序临时解包后按既有脚本清理其自建临时目录，未删除额外历史产物或触碰用户资料。命令已结束。

回执：`artifacts/stable-readiness-20261007/dist-fA7r83/governance-heartbeat-20261018.json`，SHA256 `f307424001f88a77a7d1070ed8d243f5b962887ea1189d1c0aeacc15d72a7e38`。双包名称和构建摘要沿用[前轮固定记录](LULU_RC2_DELIVERY_SCOPE_2026-10-18.md)。

## 保留的边界与下一步

- 无新增内核或产品能力；此前官方负责模型/Search/Fetch/插件/会话，桌面保留加密 Key 优先级、代理、Office/Wiki 校验备份、Git Review 和 Windows 保护的决定不变。Search/Fetch 不自动开启。
- 用户取消的输入法对照不恢复；搜狗 SGTool 历史退出残留没有新增证据，不重复运行同一退出门禁，也不将拒绝对照解释为风险已接受或问题已修复。
- 本次 `packageReady` 仅表示静态包内容合格，不是完整可安装候选/Portable 实际启动、正常退出、覆盖安装、资料保全或公开下载证明。后续仅围绕尚缺的必要最终运行与安装验收，不回到依赖构建或全量测试。
- 安装包仍未签名，自动更新验收未通过；没有改变签名设置或自动更新通道。
- 本机仍为 1.1.16 / Harness 0.2.1-alpha.2；公开 Pre-release 1.1.14、Stable 1.1.12 不变。本轮未运行安装器、上传草稿、公开发布或晋升 Stable。

Wiki 同步以本文为冻结来源，仅增量记录本轮静态证据及未交付边界，不改写旧失败。同步回执随后记入 PROGRESS 和 VALIDATION。
