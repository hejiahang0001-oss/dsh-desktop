# lulu V1.1.14 剩余验收清单

状态：2026-10-08 只读审计后的执行清单，不是安装、发布或 Stable 已完成证明。固定 Harness 0.2.1-alpha.1 / Electron 43.5.0；最终包为 `artifacts/stable-readiness-20261007/dist-ahKtZw`。以下证据路径均相对该验收基目录 `artifacts/stable-readiness-20261007`。

用户已接受缓存问题的**条件式 Important 风险**：只有另行资料边界审计通过，才继续交付；这不是把旧全根 ACL 失败改成通过，也不授权扩大 ACL 白名单、关闭沙箱或修改 DACS/驱动。资料边界结果由专门报告记录，本清单不预判通过。

## 1. 复用现有证据，不重开整轮

| 范围 | 当前可复用的最终包证据 | 尚需边界 |
|---|---|---|
| 官方页面、品牌、附件及预览 | `electron-dock-fYBl1A`、`electron-attachments-IFu7eW`、`electron-attachments-cross-MVT0bG`、`electron-preview-RveBUn`；布局七档 `electron-layout-L9x6tN` 的几何/发送命中，另由 `modal/observed-05CLU9` 关闭隐藏按钮假阴性 | 安装后的图标/快捷方式及基础窗口确认；原 layout 总失败不改写 |
| 核心插件、审批与交接 | `electron-harness-Ypwtdn`：529/529 closure、191 插件/0 failed；`model/approval-allow-juXVSM`、`model/handoff-SbjiqZ` | 不宣称逐一测试所有插件业务；交互两项窄缺口见下节 |
| 私有 PS7 与真实终端 | 既有官方来源、PIPE/PTY/Loader 证据；`electron-terminal-aG9nYv`、`portable/terminal-9vA9xD` | 安装目录完整性及安装态入口触达；不重新临停 Nahimic |
| 双包、退出与代理 | `dist-ahKtZw/governance.json`、`portable/payload-nzv4FX`、`portable/harness-vwxrmy`、`lifecycle/safe-exit-xpYFVU`、`proxy/packaged-KcRYED` 及独立视觉评估 | 安装和公开分发状态不能由候选包代替 |
| 归档与自然退出后历史 | `archive/supplement-tqCGqX` 的真实 UI/托盘退出，配合 `archive/post-exit-proof-k1Yzwa/proof.json` | 只关闭对应归档恢复项；不覆盖长驻留缓存失败 |

源码 911/911、Office 来源/native、生产闭包及同一冻结包已有有效证据，未变输入不重复全量测试或构建。未签名、较长 TEMP、Windows 10、其他机器、IME 和长期老化保持如实披露，不扩大为本轮新范围。

## 2. 两项交互：窄补证，不重跑整个 workflow

`model/workflow-oYibcr` 因归档观察失败，未返回局部检查汇总；原报告保持 false。冻结 helper 的顺序强断言已证明 Queue、向上插话、精确 marker/present、Ctrl+Enter 执行、精确请求的 user-aborted 以及侧栏。该次绑定的 helper、测试及最终 EXE/ASAR 摘要在本审计再次核对一致。

真正缺口只有两个直接时点记录：

- `sentTextCleared`：Ctrl+Enter 接受/执行后草稿清空，当时只是赋值，未立即断言/写出。
- `officialStopSettled`：Stop 后 `running=false && pending=0 && turnOpen=false`，当时同样未立即断言/写出。

后来的 `smoke.json.failure-state.json` 只证明**稍后**为空草稿、idle、零队列及 aborted，不能回填成当时两个布尔已通过。

### 与安装态合并的最窄方案（尚未执行）

1. 必须先完成安装后、首次真实用户配置启动前的字节保全。行为测试使用安装后的精确 EXE/ASAR、全新私有隔离 profile/workspace，不对用户原会话发测试消息；凭据只走既有授权的密文与配套 Local State 复制通道，环境不带 Key，默认权限不改。
2. 复用 `proxy/cdp.cjs` 的 `connect` / `waitFor` / `click`。沿 `archive/supplement-run.cjs` 已验模式，由隔离 profile 的 `DevToolsActivePort` 取得回环随机端口，并用 `SystemInfo.getProcessInfo` 绑定 owned browser PID；再验证主页面 origin、安装身份和精确 fixture workspace。`pageAt()` 只寻找官方主页面，**不会自动找到本地 Dock/任务工具页面**；它们须按本次浏览器目标列表中的精确安装资源 URL 唯一匹配，不能连其他实例。
3. 官方输入仍为 `[data-composer-card]` 内的 `window.__DSH_COMPOSER_TEXT__.current()`；`read()` 只在内存比较固定测试内容/空文本，报告仅存布尔。确保 root 非 inert、唯一可见输入且焦点命中；通过真实输入事件提交有限的纯文本测试。在同一 busy fixture 上 Ctrl+Enter 后立即、在 Stop 或切换前保存草稿清空断言。不得直接 `.clear()`、改官方 stores 或触发桌面自制 steer。
4. 权威状态已有只读产品接口，不需新增 IPC：真实 Dock `[data-tool="tasks"]` 打开任务工具，从对应 `tasks-subagents.html` 页面读取 `(await tasksSubagentsAPI.getState()).workflow`。`electron/main.cjs` 的 `getCurrentWorkflow()` 内部使用原私有 session-control `status`，复核当前选择后返回 sessionId、running、pending、queued、steering、approvals、jobs、turnOpen、lastTurnReason。观察者再次绑定 fixture sessionId，只记录这些允许字段，**不记录整个任务列表或用户数据**。该接口的 unavailable 不能当作空闲。
5. 主页面 Stop 控件按 `officialActionExpression(['Stop generating','停止生成'])` 同样的唯一、可见、启用和 hit-test 契约定位，用真实鼠标事件点击；不能调用任务面板 interrupt 或直接 cancel 代替。等待并立即保存同一 session 的 `running=false / pending=0 / turnOpen=false`，同时核对无新增排队/审批/活动任务。自然结束不能冒充 Stop；保留精确 prompt 身份和原 `userStoppedPrompt` 的 durable user-aborted 关联，若外部观察器尚未具备安全历史读取适配，应明确待完成，不用 DOM 按钮消失代替。
6. 最多补这一条两项窄交互链路，不重跑审批、交接、Office、present 或归档。实际 Stop 需要一个运行中的真实请求；本方案未调用模型，也不承诺零调用即可完成。正常退出后继续核对 owned tree、输入/原保护资料不变，结果即时写安全摘要，失败证据保留。

