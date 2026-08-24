# DSH Desktop 执行进度

> 日期：2026-08-25
> 当前构建：V0.5.8 Latest（本机已覆盖，GitHub Pre-release 已发布）
> 状态：V0.5.8 已完成上下文来源只读视图、全部本地发布门禁和远端资产验证；V0.5.4 继续保持 Stable

## V0.5.8 本轮进展

1. 工具菜单新增独立本地“上下文来源”窗口，展示 Code preset、桌面中文策略、项目规则候选链和 Harness 持久会话层，不复刻 Agent loop。
2. 规则发现严格对齐固定 Harness `0.1.1-rc.2`：全局 Harness Home，加项目根到当前工作区逐层的 `AGENTS.md`、`CLAUDE.md`、`AGENTS.local.md`、`CLAUDE.local.md`。
3. 主进程只读取有界文件元数据，不读取规则正文、隐藏系统提示、凭据、模型输入或对话内容；可按大小标出超过 Harness 1 MiB 单文件上限的候选，内容去重与总预算纳入范围明确留给 Harness 判定。
4. Renderer 只能提交主进程发放的短期内部标识定位已发现规则，不能输入任意文件路径，也没有读取或修改规则的 IPC。
5. 窗口保持 sandbox、Context Isolation、无 Node Integration、禁止导航和新窗口；工作区变化时立即关闭并清空旧标识映射。新增真实打包窗口 smoke，检查精确三项桥接能力、两份候选、正文不泄露和截图尺寸。

### V0.5.8 当前验证

| 验证项 | 当前结果 |
|---|---|
| 定向自动化 | 3/3 通过；覆盖 Harness 顺序、仅元数据、工作区令牌重置、本地窗口与窄 IPC |
| 全量自动化 | 128/128 通过；生产依赖审计无已知漏洞；主分支 Windows CI 通过 |
| 解包/安装 | 桌面、Harness、IPC、PDF、上下文窗口五类 smoke 全部退出码 0；注册版本 `0.5.8` |
| 数据保留 | 14 份会话及 29 个已选用户数据文件覆盖前后 SHA-256 完全一致 |
| 真实界面 | 1359×965 最终窗口截图可读；2 个规则候选、三项窄桥接能力与正文不泄露门禁通过 |
| 安装包 | `DSH-Desktop-Setup-0.5.8.exe`；183,277,540 字节；SHA-256 `7EFD2B18B5ABD10EAE24923303FA05EDB35C0993815EB7AE5F3E75704DDB47DC` |
| 安装一致性 | `app.asar` SHA-256 `8666CBEF8312262934A43E1AE545DD715EEDFD9244E7DCE27B4484CE2360E7CE`；解包 29,370 个文件，安装目录只多正常卸载器；0 reparse point、0 独立终端 PDB |
| 覆盖前快照 | `backups/pre-v0.5.8-20260825-015249`；32 个文件、14 份会话、0 个凭据副本；旧 0.5.7 本地发布物可从该快照恢复 |
| 发布完整性 | [v0.5.8](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.5.8) 为非 Draft 的 Pre-release；3 个远端资产大小/摘要一致，安装包直链 HTTP 200；[主分支 Windows CI 通过](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/32757364699)；V0.5.4 仍是 GitHub 正式 `Latest release` |

### V0.5.8 后计划调整

1. V0.5.9 优先统一 JSON 状态的临时文件、刷新、原子替换和已验证备份，并把真实语义数据快照纳入 CI/覆盖门禁。
2. V0.5.10 在只读上下文窗口的安全模式上增加插件 Profile 与依赖健康视图，不提前开放可变插件操作。
3. V0.5.11 再增加安全启停、失败关闭和故障恢复，并建立安装包瘦身与增量更新的可重复基线。
4. Stable 仍固定 V0.5.4；只有用户明确下达“更新 Stable”命令后才启动晋升验收。

## V0.5.7 本轮进展

1. 工具菜单新增 Windows 原生权限中心，集中显示 Harness 当前权限模式、待确认数量和桌面固定边界；允许/拒绝仍完全由 Harness 处理，桌面版没有新增第二套授权规则。
2. 代理设置在主进程规范化并比较前后值；真实变化必须经过 Windows 原生确认，默认按钮和关闭动作均为取消。取消不保存、不应用代理、不重启 Harness；无变化也不重启。
3. 文件面板与 Git Checkpoint 改为复用同一敏感路径策略，逐路径组件、大小写不敏感地阻止 `.env`、凭据目录、密钥和证书路径。
4. 文件树不能再展开 `secrets/` 等敏感目录，搜索不会进入这些目录；`secrets/token.txt`、`CrEdEnTiAlS/api.txt` 的文本和媒体预览均失败关闭。
5. 审查发现旧 Git pathspec 的 `secret*` 会误伤 `secretary-notes.md`；已改为大小写不敏感且组件精确的排除规则，并用真实临时 Git 仓库验证敏感文件不入快照、普通文件仍正常捕获。

### V0.5.7 当前验证

| 验证项 | 当前结果 |
|---|---|
| 测试先行 | 新测试先复现缺少权限中心、代理确认和嵌套敏感路径问题；实现后针对性测试通过 |
| 全量自动化 | 125/125 通过；覆盖原生代理确认、统一敏感路径、真实临时 Git 仓库和既有功能回归 |
| 代码审查 | `code-review-excellence` 审查未发现发布阻断项；1 个敏感 pathspec 过宽问题已整改并回归 |
| 生产依赖 | `pnpm audit --prod --audit-level moderate`：无已知漏洞 |
| 解包/安装 | 解包版与安装版桌面、Harness、IPC、PDF smoke 全部退出码 0；注册版本 `0.5.7`；29,370 个包内文件完整 |
| 数据保留 | 软件 Key 引用、14 份会话和 7 项持久状态摘要不变；LevelDB 仅轮换瞬态日志，5 个数据文件摘要不变 |
| 真实界面 | 权限中心可读且关闭默认安全；代理确认默认取消；Esc 后未保存并把界面恢复为“直连” |
| 安装包 | `DSH-Desktop-Setup-0.5.7.exe`；183,272,852 字节；SHA-256 `CEE81340F8CFEFA22A32487454D2DE57FC1A061B976DFB648C119DB4AF537A17` |
| 安装一致性 | `app.asar` SHA-256 `BC3745B0554C1E6E90BA1A5F499DE8B90E8E1A4D0C7C74E3107375F90ED31E62`；安装目录只多正常卸载程序；0 reparse point、0 terminal PDB |
| 覆盖前快照 | `backups/pre-v0.5.7-20260825-002436`；33 个文件、14 份会话、0 个凭据副本 |
| 发布完整性 | [v0.5.7](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.5.7) 为非 Draft 的 Pre-release；3 个远端资产大小/摘要一致，安装包直链 HTTP 200；[主分支 Windows CI 通过](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/32754200198)；V0.5.4 仍是 GitHub 正式 `Latest release` |

