# lulu 视觉改造 — 2026-10-03

## 范围与状态

用户确认：现有 DSH Desktop 的对外显示改为小写 `lulu`，使用抖音现有「水豚噜噜」，直接实现可运行界面；其他功能、快捷键、内核、Key 优先级、代理和更新通道不变。不迁移数据，不推进 ERP 或远程命令桥。

本轮为 **V1.1.14 未发布源码候选**，正式绑定仍为 Harness **0.1.6-alpha.2**。既有 0.2.0-rc.2 隔离适配证据保留，不能当作正式换核。本轮没有生成安装包、覆盖安装、推送 GitHub 或改变 Stable。历史记录中的本机 V1.1.13 / Stable V1.1.12 不作为本轮重新验收的安装事实。

## 形象来源

- 抖音定位：[水豚噜噜作品](https://www.douyin.com/video/7560638679044361518)。
- 角色核对：[中国授权展角色页](https://www.chinalicensingexpo.com/cn/product/1849)，展示主体为铁罐（北京）文化传媒有限公司。
- 使用原图 `assets/lulu/mascot.png`，600 × 600，未 AI 重绘；SHA-256 为 `28f2a3030c777205c828c14f9d0c4b86952aa537e89b404f2d70b3859b96919c`。
- Windows ICO 仅做尺寸/格式转换，16–256 px 共 9 层。旧图标留在 `artifacts/dsh-icon-before-lulu-20261003.ico`。
- 公开分发/代言授权未核实，不能将第三方角色标为 MIT 原创、官方联名或已授权；当前只纳入未公开的本地候选。详见 `assets/lulu/SOURCE.md`。

## 已实现

1. 启动页、窗口标题、托盘、菜单、关于、通知及桌面入口使用 lulu；历史导入标记保留 `lulu / DSH 历史`，避免旧数据来源混淆。
2. 10 个本地界面统一暖纸色/暖炭色、焦糖强调色、语义状态色、焦点和减少动画行为。包括启动、Dock、终端、上下文、扩展、Office、Wiki、Worktree、Git 交付、任务/子代理。
3. 官方主对话与 SideChat 只映射官方 CSS 变量，不替代官方交互。装饰 Logo 在限定的官方品牌容器内显示水豚；遵循官方明暗主题选择，不让系统暗色覆盖手动浅色。
4. 终端读取共享主题变量，保留 ANSI 语义、最小文字对比度、真实 PTY 与授权读取边界。
5. 新增 `PRODUCT.md`、`DESIGN.md` 及设计侧车，为后续界面变更保留边界和实际样式依据。

## 必须保持的兼容身份

| 展示层 | 保留的内部身份 |
| --- | --- |
| productName / 快捷方式名称：lulu | package.name：dsh-desktop |
| 窗口 / 菜单 / 托盘：lulu | app.setName：DSH Desktop，现有 userData 路径不改 |
| Windows ProductName / FileDescription：lulu | executableName：DSH Desktop，appId/AppUserModelId：com.dsh.desktop |
| 历史来源说明：lulu / DSH | 备份清单 product、IPC、运行时、更新仓库与通道不改 |

代码和构建器配置已检查；这**不等于实际覆盖安装、快捷方式更新或凭据保留已验收**。未修改依赖锁或 vendored 运行时。

## 验证与失败证据

证据目录：`artifacts/lulu-ui-20261003/`；所有 UI 验证用隔离资料，无真实模型调用、无读取/迁移用户会话或 Key。

- 改动前基线：642 项，640 通过、2 原有跳过，零失败，见 `../lulu-baseline-20261003.log`。
- 全量终测：`pnpm test` 共 648 项，646 通过、2 原有跳过，零失败，109040.5609 ms；见 `full-verified.log`。测试后没有继续修改产品代码。
- 聚焦验证：30 项通过，见 `focused-passed.log`；之后仅收紧 Logo 的 SlotOutlet 包装层规则，终测覆盖最终代码。
- Electron 独立窗口：command-feedback、office-center、wiki-center、side-chat JSON 均 `ok: true`；SideChat 使用页面夹具，不能替代真实官方 SideChat 全路径验收。
- 实际 Harness + 原生 Dock + PTY：`dock-final/dock.json` 的 23 项断言全部通过，另有顶层 `ok: true`；包括沙箱、关闭/停靠保持 PTY、5 类工具、窄窗/缩放、经确认的只读终端及停止。`realModel: false`。
- 实际品牌：`brand-verified/dock.json` 及 `.brand.json` 通过，`.brand.png` 复核主窗口与侧栏确实显示原图。该分支只验证视觉，不声称运行全部 Dock 断言。
- 浏览器检查启动页：浅色 1280×720、暗色/强制色 1024×720；图片加载成功、无横向溢出、键盘焦点可见、减少动画生效。此为静态生产页面，没有验证真实连接状态。
- `git diff --check` 通过。样式检测器因缺少解析依赖降级为正则，返回空列表不算完整样式审计；未为此添加依赖。
- 独立审查最初指出 SlotOutlet 包装层导致主窗口品牌失效，修复后重新核对 DOM 与截图并关闭 Important；限定范围内没有遗留 Blocking/Important。并非全部历史未完成适配都通过。

保留的问题轨迹：

1. `full-test.log` 的一项失败为“关于 DSH Desktop”旧断言；按确认品牌改为 lulu。
2. `dock/dock.json` 初次失败为终端方法清单断言过时，实际既有 `openWindow` 和 `openOfficial` 都仅打开窗口；补精确清单验证，没有增加 renderer 写终端权限。
3. `full-final.log` 的主题守卫将 `background-position` 误当 `position`；改为匹配完整属性边界。
4. `brand-probe` 揭示官方 renderSlot 包装层；`brand-final` 计算样式虽有背景但包装层是 `display: contents`，截图没有角色，不能算视觉通过。已在外层真实品牌盒子绘制，最终 `brand-verified` 有 DOM 与像素双证据。旧失败结果不删除。
5. 原图带有 libpng iCCP 色彩配置警告，原字节保留；当前已验证显示，未当作素材损坏或擅自重绘。

## 尚未完成与下一步

- 公开素材授权、完整 Office 引擎来源、既有新核正式迁移与完整发行门禁仍需处理；不自动删减用户要求保留的 Office 能力。
- 本轮没有打包/覆盖安装、安装态验证、公开下载、签名、多机、长期老化验证；不会把源码预览写成已安装或已发布。
- 品牌 CSS 针对固定 alpha.2 组件结构；真正升级内核时需重新核对 token、slot、类名与实际交互。
- Obsidian 同步在现有 `dsh-desktop` 项目内合并，保留历史路径，完成后记录同步证据；不新建重复 lulu 项目。

方法：impeccable / aidesk-ui / frontend-ui-engineering 用于可运行界面与状态边界，systematic-debugging 用于复现后修正，code-review-excellence 与 verification-before-completion 用于独立审查和证据分层，wiki-update 用于已有知识库同步。
