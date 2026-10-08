# lulu V1.1.14 / Harness 0.2.1-alpha.1 — Stable 就绪验收

## 当前结论

本轮继续用户要求的完整适配，仍是同一个 V1.1.14 候选。目标为已发布 `dsh-v0.2.1-alpha.1` / `5badb15009ae1756c3afe0ae0cef1faafc290ccc`，不采用 master 未发布代码。正式运行库仍绑定 **0.1.6-alpha.2**；当前没有覆盖安装、制作新安装包、上传或公开发行，Stable 未变。历史安装 V1.1.13 / Stable V1.1.12 并非本轮重新验明的安装状态。

下列结果是隔离候选和限定组件的证据，不能替代完整宿主、真实模型、Setup/Portable、资料保留和公开下载验收。`promotionAllowed` 继续为 `false`。

## 1. Office 来源与真实原生能力

- 对固定公开配方树 `b19bb73c74ed893b8a5d1716d32df32a113ed31b` 的 4 处差异与额外 0069 补丁已逐项审阅；LibreOffice Core `bce0998afefdbc355585ca324285661a2170ba77` 可获取。来源材料可获取和具体差异审查这两层门禁关闭，不再笼统等待仓库公开或缺失标签。不声称独立重建与官方二进制位级一致。
- 官方 Windows native 0.1.5 的 **733/733** 清单文件摘要一致。普通冻结安装曾错误地跳过缺失的 optional payload；使用隔离的 `PNPM_CONFIG_OPTIMISTIC_REPEAT_INSTALL=false` 重试恢复，未手工修改 store/node_modules。
- 官方队列/provider/parser 测试 **111/111**。真实 DOCX/XLSX/PPTX 转 PDF 分别 **2/1/3 页**，PNG、PDFium 和中文文本验证通过；Excel 公式缓存从 0 重算为 123.45，公式仍保留。
- 额外 **14 项 native + 6 项 provider** 检查覆盖异常输入、既有输出保护、目录/页索引拒绝、缓存与取消后恢复。主线程独立复验通过，输入文档摘要保持。
- 保留首轮 pdf.js 测试 API 错误和 DPI 精确浮点假设失败；最终接受 twips 栅格化的既定一像素误差，不删除原失败。没有安装缺失的商业字体。150ms 取消不单独证明 native 已启动后被终止。

证据：`artifacts/office-ready-20261007/REPORT.md`、`main-verification.json`。Office Skills 生成路由、真实权限/备份/Wiki、完整桌面与安装态仍未覆盖。

> 后续更新：用户已允许私有官方 PS7；7.6.6 已获取并完成来源、签名、原权限矩阵与官方 shell/tool 接缝验证。以下“尚待决定/未下载”是先前时点，当前结果和剩余门禁见 [私有运行时适配](HARNESS_PRIVATE_POWERSHELL_2026-10-07.md)。不改变旧输入/旧验证的边界。

## 2. 候选依赖安全分组

### http-cache-semantics

采用固定 **4.3.0 + 本地 25 行同步重验证补丁**，并保留补丁来源与 SHA-256；不是声称官方发布了 CVE 修复版。原测试中 Set-Cookie 一律禁缓存与未过期 proxy-revalidate 的假设已按实际 HTTP 语义纠正，保留旧证据。

- 包级固定时钟 **28/28**；实际 `got → cacheable-request` 消费者 **5/5**，主线程独立复跑实际安装路径通过；默认缓存关闭仍为两次请求、零策略调用，显式 public stale 阳性对照有效。
- 安装曾出现 lock 中已有 patch_hash、退出 0 而真实深层包未打补丁的情况。最小复现后只对候选 otel 闭包执行固定锁、离线的定向修复，未强制重装整个项目，也没有改 store 文件。
- 输入准备器增加精确的新文件允许项与 SHA、链接、并发替换保护，**22/22** 通过。真实落盘 bytes 验证是门禁，不以锁文字判断成功。

证据：`artifacts/hcs-ready-20261007/INTEGRATION.md`、`installed-tests-LijZCA/`。补丁 SHA-256：`c92799bb441a2cc6866b4468c2efe9efaeaa062f96811fd957afce97a0343403`。

