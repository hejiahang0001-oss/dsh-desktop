# Harness 0.2.1-alpha.2：隔离适配记录

## 当前状态（2026-10-11）

### 19:05续作：原资料正常退出与保留已验证，集成已恢复

用户确认托盘退出后，原资料实例同次生命周期为 clean/explicit-exit，结束于 `2026-10-11T10:47:05.203Z`；PID及安装目录占用均为0。`real-profile-exit-receipt.json` SHA256 `db07da1de0f04572c35feea62ae7803e28ffb10329eadd223097137a09922d09`，只证明该次正常退出，另由下述保留核验闭合资料边界。

`first-profile-tqCAKG/after.json` SHA256 `0414bbc223e21793644274b70498ba9d15e44b1d77ed60ec8d12e1bef55dd90d`；原比较 SHA256 `451f38be5553ff647e455f66ea32ba499019a433be5679cba4a99e12a5fbbd45` 保留 **accepted=false**。必需保护选区通过：29份原历史内容、7份草稿、加密Key及加密配套、代理/备份和旧设置保持；唯一待审差异是一份V4历史多出一条恢复标记，不能直接忽略。

独立窄补证 `artifacts/upstream-checks/2026-10-11/real-profile-proof-run-TnWDRL/proof.json`（SHA256 `d1dab045364672862ddc667e912b159783dbd376936bdd5389e1e1dfec712820`）执行退出0、最终回执ok=true，54项纯合成测试及独立代码审查通过：28份历史逐字节相同；剩余一份完整header及原3条事件不变，只追加 seq=3、data为空、时间在同次运行内的 `session/end-seed`。与固定官方session普通恢复分支及agent-loop持久化语义吻合。不是此前隔离归档的74+1证据，也不要求原会话存在中止回合。前后29份备份/实际文件、保护配置和工具摘要不变，读取前后无应用占用；不写源、不解密、不启动模型。原聚合失败与启动收据格式错误均保留。本结论限既定资料选区，不等于整个用户目录逐字节或所有ACL复核。

安装态诊断 `artifacts/stable-readiness-20261007/install/narrow-mZig0B/report.json`（SHA256 `13e669b45ed9310079d2cfeec01af4c0b9135045515669ca74288c708dabd41b`）实际两请求已验证 **插话立即清空、官方Stop调用、同会话停止归零**。输入控件是可见可命中的contenteditable DIV；不能据此认定首轮textarea不兼容，更不能把额外观察后的成功视为竞态根因已修复。用户退出等待180秒到期后测试Job清理了该隔离实例，原报告functionalAccepted=false/forcedJobCleanup=true保留，尚无同次正常退出或退出后精确历史证明。ACL结果为inspection-incomplete，现有信息不能区分扫描/解析/身份/规则拒绝，保持未决，既不判为宽权限缺陷也不算通过。原真实资料退出和保留不受该隔离失败影响。

`dsh_agent` 已只撤去本次新增的16字节临停行，保留期间其他配置修改，CLI确认enabled=true；没有整份还原旧配置。收据 `artifacts/upstream-checks/2026-10-11/mcp-config-restored.json`。新安装Node的独立握手/listTools通过：`install/mcp-handshake-116-HRNP93/mcp-handshake-result.json`（位于stable-readiness-20261007，SHA256 `d936ad1dc91e0e43ae7fb3516bab8d06a947baafb81d4264e363c9085d9b2b58`），只调用initialize/initialized/tools-list、未执行任何工具或模型；不宣称Codex当前会话的五个工具已逐个运行。19:05复查应用及安装目录占用0，本轮命令均已结束。

剩余顺序：先在固定失败fixture的私有副本做官方只读历史核对，再无需重发模型的隔离重开/人工托盘退出补验，并补齐该实例ACL检查；原强制清理记录不得冒充自然退出。既有工具绑定旧fixture，须审查新绑定，不能原样套用；当前缺独立预期文本，禁止从日志反填后宣称精确匹配。完成安装专项后再精确源码CI、公开Pre-release及匿名资产下载。未重跑全量测试、内核构建、Office或打包，也未修改产品代码。当前本机1.1.16/alpha.2；公开Pre-release1.1.14、Stable1.1.12不变，**仍未完整交付或Stable-ready**。下文均为较早时点，待退出/临停表述已由本节更新。

### 重启后续作：已覆盖安装，正在完成安装态验收（历史时点）

用户已完整重启 Codex，旧安装目录占用复查为0。继续同一 JNNUUW，不换包、不改产品代码。新增完整源码测试 `artifacts/stable-readiness-20261007/test-WF5Zqk/result.json` 通过 **976/976、零失败/跳过**（SHA256 `637124be69f5d3e6109263f5a80bac04f9b802e3f0b69e2df91457cdce8dee03`）；405代码输入不变。下面早间975/976及专项6/6是原历史结果，并未改写。

私有备份首次末阶段元数据操作失败，保留原 INCOMPLETE 和原 manifest；具体根因尚未证实，不能把预先写出的 complete=true 当验收。已用固定独立恢复工具核验旧程序15,425文件、50份资料选区、5份保护配置、6份LevelDB及18,598项备份ACL；原安装、资料、密文与备份一致，原失败及严格工具拒绝仍保留。没有重拷负载或改资料/系统权限。安全摘要见 `artifacts/upstream-checks/2026-10-11/backup-failure-receipt.json` 与 `recovery-receipt.json`；私有 completion SHA256为 `fcee8f3ff605ba87428e26534a0186174ab532020500dc1e75cf5b037109600a`，不公开逐文件私有清单。

固定Setup于 `2026-10-11T10:33:44Z` 正常完成覆盖，无强制终止、无自动启动、无清除用户资料。`install-execution-receipt.json` 只证明安装器exit0；另一次安装态独立检查 `artifacts/upstream-checks/2026-10-11/installed-identity-WOCxNJ/report.json`（SHA256 `a58288fdd6653debf58ad3a31350916041476c45c19beeae4f6258e0462ba141`）才证明本机 **lulu1.1.16 / Harness0.2.1-alpha.2**、Windows版本身份、三关键摘要、完整15,640文件负载与固定候选一致、Office/PS7运行库完整。安装前后111个资料选区及5个祖先的ACL/owner/身份/元数据相同，没有放宽权限；既有风险并未消失或重新归类。