## V0.5.6 本轮完成

1. Electron 从 `35.7.5` 固定升级到 `43.4.1`；Electron 官方 Windows x64 压缩包在打包前校验 SHA-256 `C2EF9A5F65472C34D14BD3E67B7D14E66B0C01F124ABA45263D6A4232160E13A`。
2. 外置 Node.js `24.19.0`、DeepSeek Harness `0.1.1-rc.2` 和 PTY 依赖保持不变，避免把桌面内核、Agent 行为和 Shell 行为混在一次升级中。
3. 下载脚本改为 `.partial` 临时文件、最多 3 次重试、哈希与 `electron.exe` 双校验，通过后再原子替换目标；真实网络中断留下的损坏文件不会再冒充完整运行时。
4. 对照 Electron 36–43 破坏性变更复核窗口、Preload、权限、导航和 IPC；旧 API 扫描未发现命中，主窗口继续保持 sandbox、Context Isolation、无 Node Integration 和受限导航。
5. Electron 41 起 PDF 不再产生独立 WebContents，因此增加真实 PDF 渲染 smoke：生成有效 PDF、用主窗口同等安全偏好加载、通过桌面合成截图检查查看器视觉信号，并保留截图人工核对。
6. PDF 验收首次发现 CSP 会让查看器空白；去除仅测试页上的错误限制后，确认真实 Harness 页面不发送 CSP，PDF 工具栏、缩略图和正文均正常显示。主窗口只为内置 PDF 查看器启用 `plugins: true`，其他安全偏好未放宽。
7. V0.5.6 已直接覆盖本机 V0.5.5；Stable 标签、Stable 安装包和 GitHub `Latest release` 继续保持 V0.5.4。

### V0.5.6 当前验证

| 验证项 | 结果 |
|---|---|
| 自动化 | 119/119 通过；含固定版本、下载恢复、IPC sender/frame、终端 owner、真实 Windows PTY、PDF 文件边界和既有功能回归 |
| 生产依赖 | `pnpm audit --prod --audit-level moderate` 未发现已知漏洞；Electron 已进入官方最新三个稳定大版本支持窗口 |
| 解包运行 | 桌面、Harness、IPC security 与 PDF smoke 均退出码 0；V0.5.6；Electron 43.4.1；Harness HTTP 200、标题 `DeepSeek Harness`、Workspace 同步成功 |
| PDF 真实视觉 | 1000×754 桌面合成截图显示 Chromium PDF 工具栏、缩略图和正文；深色查看器像素信号 `0.3363`，高于自动门禁 `0.08` |
| IPC 能力矩阵 | Harness 页面仅 `openWindow`；本地终端窗口仅 `getState/onOutput/onState/resize/start/stop/write`；1449×875 终端截图视觉正常 |
| 正式覆盖 | 安装器退出码 0；Windows 注册项 `DSH Desktop 0.5.6`；安装版四类 smoke 均退出码 0 |
| 数据保留 | 软件 Key 引用、14 份会话文件集合及桌面、工作台、代理、Preferences、Harness 设置摘要在覆盖前后完全一致 |
| 安装包 | `DSH-Desktop-Setup-0.5.6.exe`；183,271,349 字节；SHA-256 `9DD8855634955F12996F2DF6A57CF42F2A3D9B32AF3782A2536299D0C1F7C893` |
| 安装一致性 | 解包版 `app.asar` SHA-256 `374C7050C8CBB1B085E66C36636D22AA73B66FC048A68C0BE68EE610CDE21DEC`；29,370 个包内文件，安装目录只额外包含卸载程序，0 reparse point、0 terminal PDB |
| 覆盖前快照 | `backups/pre-v0.5.6-20260824-224757`；含 V0.5.5 安装器和 14 份会话数据；0 个凭据副本 |
| 发布完整性 | [v0.5.6](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.5.6) 为非 Draft 的 Pre-release；远端安装包大小/摘要一致，下载直链 HTTP 200；[主分支 Windows CI 通过](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/32744187437)；V0.5.4 仍是 GitHub 正式 `Latest release` |

### V0.5.6 后计划调整

1. V0.5.8 增加项目规则、Harness 记忆与本轮上下文来源视图，只允许查看或操作用户可控来源。
2. V0.5.9 统一桌面持久状态的临时文件、刷新、原子替换和已验证备份，并补 quality/security/package-smoke 三层 CI 与语义化用户数据门禁。
3. V0.5.10 增加插件 Profile 与依赖健康视图，核对固定 pnpm store 和上游插件依赖的一致性。
4. V0.5.11 增加安全启停插件、故障插件恢复，并建立安装包瘦身与增量更新的可验证基线。
5. Stable 仍固定 V0.5.4；只有用户明确下达“更新 Stable”命令后才启动晋升验收。

## V0.5.5 本轮完成

1. 持久 PowerShell PTY 从 Harness 页面内嵌面板迁移到只加载打包本地资源的独立安全窗口；窗口保持 sandbox、Context Isolation、无 Node Integration 和受限导航。
2. Harness Renderer 只保留固定的“打开/聚焦安全终端窗口”动作，不再获得终端启动、写入、调整、停止、状态或输出能力。
3. 终端 IPC 只接受独立窗口的精确主框架，并把活动 PTY owner 绑定到 `webContents.id`、`processId` 和 `routingId`；窗口关闭、导航或 Renderer 丢失时停止终端。
4. 所有原先未校验的工作区、诊断和 Harness IPC 统一经过精确主窗口、主框架和 URL 策略；预览 iframe 与其他 Renderer 默认拒绝。
5. 安装包增加真实 IPC 安全 smoke：Harness 端只能看到 1 个固定动作，本地终端端只能看到 7 个预期能力，同时生成真实渲染截图供视觉核对。
6. V0.5.5 已直接覆盖本机 V0.5.4；Stable 标签、安装包和 GitHub `Latest release` 均未改动。