### sharp

固定 **0.35.5**，仅更新其必须的官方 native 依赖组；实际 Windows 包 **55/55** 文件比对，`rsvg 2.63.2 / libvips 8.18.7` 身份通过。真实 Harness 附件模块在自然解析、无重定向下 **17/17** 行为通过，包括透明度、颜色深度、EXIF/ICC、GIF、缓存/取消和恶意超限拒绝。图比较确认其他组不动。主线程另外独立复跑隔离 17 项通过。

记录 SVG metadata 在格式白名单拒绝之前可达，不能以“不支持 SVG”推断依赖不可达；公告的特定 Linux 利用条件也不能伪写成已复现 Windows RCE。完整候选审计此时 **662 项、剩 2 high**，均属 MCP 公告，不能报告为零。

证据：`artifacts/sharp-ready-20261007/REPORT.md`、`artifacts/sharp-integration-20261007/after/`。下述 MCP 组是其后的单独迭代，保留此处当时两项告警作为历史记录。

### MCP 评估

独立评估选最小修复版本 client **2.2.0** / SDK **1.31.0**，client 自带 core 2.2.0，未升级 server 2.0.0 继续使用 core 2.0.0，不做全局 core 强制覆盖。真实 Harness HTTP/stdio 四项、OAuth 合成红绿十项、filesystem/Claude 无人值守回调四项通过；主线程独立复跑真实消费者 **4/4**。

重要边界：新版仍须为 OAuth 凭据提供 `expectedIssuer` / 持久化 issuer；无绑定的首次使用未自动修好。当前 Harness HTTP 路由只使用静态 headers、没有 authProvider，401 测试未追随 OAuth discovery。本轮不新增 OAuth 能力，不读取或迁移用户凭据，也不误报分页为新增功能。评估通过不等于共享候选已完成集成。

后续共享候选集成已完成：锁结构差异只包含 client/core/SDK 修复组及必要 peer 重绑定，不升级 Claude/GenAI/server/node；**807 份发布包文件**与独立验明的包字节一致。实际自然解析、无 hook 的 **16/16** 检查通过，新增 server-everything 的 13 工具列表、中文 emoji echo 和退出验证。3 个 stdio 子进程均退出。冻结安装及完整生产审计 **662 项、全部级别 0 已知漏洞、exit 0**；没有忽略公告或降低阈值。零告警不代替上述实际消费者验证，更不代表完整产品验收。

证据：`artifacts/mcp-ready-20261007/REPORT.md`、`consumer-fixed-main-verification.json`、`natural/REPORT.md`、`natural/verification.json`，以及 `artifacts/mcp-integration-20261007/REPORT.md`。主线程再次独立复跑共享候选自然 MCP 四项和 sharp 十七项通过（`natural/consumer-natural-main-verification.json`、`artifacts/sharp-integration-20261007/installed-o98SdQ/`），其中包含 HCS/Office/正式输入摘要保持验证。

最终候选锁 SHA-256 `143bc6abfc8283456e79dae660a8a69cbe64dba73089e36d1f86cb330397d5c5`；源码补丁 `0f629c5c4f18df624336857acbdbc705564c6ad8d3601ceabc2693eaebbc1aa8`，完整固定输入见该报告。安全状态是 `isolated-runtime-verified-host-acceptance-pending`，候选继续 `promotionAllowed:false`。

## 3. Windows PowerShell：同权限对照与限定诊断

用户授权的 Nahimic 临停对照已完成：**仅服务控制助手提升权限**，测试仍是原非管理员令牌、相同环境和 ACL 沙箱。服务停止 5675ms 后恢复 Running/Auto，主线程独立检查及相关进程退出验证通过。没有改变启动方式。

