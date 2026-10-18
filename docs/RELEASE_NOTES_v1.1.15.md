# lulu V1.1.15 — 黑色短发与眼镜造型

2026-10-09；纯视觉迭代，已覆盖本机并完成下述安装验证，尚未公开 1.1.15。公开 Pre-release 仍为 1.1.14，Stable 仍为 1.1.12。

## 本次变化

- 按用户新图片及视频参考，更换为黑色短发、半框眼镜、头顶橘子、橙色短裤、比耶手势的噜噜。
- 同一透明 PNG 用于欢迎页、侧栏、启动/状态页；九档等比例 ICO 覆盖窗口、托盘、通知和安装程序。
- 原始用户图片/视频不修改，也不随安装包携带。素材为内置 imagegen 辅助提取的衍生图，保留生成 alpha，并非逐像素无损原图。提示与来源见 `assets/lulu/PROMPT.md`、`assets/lulu/SOURCE.md`。

## 不变的边界

Harness 仍固定 0.2.1-alpha.1；Agent、Office、文件、Key 优先级、代理、会话与托盘行为不变。软件身份和用户资料目录不变。GitHub 已发布的 1.1.14 资产不改写，本机覆盖升级状态另记；Stable 仍为 1.1.12，不自动晋升。角色公开分发权利未独立核验，不宣称官方联名或 MIT 素材。

## 本轮验证

- 图标/品牌/发布版本绑定专项 29/29。
- 真实源码窗口浅色、深色、1024×720 三情境通过：素材解码、输入可见/可聚焦、导航和无横向溢出；实际截图已回看。
- 根生产依赖审计 5 项无已知漏洞；并非重新审计整个官方运行库。
- 最终完整源码 912/912、零跳过，`test-31cNVN/result.json`（SHA-256 `ab7a953a34492b9add84c1d33ad7648c75e779734e80443638d6f97852a0e337`）；原首轮 911/912 因发布版本文档未同步失败，补齐后的版本专项 6/6，原失败保留。
- 新 Setup / Portable 构建完成且输入未变；全负载 15,424 文件、1,143,122,038 字节一致，Windows `lulu / 1.1.15` 身份通过，`packageReady=true`。汇总 `artifacts/lulu-visual-20261009/package-838E3d/report.json`（SHA-256 `7541b1bcfa33e98f8ab0c8cec63093de102adce1d3229087fe9cc6cdbd47143c`）。未签名、`automaticUpdateReady=false`。
- 独立窄代码审查无 Blocking / Important；正式业务代码、内核及依赖无变化。
- 新包生命周期通过 `artifacts/stable-readiness-20261007/lifecycle/lifecycle-ID3wFQ/report.json`；safe-exit 首次在 Harness 启动后 45 秒未就绪失败，`safe-exit-SWyctw/report.json` 保留。并发 I/O 影响只是待验证假设；原包输入稳定，不修改就绪门禁。
- safe-exit 串行复验通过 `safe-exit-6uvhYs/report.json`：同次正常显式退出、备份 clean、进程/端口残留为零；原失败不改写，单次串行成功不能证明并发 I/O 就是根因。
- Portable `harness-vjaZCW` 与 `terminal-Ko656v` 实际运行通过，终端原生键盘、工作区绑定、8项断言及自行清理通过，模型调用为零；主线程已回读终态，启动器、应用、guardian与Job均结束，来源未变。
- 安装前备份已复制，但最后 Windows 元数据操作报错。原失败、`INCOMPLETE` 与原清单保留；独立核查私有继承 ACL 无异常，继续对同一快照作独立来源/内容/停机补证，不重新复制、不修改失败标记，不把预写的 complete 当作成功。
- 同快照独立补证与覆盖后的保全核验通过：50 原语义文件、5 敏感副本、6 LevelDB 文件保持一致，未审新增为零；回滚副本及原失败完整保留。安装前后 111 项权限/归属/选区、文件身份与元数据均不变，未扩大系统权限，不将既有主机风险重新判为安全。
- 原目录已覆盖 **1.1.15**：安装器退出 0，新 EXE/ASAR 摘要和 Windows `lulu / 1.1.15` 身份一致。实际安装版隔离 profile 的浅色、深色及 1024×720 三情境通过，截图逐张回看；原 profile 未启动，不夸大为再次完成原资料迁移或完整模型验证。
- 安装态预检首次使用正斜杠读取 ASAR 条目失败，独立列举确认素材存在；仅改验证脚本为 Windows `path.join` 后通过，原 PNG 摘要要求不变、产品/包未改，失败证据保留。

## 本机交付与证据索引

- 安装位置：`%LOCALAPPDATA%/Programs/DSH Desktop/DSH Desktop.exe`，版本 1.1.15；用户资料仍使用原目录。
- 本地安装包：`artifacts/stable-readiness-20261007/dist-otcyNy/output/DSH-Desktop-Setup-1.1.15.exe`，SHA-256 `9847e3e616b528ad1bcbb30fb6193a448d7308a9d86369906d51282cb4d27b70`。
- 本地便携版：同目录 `DSH-Desktop-Portable-1.1.15.exe`，SHA-256 `9ff68dc9524321d5975f4b86f33f0a7f1498895dd57bd46fc6221f7ccf6ec10d`。
- 包验收：`artifacts/lulu-visual-20261009/package-acceptance-summary.json`（`8a4920ed274c669fcffcad4a6d95d9d4136295f7534119863892cf37643538bf`）。
- 原资料保全：`artifacts/lulu-visual-20261009/install/post-install-preservation.json`（`cc522705c1d599b2ce7f26e9178b9c2f6fadfaa6136be2d79bc28d3e4706254f`）。安装身份、权限差异分别记录在同目录 `install-receipt.json`、`acl-after-receipt.json`。
- 安装态视觉：`artifacts/lulu-visual-20261009/installed-brand-e7KWB1/report.json`；零模型调用、输入包摘要不变、正常结束。首次观察器失败单独在 `installed-brand-preflight-failure.json`。
- Wiki 使用现有 Obsidian 的 DSH Desktop 项目，不另建库；写后校验回执位于 `artifacts/lulu-visual-20261009/wiki-verification.json`，QMD 未配置则跳过。
- 这轮未提交/发布新的 GitHub 版本，不改写已公开 1.1.14 资产，不晋升 Stable；1.1.15 的公开 CI/tag/上传/回下载仍是后续独立工作。

## 证据与已知限制

- 新素材 SHA-256：`e9d1619e79acb6711aec1198368f2482926fd37aa580fd02f1a8b9d80235f0ee`；1087 × 1447 RGBA。
- `artifacts/lulu-visual-20261009/brand-pxiwWL/report.json`：三情境实际 UI；无模型调用，未读取原用户资料。
- `artifacts/lulu-visual-20261009/media-probe.json`：13.03 秒参考视频的三帧核对。
- `artifacts/lulu-visual-20261009/asset-backup-f24e718a39/`：替换前素材回滚副本。
- 开发 Electron 解包目录缺失，从本地固定 SHA-256 的 43.5.0 官方归档恢复，没有换版本或下载依赖。视频第一次因 `about:blank` 无本地文件来源而失败，改用仅本地媒体页后解码成功，原失败日志保留。
- 版本号改变后 pnpm 的工作区指纹预检拒绝启动测试；离线冻结安装确认 lockfile 无变化后重试，不关闭校验或隐式下载依赖。
- 极大尺寸放大图仍有少量边缘残色，二次清理试稿未带来明确改善，未采用；应用内小尺寸已查看。不宣称精修商业原画、动画、其他电脑验证或签名发布。