### V0.5.5 当前验证

| 验证项 | 结果 |
|---|---|
| 自动化 | 118/118 通过；含精确 IPC sender/frame、终端 owner、真实 Windows PTY 和既有功能回归 |
| 生产依赖 | `pnpm audit --prod --audit-level moderate` 未发现已知漏洞；该结果不覆盖 Electron 35 的运行时支持风险 |
| 解包运行 | 桌面、Harness 与 IPC security smoke 均退出码 0；V0.5.5；Harness HTTP 200、标题 `DeepSeek Harness`、Workspace 同步成功 |
| IPC 能力矩阵 | Harness 页面仅 `openWindow`；本地终端窗口仅 `getState/onOutput/onState/resize/start/stop/write`；旧内嵌终端资产未打包 |
| 真实视觉 | 安装包实际渲染 1449×875 安全终端截图；中文、状态、按钮、PTY 区和安全提示完整可见 |
| 正式覆盖 | 安装器退出码 0；Windows 注册项 `DSH Desktop 0.5.5`；安装版三类 smoke 均退出码 0 |
| 数据保留 | 14 份会话文件集合摘要不变；软件 Key 引用及桌面、工作台、代理、Preferences、Harness 设置摘要均不变 |
| 安装包 | `DSH-Desktop-Setup-0.5.5.exe`；162,583,825 字节；SHA-256 `A22184C1A0435EAD94502B4991F38B895299D4781C57F4C44F34360296F668AA` |
| 安装一致性 | 安装版与解包版 `app.asar` SHA-256 均为 `71BE2CE32EE1029E4AFF6FC1148F8D3D66BC647890DDDE085A047A26E818A90D`；安装目录 29,369 个文件、0 reparse point、0 terminal PDB |
| 覆盖前快照 | `backups/pre-v0.5.5-20260824-200843`；31 个文件；含 V0.5.4 安装器和 14 份会话数据；0 个凭据副本 |
| 发布边界 | V0.5.4 继续为正式 Stable；V0.5.5 不创建 GitHub Release/Pre-release，待 V0.5.6 把 Electron 升入受支持线后再恢复公开 Latest 发布 |

### V0.5.5 后计划调整

1. V0.5.6 优先把 Electron `35.7.5` 升级到受支持稳定线，并完整回归窗口、Preload、预览、PTY、打包与覆盖安装；这是恢复公开 Latest 发布的阻断门禁。
2. V0.5.7 已完成权限中心、代理原生确认与统一敏感路径策略；权限语义继续来自 Harness，不建立第二套授权体系。
3. V0.5.8–V0.5.11 按“上下文来源可见 → 原子状态与 CI → 插件健康 → 安全启停与恢复”拆成四个可独立验收的小版本。
4. Stable 仍固定 V0.5.4；只有用户明确下达“更新 Stable”命令后才启动晋升验收。

## V0.5.4 本轮完成

1. 新代码检查点可关联当前普通 Harness 会话及其最近一个已完成回合；临时 API 失败不会阻塞代码检查点或用户发送。
2. `Ctrl+Alt+H` 历史中明确区分“会话回合”“已关联但尚无完整回合”和“仅代码”三种状态。
3. 历史底部提供“只恢复代码”和“建立会话分支”两个独立动作；Enter 继续只恢复代码，不暗中改变会话。
4. 会话分支只调用 Harness 官方 `session.fork(sessionId, atSeq)`，并在切换前重新验证源会话、工作区、父子关系和非 subagent 来源。
5. 会话 ID、回合序号、commit、tree、index tree 和 ref 继续只留在主进程私有边界，Renderer 只获得布尔能力摘要。
6. 建立会话分支不恢复代码、不改变真实 Git 索引、不移动 HEAD，也不改写或截断原会话。
7. 发送前重新核对最近检查点是否属于当前选中会话；用户切换会话后会先建立新的关联检查点再继续发送。
8. 实机发现 Harness 页面启动自动聚焦输入框会误建无完整回合的检查点；最终版改为只响应真实点击、输入或发送，页面自动聚焦不建点。
9. 旧检查点、空会话、运行中会话、跨工作区、subagent、损坏 ref 和无法验证的分支响应全部失败关闭，仍可保留原有代码恢复能力。

### V0.5.4 当前验证

| 验证项 | 结果 |
|---|---|
| 自动化 | 114/114 通过；含会话关联、官方 fork 边界、私有元数据、双操作 UI、启动自动聚焦抑制和既有恢复/代理/复制回归 |
| 解包运行 | 桌面 smoke 与真实 Harness smoke 均退出码 0；V0.5.4；HTTP 200；标题 `DeepSeek Harness`；Workspace 同步成功 |
| 真实会话分支 | 从 1 个已完成持久会话建立手动检查点，界面显示“会话回合”；官方 API 产生 1 个普通子会话，父会话、同工作区和完整回合边界均核对通过 |
| Git 不变性 | 分支前后 HEAD、工作树 Diff、真实索引 tree 与 cached Diff 哈希完全一致；只新增 Harness 子会话，不执行代码恢复 |
| 真实桌面 | 1208×794 和 1024×720 均显示双操作；旧点及无完整回合点的分支按钮禁用；文件、Diff、终端和历史动作无裁切 |
| 启动时序 | 最终安装版加载到工作台前后 checkpoint item ref 数量及集合摘要保持 8，不再因页面自动聚焦产生多余项 |
| 正式覆盖 | 最终安装器退出码 0；注册项 `DSH Desktop 0.5.4`；安装版 Harness HTTP 200，标题 `DeepSeek Harness` |
| 数据保留 | 14 个会话；会话集合及 Key/桌面/v5 工作台/代理/设置哈希不变；8 个真实 checkpoint item refs 保留 |
| 安装包 | `DSH-Desktop-Setup-0.5.4.exe`；162,583,718 字节；SHA-256 `C07CF56B0D809F5D84655AD8513D02FCB77684A98D31420FB99036BD2CFD41F3` |
| 安装一致性 | 安装版与解包版 `app.asar` SHA-256 均为 `812D385BF6F27348A1C21BD75C2002C81BE39906F65D3E4A370C0ADBE5461003`；安装目录 29,369 个文件、0 reparse point、0 terminal PDB |
| 覆盖前快照 | `backups/pre-v0.5.4-20260824-135649`；23 个文件；14 个会话；0 个凭据副本 |
| 发布完整性 | [v0.5.4](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.5.4)；正式 latest、非 draft/prerelease；远端大小/摘要一致；latest 直链 HTTP 200；[Windows CI 通过](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/32697127999) |