首次启动前严格资料保全已经通过：`artifacts/upstream-checks/2026-10-10/install/first-profile-gBXDH6/before.json`（SHA256 `1704e4d591189802867c279d85d765d601874ae7f805fdd87d6e80be9d907000`），29份原历史选区；只记安全摘要，不公开私有快照内容。`first-profile-recovered-116.cjs` 的 before 内仅执行一次严格安装后核验；after 不重复启动前字节比较，原V4/草稿/密文/代理比较规则未放宽。

安装态窄测 `artifacts/stable-readiness-20261007/install/narrow-TPVBpA/report.json` 失败保留：phase=initial-busy-fixture，未记录首条提交，尚无即时清空/Stop通过证据；输入框操作错误仅归类为observer-operation-failed，具体原因待安全诊断，不能判成模型/API失败或直接产品缺陷。该隔离实例由受控Job在失败后清理，**不是自然托盘退出通过**；工具输入及原保护源保持，全根ACL通过。没有因此重复全量/Office/打包或放宽判据。

原资料独立只读UI `artifacts/stable-readiness-20261007/install/live-ui-Wbun8O/report.json`（SHA256 `40d8de5deeb96abcfd8d33211a2de8d90f0c9426fe090546a795303ce40988e6`）通过：版本/包身份正确、原工作区一致、17会话目录可达、Key配置且加密、当前草稿/附件状态对应，无弹窗。没有发送模型、返回正文/附件名或写入操作；不表示全部历史内容已人工阅读。启动命令的收据格式曾报错，未重开实例，独立CIM复核唯一PID28324及创建时间后观察成功；`real-profile-launch-receipt.json` 保留该边界。本次原资料runId/startedAt已固定，已提示用户从托盘“退出lulu”，尚待同次clean/explicit-exit及after保留核验。

下一步先完成这次原资料正常退出和after，再依据窄测安全诊断完成安装态即时清空/Stop，精确恢复dsh_agent和源码CI/公开下载验收。`dsh_agent`暂仍临停；旧备份工具继续正确拒绝INCOMPLETE。当前**已安装不等于全部交付通过**：公开Pre-release仍1.1.14、Stable仍1.1.12，没有公开1.1.16或晋升Stable。

### 下午续作：最终候选功能验收与安装准备（历史时点）

继续同一 `dist-JNNUUW`，未改产品代码、内核或双包。用户已明确批准本版一次限定“拒绝→仅本次允许”测试及验收后临停 `dsh_agent`／提示后重启，不再等待早间两项选择。以下路径除另注明外均在 `artifacts/stable-readiness-20261007/`。

| 验收 | 本次结果与证据 | 范围限制 |
|---|---|---|
| 生命周期／安全退出 | `lifecycle/lifecycle-1XRcne/report.json`、`lifecycle/safe-exit-c3DdOd/report.json` 通过；第二实例、实际 Harness／终端／预览运行及同次 clean/explicit-exit，root/Job/guardian 归零，无强制清理 | 不替代真实用户资料覆盖保全 |
| 真实模型工作流 | `model/workflow-kwNixf/report.json` 原聚合失败保留；源码执行顺序与文件证据确认上箭头插话、Ctrl+Enter、文件呈现／预览及 Stop 请求已执行至后续归档步骤 | catch 丢失分项快照，不伪造整轮绿；即时清空布尔值未保留，失败时草稿空／已空闲不等于即时清空已证 |
| 权限 | `model/approval-allow-6mMcoi/report.json` 通过：真实拒绝／仅本次允许及限定文件效果；默认 workspace-write 不变 | 本次隔离随机标记，非全局放宽；不读取用户资料或提权 |
| 代理 | `proxy/packaged-oFRWv8/report.json` 11项机器检查通过；主控实际回看 custom-proposal／saved-after-restart 两张截图，字段和按钮可用 | 原 `ok=false` 表示待人工视觉复核，原件不改；仅合成凭据／本地代理探针，不宣称真实模型经代理成功 |
| 布局 | `electron-layout-e8c70L/report.json` 最终包7种尺寸／面板形态、模态关闭和状态保持通过，主控回看紧凑／高缩放／设置实图 | Git Review 内容仍有自身横向滚动，不扩大为全部交互已优化 |
| 工作区交接 | `model/handoff-fMSVRB/report.json` 12项通过，真实模型历史／cwd、草稿引用、代码和暂存区、冲突拒绝、返回及原工作区保留 | 隔离 fixture；20项输入、2项保护源不变，root/Job/guardian归零 |
| 归档 UI／正常退出 | `archive/supplement-PMqpPW/supplement-report.json` 的12项归档／恢复／重载检查通过；用户从托盘正常退出，同次 clean/explicit-exit，root/Job/guardian归零 | 原聚合仍失败于退出后严格事件数量比较，另作以下窄补证，不改原报告 |

归档首轮 UI 失败不是已证实的产品归档缺陷：旧测试在左栏收起时直接找“视图选项”，官方 alpha.2 只在展开列表渲染该控件。既有补验先展开左栏；派生工具 `archive/supplement-alpha2-kwNixf.cjs` 相对旧工具仅改变 workflow 目录和完整内核身份，独立字节比较通过，没有放宽 UI 断言。

退出后独立只读诊断 `archive/post-exit-diagnosis-gXVXRQ/report.json` 证明原74条事件顺序摘要、完整会话头与继承关系保持；只追加一条空 `session/end-seed`，实际官方 V4 恢复成功。原固定74条数量断言因此拒绝75条；不能直接忽略新增事件。固定alpha.2源码 `packages/core/session/src/index.ts:696` 的普通恢复标记与 `agent-loop/src/index.ts:734` 的持久化追加语义对应。独立补证 `archive/post-exit-proof-M9DZo2/proof.json`（SHA256 `e25bc5acf465f3496b31e807e17778cdaf9074f446fbc7d9bb12c414deba6482`）退出0／ok=true：严格74条前缀及完整header保持、全部业务事件相同、仅一个空marker且seq=74／时间在本次lifecycle内、官方V4恢复成功；UI12与同次正常退出保留。源快照、读副本、输入与模块摘要不变，读前读后无候选进程，输出ACL私有。原合同相同fixture红5/6→新窄合同绿6/6，原失败报告和原69条旧版契约未改；没有启动UI、读取凭据或调用模型。此专项补证关闭归档缺口，不把原workflow聚合失败改成成功。

