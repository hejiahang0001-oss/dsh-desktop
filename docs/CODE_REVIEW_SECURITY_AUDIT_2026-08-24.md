# DSH Desktop 代码与安全审核报告

> 审核日期：2026-08-24  
> 初始审核对象：`44dcefb`（`codex/v0.5.4-session-checkpoint`）  
> 审核与整改方式：`code-review-excellence` + OpenAI `security-best-practices` + 测试先行整改 + 安装包真实验证  
> 结论：**Approve for Latest Pre-release。SEC-001 终端隔离和 SEC-004 IPC sender 校验已在 V0.5.5 完成；SEC-002 Electron 受支持线升级已在 V0.5.6 完成。发布阻断项为 0，剩余重要项继续按 V0.5.7–V0.5.8 整改；V0.5.4 Stable 不变。**

## 一、结论摘要

- 初始阻断项 2 项；当前已修复 2 项、剩余 0 项：
  - **已修复**：Harness Renderer 不再拥有 PowerShell start/write/resize/stop/state/output；终端移入本地隔离窗口并绑定精确 frame owner。
  - **已修复**：Electron 从 `35.7.5` 固定升级到官方受支持的 `43.4.1`，并通过窗口、Preload、IPC、PTY、真实 PDF、Harness、打包和覆盖安装验证。
- 初始重要项 6 项；当前已修复 1 项、剩余 5 项：
  - 代理保存缺少独立可信确认边界。
  - **已修复**：原先未校验的一组 IPC 已统一验证精确 WebContents、主框架和 URL，预览 iframe 默认拒绝。
  - 文件面板的敏感目录识别只检查文件 basename。
  - 软件 Key 仍以明文 YAML 落盘，未接入 DPAPI/Windows Credential Manager。
  - Windows 安装包未签名，也未启用 ASAR 完整性/Fuse 加固证据。
  - CI 只跑 Node 单元测试，没有安装冻结、构建、Electron 冒烟、静态检查和 IPC 权限回归门禁。
- 改进项：2 项
  - `electron/main.cjs` 仍超过 2500 行，职责过多；本轮已先抽出共享 IPC policy，后续继续按控制器拆分。
  - 多个状态文件直接覆盖写入，异常退出时可能损坏并回退到默认状态。

## 二、阻断项

### SEC-001：Harness Renderer 可向持久 PowerShell 写入任意输入（V0.5.5 已修复）

- 严重级别：**High / Blocking**
- CWE：CWE-862（Missing Authorization）、CWE-749（Exposed Dangerous Method or Function）
- 位置：
  - `electron/preload.cjs:78-83`
  - `electron/main.cjs:955-962`
  - `electron/main.cjs:1120-1145`
  - `electron/main.cjs:2256-2267`
- 证据：Preload 把 `terminal.start/write/resize/stop` 暴露到 Harness 页面；主进程只在启动时弹一次原生确认。终端处于 `running` 后，`terminal:write` 会直接把 Renderer 提供的文本送入 PTY。`desktopIpcAllowed`/`harnessIpcAllowed` 只验证 URL 属于 Harness origin，没有强制 `senderFrame === webContents.mainFrame`，也没有把 PTY 所有权绑定到独立可信桌面 UI。
- 可达条件：Harness 主页面发生 XSS、同源插件/子框架执行恶意脚本，或其他同源渲染代码失陷；终端已经由用户启动，或用户被诱导接受一次启动确认。
- 影响：恶意脚本可在用户看不到终端面板时分块写入 PowerShell 命令，以当前 Windows 用户权限读取/修改文件、发起网络请求或启动进程。
- 为什么现有控制不足：`sandbox: true`、`nodeIntegration: false` 和 Context Isolation 能阻止 Renderer 直接使用 Node，但 Preload 主动提供的 PTY 写能力就是跨越沙箱的特权通道。启动确认不能约束后续每一条输入的来源。
- 建议修复：
  1. 把终端 UI 移到独立、仅加载打包本地资源的可信 `BrowserWindow`/`WebContentsView`，使用专用 Preload；Harness WebContents 不再获得 `terminal.write`。
  2. 主进程记录终端 owner 的 `webContents.id` 与 `frame.routingId`，所有 start/write/resize/stop 均做精确绑定。
  3. 在隔离完成前，Latest 暂时移除集成终端入口，或改为打开系统终端。
  4. 新增真实 Electron IPC 测试：Harness 主框架、Harness 同源子框架、预览 iframe、状态页分别验证允许/拒绝矩阵。