- 服务运行的两项均 `0xc0000005`；停止时 ASCII sentinel / exit 0 / 空 stderr 通过。
- 停止时官方编码前导仍有 **两条 CannotCreateTypeConstrainedLanguage**，因此不能宣布完整 shell 已修复。
- 用户进一步允许临时关闭 Sound Tracker；界面中 Audio Recon 本来是关闭的，没有找到独立 Engine 开关，因此未改变音效设置，也未再停服务。Audio Recon 关闭不能证明注入引擎关闭。
- 服务保持运行时，仅给自建受限 PowerShell 子进程启用 extension-point-disable mitigation，ASCII 连续三次成功；实际 `GetProcessMitigationPolicy` 读回 flags=1。原令牌、挂起创建→加入 Job→恢复顺序不变。MicrosoftSignedOnly 方案失败并被排除，不采用。
- 新建独占隐藏 console 的隔离诊断使中文/emoji stdout/stderr 成为准确 UTF-8，CLM 保持，父 console 码页/进程列表与服务保持；拒绝写入仍生效。最初原生命令没有执行，是探针手工环境遗漏 `PATHEXT`；单变量对照定位，补回即恢复，真实 Harness 原本保留此变量，**不是产品缺陷，不能以修探针充当修产品**。
- PowerShell 5.1 的替代编码前缀使 native 输入多出两个 UTF-8 BOM；普通 FullLanguage 下官方 `UTF8Encoding(false)` 对照没有 BOM，不能视为等价。去掉 OutputFormat 或只读 Console getter 均未解决，未继续引入 CLIXML 转换器等复杂绕路。2>&1 的观察差异也在未缓解的普通 5.1 对照存在，未证实为新回归。
- 既有 Codex 私有 **PowerShell 7.6.5** 仅作临时诊断：原 ACL/CLM/Job 与 mitigation 保持，**不加编码前缀**即可完成准确中文/emoji、native stdout/stderr、无 BOM 管道输入，ERROR_COUNT=0。服务、共享 console、源码不变，自建进程已退出。这不是产品已固定/分发的运行时；网络/代理、写入、取消树、实际 Harness/打包仍待验。
- 已请求用户决定是否允许将微软官方 PowerShell 7 作为 **lulu 私有运行时**纳入适配，官方 x64 ZIP 约 100 MiB，不改全局 PATH 或系统 PowerShell。尚未下载或纳入产品。官方当前补丁版本核查为 7.6.6；7.6.5 的诊断不能替代将来对最终所选版本的验收。

所有 mitigation/console 代码此时只在 artifacts 诊断目录，没有接入正式运行库、放宽沙箱、持久化系统设置或影响共享 console。隔离 opt-in 原型 20 项单测及严格 TS 检查通过，主线程独立复跑；这些是模拟 FFI 与类型检查，不是该原型的真实执行证明。证据：`artifacts/shell-ready-20261007/paired-Rl37yx/`、`mitigation-IikjSK/`、`ENCODING_REPORT.md`、`ps7-verification.json`、`audio-ui-inspection.md` 与 `artifacts/shell-mitigation-ready-20261007/verify-yT63WA/`。后续仅可在完整语义成立后考虑限定调用路径，不默认作用于所有程序。

## 4. 源码、组件与真实交付边界