### V0.5.4 后计划调整

1. 后续安全审核把 V0.5.5 调整为终端/IPC 隔离切片；原权限中心顺延到 V0.5.7。
2. 页面自动聚焦与 Harness 会话选择存在启动时序差异；V0.5.4 已禁止自动聚焦建点，并保留发送前会话复核。V0.5.8 稳定化继续覆盖重载、切换会话和分支后首轮发送。
3. 官方 fork 已验证只增加会话数据且不碰代码；后续版本仍不把“恢复代码 + 恢复会话”合并为一个模糊动作，避免扩大不可逆误操作面。
4. 当前真实仓库已有 8 个检查点 item refs，历史列表性能和键盘交互正常；接近 12 个后按 V0.5.8 计划复测，不提前引入可能过期的缓存。
5. 复核 `dataelement/dsh-desktop` 后继续保持 Claude Code 式编程工作台定位；V0.6 在插件市场之前先完成固定 pnpm store、Profile 一致性检查和故障插件恢复，V0.7 更新改为用户接受后才下载并支持跳过指定 Latest，移动端仍放在 1.0 以后。
6. V0.5.4 Stable 保持现名；V0.5.5 只形成独立品牌与无损迁移方案，具体名称经用户确认后才应用到后续 Latest，避免同名安装目录、快捷方式和公众认知冲突。

## V0.5.3 本轮完成

1. 模型菜单、`Ctrl+,` 和固定命令面板增加“网络与代理设置”，前台可选直连、Windows 系统代理或自定义 HTTP(S) 代理。
2. 软件在独立测试会话中连接 DeepSeek API，显示 HTTP 状态且不携带软件 Key；保存后统一重启 Harness，使页面和 Node 运行时使用同一有效路由。
3. 自定义代理只接受无账号密码的 HTTP/HTTPS origin；拒绝 SOCKS、凭据、路径、查询和 fragment，并固定绕过 `127.0.0.1`、`localhost` 与 `::1`。
4. Harness 子进程移除继承的大小写代理环境变量，只注入软件选择的 `HTTP_PROXY`、`HTTPS_PROXY`、`NO_PROXY` 和 `NODE_USE_ENV_PROXY`；集成终端不继承软件代理。
5. 网络设置写入用户数据目录的独立 `network-state.json`，不写安装目录，不与 API Key 混存；Agent 运行或等待确认时不允许切换网络。
6. 原全局权限拒绝策略改为仅允许当前随机回环 Harness 主页面的 `clipboard-sanitized-write`；剪贴板读取、子框架、其他来源和其他权限仍拒绝。
7. 增加 Windows 原生编辑菜单的撤销、重做、剪切、复制、粘贴和全选角色，键盘选区复制不再依赖隐藏菜单行为。

### V0.5.3 当前验证

| 验证项 | 结果 |
|---|---|
| 自动化 | 108/108 通过；含 URL/凭据边界、持久化、环境隔离、权限白名单、可访问 UI 和内置 Node 真实代理链 |
| 解包运行 | 桌面 smoke 与真实 Harness smoke 均退出码 0；V0.5.3；HTTP 200；标题 `DeepSeek Harness`；Workspace 同步成功 |
| 真实代理 | 内置 Node 访问无法直连的测试域名，只经本机 HTTP CONNECT 代理取得 `proxy-route-ok` |
| 真实桌面 | 1024×720 与最大化代理窗口无裁切；模型菜单显示当前模式；直连测试返回 DeepSeek API HTTP 401，证明未携带 Key 但网络可达 |
| 真实复制 | 打开已有持久会话并点击 Harness 复制按钮，界面显示“已复制”；验证过程未读取或输出剪贴板内容 |
| 正式覆盖 | 安装器退出码 0；注册项 `DSH Desktop 0.5.3`；安装版 Harness HTTP 200，标题 `DeepSeek Harness` |
| 数据保留 | 13 个会话；会话集合及 Key/桌面/v5 工作台/代理/设置哈希不变；4 个真实 checkpoint item refs 保留 |
| 安装包 | `DSH-Desktop-Setup-0.5.3.exe`；162,581,004 字节；SHA-256 `CFBCF77CD0AC028704FD42BEA3992C49067D31149D3B2C51B8998E00A01FD2A3` |
| 安装一致性 | 安装版与解包版 `app.asar` SHA-256 均为 `76D12AEACFAF70C47A140F76DCB15A77AAF022922E4ACA4BA538D414C86AB89C` |
| 覆盖前快照 | `backups/pre-v0.5.3-20260824-095123`；22 个文件；13 个会话；0 个凭据副本 |
| 发布完整性 | [v0.5.3](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.5.3)；远端大小/摘要一致；latest 直链 HTTP 200；[后续主分支 CI 通过](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/32683259791)；本地 108/108，CI 106 通过、2 项按无内置 PTY 环境跳过 |

### V0.5.3 后计划调整

1. 第二台电脑反馈表明“基础网络可配置”和“复制可靠”比新增恢复语义更阻塞使用，因此 V0.5.3 调整为跨环境兼容修复。
2. 原 V0.5.3 的会话/检查点关联顺延到 V0.5.4，不减少范围；权限界面、上下文来源和 V0.5 稳定化依次顺延到 V0.5.5、V0.5.6、V0.5.7。
3. 本版先覆盖无需认证的 HTTP(S) 代理。认证代理、SOCKS、PAC 诊断和按域路由等待真实反馈，不提前扩张保存凭据的安全面。
4. 复制问题通过最小权限修复，不建立桌面自有会话消息复制层；后续 Harness 升级需要继续回归其剪贴板权限名称和按钮反馈。
5. GitHub 干净 Windows 环境暴露出旧检查点预览同时读取 Git 索引时的偶发锁竞争；主分支已改为顺序读取并连续 5 轮专项、完整 108 项和远端 CI 通过，该稳定性修正随下一安装包带入。

## V0.5.2 本轮完成

