# 2026-09-26：保留 DSH 桌面，复用官方能力

## 用户决定与交付边界

用户确认“保留，官方有的能力用官方的”：保留本项目独立 Windows 桌面，逐项接入官方等价实现并删除重复实现，不迁移到官方 Electron 宿主。另下载官方客户端供独立体验；未授权执行安装包、导入真实凭据或迁移现有资料。

本次继续同一未发布源码候选 V1.1.14，固定 Harness `0.1.6-alpha.2` / `ddefc45fbc7f8e46dd73185e68295696d1297887`。对照官方已发布 `0.1.7-rc.2` / `477b4f420553e8a52c2fbccc464d7561b239c443`，不把参考代码当成已经接入的运行库。

## 已实施：移除旧文件读取通道

- 删除 `files:list`、`files:read`、`files:preview` 三个 Main IPC 和三个 Preload 方法，及 `WorkspaceFiles.listDirectory/readFile/readPreviewFile` 的旧实现、文本解码、媒体签名/base64 传输和专用常量。生产代码删除 240 行。
- 当前界面已只使用 `files.search` 与受保护的 `files.resolvePreview`，随后经官方 `sidebarRight.openResource` 打开文件；alpha.2 实际 vendor 已提供目录、文本、图片和 PDF 预览。不是把这些用户能力删除，而是删掉已不再调用的另一套后端。
- 保留跨目录文件名搜索、路径描述、敏感文件/私钥过滤、绝对路径/越界/Junction 拒绝，以及会话和工作区前后核验。文档导入、HTML 本地应用预览仍使用共享安全逻辑。
- 补真实 Preload 的 API 表面测试，明确禁止重新暴露旧三接口；把旧读取器的安全测试迁到仍运行的描述入口。补 alpha.2 `byId/retainedBy.mainView/binding` 的文件/终端导航、无效主会话和异步绑定变化测试。
- 仅本次七文件合计 +98 / -302，净减少 204 行。八份写前备份位于 `artifacts/official-desktop-dedup-2026-09-26/source-before/`，可恢复本次删除；既有 session-control、备份、用户文件及未提交工作保持不动。

## 后续官方替换与桌面保留

| 能力 | 决定与理由 |
| --- | --- |
| 普通文件浏览、文本/图片/PDF/Office 侧栏预览 | 继续用当前官方实现；本次清理已退役的桌面文件字节通道，不再发展第二套普通预览。 |
| Word / PPT / Excel 通用生成教程与基础结构检查 | alpha.2 vendor 已包含官方三种 Office Skills 和 `check_office.py`，并非 rc.2 首创。但本宿主仍运行自己的 CJS 工具，官方 Python 离线依赖闭包尚未验证。优先接通官方 Skills、依赖提供和生成链路，对等验证后删除重复生成器。 |
| Office/Wiki 安全与恢复 | 保留 ZIP/XML/路径约束、危险公式/外链检查、备份、摘要、防文件变化、恢复收据等桌面差异。官方结构 checker 不等于这些数据保护；共同检查项通过验证后可逐项合并。 |
| 终端 | 普通终端已经走官方。兼容终端的授权只读输出、脱敏、PID/runId/会话绑定尚无已验证的等价替代，暂保留；不以官方 PTY 键盘跟随代替授权只读。 |
| HTML 本地应用预览 | 区分托管回环端口与外部服务所有权；官方文档预览和 rc.2 受租约浏览器未证明完全等价，先保留。 |
| 快捷键、窗口、托盘、更新 | 优先复用官方 Web 能力，但官方 Electron Main/IPC 不会随 npm 内核升级自动运行；本项目窗口、安装来源和更新通道仍需自己承接。 |
| 软件 Key、代理、Git Review、Windows 保护 | 继续保留加密 Key 最高优先级、网络隔离、持久 Git 审阅、沙盒/导航/回环与剪贴板写权限门。官方同名入口不等于相同权限和持久语义。 |