**接口限制：**当前 `model/run.cjs` 只有 `unit` / `workflow` / `approval-deny` / `approval-allow`，没有 `stop-only` 或草稿单项 CLI。其 `workflow` 会执行整条高成本链路，不能换名称就算窄补测。本节仅准备动作/契约，尚未新增或执行外部 observer。原历史读取 helper 的 `session.history` 通过主进程私有 IPC 适配，不能从外部臆造已退役的 HTTP history 接口；原生 `session.inspect` 也不是公开 Remote。

## 3. 覆盖安装与资料保全

1. 资料边界审计满足用户条件后，才安排一次安装窗口。核对所有旧安装目录进程；如 Codex `dsh_agent` 仍占用，沿既有单集成临停授权处理并恢复，不强杀、不改其他集成。不因缓存决定就跳过安装占用门禁。
2. 复用已完成的私有补证 `backups/recovery-pre-v1.1.14-p5bjE4-2SswUE/completion.json`，独立 SHA-256 为 `329d49142db8b3cafa708e47833dfb786914969c18a46443328ba2dbe592ec46`；重新核对时只输出安全汇总，备份/逐文件资料元数据不进公开文档或 Wiki。
3. `install/recover-incomplete.cjs verify-recovered --execute-authorized --proof=<精确路径> --proof-sha256=<摘要>` 是有效 CLI，但默认 `originalInstallationRequired=false`：它核对用户资料和旧程序回滚副本，**不确认当前安装仍等于旧程序全树**。安装前如需该确认，可使用已导出的 `auditSnapshot(LIVE, { originalInstallationRequired: true })`，保持其固定 LIVE/pin 及真实进程门禁前后核验；该模块未导出 `assertStopped`，也没有 `--original-installation-required` CLI，不能臆造。原 `backup-and-verify verify` 必须继续拒绝原 INCOMPLETE。
4. 使用 `install/EXECUTION-CHECKLIST.md` 的固定旧目录 `/S /currentuser /D=...` 覆盖。之后先不启动真实用户 profile，核对 lulu/1.1.14、安装 EXE/ASAR、完整 Harness/PS7、原语义资料、密文/Local State/代理以及整组 LevelDB 保全。安装退出码 0 不等于验收。
5. 安装态基础、品牌和 PS7 触达可与上面的窄交互合并。真实 profile 首次启动后可能合法迁移，应按事先审查的语义规则核验；不能靠“预期迁移”忽略原资料变化或自动回滚覆盖人工内容。

## 4. 公开发行与最终状态

- 先建立与冻结包对应的源码/发布身份及 CI 记录。当前 `harness-runtime.yml` 是 Legacy alpha.2 配方，旧 byte-transfer/public-verify 工作流固定旧版本；不能宣称它们已经重建或验过 0.2.1。无需为了本清单重构整套 CI。
- 安装验收通过后按既有授权公开 Latest / Pre-release，核对 tag、提交、draft/prerelease、每个远端资产的字节数与 SHA-256。上传草稿不算公开交付。
- `scripts/verify-public-release.cjs 1.1.14` 固定读取项目 `dist/`，下载到 `artifacts/public-v1.1.14/`；没有 `--dist` / `--output` 参数。先建立经摘要确认的正式资产副本，首次公开验收使用未存在的下载目录；缓存命中不能冒充本次实际匿名回下载。模块另导出 `verify(version, root)`，替代 root 必须具备完整隔离的相同目录结构。
- 完成后一次同步真实安装、公开下载和剩余限制到原 Obsidian 项目，再判断 Stable-ready。Stable 通道晋升仍需单独明确命令；未执行前保留安装 V1.1.13、Stable V1.1.12 的原记录，不提前改版本状态。

来源：`docs/DEVELOPMENT_PLAYBOOK.md`、`docs/LULU_STABLE_ACCEPTANCE_2026-10-07.md`、本节列出的冻结报告及源码接口。本次只是定向读取/摘要核对与清单准备，没有复跑应用、测试、模型、安装或发布。
