# lulu V1.1.14 Stable 就绪验收（持续推进）

本记录延续同一 V1.1.14 / Harness 0.2.1-alpha.1，不新增产品范围。源码通过、运行库、候选包、已安装、公开发行与 Stable 分开验收；当前尚未宣称 Stable-ready。

## 2026-10-08 当前检查点

以下新证据优先于文末早期“下一步”记录；旧失败继续保留。

### 最终候选冻结与实际检查（10 月 8 日）

- Windows 原子替换修复已独立终审：42/42 相关测试通过，包括真实 Windows 短时占用、永久占用及等待期间源/目标被替换的拒绝测试。只对 Windows rename 做有界退避，最多 7 次；不删目标、不重跑整个凭据事务。实际干扰进程未确定，不声称已找出外部锁持有者。
- 冻结产品源码 `test-qgcb9e`：**910/910，零失败/跳过，359.5 秒，输入未变**。同批 `dist-ahKtZw`：完整 NSIS/Portable 构建成功，显式 `--publish=never`，输入未变。随后仅修未入包的 Job 退出观察器及其测试，完整 `test-T1UpRM` **911/911，零失败/跳过，370.0 秒，输入未变**；没有修改包内产品源码。
- Setup 318,826,801 字节，SHA-256 `ecc60da24ba3550f43db8cf03b32b42336589d2b99c1162a7041fdab1baea9ce`；Portable 318,079,491 字节，SHA-256 `87e859566edcadf36c936d5948e549bdc1adcf4415f3d56f6873cb18d150985f`。最终 EXE `b59a499c848d00ba6382bd2a362e85567af38624626744506878c3ab7f1db2c4`，ASAR `107169a5c8b36cbe809e6e2057b994a1c79b2d66660555e3e75339aa320adf2c`。
- `portable/payload-8wlOfB` 核对当时源码/品牌身份、Setup 与 Portable 完整负载一致；观察器更新后 `portable/payload-nzv4FX` 再次逐文件通过，报告 SHA-256 `242ca6ec7784c8bd7eb0edfbc7ac0a4e2c1c3f48cb0af5932651e94a35f65b27`。这不代替真实 Portable 启动/清理。Windows Authenticode 确认 EXE/Setup/Portable 均 `NotSigned`，不声称签名或自动更新信任已通过。
- 同批目录程序实际通过 basic、Harness、附件同会话/跨工作区、全部文件/Office 预览、终端、Git Review、Wiki、Office、托盘及 Dock，全部正常退出且包摘要未变。证据依次为 `electron-basic-CmHmzG`、`electron-harness-Ypwtdn`、`electron-attachments-IFu7eW`、`electron-attachments-cross-MVT0bG`、`electron-preview-RveBUn`、`electron-terminal-aG9nYv`、`electron-review-l4TFMw`、`electron-wiki-FApVRQ`、`electron-office-399oZY`、`electron-tray-qmLck9`、`electron-dock-fYBl1A`。主线程另看 Word 第二页、Excel B5 的 123.45/SUM、PPT 中文表格/图表截图。
- 设置弹窗原 `electron-layout-L9x6tN` 总结果 **false** 保留：7 档几何、发送命中、关闭及状态保留通过，但观察器误计折叠 details 的五个隐藏按钮。独立 `modal/observed-05CLU9` 已在最终包真实折叠/展开、逐个控件命中、恢复折叠/Escape/面板状态全部通过，root 0、Job empty、guardian 0；展开截图人工检查通过。只关闭该假阴性，不改原报告。
- 最终包真模型 `model/workflow-oYibcr` 总结果仍 **false**：顺序断言已到归档前，证明排队、向上插话、精确 marker present、Ctrl+Enter、精确请求 user-aborted 及右文件栏断言已执行；清空草稿与 Stop settled 两个布尔当时未断言/保存，后来的 failure-state 仅补充 idle/无队列/无 draft/aborted 事后观测。真实 root 0、Job empty、guardian 0，密文及 Local State 未变。归档观察器未先打开实际折叠的左会话栏，不能据此判产品归档故障，也不能称完整工作流通过。拟复用原真实 V4 events 做独立归档/恢复验收，不重复高 token 模型流程。
- 工作流后置 ACL 原严格扫描不认识 Chromium 缓存的官方能力 SID；独立 `runtime-acl/workflow-oYibcr-metadata.json` 元数据校验通过（171 项、37 条限定缓存能力 ACE）。新扫描仅允许经官方 Chromium 源核对的网络服务 SID、精确缓存子路径及权限组合，其余私有文件仍限定本人/SYSTEM，拒绝链接/硬链接；未改 ACL、未读明文 Key。后置扫描通过不覆盖工作流失败。
- Portable 首轮 `portable/harness-uRtl9z` 失败保留：验收 TEMP 过深，私有 PS7 有 30 个长路径文件未解出；其余 628 文件字节均匹配。新的观察器独占真实用户 TEMP 下 3 字符随机目录，并在启动前对全部 15,424 路径硬校验最大 258 字符，再验证实际解包完整性；不是忽略缺文件或修改产品沙箱。真实短 TEMP 重试待验，更长 TEMP 不承诺。
- `lifecycle/lifecycle-DCg1gH` 已通过；`lifecycle/safe-exit-1nJT03` 原失败保留：Job active=0 先于 root handle 可读退出码，观察器过早发 empty。仅修未入包观察器为同时等待真实 rootReported，相关 16/16 含三个 Windows Job 实测通过；完整 **`lifecycle/safe-exit-xpYFVU` 重试通过**，runner/child 0、输入未变、没有强制清理。诊断生成的单个 ModuleAnalysisCache 已按准确路径移动到私有证据目录保留，后续诊断缓存定向到每次证据目录。
- 短 TEMP 的 `portable/harness-xhsXP3` 功能报告通过：HTTP 200、529 项运行库健康、191 个插件零失败，但总结果 false，不能据功能或启动器 0 声称完成。独审确认候选目录有三层仅诊断产生的空 `Microsoft/Windows/PowerShell`，归档没有，导致 observer 的目录完整性永远不满足，正常退出后才报绑定丢失。候选停止后精确核验 0 文件、3 个普通目录，整体移动到 `diagnostic-cache-20261008/evidence-empty-tree`，可恢复、不删除资料、不改观察器；重新核验 15,424 文件/1,141,571,656 字节/3,061 目录、全部冻结输入不变，再重跑原 Portable 门禁。
- 随后 **`portable/harness-vwxrmy` 和 `portable/terminal-9vA9xD` 均完整通过**：真实解包文件/摘要及活进程身份绑定，功能报告通过，launcher root 0、Job empty、guardian 0、应用消失、启动器自行清理解包目录、独占 TEMP 边界确认、输入未变。终端额外验证原生键盘执行、workspace 绑定、Key 不继承、紧凑面板、多独立终端、只读枚举保留输入及显式关闭。未强制清理；独占空 TEMP 保留，不删除用户 TEMP。IME、Host 重启后终端恢复、其他 shell/机器未验，较长 TEMP 限制仍披露。
- `proxy/packaged-Yxsvsf` 与 `packaged-iFMdTC` 未通过：原生确认框 UIA Invoke 不支持，后续精确 Button 守卫拒绝，尚不能判断产品代理故障。未绕过 native 保存/取消、未直接改配置冒充 UI 通过；原报告和强制清理事实保留。
- 新代理观察 `proxy/packaged-jg3SET` 明确：同 PID 的精确取消控件，UIA type=50033（Pane），但真实 HWND class=Button、可见/启用；原拒绝原因是 provider 类型与 Win32 控件不一致，不是产品代理失败。只准备精确原生 HWND/父对话框验证路径，不允许跨进程、全局按键或坐标回退；实际保存/取消仍未通过。
- 原生观察器仅按实际控件语义修正，13/13 单测含 PowerShell 无 UI 拒绝矩阵通过；主线程复核后，**`proxy/packaged-KcRYED` 机器验收及独立截图复核通过**。原生取消不改设置/不重启，原生保存后重启并重开面板保留设置，软件凭据元数据/测试密文未变，真实打包 Node 通过受控代理、loopback 绕过、环境 Key 清理均通过，应用自然退出 0、无强制清理。原 report 保持 pending-screenshot，独立 `visual-assessment.json` 绑定报告/两图摘要并记录实际检查；不声称已测企业代理或真实 DeepSeek 请求穿过代理。
- 最终包 **`model/approval-allow-juXVSM` 完整通过**：真实模型的拒绝与一次限定允许均验证对应文件效果，默认 `workspace-write` 未变；真实 root 0、Job empty、guardian 0、无强制清理，冻结输入与受限后置 ACL 校验通过。该结果替代旧包审批证据的适用范围，不覆盖归档、工作区交接或整个 workflow。
- 最终包 **`model/handoff-SbjiqZ` 完整通过**：outward、Harness进程存续、草稿引用、代码与暂存区、原目录未变、真实模型 history/cwd、冲突返回拒绝、返回、返回后的代码与暂存区、保留工作树、原生确认及恢复记录共 12 项均真；无强制清理。此模型结果说明实际交接链路，未隔绝模型读取旧目录，不能扩大成“纯对话记忆来源已形式化证明”。
- 独立归档恢复工具已准备，`archive/supplement-preparation.json`：12/12 纯测试、五文件语法检查通过，已补退出后官方冷读再次核对迁移副本事件数量/顺序/摘要及 header；未复制真实 fixture、未发模型或启动 UI。执行仍要求原生托盘明确退出与自然 root/Job 终态，未安排可用操作者前保持 prepared，不把工具准备当归档已通过。
- 安装备份两次在复制前被原进程门禁拒绝。只读确认无 DSH 主窗进程，但 Codex 的 10 个 `dsh_agent` MCP 服务使用已安装目录的 Node，且脚本仍从该目录加载 SDK。没有终止它们或放宽门禁；已向用户请求临时停用单个集成，必要时由用户保存工作并重启 Codex。真实备份、覆盖安装、安装态资料保留及公开发布均尚未执行。

