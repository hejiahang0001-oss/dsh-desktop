# DSH Desktop

DSH Desktop 是一个面向 Windows 的 DeepSeek Harness 桌面宿主，产品体验以 Claude Code 为对标。

当前版本：**V0.3.7 Daily Build（V0.3 第八切片）**
固定内核：`@deepseek-ai/dsh@0.1.0-rc.8`  
固定运行时：Node.js `v24.19.0`、Electron `35.7.5`

## V0.3.7 已具备

- 双击桌面应用启动官方 DeepSeek Harness Web UI，不由 Electron 另建 Agent loop。
- 通过 Windows 原生“项目 → 打开代码仓库…”或 `Ctrl+O` 选择本地仓库。
- 记忆当前仓库和最多 8 个最近仓库；失效路径会在启动时自动剔除。
- 切换仓库后重启 Harness，并把所选仓库作为 Harness 子进程工作目录。
- 通过 rc.8 官方 `workspace.create/list` 与 `session.list/create` 接口，把桌面所选目录注册为同一路径的 Harness Workspace。
- 显式注入 `DSH_CWD`，复用目标 Workspace 的未归档空白会话；没有可复用会话时创建并绑定新会话。
- 启动时将官方 UI 稳定切换到目标会话，并处理 rc.8 会话列表初始化期间的持久化竞态；原生“项目”菜单显示实际同步目标。
- 新增 Windows 原生“会话”菜单，可新建会话、打开会话搜索、定位会话列表、查看已保存会话数和打开会话数据目录。
- 原生会话入口只调用固定动作白名单；会话内容仍由官方 Harness UI 和持久化组件管理。
- 扫描 `DSH_HOME/sessions` 的 JSONL/Zstd 元数据，状态页可显示已保存会话数，但不读取或回传对话正文。
- Windows 原生“模型”菜单显示软件 Key 状态和“软件托管优先”策略，并可直达官方 Harness 模型设置。
- DSH Desktop 启动 Harness 时隔离 Windows `DEEPSEEK_API_KEY`；软件模型页写入的 `$DSH_HOME/.credentials.yaml` 是最高优先级来源。
- 新增 Windows 原生“Agent”菜单，显示空闲、运行中、等待用户确认或不可用状态。
- 运行中可从桌面菜单停止当前生成、聚焦补充/纠正输入，并把首条排队消息作为插话发送。
- 等待授权时可从桌面菜单定位待确认操作；菜单状态每 1.5 秒从官方 Harness UI 同步。
- 原生 Agent 控制只使用固定双语标签和动作白名单，不读取会话正文，也不建立第二套 Agent loop。
- 已处理“点击时任务恰好结束”的竞态：动作目标消失时刷新状态并安静收敛，不弹出误导性错误。
- 新增 Windows 原生“工具”菜单，显示最近工具状态、工具类别、当前窗口调用/失败/停止计数和最近测试结果。
- 工具类别覆盖读取、搜索、编辑、命令、测试等 Harness 工具过程；可从原生菜单定位当前/最近工具并打开轨迹。
- 测试结果可显示通过、失败、运行中、已停止和退出码；状态来自官方 Harness 对话或轨迹 DOM，不建立第二套工具执行器。
- 原生“工具”菜单显示当前权限模式，并可打开官方 Harness 权限入口；应用不会自动切换权限。
- 对受限模式下 PowerShell 的 `0xC0000005` 精确失败提供兼容性说明，同时明确 Full Access 会绕过命令沙盒。
- 新增 Windows 原生“变更”菜单，从官方 Harness Diff 卡和 Produced 文件入口定位最近变更，不建立第二套 Agent loop。
- 可将最近产物文件“接受并暂存”到当前 Git 暂存区；不会自动提交或推送。
- 可拒绝最近的已跟踪文件修改并恢复到当前暂存版本；新文件拒绝时进入 Windows 回收站。
- Agent 运行或等待确认时禁止接受/拒绝；非 Git 工作区保持只读查看。
- 打开仓库和进入新 Agent 回合时记录已有未暂存/未跟踪文件，命中这些原有修改时禁用一键拒绝，避免覆盖用户内容。
- Windows 环境变量本身不会被修改，其他软件仍可继续使用；诊断只报告 Key 状态，不显示、记录或传输密钥。
- 首次进入会直接显示可编辑的 API Key 输入框，不再因启动环境变量而锁定为只读。
- 未选择仓库时保持空白 `launch-root`，不向用户预置演示项目或业务内容。
- 安装包内置固定 Node 与 Harness，目标电脑不需要预装 Node。
- Harness 由独立 `HarnessSupervisor` 管理启动、就绪、日志、停止和重试。
- 每次启动使用随机 `127.0.0.1` 端口，并在加载前执行 HTTP 健康检查。
- Harness Profile、会话、配置和桌面仓库状态保存在安装目录之外。
- 启动失败时显示可访问的错误状态，可重新启动或打开日志。
- Renderer 保持 sandbox、上下文隔离、无 Node integration，并限制跨源导航。
- 提供开发态和 packaged-app 的真实 Harness smoke，不只检查 exe 是否存在。

## 数据目录

正式运行时使用：

```text
%APPDATA%\DSH Desktop\
├── desktop-state.json  # 当前仓库与最近仓库
├── harness\            # DSH_HOME：Profile、会话、配置和插件
│   └── .credentials.yaml # 软件模型页管理的 Key；不进入普通回滚备份
├── launch-root\        # 未选择仓库时的空白工作目录
└── logs\
    └── harness.log
```

应用升级不会删除上述数据。

## Daily Build 覆盖规则