- 临时缓解：不要内置来源不明的 Harness 插件；不要在加载不可信仓库内容时保持集成终端运行。
- 误报说明：该路径需要 Renderer 代码执行或用户启动终端，不是无需交互的远程攻击；但 Renderer XSS 被放大为本机命令执行，仍应作为发布阻断项。
- 整改结果：V0.5.5 新增只加载 `terminal.html` 的独立 sandboxed BrowserWindow 与 `terminal-preload.cjs`。Harness Preload 仅保留 `openWindow`；所有 PTY 输入、调整和停止只接受独立窗口精确主框架，活动 owner 同时绑定 `webContents.id`、`processId` 与 `routingId`。窗口关闭或 Renderer 丢失会停止 PTY。
- 整改验证：源代码测试先证明旧边界失败，再完成实现；118 项完整测试通过。解包版和安装版 IPC security smoke 均确认 Harness 侧只有 1 个固定动作、本地终端侧只有 7 个预期能力，并生成真实终端窗口截图。

### SEC-002：Electron 35 已超出官方支持窗口（V0.5.6 已修复）

- 严重级别：**High / Blocking**
- 位置：`package.json:18-20`
- 证据：项目固定 `electron: 35.7.5`。Electron 官方只支持最新三个稳定大版本；2026-08-24 的最新稳定版本为 `43.4.1`，受支持线为 41/42/43。
- 影响：应用捆绑的 Chromium、Node 和 Electron 安全修复不能继续从官方受支持分支获得，`pnpm audit` 也不会完整覆盖 Chromium/Electron 运行时漏洞。
- 建议修复：按 Electron 官方迁移建议逐大版本升级并执行回归，目标至少进入受支持线，优先 `43.4.1`；重点验证 Preload sandbox、iframe 导航、权限处理、xterm、node-pty、打包和覆盖安装。
- 整改结果：`package.json`、锁文件、离线 Electron 压缩包和打包路径统一固定到 `43.4.1`。下载脚本使用 `.partial`、重试、SHA-256 和 `electron.exe` 内容双校验，通过后才替换正式文件；DeepSeek Harness 与外置 Node/PTY 版本未混合升级。
- 整改验证：119 项测试和生产依赖审计通过；解包版与安装版桌面、Harness、IPC security 和 PDF smoke 均退出码 0。真实 PDF 桌面截图显示工具栏、缩略图和正文，自动视觉信号 `0.3363` 高于门禁 `0.08`；覆盖安装后 14 份会话、凭据引用和五项用户状态摘要完全不变。
- 验证来源：
  - https://www.electronjs.org/docs/latest/tutorial/electron-timelines
  - https://releases.electronjs.org/release?channel=stable

## 三、重要项

### SEC-003：代理配置可由 Harness 同源脚本静默改写

- 严重级别：**Medium / Important**
- 位置：
  - `electron/main.cjs:445-452`
  - `electron/main.cjs:2084-2087`
  - `electron/network-proxy.cjs:16-37`
- 证据：`network:save` 只通过 Harness origin 校验，随后持久化代理并重启 Harness；主进程没有显示变更前后的原生确认，也不要求独立可信设置页面。
- 影响：失陷的同源脚本可修改外部网络路由并造成拒绝服务、流量元数据泄露；若系统同时信任攻击者控制的 TLS 根证书，风险会进一步扩大。
- 已有缓解：代理 URL 禁止用户名/密码，DeepSeek API 使用 HTTPS，回环地址绕过代理。
- 建议修复：代理变更必须在主进程显示默认取消的原生确认；长期应移到与 Harness 内容隔离的本地设置窗口。

### SEC-004：部分 IPC 没有发送方校验（V0.5.5 已修复）

- 严重级别：**Medium / Important**
- 位置：
  - `electron/main.cjs:2089-2092`
  - `electron/main.cjs:2273-2281`
  - `electron/preload.cjs:12-23`
  - `electron/preload.cjs:95-103`