下一顺序：先修工作区切换后的工具目录绑定（Blocking）与卸载清理，接通官方 Office 生成及校验；重复生成器退役必须有失败保留、写入授权、原文件不变和备份恢复证据，再继续 rc.2 完整适配。此次不整删任何仍在使用的产品能力。

## 官方客户端来源

- 官方 GitHub Release 页面没有附 Windows 资产，但精确 rc.2 源码的生产更新配置指向 `https://download.deepseek.com`，Windows 更新清单位于 `dsh-desk/feeds/win-x64/nightly.yml`。
- 对应官方 Windows x64 安装包：`deepseek-harness-0.1.7-rc.2-win-x64.exe`，288,245,480 字节（约 274.89 MiB），属于预发布/nightly 通道，不是 Stable。
- 官方清单 SHA-512（base64）：`AY7f45dYO7BFrfgaLmzXNWP0pavlxkSbsehPo/WF6PXcFdDK3fF1oHUPs/4f2bzROgQvm6wSgawZ/g7UzbPRmw==`。独立下载目录 `C:/Users/86186/Downloads/DeepSeek-Harness-Official/`。
- 下载完成，主线程在 2026-09-26T13:19:20Z 独立复核大小、官方 SHA-512 与 Authenticode。SHA-256：`0cf065dc2fc56456448620230581a9072477f0b2562bbc4e1709cdaedd3ceb86`；签名 `Valid`，签发对象为 `Hangzhou DeepSeek Artificial Intelligence Co., Ltd.`，文件产品版本 `0.1.7-rc.2`。实际文件为 `C:/Users/86186/Downloads/DeepSeek-Harness-Official/deepseek-harness-0.1.7-rc.2-win-x64.exe`。
- 下载初期单连接低吞吐，保留有效前缀后分段续传，最终只以完整安装包摘要判定成功；目录元数据曾滞后，不将此前大小不变误报为完全无传输。完整包复核后清理本次临时前缀/分段字节，HTTP/失败元数据另存 artifacts；安装包和源码备份保留。未执行、安装或自动迁移，也未检查安装后或其他电脑的运行效果。

## 验证与未完成项

- 实施前审查聚焦 24/24；删除后聚焦 48/48。这包括 VM/源码契约和实际临时文件/Junction，不代表真实 Electron 画面或安装态验收。
- 2026-09-26T13:16:01.735Z 完成全量 `pnpm test`：633 项 / 631 通过 / 0 失败 / 2 跳过 / 0 取消，106728.7608 ms，退出 0。`test-result.json` 记录所有受跟踪生产/测试文件运行前后摘要一致。两项跳过仍因旧固定源码检出已清理（启动代理优先级和官方 Queue/Steer/Stop 归属），不是通过或免验；本轮新增 alpha.2 绑定测试不代替它们。根生产依赖 5 项新审计零已知发现，不是 rc.2 完整运行库审计。
- 已知工作区绑定、工具卸载、Office 来源及 Portable 门禁没有因本次清理而解除。未生成 DSH 安装包、覆盖安装、公开发布或修改 Stable；已安装 V1.1.13、私有草稿和 Stable V1.1.12 不变。
- 没有使用真实 API Key、模型或用户文档；官方包下载成功也不能代替自有桌面构建/交互/安装验收。未验证其他电脑和长期老化。

## 证据来源

- 本项目 `electron/workspace-files.cjs`、`electron/official-file-preview.cjs`、`runtime/dsh-desktop-tools/client.js` 与对应测试；实施前审查 `artifacts/official-desktop-dedup-2026-09-26/overlap-review.md` 的行号是旧源码位置。
- [官方 rc.2 发布](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.7-rc.2)。
- [精确官方桌面更新配置](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/apps/desktop/scripts/desktop-auto-update-environment.mjs)。
- [官方 Windows 清单](https://download.deepseek.com/dsh-desk/feeds/win-x64/nightly.yml)；该清单会更新，本轮快照保存在 artifacts。