- 每日新版本完成测试和 packaged smoke 后，直接覆盖当前电脑中已安装的旧版。
- 覆盖前备份已安装程序与 `%APPDATA%\DSH Desktop`，覆盖后启动安装版并验证 Harness 就绪。
- 普通回滚备份排除 `harness/.credentials.yaml`，避免软件托管 Key 被复制到工作区备份。
- 验证失败时保留失败现场并恢复最近一次 last-known-good；不把仅生成安装包视为当日升级完成。
- V0.2.0 的 pnpm 联接目录已在迁移中整体移入备份；V0.3.0 起使用无联接的平铺 Harness 运行时。

## 开发和构建

```powershell
pnpm install --prod=false
pnpm electron:fetch
pnpm runtime:fetch
pnpm runtime:deploy
pnpm test
pnpm start
pnpm pack:win
pnpm dist:win
```

构建产物：

- 解包版：`dist/win-unpacked/DSH Desktop.exe`
- 安装包：`dist/DSH-Desktop-Setup-0.3.7.exe`
- 更新块映射：`dist/DSH-Desktop-Setup-0.3.7.exe.blockmap`

`electron:fetch` 和 `runtime:fetch` 只接受固定版本、固定 SHA-256 的官方 Electron/Node 压缩包；`runtime:deploy` 根据锁文件生成固定、无目录联接的 Harness 生产闭包。

## 已验证

- 48 项 Supervisor、工作区映射、回环安全、健康检查、会话目录、模型诊断、软件凭据优先级、Agent/工具/Diff 状态及真实临时 Git 仓库接受/拒绝测试通过。
- 开发态、正式 hoisted runtime 与 Windows x64 解包版均真实启动 Harness，随机回环地址返回 HTTP 200。
- 安装包内 Harness 为 29,201 个文件、0 个 reparse point，避免 NSIS 重复展开 pnpm 联接。
- NSIS 安装介质通过 7-Zip 结构完整性检查，内部文件 `Everything is Ok`。
- V0.3.7 安装包为 158,432,047 字节，SHA-256 为 `005C4F7FA224E71E1BDC284053F0BF6C998A424792F1F89BD7F0EBE9F77892E6`。
- 已将 V0.3.7 直接覆盖 V0.3.6；系统卸载信息为 `DSH Desktop 0.3.7`。
- NSIS 安装介质包含 29,278 个文件；正式安装版 `app.asar` 与 `win-unpacked` SHA-256 一致，均为 `B7A17CFEE05BB63270AA4A360360C65422B73EEE0B45892CE14F1A2A2C83F1D2`。
- 正式安装版在随机回环端口返回 HTTP 200，标题为 `DeepSeek Harness`，packaged smoke 同时确认 Workspace 同步成功。
- 覆盖安装后 8 个持久会话文件保留，软件 Key 仍为“已配置、软件优先”；验证期间未读取、显示或复制 Key 明文。
- 软件 Key 已保存并在连续覆盖安装后保持可用；验证期间未读取、显示或复制 Key 明文。
- 使用 `DeepSeek-V4-Flash High` 完成真实模型调用：一次 1,000 项平方输出正常结束，约 29 秒、3.1K 输出 tokens。
- 真实长输出中验证了运行状态、补充输入、排队消息、插话发送和桌面菜单停止；停止后回到空闲且无误报弹窗。
- 使用软件中保存的 Key 发起一次真实 `pwsh` 只读测试；模型成功调用工具，但 rc.8 Workspace Write 工具进程以 `3221225477 (0xC0000005)` 退出且无输出，因此不宣称测试通过。
- 正式安装版已在对话和轨迹两种视图中准确识别这次失败；原生“工具”菜单显示“最近失败”“命令”“测试失败（退出码 3221225477）”及 `1 次调用 · 1 次失败 · 0 次停止`。
- 在隔离的 Full Access 验证会话中，使用软件 Key 完成真实文件读取、定点修改和一次 `pwsh` 测试；测试 1/1 通过，工具退出码 0，并经独立测试复核。
- V0.3.7 在隔离 Git 仓库中使用软件 Key 和 `DeepSeek-V4-Flash High` 完成两轮真实编辑：`alpha=1 → alpha=2` 后通过桌面接受并暂存，`alpha=2 → alpha=3` 后通过桌面拒绝并恢复；最终工作区与暂存区均稳定在 `alpha=2`。

## 当前边界

- DeepSeek Harness 仍是 developer preview；V0.3.7 固定 rc.8，不自动追踪 latest。
- Windows 安装包尚未代码签名，SmartScreen 可能提示风险。
- 软件 Key 仍由 Harness rc.8 的 `.credentials.yaml` 管理，Windows 下依赖用户目录 ACL；尚未接入 Credential Manager/DPAPI。
- rc.8 官方 UI 已具备会话搜索、继续、重命名、归档和分支入口；V0.3.1 增加桌面原生入口和持久化可见性，不重做第二套会话系统。
- V0.3.7 已完成桌面仓库、Harness Workspace、目标会话和真实单文件 Diff 确认闭环，但还不是独立多文件 Diff 面板，也不包含批量审查、Checkpoint 或会话级 Rewind。
- Workspace Write 的 PowerShell `0xC0000005` 兼容问题仍存在；应用会准确显示失败，不会自动切换 Full Access。
- 旧的自建聊天原型文件仍保留在源码中作历史参考，但不进入正式包。

路线图见 [DSH_DESKTOP_ITERATION_PLAN.md](DSH_DESKTOP_ITERATION_PLAN.md)，当前交接见 [PROGRESS.md](PROGRESS.md)。

## 许可证

DSH Desktop 采用 [MIT License](LICENSE)。DeepSeek Harness 及其他第三方依赖继续适用各自的许可证。