1. `Ctrl+Alt+H`、视图菜单和固定命令面板增加“浏览代码检查点”，最多显示最近 12 个本地安全点。
2. 每个历史点显示来源、本机时间、最近标记、真实影响路径、Git 索引变化、回收站新文件和敏感路径保留摘要。
3. 历史核对只建立一次当前非敏感 Git tree，再与每个目标比较，避免为 12 个目标重复扫描和暂存完整工作区。
4. Renderer 只获得严格 checkpoint ID 与有界显示摘要，不获得 commit、tree、index tree、ref 或文件路径。
5. 选择恢复时主进程重新解析私有 ref，并要求 commit 与确认前预检一致；外部替换、伪造或损坏 ref 失败关闭。
6. 历史界面提供加载、空、忽略无效项、超范围、未变化、取消和失败状态，支持上下键、Enter、Escape、焦点循环与关闭后恢复原焦点。
7. 所选旧点继续复用 V0.5.1 的原生默认取消、safety point、回收站、敏感路径/索引保留、分支/HEAD 不移动和失败回滚。
8. GitHub CI 官方 Actions 升级为 `checkout@v7`、`setup-node@v7`，保留 Windows Node.js 24 测试。

### V0.5.2 当前验证

| 验证项 | 结果 |
|---|---|
| Git 核心 | 两个合法历史点排序与所选旧点恢复通过；伪造 ref 被忽略；Renderer 摘要不含 commit |
| UI/接口 | 固定命令、严格 ID、12 项上限、ARIA listbox/option、键盘与紧凑/强制色样式测试通过 |
| 自动化 | 100/100 通过 |
| 真实桌面 | 1024×720 与最大化窗口均无裁切；上下键、Enter、Escape、默认取消和取消后零恢复通过 |
| 正式覆盖 | 安装器退出码 0；注册项 `DSH Desktop 0.5.2`；安装版 Harness HTTP 200，标题 `DeepSeek Harness` |
| 数据保留 | 13 个会话；会话集合及 Key/桌面/v5 工作台/设置哈希不变；3 个真实 checkpoint item refs 保留 |
| 安装包 | `DSH-Desktop-Setup-0.5.2.exe`；162,576,040 字节；SHA-256 `03D98C21CADD6AEF324A5B9DBAB67086A34EDFE469EEF5F358064C300205B913` |
| 安装一致性 | 安装版与解包版 `app.asar` SHA-256 均为 `C5EEEE459A875F1D13C6EF74F33749A9B2AE606104341EC06FDD894B4E515681` |
| 覆盖前快照 | `backups/pre-v0.5.2-20260824-080459`；21 个文件；13 个会话；0 个凭据副本 |
| 发布完整性 | [v0.5.2](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.5.2)；远端大小/摘要一致；latest 直链 HTTP 200；[CI 通过](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/32675976172)，0 注释且无 Node 20 Actions 警告 |

### V0.5.2 后计划调整

1. V0.5.3 关联 Harness 会话节点与代码检查点，但继续区分“只恢复代码”和“从会话节点建立分支”，不改写历史会话。
2. 历史列表首版固定最近 12 个，先观察真实仓库性能和辨识度；搜索、分页、删除和云同步不提前扩张。
3. 当前 Git 快照只构建一次再比较多个目标；如果 12 点实机仍偏慢，下一版优先增加同一工作树状态下的短生命周期缓存，而不是降低安全核验。
4. 真实仓库 3 个检查点首次列表约 3 秒且后续交互即时，V0.5.3 暂不引入缓存；到 12 个真实点后再按实测决定，避免缓存造成恢复预览过期。

## V0.5.1 本轮完成

1. `Ctrl+Alt+R`、视图菜单和固定命令面板增加“恢复到最近代码检查点”。
2. 恢复前通过 Windows 原生提示展示影响路径、会进入回收站的新文件、保持不变的敏感路径和 Git 索引变化，默认选择取消。
3. Agent 运行/等待/排队或持久终端运行时禁止恢复，避免与写入中的工作区竞态。
4. 确认后先创建新的 safety checkpoint，再恢复代码工作树和原暂存区；分支与 HEAD 不移动。
5. 新增未跟踪代码先进入 Windows 回收站；`.env`、`.npmrc`、私钥和 secrets 等敏感工作树及当前敏感暂存状态均保持不变。
6. 恢复失败自动应用 safety checkpoint；成功后 safety point 保持为最近项，可立即再次恢复以撤销恢复。
7. 恢复成功后原位刷新文件树与 Git 审查，不重载 Harness 会话。
8. 恢复范围超过 500 路径时失败关闭；最近项选择器和会话 Rewind 不冒充本版能力。

### V0.5.1 当前验证

| 验证项 | 结果 |
|---|---|
| Git 核心 | 临时真实仓库已验证已跟踪/未跟踪恢复、回收站语义、敏感工作树与敏感索引保留、HEAD 不变、safety checkpoint 和 Windows CRLF |
| 原生交互 | 1024×720 解包桌面 `Ctrl+Alt+R` 展示原生摘要，“取消”为默认焦点；Enter 取消后 status/index 哈希不变 |
| 自动化 | 98/98 通过；含无变化精准预览、回收站失败回滚和 501 路径失败关闭 |
| 正式覆盖 | 最终安装器退出码 0；注册项 `DSH Desktop 0.5.1`；Harness HTTP 200，标题 `DeepSeek Harness` |
| 数据保留 | 13 个会话；会话集合及 Key/桌面/v5 工作台/设置哈希不变；2 个真实 checkpoint item refs 保留 |
| 安装包 | `DSH-Desktop-Setup-0.5.1.exe`；162,572,783 字节 |
| 安装包 SHA-256 | `2B235A1D463EBF203AA0967783CC3ECEBC7AB04D47F3334418B0645EB43D19E6` |
| 安装一致性 | 安装版与解包版 `app.asar` SHA-256 均为 `2B787A808BA46AE20CB29E7B999E433253CEE34AEC2CC1767FCD25256CA087B0` |
| 覆盖前快照 | `backups/pre-v0.5.1-20260824-042438`；21 个文件；13 个会话；0 个凭据副本 |
| 发布完整性 | [v0.5.1](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.5.1)；远端大小/摘要一致；latest 直链 HTTP 200；[CI 通过](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/32666336706) |

### V0.5.1 后计划调整