预览和附件沿用同 alpha.2 的 `electron-preview-8V7WdN`、`electron-attachments-cross-Hk71V4` 范围证据；SZqatc→JNNUUW的405输入集合只差5个品牌／布局观察器及测试文件，非405项全相同。最终品牌与布局已在JNNUUW另验。原生 `native-EKV8Sf` 仅复用相同 descriptor／消费者字节下 Office 转PDF与内容／页数等原生检查；不泛化为安装态、加密／大PDF、真实模型附件上传／取消重试或重启附件恢复。独立只读比较记录：`artifacts/upstream-checks/2026-10-11/final-candidate-reuse.json`，SHA256 `96a66a60f28ddfc9740064faab7f973cded9e52e3fac1026b8e4e2a213e057e7`。

`2026-10-11T09:29:27.321Z` 主控重新核对 JNNUUW 的405项冻结代码输入零差异、该候选 EXE 占用0；README状态文档独立于405项。证据 `artifacts/upstream-checks/2026-10-11/post-functional-preflight.json`。Codex配置已先复制至 `.codex` 私有目录并核对仅当前用户/SYSTEM权限及SHA一致；首次输出收据时PowerShell布尔字面量错误，未影响复制，随后独立回读通过，记录 `artifacts/upstream-checks/2026-10-11/mcp-config-backup.json`。