- 证据：`workspace:get-state`、`workspace:choose`、`diagnostics:get-state`、`diagnostics:refresh`、`harness:get-state`、`harness:restart`、`harness:open-log` 没有接收/校验 IPC event。Electron 官方明确说明所有 Web Frames（包括 iframe）理论上都可发送 IPC，且 Preload 会在每个 iframe 中加载。
- 影响：预览 iframe 可读取工作区绝对路径与诊断状态、弹出目录选择器、重启 Harness 或打开日志目录，形成信息泄露与界面/可用性攻击。当前未发现这些未校验接口能直接修改工作区文件。
- 建议修复：所有 IPC 统一经过一个 fail-closed 授权包装器；明确区分 `status-page main frame`、`Harness main frame`、`trusted local chrome`、`preview frame`，默认拒绝未列入矩阵的调用。
- 验证来源：https://www.electronjs.org/docs/latest/tutorial/security#17-validate-the-sender-of-all-ipc-messages
- 整改结果：新增共享 `ipc-policy.cjs`；`workspace:get-state/choose`、`diagnostics:get-state/refresh`、`harness:get-state/restart/open-log` 和终端接口全部 fail closed，并区分桌面主框架、Harness 主框架和本地终端主框架。状态页本地 URL 改为精确文件匹配。
- 整改验证：单元测试覆盖子框架、不同 WebContents、URL 不匹配、导航后 owner 变化；安装版 IPC smoke 退出码 0。

### SEC-005：文件面板未阻止敏感目录下的普通文件名

- 严重级别：**Medium / Important**
- 位置：
  - `electron/workspace-files.cjs:17-24`
  - `electron/workspace-files.cjs:77-80`
  - `electron/workspace-files.cjs:212-220`
- 证据：`isRestrictedWorkspaceFile()` 只对 `path.posix.basename(relativePath)` 匹配。实测 `.env` 返回 `true`，但 `secrets/token.txt` 和 `credentials/api.txt` 均返回 `false`。Checkpoint 模块则会检查每一个路径组件，两个策略已经漂移。
- 影响：文件树与搜索可能展示并读取放在 `secrets/`、`credentials/` 等目录中的文本凭据，与 README“不会显示疑似凭据、私钥”的承诺不一致。
- 建议修复：复用一份共享敏感路径策略，对每个路径组件检查；为敏感目录、大小写、嵌套路径、重命名和搜索结果增加测试。

### SEC-006：软件 Key 未做 Windows 系统级静态加密

- 严重级别：**Medium / Important（已知限制）**
- 位置：
  - `electron/main.cjs:341-343`
  - `electron/main.cjs:2349-2357`
  - `SECURITY.md:29-30`
- 证据：Key 由 Harness 写入 `%APPDATA%` 下的 `.credentials.yaml`。应用只在冒烟信息中检查 `safeStorage.isEncryptionAvailable()`，没有使用它加密/解密凭据。Windows 下依赖用户目录 ACL。
- 影响：同一 Windows 用户上下文中的恶意软件、误配置备份或同步工具可读取明文 Key。
- 建议修复：规划 DPAPI/Windows Credential Manager 适配；桌面端只向 Harness 提供短生命周期的内存凭据能力，禁止 Key 进入日志、终端、诊断和崩溃信息。
- 误报说明：这是仓库已公开声明的限制，不是本次新引入的回归；当前软件 Key 优先级和 PTY 环境隔离仍然有效。

### REL-001：公开安装包缺少签名和运行时完整性加固

- 严重级别：**Medium / Important**
- 位置：`package.json:95-108`
- 证据：`signAndEditExecutable` 与 `verifyUpdateCodeSignature` 均为 `false`；仓库未发现 `@electron/fuses` 或 ASAR integrity 配置。
- 影响：用户无法可靠验证发布者身份，SmartScreen 信任积累受限；安装目录或 ASAR 被篡改时缺少运行时完整性门禁。
- 建议修复：取得 Windows Authenticode 代码签名证书；发布过程记录并校验 SHA-256；评估启用 `EnableEmbeddedAsarIntegrityValidation`、禁用 `RunAsNode`/`nodeCliInspect` 等不需要的 Electron Fuses。
- 验证来源：
  - https://www.electronjs.org/docs/latest/tutorial/security#checklist-security-recommendations
  - https://www.electronjs.org/docs/latest/tutorial/asar-integrity

### REL-002：CI 没有覆盖真实依赖、打包和 IPC 安全边界

- 严重级别：**Important**
- 位置：
  - `.github/workflows/ci.yml:16-34`
  - `package.json:9-16`