1. 恢复测试证明 Windows 工作树过滤会产生 CRLF，后续以 Git tree/规范化文本验证语义，不用原始换行误判失败。
2. 恢复后不重载 Harness，显式刷新文件树和 Diff，避免页面重载自动建立新检查点并覆盖“立即撤销”的 safety point。
3. V0.5.2 增加有界检查点历史、来源/时间/影响摘要和选择恢复；仍不允许任意 commit 输入。
4. V0.5.3 再接 Harness 会话分支/继续与代码检查点关联，区分“只恢复代码”和“从会话节点继续”。
5. 实机发现检查点内已有的未跟踪文件会被旧预览算法重复计数；V0.5.1 已改为临时 Git tree 对比，只提示和回收真正变化的文件。
6. GitHub CI 已通过，但平台提示 `actions/checkout@v4` 与 `actions/setup-node@v4` 的 Node 20 运行时弃用并临时强制到 Node 24；V0.5.2 先升级官方 CI Actions，再交付检查点历史，避免基础验证链累积技术债。

## V0.5.0 本轮完成

1. 新增 `GitCheckpointManager`，用临时索引、`write-tree`、`commit-tree` 和私有 refs 保存回合前代码状态。
2. 检查点不切换分支、不移动 HEAD、不改工作树和真实索引；独立 Git 测试已逐字节验证索引保持。
3. 工作树与索引树共同参与去重；相同状态沿用最近检查点，不产生重复 commit/ref。
4. `.env`、`.credentials*`、credentials/secrets、SSH 私钥、`.npmrc` 和证书密钥扩展名从快照排除，UI 只显示排除数量。
5. Harness prompt 输入框聚焦/输入时提前创建；识别到的发送按钮或 Enter 若遇到仍在创建的检查点，会先等待再重放发送。
6. Agent 忙碌结束后重新武装下一回合；`Ctrl+Alt+B`、视图菜单和命令面板提供手动入口。
7. 当前只接受 Git 仓库根目录，嵌套工作区失败关闭，避免越过用户选择范围。
8. 实机发现 ISO 时间直接截取会显示 UTC；菜单和提示改为按本机时区格式化，Git 元数据继续保留标准 ISO 时间。

### V0.5.0 当前验证

| 验证项 | 结果 |
|---|---|
| Git 核心 | 修改文件、新文件和 `.env` 排除通过；status/真实 index 前后相同；相同状态去重通过 |
| 自动化 | 97/97 通过 |
| 实机输入焦点 | 聚焦真实 Harness 输入框自动建立 1 个 private ref；检查点包含本轮未提交新文件，来源 automatic |
| Git 不变性 | 真实 index SHA-256 与 status SHA-256 建立前后完全相同；再次触发沿用最近检查点，ref 仍为 1 |
| 可见状态 | `Ctrl+Alt+B` 显示“代码未变化，沿用最近检查点。”；本机时区显示修正通过 |
| 正式覆盖 | 安装器退出码 0；注册项 `DSH Desktop 0.5.0`；Harness HTTP 200，标题 `DeepSeek Harness` |
| 数据保留 | 13 个会话；会话集合及 Key/桌面/v5 工作台/设置哈希不变；真实 checkpoint ref 保留 |
| 安装包 | `DSH-Desktop-Setup-0.5.0.exe`；162,570,692 字节 |
| 安装包 SHA-256 | `6705D2DC73A2EBE546D99CC7B996F5E52091A90457E13B00F4224BDE848A53DC` |
| 安装一致性 | 安装版与解包版 `app.asar` SHA-256 均为 `4263F41ED3ADA22F188995F94AB3DDB7AE2D4F6F7089B6B506C8067509657ED5` |
| 覆盖前快照 | `backups/pre-v0.5.0-20260824-035352`；21 个文件；13 个会话；0 个凭据副本 |
| 发布完整性 | [v0.5.0](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.5.0)；远端大小/摘要一致；latest 直链 HTTP 200；[CI 通过](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/32663110422) |

### V0.5.0 后计划调整

1. V0.5.1 读取当前已保存的工作树 tree 与原 index tree，恢复前先创建一个新的 safety checkpoint。
2. 恢复只允许当前 Git 根工作区，先显示将覆盖/移除的有界文件计数并做原生确认。
3. 敏感路径在检查点与恢复两端都排除，不能因“回退”覆盖用户的本地 Key/证书文件。
4. 实机证明输入框可能在脚本注入前已获得焦点，因此保留“安装后检查当前 activeElement”作为自动建立兜底；后续恢复 UI 不依赖该时序。

## V0.4.8 本轮完成

1. 工作台状态升级为 schema v5，新增 80%–140% 的持久界面缩放，0.1 步进并自动夹紧。
2. `Ctrl+=`、`Ctrl+-`、`Ctrl+0` 覆盖完整 Harness 与桌面工作台；“视图”菜单显示当前百分比。
3. `Ctrl+Alt+0` 一次恢复文件、预览、终端、审查面板开关、尺寸和 100% 缩放；关闭预览时先释放软件管理端口。
4. 缩放与重置同时进入固定白名单命令面板，不增加任意命令执行能力。
5. 760 CSS 像素以下终端有效高度限制为 210px，文件、预览与审查头部同步收紧；用户保存的大窗口高度不被改写。
6. 增加 `--smoke-window-size=1024x720` 的有界实机烟测入口，只影响测试启动窗口。

### V0.4.8 当前验证

| 验证项 | 结果 |
|---|---|
| 自动化 | 93/93 通过 |
| 1024×720 实机 | 100% 三面板完整；140% 侧栏覆盖与 210px 紧凑终端可用；重置恢复默认；审查列表焦点环可见 |
| 正式覆盖 | 安装器退出码 0；注册项 `DSH Desktop 0.4.8`；Harness HTTP 200，标题 `DeepSeek Harness` |
| 数据保留 | 13 个会话；会话集合及 Key/桌面/v5 工作台/设置哈希覆盖前后相同 |
| 安装包 | `DSH-Desktop-Setup-0.4.8.exe`；162,567,003 字节 |
| 安装包 SHA-256 | `975137816DAE921ED17FE996A4EF32BF2DEC787C9B7466DA8CECB121B1D76764` |
| 安装一致性 | 安装版与解包版 `app.asar` SHA-256 均为 `C4FFF9BF5634F71A7B061D679A5DDCE91E77F92B4D82327E7D9ED5CB75C7ED28` |
| 覆盖前快照 | `backups/pre-v0.4.8-20260824-032305`；21 个文件；13 个会话；0 个凭据副本 |
| 发布完整性 | [v0.4.8](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.4.8)；远端大小/摘要一致；latest 直链 HTTP 200；[CI 通过](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/32661461695) |