归档补证通过后，`2026-10-11T09:35:58.095Z` 按用户本次授权仅在 `[mcp_servers.dsh_agent]` 新增 `enabled = false`，16字节；撤去该行与私有备份逐字节完全相同，Codex CLI读回enabled=false。依据[官方配置字段](https://learn.chatgpt.com/docs/config-file/config-reference)，这是保留配置的临停，不是卸载或自动清退已有进程。收据 `artifacts/upstream-checks/2026-10-11/mcp-config-disabled.json`；旧安装仍有13个Node占用，没有强杀。**现在需用户保存工作后完整退出并重开Codex**，再回到本会话继续；不是只关闭当前对话。安装通过后只撤销本次新增行并验集成，不能用整份旧备份覆盖用户此后的设置。若更新中止，也须显式恢复临停状态。

重启后的下一步：重验旧安装无占用与可用空间 → 用 `artifacts/upstream-checks/2026-10-10/install/backup-and-verify.cjs` 做1.1.15→1.1.16新私有备份 → 固定JNNUUW Setup覆盖 → 首启前严格保全及 `first-profile-preservation.cjs` before → 安装态和真实资料只读交互、即时清空／Stop窄验 → 正常退出后after／必要V4新增事件独立审查 → 恢复集成 → 最终源码全测／精确提交CI和公开Pre-release回下载。不得使用旧固定1.1.14的同名备份工具；不得重跑已闭合Office／全模型／打包来代替安装缺口。

当前本机仍1.1.15/alpha.1、公开Pre-release1.1.14、Stable1.1.12；没有覆盖或公开1.1.16。未签名、其他电脑、长期老化、既有主机权限风险与早间 Portable 启动耗时限制保持。下文早间和前日段落保留各原始时点；“待两项选择”不再是当前阻塞。

### 早间检查与候选构建（历史时点）

本轮继续已有的 lulu 1.1.16 / Harness 0.2.1-alpha.2，不另开版本。官方 Releases、标签、npm 于 `2026-10-11T00:03:33.5509525Z` 核对仍为完整版本 `0.2.1-alpha.2`，标签 `dsh-v0.2.1-alpha.2`、提交 `d743267388641bc76f17c45ce8b4c231aed1d32c`，发布于 `2026-10-09T11:09:26Z`；npm alpha 同版，latest/next 为 `0.2.0-rc.2`。按完整 semver 与已固定内核比较相等，没有采用 master 未发布代码。检查收据：`artifacts/upstream-checks/2026-10-11/check.json`。

此前用户清理旧安装包已解除空间阻塞，所以本轮补齐最新噜噜品牌修复的源码检查、双包构建和包级验证，没有重新构建未变的298个内核组件或重复依赖审计。以下均为**本地候选**，不是已安装、已公开或 Stable-ready 声明。

### 最新源码与最终品牌候选

- 完整 `pnpm test` 运行976项，975通过、1失败、零跳过/取消，405个冻结源码输入前后不变：`artifacts/stable-readiness-20261007/test-NOSYBV/`。唯一失败为 README 缺少候选安装包名的版本断言，原失败记录保留。
- README 补上 `DSH-Desktop-Setup-1.1.16.exe` / `DSH-Desktop-Portable-1.1.16.exe` 及未发布边界后，`test/release-version.test.cjs` 专项6/6通过。未为此重复976项全测；405个冻结代码输入重新比对不变，README不在这405项中，已单独记录修正后摘要。**不能写成一次新的976/976全量通过。** 观察结果汇总：`artifacts/upstream-checks/2026-10-11/test-followup.json`，这是主控实际命令结果摘要，不替代原始失败日志。
- 新双包位于 `artifacts/stable-readiness-20261007/dist-JNNUUW/output/`。构建退出0、子进程已关闭、405项输入不变且与上述完整测试代码相同。构建收据SHA256：`e5ca75727123a968ed005b914efbc3c53373b427d866e5c1a050abb5ffafa884`。
- Setup SHA256：`c7147a0792f0ba2a9fc21b4bf9283be11d14d157ffcf7c7f8e127650e709f67b`；Portable SHA256：`30da2749bb90dc0aac3e26be306d1e0b4fb8ed7949380587bbf5c46164bf43a0`。
- 实际 ASAR 中品牌CSS、噜噜PNG、ICO、品牌烟测与Harness manifest五份文件均与源码逐字节一致。根package.json由构建器规范化，按既有语义校验器验证，不以原始文本相等替代语义检查。预检修正Windows嵌套ASAR路径和manifest比较方式的记录保留在 `artifacts/upstream-checks/2026-10-11/package-inputs.json`，没有因此修改产品或放宽完整验包。

### 静态与真实品牌验收

1. `artifacts/upstream-checks/2026-10-11/package-116-Y8W0yE/report.json` 的负载、Windows身份与发布治理三阶段均退出0，输入前后不变。Setup、Portable与已验证展开目录各15,640文件 / 1,148,057,294字节，完整负载树SHA256相同：`4dcc9f599e3b3e774aef5bcf013503db9b824c1e9f8f1fa35ae0120ec2a39643`；缺失、额外、字节不匹配均为0。负载原报告 `portable/payload-LWXRRs/report.json` 位于 `artifacts/stable-readiness-20261007/`，SHA256 `a63414d83a42469a738d881991f662390dbda05927048fa8eea931b560d6e62a`。
2. Windows productName/fileDescription 为 lulu，fileVersion 为1.1.16。静态 `packageReady=true` 不包含完整真实交互、覆盖安装或公开交付；安装包仍未签名、发布者信任未验证、更新feed未分离，`automaticUpdateReady=false`，不得宣传自动更新已就绪。
3. 用户已删除的1.1.14旧blockmap不重新下载；本轮仅把验包辅助脚本基线换为仍保留且本机已安装的1.1.15，原门禁不变。新增纯契约5/5及独立窄审通过；该证据只覆盖**本地已安装1.1.15基线**，不证明公开1.1.14差分更新。旧脚本未改，具体版本/摘要/来源写在新脚本与报告中。
4. 新包真实品牌烟测：`artifacts/stable-readiness-20261007/electron-brand-47hNol/report.json`，退出0、输入不变、应用自然关闭；浅色/深色1280×880和紧凑1024×720三组通过。每组两处噜噜图片成功解码、输入可见可聚焦、导航可见、根页面无横向溢出。主控回看三张实际截图，欢迎页和侧栏为黑发、眼镜、比耶噜噜，没有鲸鱼回退。使用全新隔离资料、无真实模型发送；不是已安装实例，也不表示所有面板交互均已完整验收。

### Portable 实际启动与终端（同一最终候选）

`artifacts/stable-readiness-20261007/portable/harness-YK0IMX/report.json` 已通过，SHA256 `dd3200dae577121f3c845e6c6215c4c76def95c6f455858f84cc4e365a296170`。直接启动原Portable，不预解压、不伪造PORTABLE环境变量；真实解压应用PID与启动器后代关系、EXE/ASAR/descriptor三摘要已绑定。同次实际会话/临时工作区、独立侧聊和必要官方模块通过，运行闭包532/532健康、插件191项中163 active、0 failed；不表示191插件逐项执行或真实MCP/模型调用全通过。

应用、启动器、受控Job成员及guardian自然退出，launcher自行删除解压应用，所有冻结输入未变。未使用真实用户资料/Key、未运行Setup；短TEMP下最大负载路径258字符，**没有证明260字符及以上长TEMP可用**。独立只读复核绑定与完成条件通过。

终端独立轮 `artifacts/stable-readiness-20261007/portable/terminal-8VkjPZ/report.json` 同样通过，SHA256 `10cca34d38ebf803a07c96c4016bfb334ab3f15fde294c0c8d16f2b2d1177eda`。8项实际检查：官方PTY运行、Electron原生键盘执行、工作区绑定、不继承Key、窄面板可见、多终端独立、只读清单保留输入、显式关闭移除终端。使用隔离工作区合成收据，modelCalls=0；真实应用三摘要与上述候选匹配，root/Job/guardian自然归零、启动器自行清理解压EXE，固定输入不变。Windows输入法、Host重启终端恢复、其他shell/机器未验证；这两组正常结束不替代完整历史落盘与Safe Exit协议验收。

另记录体验样本：两轮启动器创建到实际应用创建分别相差257.09秒、203.52秒，等待主要发生在解压阶段。仅为这两次机器/环境下的观测，不是标准基准或唯一原因结论；后续需单独分析便携包提取耗时。功能门禁通过不等于启动速度已优化。本轮测试命令及其受控实例均已结束，没有把仍运行的测试留作“已完成”。

### 仍开放的门禁与状态

官方替换/桌面保留决策与下文表格相同：采用官方流式、终端输出、后台任务及子代理拖放修复；去掉18条重复安全版本覆盖；继续保留软件优先加密Key、代理、Office/Wiki校验备份、Git Review、Windows宿主/私有PS7及附件生命周期保护。此次只补包和证据，不新增ERP、远程桥或实验能力。

最新候选仍需完整功能/模型与审批路径、安全退出、安装前私有备份和覆盖后资料保全、精确源码CI及公开资产下载验证。已有同核有效证据按输入和作用范围复用，不把旧包的交互结果直接当作最终包全验通过。新版一次“拒绝→仅本次允许”的限定测试，以及覆盖前临停dsh_agent/提示后重启仍待原问题答复；不复用旧一次授权、不由心跳替代、不强杀旧安装进程。取消的D盘归档问题不再构成阻塞。

本机仍1.1.15 / alpha.1；`2026-10-11T00:19:42.5401106Z` 只读GitHub复核公开Pre-release仍1.1.14、Stable仍1.1.12。本轮未覆盖、上传、提交或晋升Stable；私有草稿1.1.13仅沿用历史记录，本轮未查询。已验证范围限本机Windows11 x64及各分项所述；签名、其他电脑、长期老化及既有主机风险未因本轮变成已通过。

## 历史状态（2026-10-10；以以上最新状态为准）

17:23清理更新：用户明确保留1.1.15及以后安装包、删除更早版本且D盘不再归档。27个精确旧安装目标（13 EXE、7 blockmap、7展开目录）已永久删除，10,411,508,392字节；C盘约3.02→13.60GB可用。12个1.1.15/1.1.16安装资产与6个源码/现用安装保护文件SHA不变；删除目标全消失，重新检索旧包0项。D盘9个指定下载/归档根0命中，官方客户端/运行库/资料保留，未进行全盘无界搜索。取消此前两套1.1.16转存D盘请求，保留全部1.1.16候选；空间阻塞已解除。一次限定权限测试及临停集成/提示后重启仍待独立答复，本轮未做模型、打包、安装或GitHub变更。清单/执行/独立复核位于 `artifacts/package-cleanup-20261010/`；删除回执SHA256 `8a073c4a54233bf1d8f43dffbc15095f4a13f8e6f46ca15943b4ac83e25f0e2d`。旧日志/证据不变，但被删安装包不能再本地直接复核或从回收站恢复；[详细清理范围](INSTALLER_CLEANUP_2026-10-10.md)。以下时间段保留原始进度与失败，不把旧待办当作仍然需要。

15:44（北京时间）续作：源码1.1.16/正式vendor已固定0.2.1-alpha.2，用户“携带”的范围已落实；本机仍1.1.15/alpha.1、公开Pre-release仍1.1.14、Stable仍1.1.12、私有草稿1.1.13不变。最新噜噜品牌接线修复已通过开发态真实浅/深/窄窗口，尚未重新全测和打包。已有候选仅保留为分层证据，不公开、不推荐安装，不称为Stable-ready。

### 本轮继续取得的证据与原失败

以下路径如无前缀，均在 `artifacts/stable-readiness-20261007/`。

1. 跨工作区附件烟测不再凭空创建服务端会话后假定前台选中：通过官方原生新建入口取得真实会话ID，严格检查原会话/工作区/非子代理/草稿，返回时恢复原ID、4个附件和草稿。修改仅在烟测与契约断言，保留原件字节和外部Office拷贝拒绝检查。SZqatc候选真实成功 `electron-attachments-cross-Hk71V4/report.json`，SHA256 `1587dea595c4fda213bd9c3911c8c3d98bb5567969e02b95bf213b4eddc43061`。首轮 `electron-attachments-cross-uy8s8e` 的单次hover未出现按钮失败保留；同冻结输入重试通过不证明唯一根因已知。没有真实模型上传/取消/重试或重启附件恢复结论。
2. 同一SZqatc候选预览通过：Markdown/JS/PNG/HTML/PDF三页末页有内容、DOCX/XLSX/PPTX原生预览、键盘搜索、拒绝.env、原件字节不变。`electron-preview-8V7WdN/report.json` SHA256 `96de9c31f75a5c507d05df3a0bed61eb4ea9bb4394f32005d0137adf60b06d98`。先前 `electron-preview-y035Em` 在并行重负载时Host45秒就绪超时，串行重试通过；资源关联不是已证实根因。后续静态大文件校验与UI串行进行。
3. 布局烟测 `electron-layout-E5T5qc` 的7组几何通过，但误将闭合details里5个模型按钮判为可见。真实HTML语义为仅首个直系summary展示；观察器逐级检查details祖先，保留可见按钮原有elementFromPoint遮挡检查。新增3个负例先红，再5/5通过，未改产品布局/权限。开发态 `layout-n3poNj/report.json` SHA256 `d6135e6f70ef54d14005695030ab5dfa47a8266f88dc7b4c21b0219c28a7fdd6`，7种尺寸/面板形态、模态关闭和面板状态保留通过。独立窄审无Blocking/Important。该次截图仍有鲸鱼，不能作为品牌通过证据。
4. 上述修复后冻结全测975/975、零失败/跳过、输入不变：`test-S7rBvP/result.json` SHA256 `e1b052223abc713390885eca755f56083e09714537e0b9b2fbac2af5482a1776`。构建 `dist-YPbNuf/result.json` SHA256 `b2ab497f50ffcb524d4cf330f7fef8698808447a2d206438c6f94b9dbce4827d`；Setup SHA256 `2b4df012c3c3e129749cbcb82715175955fe39229028e6297cec7db74c1bf2d3`、Portable SHA256 `efcf5b0ee349b469a566516d4b1bd0f2b0f12a65d1919454a461b4bb9dc93e3b`。
5. YPbNuf实际双包/未打包目录完整负载一致、Windows身份lulu1.1.16和发布治理通过：`artifacts/upstream-checks/2026-10-10/package-116-FJ6YIh/report.json` SHA256 `840d55230d1ae09c8c69d9422b6a72b51f62117b438702ce65e99a69cce6b7df`；负载报告 `portable/payload-YXV9xh/report.json` SHA256 `2744215a6c970eaaff4da93c9570a3b68699ec875e535929bc57caed2cb92e17`。此处packageReady只覆盖静态门禁，不代表真实Portable启动、界面、模型、安装、签名或公开交付。

### 实际发现并修复的噜噜品牌回退

主控回看布局截图发现左栏和欢迎页显示官方鲸鱼。alpha.1的 `qVIJiq_fishHitbox` / `ghK-Yq_*` 编译类名在alpha.2变为 `zBQbhG_fishHitbox` / `_4_Dsta_*`；官方EmptyHero/SidebarRoot源码字节相同，而编译产物的CSS模块token变化，原精确品牌接线失效。注入仍正常，不能以暖色背景推断品牌已替换。

静态冻结检查完成后才修改三文件：`assets/lulu-harness-theme.css`、`electron/native-dock-ui-smoke.cjs`、`test/lulu-current-brand.test.cjs`。只更新装饰容器精确选择器，保留SVG viewBox、aria-hidden、直系data-slot和root限制；不改几何、事件、权限、业务或素材。新增runtime两版本字段/CSS版本说明绑定，拒绝旧类名；单元测试不读取干净CI不存在的vendor，不新增skip或下载整套内核。两组单测8/8、零跳过，语法/diff与独立窄审通过。

- CSS SHA256 `297167a8e5018152d5c491f4aa13013d11642405fbcb140b031f0a1be9d5a19e`；品牌烟测 SHA256 `f20a7a365c1612fdf8c57d10e8580ccb78216cf00329d2f0961d3de6dc8cfd2c`；测试 SHA256 `b01fed662cc9fe20b7ce3b64210dab0318c9e2b1876536dc9636e98f2da2a0a1`。
- 命令：固定Node执行 `--test test/lulu-brand-ui.test.cjs test/lulu-current-brand.test.cjs`；真实开发态执行 `artifacts/lulu-visual-20261009/run-brand.cjs`。
- 实际报告 `artifacts/lulu-visual-20261009/brand-mw0fkD/report.json` SHA256 `f892d764f814ee898d382c4edae1a0452760e18e57be7ceaa76207e739d1bf73`。浅/深1280×880、窄1024×720全部通过，每种两处噜噜图片解码、输入可见可聚焦、导航可见、根页面无横向溢出；主控回看浅色及窄窗实图。输入摘要不变、进程自然关闭，无模型调用/真实用户资料；不扩大成全部面板和安装态均通过。

**975项全测和YPbNuf均发生在该品牌修复之前。最新源码尚未重新完整全测、未生成包含修复的新包；所有旧候选保持未发布。** 待具备下一轮构建空间后一次冻结完成全测/打包/受影响验收，不重复未变内核298包构建和安全审计。

### 待用户选择与下一步

- 空间：C盘约3.3GiB，不足以稳妥保留候选、重建和同时展开验包。仅申请将 `dist-zDabGK/output`、`dist-SZqatc/output` 两套未发布旧候选复制到 `D:/DSH-Archives/2026-10-10`，逐文件校验后才移除C盘副本；不动源码、测试日志、现用安装、用户资料或YPbNuf。**尚未得到本轮答复，未移动/删除。**
- 权限：6组审批/沙箱核心源码除版本外与alpha.1相同，但新版tool-pwsh在批准后、执行前新增working-directory.ensure，agent-loop与session-controller也有变化。可复用源码一致证据，不能复用旧整条审批验收；已申请一次新隔离目录写随机标记的“先拒绝、再仅本次允许”，不提权、不改默认沙箱、不读用户资料。旧限定一次授权不挪用，**本轮待答复，未运行真实模型审批测试**。
- 安装：备份预检因Codex dsh_agent占用旧安装8个Node安全拒绝，日志 `artifacts/upstream-checks/2026-10-10/install/backup-live.log`；尚未复制用户资料、临停集成或杀进程。已申请最终包通过后临停集成并提示用户重启，再备份/覆盖/保全/恢复，**选择待答复，现在不要求重启**。

答复后按顺序继续：精确归档并保留回滚映射 → 最终冻结全测/双包 → 串行静态与真实品牌/功能/模型/权限/Portable/安全退出 → 私有备份、覆盖前后资料与凭据保全及安装态 → CI/公开Pre-release/匿名下载 → Wiki交付记录。仅本机Windows11 x64确认范围；未签名、其他电脑、长期老化仍未验证，既有主机权限风险不伪称消除。新噜噜范围不再待定，但不替代上述选择。Stable不自动更新。

### 以下为本轮较早时点，按原样保留历史

14:28续作：正式vendor部署、最终源码962/962和冻结双包构建通过；Setup/Portable已生成于 `artifacts/stable-readiness-20261007/dist-zDabGK/output/`，仍需实际包/交互验收。成功全测收据SHA `21505416fced84e667d7a38c8a3ea0180a3366d31e17de827ba830bdc37d6fc7`，构建收据SHA `edf79f3d8ceb223818761f6b37b43a728c47d7856f75cd59bd42132d888e8c6a`。一次许可证摘要遗漏失败经精确修正和篡改负例补充后通过，未降低门禁。安装备份预检因Codex仍持有旧安装内8个Node而拒绝；资料未动，正等待用户选择临停集成/重启或仅保留候选。本机/公开/Stable不变。

本日下午续作：用户已批准携带新噜噜形象；正式源码绑定为 lulu 1.1.16 / Harness 0.2.1-alpha.2。受控构建/打包来源缺口已补齐：真实 14,994 输入前后不变，298 个 TGZ 和描述文件与已验证下游输入逐字节相同。新来源配方位于 `runtime/harness-021-alpha2`，独立历史验证器的 alpha.1 构建记录原样保留，另附四个官方源码字节一致证明。接线专项51/51通过；尚未覆盖安装或公开发布。下列早间阶段记录保留其历史状态。

发现新发布标签，已启动下一次必要内核适配；不是重新打开已经完成的 1.1.14 / alpha.1 验收。源码与本机仍为 lulu 1.1.15 / Harness 0.2.1-alpha.1；公开 Pre-release 1.1.14、Stable 1.1.12、私有草稿 1.1.13 不变。本次没有覆盖安装、公开上传或 Stable 晋升。

官方检查时间 `2026-10-10T00:02:35.325Z`，完整分页取得 26 个 Releases、27 个标签，按完整 semver 比较：

- 版本 `0.2.1-alpha.2`，标签 `dsh-v0.2.1-alpha.2`，预发布。
- 发布于 `2026-10-09T11:09:26Z`，即北京时间 10 月 9 日 19:09:26。
- 提交 `d743267388641bc76f17c45ce8b4c231aed1d32c`；annotated tag 对象 `6851e496285b2c9670066fdd142e7e46da586649`。
- npm `@deepseek-ai/dsh@0.2.1-alpha.2` 同版，integrity `sha512-CkRE0uAOg2ldL2VpfF4cNRsl178CH5nM+8YklPrlMZl5ln0KhVfd42dJuRlgOXZmkpizCRvrVS8LAL+GKfgk0w==`。
- [官方发布说明](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-alpha.2)。原始检查证据：`artifacts/upstream-checks/2026-10-10/{check,releases,tags,npm}.json`。

## 官方替换与桌面保留

| 能力/实现 | 决策 | 依据与验收边界 |
|---|---|---|
| 流式超时、取消、PowerShell 大量输出结束、后台任务/轨迹状态 | 使用官方修复，不新增同类桌面逻辑 | 来自本次发布；仍需在新运行库验证中断、重试、退出，不把发布说明等同本机通过 |
| 子代理图片粘贴/拖放、标题保持、字体/侧栏/命令展示 | 使用官方界面与行为 | 不另造会话或附件入口；真实图片、文件及窄窗口仍需验收 |
| 图片、MCP 等安全依赖版本覆盖 | 候选去掉旧 20 条本地覆盖中的 18 条，仅保留两条仍必需的安全修复 | 新官方锁已包含 sharp 0.35.5、MCP client/core/server 2.2.0、SDK 1.31.0 等；减少覆盖不等于免除实际组件检查 |
| 私有 PowerShell 7、控制台及创建期防护 | 保留最小补丁 | 对应官方原码仍与旧补丁 preimage 相同；官方“大量输出结束”不是本机受限 PowerShell/控制台保护的等价替换 |
| 切换会话保留未发送附件 | 保留最小生命周期补丁 | 官方 hub 仍随 scope teardown dispose/release，facade 成功路径缺发布通知；子代理拖放修复不等于草稿引用生命周期修复 |
| 软件优先加密 Key、代理、Office/Wiki 检查与备份、Git Review、托盘退出 | 保留桌面补充 | 权限、数据语义和 Windows 宿主职责不同，不按名称相似删掉 |
| 推理翻译、Git Worktrees、实验性 Session state、SSH helper | 不自动启用或扩大产品承诺 | 官方可选/实验性能力；不纳入本次必要适配默认范围，也不重启远程命令桥计划 |

破坏性变化重点：PTC Python 需 Session 文件系统 sandbox/sandboxPolicy；tools 不再有 `both`；agent-instructions 改进程级 DSH_HOME；子代理立即返回 child ID、自定义运行时需 session/wait；Agent Team 改 Inbox、删除 outbox/retry/dedup；SDK 默认 agent 改 generic。须逐项追踪实际消费者，不因产品未直接暴露 SDK 就跳过默认组合测试。

## 本次隔离执行与证据

隔离源码：`artifacts/harness-source-0.2.1-alpha.2`，分支 `codex/harness-0.2.1-alpha2-compat`，固定上述官方提交。正式根分支、用户未提交视觉工作、`runtime/harness` 和已部署 vendor 不变。

1. 官方原始生产审计：634 条依赖，HCS 4.2.0 高危、fflate 0.8.2 中危各一项。保留 `upstream-audit.json`；[HCS 公告](https://github.com/advisories/GHSA-ch52-4w7c-c8xp)、[fflate 公告](https://github.com/advisories/GHSA-px8p-9vwx-vf98)。审计不代表所有漏洞或可达性已经排除。
2. 仅保留 `http-cache-semantics=4.3.0` 加既有精确 RFC 补丁、`fflate@0.8.2=0.8.3`。补丁 SHA256 `c92799bb441a2cc6866b4468c2efe9efaeaa062f96811fd957afce97a0343403`；不是声称官方 4.3.0 已覆盖所有本地回归。
3. 使用独立固定 pnpm 11.28.5，根 pnpm 11.19.0 不变。生成新锁并 `install --frozen-lockfile --ignore-scripts` 成功；未执行依赖生命周期脚本，不等于 native 构建通过。原始 package/workspace/lock 保存在 `upstream-inputs/`。
4. 新锁 SHA256 `94f8c46168ca3056bc693c19956c85e33bdcc15a12a0249e5428458ded009f47`；workspace SHA256 `07e4dfd35c6671a1c870e09837f6b3412c88e546ed98091aefb4b3fa62aed624`。包记录仅新增 HCS4.3.0、去掉 HCS4.2.0/fflate0.8.2；fflate0.8.3 原锁已有，因此去重。其他包记录无变化；完整锁语义另审。
5. 候选生产审计633条、零已知告警（`candidate-audit.json`）。实际安装路径 HCS 摘要匹配，28条策略与5条自然 got 消费检查通过；不重定向 import，回环合成数据，不读取 Key。证据 `security-tests/installed-tests-WmszWv/result.json`。
6. 实际 Office 依赖路径 fflate0.8.3 的选版、ZIP 往返及坏 ZIP64 有界拒绝3项通过，`security-tests/fflate-corrected.tap`。第一次夹具未进入 ZIP64 分支导致“预期抛错”断言失败，保留 `fflate.tap`；修正夹具加入 ZIP64 EOCD/locator，不改产品或放宽断言。这不是完整 Word/Excel/PPT 转换验收。
7. 私有 PS7 的15个必要源码文件及18个对应文档、附件生命周期4文件在新标签上预检后应用；必要 type-only/JSDoc 后续层一并重放。37个最终文件经主控独立重算摘要一致，8个保护输入不变，未盲带旧 typed-spy/bundle-roster 修补。证据 `patch-preflight/README.md`、`patch-preflight/followups-VKBfVJ/after.json`；旧整补丁 workspace 冲突保留。
8. 新源码的附件导航与会话编排2文件43项通过（`attachment-tests.log`，Vitest4.1.11）。这是源码客户端测试，不是 Electron 实际拖放验收。
9. 独立全锁审查：importers仅3处fflate specifier，snapshots仅Office→fflate和两处cacheable-request→HCS变化，8份补丁摘要与锁一致；其余无漂移。旧18条覆盖由官方满足，node-server/postcss已高于旧目标。
10. Node24.19.0 实际加载新版 node-addon-require-builtin0.1.9 的 Windows napi-v9，原生binding、manifest reader、CJS/ESM解析及ResolveCache共5项通过（`native-loader-probe.json`）；缓存仅在本轮隔离目录。lulu以私有Node启动Harness，不因官方使用Electron44.7.0就同时升级现有Electron43.5.0；完整宿主和Electron仍需验。
11. 官方 `build:official` 完整执行成功（非 `--artifacts-only`），含 host/client 类型检查、bundle 与 web。新 build record 共357个客户端文件、内容摘要 `55a824535271563c64631b855edee66912d621e913506ee6a6ee06fa28dbd5b1`；主控再次用官方 `readClientBuildRecord` 校验实际文件并重核37个源码 postimage 及固定锁。证据 `build-official.log`、`build-verification.json`。旧 typed-spy/bundle-roster 修补没有携带也通过，因此不增加这两类重复修补；这不是安装版/完整原生运行验收，也不虚构构建开始时的全树快照。
12. 破坏变更定向回归7文件62项通过：execution-mode10、Inbox7、parked-wait6、DSH_HOME9、SDK session/wait10、subagent-control17、tools both/native/ptc呈现契约3。另289条由明确的 `-t` 范围筛选未执行，不计作通过；所选范围无平台跳过。MockAdapter/FakeRuntime、临时目录及移除模型凭据的进程环境，无真实模型调用。命令、JSON测试名及摘要：`breaking-regressions-082736/REPORT.md`。这不替代自有extension与实际会话/权限集成。

13. 官方六阶段打包成功：pack-dsh、pack-host、pack-vendor、native-ts、pack-native-entry、select-packages 均退出0且输入不变，生成并选取298个本地组件包，每包SRI/SHA核对一致。证据 `official-pack-3WRQvy/result.json`（SHA256 `265f13ae71a9ec62aa3e8f2b1890737494b4b0e5a0918eeeb1d28498bf363f50`）；这是运行库输入打包，不是 lulu Setup/Portable。
14. 全新生产闭包为298个本地包加372个registry快照。使用固定11.28.5离线生成派生锁，SHA256 `ddea7591ca578548aeb71a324147b11a3052d76f9c2afc6e29519d6d8b2510c1`。首次严格语义校验拒绝pnpm把peer范围归一为父级精确override；保留 `runtime-lock-review/verify-derived-first.log`。逐项审查实际pnpm代码后，仅允许15组明确前后peer元数据和3个上下文标识映射，版本、SRI、非peer字段及required/optional分类不变；不是通配忽略peer差异。实际锁与变异回归34/34通过；主控重新执行完整校验成功，报告 `runtime-lock-review/derived-xDnPwF/lock-verification.json`，SHA256 `92a2702d1e0df3b0bfd0b64e6b254dd03d1a96538c823d7be204c7dfb82b5f61`。
15. 新生产锁以 `--prod --frozen-lockfile --offline --ignore-scripts --package-import-method=copy` 安装成功，实际复用602个适用平台包、下载0、1分43.8秒，锁和全部tarball等输入前后一致。证据 `runtime-install-oQtPp5/result.json`，SHA256 `a8e32a78a695625568779ee46409a5b1d1863ba727eae4aca2dd20a884ae3c91`。独立生产闭包审计670项（含跨平台可选记录）零已知告警，`runtime-audit-ABhN20/stdout.log`。未执行生命周期脚本、未改正式vendor或安装态；这些结果仍不等于实际原生组件和宿主通过。

16. 新运行库已按官方文件策略/manifest transformer组装：`runtime-payload-review/materialized-Lvif3G/dsh`，14,389文件、392,397,879字节、298共享包，Office全部733个清单文件及源码/许可证保留。收据SHA256 `9d2b8b1919d0e534cca20bcae7a97bb9743ed2250adbd9c746139feb2864c90e`，descriptor SHA256 `977b764d51d79f3b4f3f919d38067695e282acfe8b20add4dab1480958b21b70`。所有包内链接转换为普通独立文件；没有运行依赖安装脚本或修改正式vendor。首轮工具把合法pnpm入口junction拒绝的失败保留在 `materialize-real.log`；修复仅接受当前工具链内精确 `pnpm@11.28.5` 实体，通用输入/输出链接检查未放宽，11/11门禁回归通过。

17. 对物化产物独立只读回验通过（`runtime-payload-review/independent-verification.log`）。随后以私有Node24.19.0真正运行五组原生检查：自然HCS/MCP入口、sharp像素编解码、Koffi/0.1.9原生加载、DOCX/XLSX/PPTX转PDF、真实受限PS7 PTY取消/复用/销毁，全部通过。三种PDF分别2/1/3页，中文标记与Excel数值123.45实际解析匹配；历史只复用合成输入字节，不复用历史成功结论。Job根退出0、7个归属进程最终活动数0、guardian退出0，输入和descriptor前后不变。报告 `runtime-live-review/native-EKV8Sf/runtime-verification-report.json`（SHA256 `cedb145b73bb6b1d71cac16efd27c1574d430ad32fea9d66e527454496893f97`）。这是隔离Node原生组件验收，不代表Electron完整界面、真实Key/代理、Setup/Portable或安装态通过；本轮未调用真实模型。

18. 当前桌面Supervisor/真实launch worker的隔离宿主运行通过：认证HTTP200、history插件、无模型提示的会话创建、两次启动间同一会话ID和三条合成历史事件/序号/分页状态一致；输入与运行库再次校验不变。仅在artifact副本作5处已逐一验证的路径/pnpm精确替换，未注入绕过运行库验证的测试入口。报告 `runtime-host-review/run-q83M5A/result.json`（SHA256 `39731ad95aa05d42b7e36f6240f15ce219dfdb80fa55097687ed5a9ed972a5a8`）。两个由Supervisor持有的Host根进程已停止，使用其原有停止逻辑，未声称原生托盘正常退出或独立完整子进程Job计数；未使用真实用户会话、Key、代理或模型。正式根目录与安装未改变。

## 后续顺序与发行边界

### 下午受控来源闭合与正式接线

- `controlled-build-pack-56AHIJ/build.json` SHA256 `02c640225e71a676d902d051914e39166c475090da886407cb91860dbef315ae`；真实完整构建退出0。
- 同目录 `pack.json` SHA256 `befc96e7c29a09020fcd7adfdcfe017169daa615bbcafc31e0fbfeb0962ee36d`；六个子步骤退出0且自然关闭。
- `equivalence.json` SHA256 `3248118fa897162161f8e6ae62dcc5c167dcbf16b2cf72c1906500514fceeac9`；298个TGZ与descriptor逐字节相同、差异0。历史收据和客户端构建记录没有改写。
- 六层补丁在固定官方提交上重放，40个目标文件完全一致：`source-recipe-agoof5/result.json` SHA256 `cc8eb0b606c63b6103dd4245395cc3820ae29798bb7220349ffe2e2d3d1c9a06`。
- v2来源链与部署验证器通过完整输入、逐包摘要/SRI和测试候选到正式宿主的精确变换核验，不按相同版本号豁免旧结果。下方缺口段为修复前记录，仍保留失败证据。

下一小版本拟为 1.1.16；在正式源码绑定前不只改版本号宣称换核。先完成新标签源码补丁、附件与 Windows 受限终端、官方完整构建/原生闭包和完整锁语义检查，再进入 Supervisor/打包绑定及源码全测、Office/Wiki/Git/Key/代理/插话/退出、Setup/Portable、私有备份覆盖与安装保全、公开回下载。有效的旧版结果只作对照，不能冒充 alpha.2 验收。

正式接线新增缺口：本次真实构建成功及事后文件摘要有效，但没有发布门禁要求的构建前后完整源码输入快照，不得事后补造 `before/after/inputsUnchanged`。357项官方摘要只覆盖客户端，不覆盖全部Host/native。后续需在保留本轮证据的前提下补一次受控 build+pack；只有全部tarball字节、包集及固定输入一致并建立独立等价记录，才能复用既有下游结果，否则从发生变化的包集派生处续作，不重复未受影响的安全/源码专项。具体差异、禁止补造字段与最小正式绑定清单见 `artifacts/upstream-checks/2026-10-10/runtime-lock-review/PROMOTION-GAP.md`（SHA256 `eafea0a8fecb2a71d95ead3c6e9a3d44c9db9b05a7becf3594fea302acddf4da`）。当前正式内核尚未替换不是因为已经安装了alpha.2后界面未刷新。

2026-10-10 用户回复“携带”，已明确允许 1.1.16 公开 Pre-release 携带 1.1.15 的黑发、眼镜、比耶噜噜形象及图标；不再等待这一范围决定。1.1.15 不单独补发，既有安装身份、资料目录、Key、代理和功能边界保持。未签名、仅本机 Windows 11 x64、其他电脑和长期老化未验证等限制保持。Stable 不自动改变。公开批准不替代剩余技术验收；Obsidian 写后校验另附本次同步回执，未完成前不宣称闭环。