- 证据：CI 只 checkout、设置 Node、执行 `npm test`；没有 `pnpm install --frozen-lockfile`、`pnpm audit`、lint/格式检查、Electron 启动冒烟、Windows 打包或安装包检查。现有 UI 测试多数为源文本断言，没有运行真实 IPC sender/frame 权限矩阵。
- 影响：锁文件漂移、打包缺文件、Electron API 行为变化、Preload 子框架暴露和授权遗漏不能在合并前被阻断。
- 建议修复：增加 `quality`、`security`、`package-smoke` 三层门禁，并将 IPC 能力矩阵作为集成测试。
- 当前验证：本次 `pnpm audit --prod --audit-level moderate` 返回无已知漏洞；该结果不覆盖 Electron/Chromium EOL 风险。

## 四、改进项

### ARCH-001：主进程文件职责过载

- 严重级别：**Important（维护性）**
- 位置：`electron/main.cjs`（当前约 2655 行）
- 证据：窗口导航、权限、Harness 生命周期、工作区、网络、终端、预览、Git、Checkpoint、菜单、诊断和全部 IPC 均集中在一个文件；当前已有“部分 IPC 校验、部分不校验”的实际漂移。
- 建议修复：先抽出 `ipc-policy` 与能力矩阵，再按 `terminal-controller`、`network-controller`、`checkpoint-controller`、`window-security` 拆分；拆分应保持行为不变并由集成测试护航。

### REL-003：持久状态直接覆盖写入

- 严重级别：**Minor**
- 位置：
  - `electron/workspace-store.cjs:38-45`
  - `electron/workbench-store.cjs:50-53`
  - `electron/network-proxy.cjs:113-116`
- 证据：状态文件直接 `writeFile` 覆盖；进程崩溃、磁盘满或杀进程时可能留下截断 JSON，下一次启动会静默回到默认值。
- 建议修复：统一使用同目录临时文件 + flush + 原子替换，并保留一个已验证备份。

## 五、已验证的良好控制

- `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、`webSecurity: true`；主窗口仅为 Chromium 内置 PDF 查看器启用插件能力。
- 主窗口导航、弹窗、新窗口和 Web permission 默认收紧；剪贴板只允许 Harness 主框架进行 sanitized write。
- Harness 固定绑定随机 `127.0.0.1` 端口；应用预览限制在 loopback，并隔离 Harness origin。
- Git 接受/拒绝和 Checkpoint 恢复在主进程重新检查状态，并使用默认取消的原生确认。
- 工作区读取有相对路径、大小、编码、二进制、符号链接和媒体签名限制。
- 软件 Key 不继承进入 Harness/PTY 环境，代理凭据被拒绝。
- DeepSeek Harness `0.1.1-rc.2` 与 npm 当前版本一致。
- 119/119 自动化测试通过；生产依赖审计未发现已知漏洞。

## 六、建议整改顺序

1. **V0.5.5 安全切片（已完成）**：隔离终端 UI/IPC，建立 frame 级能力矩阵，补真实 Electron IPC 测试，并完成解包版/安装版/覆盖升级验证。
2. **V0.5.6 运行时切片（已完成）**：Electron 固定升级到 `43.4.1`，完成窗口、Preload、真实 PDF/图片预览、PTY、覆盖安装和数据保留回归。
3. **V0.5.7 边界切片**：代理原生确认、补齐全部 IPC sender 校验、统一敏感路径策略。
4. **V0.5.8 发布切片**：CI 三层门禁、签名准备、Electron Fuses/ASAR integrity。
5. **后续 Stable 候选**：DPAPI/Windows Credential Manager 迁移和真实覆盖升级验证；只有维护者明确命令后晋升 Stable。

## 七、验证记录

- `node --test test/*.test.cjs`：119 通过，0 失败。
- `pnpm audit --prod --audit-level moderate`：No known vulnerabilities found。
- `pnpm view @deepseek-ai/dsh version`：`0.1.1-rc.2`。
- `pnpm view electron version`：`43.4.1`。
- V0.5.6 解包版与安装版桌面、Harness、IPC security、PDF smoke 全部退出码 0；Electron 版本 `43.4.1`；真实 Harness HTTP 200、Workspace 同步成功且未发送阻断 PDF 的 CSP。
- V0.5.6 覆盖安装退出码 0；Windows 注册版本 0.5.6；14 份会话、凭据引用和五项用户状态摘要保持不变；快照中凭据副本为 0。
- 解包版包含 29,370 个文件，安装目录只额外包含卸载程序；0 reparse point、0 terminal PDB；最终 `app.asar` SHA-256 为 `374C7050C8CBB1B085E66C36636D22AA73B66FC048A68C0BE68EE610CDE21DEC`。