### V0.4.8 后计划调整

1. 若紧凑窗口通过，V0.5.0 不再继续做视觉扩张，直接进入自动代码检查点。
2. 自动检查点只保存 Git 对象与有界元数据，不切换分支、不改变用户工作树或索引。
3. V0.5.1 的恢复必须在恢复前再建立安全检查点，并对工作树覆盖进行原生确认。
4. 140% 下 CSS 视口会进入既有窄屏覆盖模式，实机验证比仅按物理窗口宽度判断更可靠；后续紧凑测试同时覆盖 100% 与最大缩放。

## V0.4.7 本轮完成

1. 增加 `Ctrl+Shift+P` 和“视图 → 打开命令面板…”，不另建项目、会话或 Agent 体系。
2. 固定白名单收纳 11 个已有工作台动作：聚焦对话、新建 Harness 会话、切换/聚焦文件、应用预览、终端、Git 审查，以及重载 Harness。
3. 支持搜索、上下键选择、Enter 执行、Escape/遮罩关闭和关闭时恢复原焦点。
4. 命令输入不会进入 Shell、文件 API、IPC 或 JavaScript 求值；面板只调用既有受限接口。
5. 增加 ARIA 对话框、列表框、选项和活动项语义，以及紧凑窗口、强制色和减少动态效果样式。
6. 实机用“文件搜索”过滤并按 Enter 后，面板关闭且左侧文件搜索框得到焦点；Escape 关闭通过。
7. 修复动作失败时原焦点引用过早清空的问题。
8. 版本一致性测试集中读取 `package.json`，避免日更版本号散落在预览/终端测试中。

### V0.4.7 当前验证

| 验证项 | 结果 |
|---|---|
| 自动化 | 90/90 通过 |
| 解包版实机 | V0.4.7、13 个会话、软件 Key 已配置；命令面板搜索、Enter 与 Escape 通过 |
| 正式覆盖 | 安装器退出码 0；注册项 `DSH Desktop 0.4.7`；Harness HTTP 200，标题 `DeepSeek Harness` |
| 数据保留 | 13 个会话；会话集合及 Key/桌面/工作台/设置哈希覆盖前后相同 |
| 安装包 | `DSH-Desktop-Setup-0.4.7.exe`；162,566,222 字节 |
| 安装包 SHA-256 | `2B9842ED34CF2525AF96EE50C52325C1C24D771D61428F44206ADF6690E6A99F` |
| 安装一致性 | 安装版与解包版 `app.asar` SHA-256 均为 `3E34EA7ED4B317A4C91C9564E4C488BD4279366B42DE8340B8FA6511C2FA2018` |
| 覆盖前快照 | `backups/pre-v0.4.7-20260824-025712`；21 个文件；13 个会话；0 个凭据副本 |
| 发布完整性 | [v0.4.7](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.4.7)；远端大小/摘要一致；latest 直链 HTTP 200；[CI 通过](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/32660139810) |

### V0.4.7 后计划调整

1. V0.4.8 把布局重置和界面缩放加入同一命令入口，并按 1024×720 实机烟测收敛面板裁切。
2. V0.4.6 的全运行时备份耗时过长；V0.4.7 起保留上一版安装包、会话/状态小型快照和不含凭据的哈希证据，完整 V0.4.6 last-known-good 继续保留。
3. 实测发现 `harness/profiles` 仍嵌入自己的 `node_modules`；后续快照明确排除整个 profiles 运行时闭包，只保留 sessions、storages、设置和桌面状态。误生成的局部快照已送入 Windows 回收站，可恢复。
4. V0.5.0 先交付自动代码检查点；V0.5.1 再交付显式确认的恢复，避免一次版本同时放大保存与破坏性恢复风险。

## V0.4.6 本轮完成

1. 在现有文件 Quick Look 中增加 PNG、JPEG、WebP、GIF 和 PDF 专用预览，不建立第二套文件入口。
2. 图片支持适合窗口与 25%–400% 缩放；PDF 支持上一页、下一页、直接页码、适合窗口和 50%–300% 缩放。
3. 图片上限 24 MiB、PDF 上限 40 MiB；路径越界、链接/联接、疑似凭据、内容签名错误和跨类型伪装继续阻止。
4. 真实桌面发现 `app-screenshot.png` 内容实际为 JPEG；策略调整为受支持图片间的扩展名误写可按真实 MIME 打开并提示，图片/PDF 跨类型不放行。
5. PDF 从受限 iframe 改为 Chromium 隔离的本机 `embed` 渲染，实际一页 PDF 的文字与页面可访问状态均已读取成功。
6. 修复图片模式误显示 PDF 页码控件的问题；最终图片模式只显示缩放/适合窗口。
7. 自动化回归 87/87 通过；正式安装版 Harness HTTP 200，标题为 `DeepSeek Harness`。
8. V0.4.6 已直接覆盖 V0.4.5；13 个会话、软件 Key、桌面状态和工作台状态哈希全部保持一致。

### V0.4.6 验证证据

| 验证项 | 结果 |
|---|---|
| 单元/集成测试 | 87/87 通过 |
| 图片实机 | 1208×794 JPEG 内容以 `.png` 文件名打开，显示真实格式提示；PDF 控件已隐藏 |
| PDF 实机 | 一页 PDF 实际渲染并读取到 `DSH PDF Preview 0.4.6` |
| 正式安装版 | Harness 随机回环 HTTP 200；注册项 `DSH Desktop 0.4.6` |
| 数据保留 | 13 个会话；Key/桌面/工作台状态哈希覆盖前后相同 |
| 安装包 | `DSH-Desktop-Setup-0.4.6.exe`；162,563,961 字节 |
| 安装包 SHA-256 | `62EABBEB2A652B60B25B0F0DDA05AD460464C301D05483A6D34AEA4A18424EB5` |
| 安装一致性 | 安装版与解包版 `app.asar` SHA-256 均为 `C14FF9CFD33D297BCE637D533C9F8B75C9CB62B32F2B37572200AEE3A44A68F5` |
| 覆盖前快照 | `backups/pre-v0.4.6-20260824-021839`；58,560 个文件；786,634,659 字节；0 个凭据副本 |

### V0.4.6 后计划调整