以下为本轮较早检查点；上方同批候选结果优先，原失败及阶段范围继续保留。

- 新运行库已真实部署至 `vendor/harness-desktop-0.2.1-alpha.1-attachment-1`，descriptor `b0692fff88311e8cc326b7a7792b8e66620716176f3865c9a188dbaffcff82a7`。官方完整 build/pack、锁派生、冻结离线安装、14,173 文件树和原生 Office/PTY 等 5 组验证通过；不是仅改版本号。来源链校验补入全部构建输入及四段补丁，旧运行库保留。
- 新 V4 的 32 轮/64 消息/192 事件在真实 HTTP 分页及新 Host 重启后语义/字节一致；旧 0.1.6 实际 V3 的明文及 zstd 均完成 V4 迁移、冷读和旧 reader 回滚副本读取。证据 `history/formal-O1KZaU`、`migration-016-U2Ds5t`，不使用真实用户会话或模型。
- 旧 profile 未明确选择自动任务 bundle、但共享 Home 存有活动任务时，升级先暂停当前 Web 的整个自动任务驱动。原任务与 profile 不改，只有用户明确确认才恢复；忙状态门禁保留。真实红例 `automation-HetKAc`、最终绿例 `automation-rVswoK`。未来任务 fixture 未实际触发模型；不能据此声称到期执行已验。
- 第一轮源码测试 `test-uiVjLy` 852/848/4 失败保留；路径/布局旧断言、抽取后 helper 静态断言及许可证摘要同步后，`test-3ooogH` **852/852、零跳过、输入不变**。随后 `pack-ci8c59` 成功，使用当时 Electron 43.4.1。
- 该包启动、附件同会话、Office/PDF/Spreadsheet 真实预览、7 档布局、Git Review、Wiki/Office 入口、托盘均通过。主线程回看 Word 第二页、Excel 123.45/公式、PPT 表格图及窄窗/140% 截图；源 fixture 不变。Git Review 首轮隔离 PATH 缺已有 Git，已明确路径/摘要后重测通过，非要求用户另装 Git。
- 仍保留三个不计通过的包级结果：跨 workspace 附件功能通过但退出 `0x80000003`；一次 preview 启动的凭据写入失败（第二次全预览通过不覆盖首次）；terminal marker 超时且退出 `0x80000003`。终端截图证实首次引导模态抢焦点，未把命令送入 xterm；修正 smoke 前置取消引导及输入前/回车前精确焦点门禁，0/3 红例到相关 13/13 绿例，尚待新包。
- `0x80000003` 加 `PostQueuedCompletionStatus` 高度匹配 Electron 官方 [PR 52956](https://releases.electronjs.org/pr/52956) 的 Windows 延迟任务退出竞态；无本次 native 栈，不冒充已确诊。源码候选仅升级 Electron **43.5.0**，tag `v43.5.0` / commit `87cd122b5de69555831cd752578b810dd6e504d8`，官方 Windows ZIP SHA-256 `1fc131e62cafa02f0c94b5ec730c4eb1e8ce75e5f5b84f3c52a3443d86058184`。锁差异只此一个包；冻结安装通过。旧包及 `electron435-before-73336a93` 快照保留；不把换版本本身当修复验证。
- 凭据失败的 100 次真实合成原子写/80 次备份核验没有复现；新增安全写盘阶段/白名单错误码、保留首错并完整清理两临时文件，IPC 不输出原 message、stack、路径或内容。对应真实红测 11/19 到最终 **24/24**；这是诊断完善，**不是原失败根因已修复**。
- `test-CRMKuN` 完成 **868/868、零跳过、输入不变**，Electron 43.5.0 新包 `pack-ek0uD2` 成功。随后 basic、Harness 启动、跨 workspace 附件、全部 Office/文件预览及真实终端输入均通过且正常退出；本轮此前的 `0x80000003` 尚未在该包重现，不能据有限次数断言永久解决。
- `electron-layout-ZVCNxk` 再次复现启动失败；新诊断明确为 `primary-replace / EPERM`，不是模型 Key 无效。真实 Windows 无 Delete 共享的隔离文件句柄能复现同类原子替换失败；实际干扰进程未知。正在进行仅 Windows 原子 rename 的有界退避修复，禁止删目标/重跑整个凭据事务，永久锁必须失败保留原资料。
- 真模型 `model/workflow-tos3tc` 已通过排队、向上插话、随机文件写入及 present 交付，但脚本误用显示标签全文件名及后代选择器，导致可见的正确预览被误判；截图与失败保留。观察 helper 改为唯一可见选中 dock 与 resource basename 绑定，再核对可见 plain 内容精确随机 marker；红 5/1 到相关 18/18，独立审查通过。完整 Ctrl+Enter/Stop 尚未运行完成。
- 真模型 `model/approval-allow-uG2tmZ` 完成拒绝及一次限定授权：拒绝没有写文件、允许一次仅生成对应 fixture marker，准确关联申请/决定，默认 `workspace-write` 未变；程序正常退出、用户密文及 Local State 摘要不变。当前结果绑定该包，不充作随后改包的完整验收。
- 根生产审计 `audit-root-5NFKd2` 5 项零告警；完整构建依赖另有 38 项（3 low/13 moderate/22 high，32 GHSA）。独立实际包审查确认受影响旧版未在检查到的 ASAR/Harness/skills/pnpm 路径捆绑，开发依赖不能因此称安全；固定旧 build-pnpm、builder 凭据处理保留 Important，后续最终打包显式 `--publish=never` 且不继承 Key/Token。新 Harness 生产闭包 667 项此前零告警，不重建已有效的 Office/Harness。
- 品牌源码验收工具遗留 `ProductName=DSH Desktop`，已改为被摘要固定的 `build.productName=lulu` 精确匹配，同时保留 DSH appId/name/EXE/internalName 全部约束；20/20 红绿修复通过，独立评审无 Blocking。该工具不随包分发，无需仅为它重包。`proxy/packaged-ym92JM` 因源观察 helper 已变、包未重建而在启动前正确拒绝，不是产品代理失败；最终包生成后再跑。
- 安装前私有回滚工具经独立审查、23/23 合成测试：固定原安装/资料路径、运行进程门禁、受限 ACL、程序全树、语义资料、DPAPI 密文/Local State/代理独立原字节副本、完整 LevelDB WAL 集合；拒绝旧明文凭据，绝不纳入公开支持包。**尚未执行真实备份、覆盖安装或发布**。

本轮支持范围遵从用户确认：Windows 11 x64；Windows 10 暂不承诺。上方最终包通过项不重开；剩余为精确归档恢复、解除安装占用后的真实备份/覆盖和资料保留、公开下载及知识同步回读。最终包审批、交接、受控代理、Portable 和安全退出已有分项通过证据；Stable 保持原状态。

## 用户决定与边界

- 继续到可发布 Stable 的技术状态；Stable 通道不自动晋升。
- 允许一次限定审批测试：非管理员、只在新建隔离目录写随机标记、不改变默认权限、不读用户资料。
- 本次发行支持范围先承诺 **Windows 11 x64**；Windows 10 暂不承诺。保留功能及沙箱，不把本机结果推广到未经验证系统。
- 原版噜噜素材和九档等比例 ICO 沿用用户上传图；主窗 × 隐藏到托盘，独立退出入口保留安全退出。
- 沿用软件优先加密 Key、代理、Office/Wiki 校验与备份、Git Review 和 Windows 宿主边界。用户会话和凭据不参与隔离 fixture。

## 本轮修复及验证

### 官方附件草稿生命周期

仍使用官方 InputHub/SessionReference；以 `conversationDraft` 保留有附件或发送中的原会话，最后附件移除、成功发送、删除或根 teardown 时释放；错误恢复和转移目标保留顺序有回归覆盖。没有另造附件协议、持久化或桌面附件系统。

- 初版 11 条导航回归在未修源码上 9 失败/2 通过，在增量上全部通过；相关客户端组 172/172 通过。
- 完整官方构建随后发现新增测试 fixture 的 21 个严格 TypeScript 错误，保留 `build/build-kMR3sQ` 失败证据；以独立 type-only 增量修正，生成 JavaScript 不变。
- 最终类型增量的全客户端 aggregate tsc 通过，11/11 行为复核通过。父 profile、原附件补丁及失败报告均不覆盖。
- 最终源代码 `build/build-final-NEF5BV` 的完整 `build:official` exit 0，输入不变、子进程真实关闭。尚不能仅据构建成功宣布桌面附件验收完成。

### Office 全屏预览与窄窗布局

查明真正产品问题：官方 fullscreen panel 保持 absolute 定位，但桌面样式将左右留白施加在可能为零宽的 rightbar 列，造成正确文件已加载而预览宽度为零。改为显式可用视口宽度并右侧锚定，保留官方 stacking 行为。中间 fixed 方案导致输入卡遮挡已记录并回退，没有把中间退出码当作通过。

- `office/ui-9Shox0`：真实 Electron Word 2 页、PPT 3 页、Excel 中文/数值/公式和只读预览通过，6 张截图独立检查；原 fixture 源文件摘要不变。
- `layout-VMOgql`：窄窗、双面板、125%/140% 缩放等 7 场景几何/控件命中通过。
- 后续又收紧发送按钮 hit-test，增加同卡片兄弟遮罩拒绝测试；该最后增量须在最终包再验。
- 本轮只修布局和新版引导/预览验收契约，不替换 Office 引擎，不删除内容校验。

### 源码规范与装配追溯

- 既有私有 PS7 增量 5 文件/17 导出补齐接口注释；去注释 AST 和生成 JS 完全一致。
- 最终官方全源 JSDoc gate 通过：2,059 TS 输入摘要不变，见 `attachment/export-jsdoc-Rd8ywt`。原 39 项失败保留。
- 新装配保留原运行库作回滚，使用独立输出目录及新 descriptor；母补丁、附件、测试类型与注释四段来源均固定，部署校验必须追溯完整构建/pack/物化输入，不能只比较名称。

## 下一步和交付状态

1. 保留已完成的新运行库、最终源码全测、双包/完整负载、文件/Office/布局/终端、安全退出和 Portable 证据；不重复从头构建。
2. 补归档/恢复；工具独审与退出后事件保全核验准备完成，复用已产生的真实会话，在精确隔离与原生退出可验时执行，不重复高 token 模型工作流。真实 final-package 审批、交接及受控代理验收不重开。
3. 安装路径占用须用户决定后再处理；按原门禁真实备份、覆盖、安装态与资料/密文保留。没有备份时不先覆盖，不能改用另一个 Node 就假定 SDK 已脱离安装目录。
4. 同步原 Obsidian DSH 项目并完成公开下载验证后，才评估 Stable 技术就绪；通道晋升仍须明确命令。未签名、长期老化、较长 TEMP 和其他机器如实披露。

目前本机安装仍为 V1.1.13，既有公开 Stable 为 V1.1.12；本轮未覆盖安装或公开发布。Obsidian 按 wiki-update 同步既有项目，最终同步结果以 `artifacts/stable-readiness-20261007/wiki-followup/` 的事务回读为准；本文或“已生成补丁”本身不证明已同步，更不证明发行闭环。

证据基目录：`artifacts/stable-readiness-20261007/`。早期截图/测试失败与后来修复通过均保留，后者只覆盖各自输入及范围。