- 当前桌面源码全量基线 **662 项：659 通过、1 失败、2 原有跳过**。失败是 PTY guardian 测试在原 5 秒内未生成子进程 PID；原测试和超时不改的单项重跑通过。不将其合并为一次全量绿，不臆断根因。
- 本轮代码与候选输入冻结后的独立全量终测：`pnpm test` **685 项 / 683 pass / 0 fail / 0 cancelled / 2 原有 skip**，296186.59ms，exit 0，源码与候选输入快照前后一致。证据 `artifacts/stable-readiness-20261007/source-tests-iHl03R/result.json`。pnpm 的既有 node.cmd 选中 Codex Node，但已核实其 SHA-256 与项目固定 Node **完全相同**（`3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237`），均为 24.19.0，未改 shim。它仍是当前正式 alpha.2 绑定的桌面源码测试，不冒充完整 021 宿主测试；两项原有跳过不作为发布豁免。
- 安全修复组之后的 **0.2.1-alpha.1 完整 `build:official` 成功**：2026-10-07 08:06:34–08:09:01 UTC，Node 24.19.0 / pnpm 11.7.0，355 个客户端产物、4 个公开构建值，锁及 workspace 摘要不变。复用已审阅执行器，证据目录虽为旧日期前缀，实际本次记录在 `artifacts/harness-021-build-20261006/build-ImJhzE/command.json`，不混用昨天结果。保留 bundle/plugin 性能警告；Windows native-system 是官方 no-op，不声称编译 POSIX 原生件。
- 此次编译后的六项官方门禁也分别 exit 0、输入不变：`closure-Mcmu3r`、`entrypoints-OySDM7`、`client-S302gS`、`optional-6M30bt`、`release-dsh-4ESJ4N`、`release-vendor-NXo0vg`（同上证据根）。这是运行库闭包、入口、客户端边界、optional import 和版本族/发布顺序检查，不执行 npm/GitHub 发布。
- 新 021 实际 Cordis/shell-env/defineTool 组件完成三轮环境绑定清理、终端插件卸载/断连/取消，主线程运行通过。会话 provider 仍有夹具，不是完整控制器/官方页面/模型验收。
- 修复宿主只按 hoisted 布局猜模块路径、导致新官方 source/apps/cli 布局失败的问题：固定三个官方包，从 CLI/provider 各自真实依赖锚解析，校验包身份、完整版本与词法/真实闭包边界；不允许 NODE_PATH、祖先目录或外链注入。不改 Vault、IPC、迁移或正式内核版本。专项 **57/57**、两套真实 0.1.6-alpha.2 / 0.2.1-alpha.1 路径摘要回读通过，主线程独立 `artifacts/host-modules-ready-20261007/verify-f6tWkN/` 复验。源码故障先红后绿；完整产品全量终测另记。
- 使用指定水豚噜噜形象按本轮用户决定保留。用户决定不等于存在第三方授权文件；素材来源说明保留未验证事实，不声称官方背书。
- 独立代码评审：上述双布局 leaf 与输入准备器新增文件/回滚保护未发现 Blocking / Important。核对真实两套包清单与导出、凭据初始化顺序和只读限制；不代表全产品安全评审。报告 `artifacts/stable-readiness-20261007/independent-review.md`。
- 未调用模型、未读取/输出/打包 Key，用户真实会话资料未迁移。阶段验证与实测源码路径不应被描述为用户本机已更新。

## 5. 剩余顺序

1. 最小安全组、真实消费者、整闭包审计、新目标完整构建/六项编译后门禁与桌面源码终测已完成；冻结本轮证据，不重复 Office 来源/native 或从头重做同一构建。
2. 完成 Windows shell 非管理员/ACL/Unicode/native/网络/进程树取消等完整语义，再决定是否接入限定 opt-in；不以单条 ASCII 或 exit0 放行。
3. 接通受控源码/部署双布局与新运行库构建绑定，验证真实宿主、软件优先加密 Key、代理、会话/分页/默认自动化存量恢复和官方工具路由。等价且已验证后才删除重复实现；Office/Wiki 危险内容检查、备份/收据、Git Review 及 Windows 宿主保护保留。
4. lulu 官方页面和工作台真实交互、Setup 与 Portable、覆盖前备份和安装态用户资料/凭据保留、公开下载验证；签名/另一台电脑/长期老化如未验明须注明。DSH 在运行时不强行结束。
5. 同步既有 Obsidian 项目和关联索引，不另建 lulu 知识库。达到 Stable-ready 后明确报告；不凭“推进到可以发布”擅自改 Stable 通道。

私有 PowerShell 运行时的来源、体积、许可和平台边界见 `artifacts/stable-readiness-20261007/powershell-runtime-assessment.md`。官方建议候选为 7.6.6 / 提交 `f260eb9c31ec72c5282f98e5ea24d9be4f8d7536`，ZIP 为 **101.4031 MiB**，不是已知安装包增量；尚未下载。微软对 Windows 10 的当前支持受 edition/servicing branch 限制，不能把本机 Windows 11 的诊断推广到普通 Win10 22H2，也不据此擅自缩窄产品 Windows 10/11 承诺。新的私有运行时范围仍待用户决定，不将先前临停音效服务的授权扩大到新增发行依赖。

本页是本轮合并记录；各原始失败和日期文档仍保留。Obsidian 同步与主线程回读结果独立记录在 `artifacts/stable-readiness-20261007/wiki/final-verification.json`；须核对其实际存在与成功字段，不能仅凭本页链接声称已同步。它不改变以上安装/发布门禁。