1. V0.4.7 继续交付全局命令面板与快捷键帮助。
2. 版本号测试改为集中读取当前 manifest，避免连续日更时散落的旧版本断言。
3. 后四版改用“上一版安装包 + 每版用户状态快照”作为回滚点，不重复复制完全相同的离线运行时闭包。
4. V0.4.8 增加布局重置、1024×720、界面缩放和完整焦点矩阵。

## V0.4.5 已完成

1. 在现有 Harness 工作台中增加应用预览层，不新建窗口、Agent 或聊天入口；文件、预览、终端和 Harness 继续使用同一仓库。
2. HTML Quick Look 增加“应用预览”，由软件在随机 `127.0.0.1` 端口提供当前工作区 HTML、CSS、JavaScript、图片、字体、JSON、SVG 和 WASM 资源。
3. 可连接已经运行的 `127.0.0.1`、`localhost` 或 `::1` HTTP/HTTPS 开发服务器；支持端口简写、重新加载、浏览器打开、停止和离线监控。
4. 软件管理的端口在停止、关闭面板、切换仓库或退出时释放；外部开发服务器只连接和监控，不会被 DSH Desktop 结束。
5. 预览限定回环地址，拒绝凭据、远程地址、Harness 自身 origin、父目录跳转、链接/目录联接、工作区外路径、疑似凭据文件和超过 32 MiB 的托管文件。
6. 预览 iframe 使用独立 loopback origin 和 sandbox；Renderer 仍保持 sandbox、context isolation 和无 Node integration，子框架不能调用桌面 IPC。
7. 面板显示未启动、连接中、可用、离线、失败和已停止状态，并明确标识来源、端口以及端口由软件还是外部服务管理。
8. 新增 `Ctrl+Alt+P` 开关、`Ctrl+Alt+L` 聚焦，面板开关进入工作台 schema v4 并在 Harness 重载和软件重启后恢复。
9. 自动化回归增至 85 项；真实桌面验证发现并修复 Electron 35 `will-frame-navigate` 事件签名兼容问题，避免本机 iframe 被误拦截。
10. 普通窗口和 2560×1392 最大化窗口均实际渲染 `index.html`；停止后随机端口已确认不可访问。
11. 解包版与正式安装版均通过 V0.4.5、`zh-CN`、Windows 安全存储、随机回环 HTTP 200、标题和 Workspace 同步烟测。
12. V0.4.5 已直接覆盖 V0.4.4；原有 13 个会话、软件 Key、桌面状态和工作台状态均保留。

## 验证证据

| 验证项 | 结果 |
|---|---|
| 单元/集成测试 | 85/85 通过 |
| 工作区 HTML | `index.html` 及相对资源在随机回环端口实际渲染 |
| 端口生命周期 | 停止后端口不可访问；切换仓库、关闭面板和退出均接入释放路径 |
| 外部服务边界 | 仅允许本机回环；外部端口标记为非软件所有，只监控、不结束 |
| 桌面布局 | 1208×794 普通窗口与 2560×1392 最大化窗口通过；文件、预览和终端无裁切 |
| 正式安装版 | V0.4.5、`zh-CN`、`safeStorage=true`；Harness `0.1.1-rc.2`；随机回环 HTTP 200；Workspace 同步成功 |
| 会话持久化 | 覆盖安装后仍为 13 个会话 |
| 用户状态 | 软件 Key、桌面状态与工作台状态哈希在覆盖前后保持一致；未读取或输出 Key 明文 |
| 安装包 | `DSH-Desktop-Setup-0.4.5.exe`；162,561,775 字节 |
| 安装包 SHA-256 | `733F68A1A3F48F65BFA73B50C8136A1AF6D1675785FF92E1030FD82D6F1B4EA7` |
| 直接覆盖 | 安装器退出码 0；Windows 注册项 `DSH Desktop 0.4.5` |
| 安装一致性 | 安装版与解包版 `app.asar` SHA-256 均为 `4F83979629DE9B407AA4B4FBB34EE56F1B842355AE357A75CEA7E4427BD5D615` |
| 预览资源 | 安装版 `app.asar` 包含 `preview-manager.cjs`、`workbench-preview.js` 和 `workbench-preview.css` |
| 安装闭包 | 解包版 29,368 个文件；安装版 29,369 个文件；0 个重解析点；0 个终端 PDB |

## 安装与回滚

- 当前正式目录：`%LOCALAPPDATA%\Programs\DSH Desktop`
- V0.4.5 覆盖前快照：`backups/pre-v0.4.5-20260824-011037`
- 快照包含旧程序和非凭据用户数据，共 62,379 个文件、1,006,226,877 字节。
- 快照中 `.credentials.yaml` 为 0 个；软件 Key 仍只保留在用户数据原位置。
- V0.4.4 及更早版本前的可用快照继续保留，不覆盖历史回滚点。

## 未宣称完成

- 本版应用预览仅覆盖工作区 HTML 与已有本机开发服务器；图片/PDF 专用查看、设备尺寸预设、开发者工具和远程 URL 未完成。
- 当前只有一个持久 PTY；尚无终端标签页、分屏、Shell 配置选择或终端会话快照。
- 文件查看仍是有界只读文本预览，不是代码编辑器；没有保存、多标签编辑和语法服务。
- 尚无自动 Checkpoint、会话级 Rewind 和完整 Plan 取消/恢复状态视图。
- 搜索不读取文件内容，也未实现完整 `.gitignore` 语义。
- rc.8 曾出现 Harness Workspace Write `0xC0000005`；本轮没有用计费模型重测该路径，因此不宣称 rc.2 已修复。
- 软件 Key 仍使用 Harness `0.1.1-rc.2` 的 `.credentials.yaml` 与 Windows 用户目录 ACL，尚未接入 Credential Manager/DPAPI。
- 自动更新、代码签名和 Harness 兼容矩阵流水线尚未完成。

## 下一优先级

1. V0.4.6 增加图片/PDF 专用预览和清晰的加载失败、过大文件与不支持格式状态，完成应用预览切片。
2. V0.4.7 增加命令面板、快捷键帮助和布局恢复入口。
3. 补齐 1024×720、高对比度、文本缩放和完整键盘焦点视觉矩阵。
4. 下一 Daily Build 继续直接覆盖 V0.4.5，并保留不含凭据的 last-known-good 快照。
5. V0.6 内置固定版本、隔离运行的 pnpm，由原生插件管理器代办安装、升级、卸载、启停和回滚。
