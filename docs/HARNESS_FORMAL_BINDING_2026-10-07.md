# V1.1.14 / lulu：正式宿主绑定 0.2.1-alpha.1

日期：2026-10-07（Asia/Shanghai）。本页记录同一候选的源码接线和打包验证，不代表本机覆盖升级或公开交付。旧运行库、用户资料、既有失败证据均保留。

## 当前状态

- `runtime/harness/package.json` 的正式源码候选绑定已从 0.1.6-alpha.2 改为 **0.2.1-alpha.1**，上游标签 `dsh-v0.2.1-alpha.1`，提交 `5badb15009ae1756c3afe0ae0cef1faafc290ccc`。没有采用未发布 master。
- 新运行库已受控部署到 `vendor/harness-desktop-0.2.1-alpha.1/`。14,173 个负载文件、387,504,989 字节、完整 Office 733 项及私有 PowerShell 7.6.6 均按既有固定证据核验；没有用新 vendor 修补旧版安装程序。
- 最终冻结源码 `test-OGH6D3` **782 / 782 通过，0 失败、0 跳过**，342.4 秒，前后输入相同、真实退出 0；此前 772 项接线测试单独保留。正式源代码 Supervisor 的认证、空会话重启恢复、启动取消/重启实测通过；没有用测试版 Supervisor 替代正式文件。
- 最终真实 Electron 候选包 `pack-My8nLr` 打包、新核完整性和基础/Harness 冒烟均通过，具体范围见后文。附件跨会话实测缺陷及完整 UI/安装门禁仍开放。未生成/验收新 Setup 或 Portable、未覆盖安装、未上传草稿或公开发布；安装记录仍 V1.1.13 / Harness 0.1.6-alpha.1，Stable 仍 V1.1.12。本轮未声称重新验证既有安装状态。

历史隔离构建 profile 的 `promotionAllowed:false` 原样保留；它是当时证据，不是产品运行开关。当前更改是正式源码候选接线，不是通过了全部发行门禁。

## 官方复用与桌面保留

| 决策 | 实施和语义边界 |
| --- | --- |
| 使用官方运行库定义 | 固定官方四个源码及其编译包，复用 descriptor、文件过滤、包身份和全树核验；不以旧版 hoisted 包数量证明新版本完整。 |
| 使用官方交互和代理接口 | 新核测试直接执行官方队列/插话/停止状态函数，以及 `installProxyFromEnvironment`、`proxyRouteFor`、`proxyEnvironmentForChild`。旧私有代理接口只存在于旧测试，产品未引用；未新增一套桌面队列。此层不等于真实 DOM/模型验收。 |
| 替换旧部署入口 | `runtime:deploy` 走已审查 descriptor + 21 项输入证据的受控部署；旧入口明确标记 `runtime:deploy:legacy`，用于历史复现，不作为新核验收。旧 CI 工作流也标记 Legacy，尚未建立完整新核 CI 重建。 |
| 仍保留 Windows 安全补充 | 官方全树校验外保留链接/硬链接、Windows 路径与大小写碰撞检查；部署采用新目录、暂存校验后重命名，不覆盖历史负载。 |
| 仍保留桌面独有能力 | 软件优先加密 Key、代理入口、Office/Wiki 校验与备份、Git Review、进程隔离/退出保护和私有微软 PS7 保留；没有为去重删掉权限、凭据或数据保护。 |

完整 Office 使用已核实的官方 0.1.5 负载；本轮没有再次从头构建 Office。前阶段 DOCX/XLSX/PPTX 到 PDF 的中文及数值验证仍有效，字体替代限制仍需说明，不能宣称与所有 Office 客户端像素一致。

## 启动与退出

全树完整性在部署/打包时校验；运行时用官方元数据与入口核验，加固定 Node 摘要、完整私有 PS7 校验。耗时校验放到 Worker，避免在 Electron 主线程同步扫描大树。Worker 正常完成和取消均等到实际退出才返回。

Supervisor 启动验证在凭据读取、配置创建及 spawn 之前完成；停止时 abort 并等待当前 Worker，generation 检查拒绝过期启动结果。Renderer 不能覆盖版本、路径或固定摘要，也没有沙箱开关。私有 PS7 环境变量仅由主进程核实后设置，不修改系统默认 PowerShell、全局 PATH 或 Nahimic。

实测启动校验约 1.53 秒（缓存温/未知），主事件循环有 79 次 tick、最大间隔 64.7ms，Worker 返回时已退出。此为 Node 测量，不是 Electron UI 冷启动性能承诺。

## 证据及失败保留

证据基目录：`artifacts/formal-binding-20261007/`。

| 证据 | 结果 / 限定范围 |
| --- | --- |
| `deploy-f5voR8/stdout.log` | 固定来源到新 vendor 全树、Office、PS7 核验通过；并行编辑导致外层 `inputsUnchanged:false`，因此不把部署 wrapper 当完整源码通过证据；没有重复部署或覆写目标。 |
| `workspace-refresh-E1irpH/result.json` | pnpm 最初因 workspace 版本缓存陈旧拒绝进入测试；限定空 runtime workspace 的 offline/frozen/ignore-scripts 刷新通过。根锁、依赖及原生负载字节不变，没有关闭 pnpm 校验。 |
| `test-uxTlM9/result.json` | 771/771，0 失败/跳过，源码前后相同；此后增加真实打包复制回归。 |
| `test-pzztdI/result.json`、`stdout.log` | 接线阶段 772/772，0 失败/跳过，退出 0、child closed、源码前后相同。旧候选测试失败及补充测试仍单独保留。 |
| `test-OGH6D3/result.json`、`stdout.log` | 插件健康修复后的最终源码 782/782，0 失败/跳过，342.4 秒、退出 0、child closed、源码前后相同。 |
| `formal-host-Yl9WUE/report.json` | 正式 Supervisor，无 adapter/verifier/spawn 替身：校验取消、再启动认证、空会话跨重启保留，3 项通过，3 events/throughSeq=2；没有模型请求或真实用户资料。owned host 已退出；后代进程终止没有独立全生命周期观测，不夸大为完整迁移。 |
| `launch-check-XXmtNN/report.json` | 实际 Worker 完成/事件循环测量，9 个输入摘要不变，返回时 0 个活动 Worker。 |
| `root-audit.json` | 根 production 5 项、0 已知漏洞；与前阶段 Harness 667 项审计是不同范围。 |
| `licenses-ZFhSan/stdout.log` | 按新 descriptor 的顶层/嵌套包身份生成 605 个包、11 类许可证，PDF.js notices 保留；并行源码变化使 wrapper 不作为整套源码证明。新许可证清单摘要已进入治理固定值。 |
| `pack-08RKUY/result.json` | 首个真实包失败：electron-builder 的根过滤器排除了相对根 `node_modules`。打包后官方门禁正确拒绝不完整包，没有拿它安装或发布。 |

根复制问题已改为两个明确映射：根元数据与 `node_modules` 独立来源。新增测试使用当前实际 electron-builder 复制实现，修正前复现漏复制、修正后验证顶层及嵌套依赖。没有降低完整性断言或只在源码目录验证。

## 真实候选包收口

第二包 `pack-wXLnz5`：真实打包退出 0、输入不变、child closed；after-pack 新核和 PS7 全树门禁通过。Windows 元数据为 lulu / DSH Desktop / 1.1.14，当前布局 18 项门禁通过；旧 legacy=false 单列，不冒充新核门禁。基础 Electron smoke 与包内独立终端 cwd/凭据隔离/第二命令通过，owned helper/shell 退出已核实。

对应证据：`package-layout-r11NDI/result.json`、`package-terminal-BCY9R9/result.json`、`electron-basic-heAuOF/report.json`。首轮布局测试器 PATH 缺 PowerShell 的 `package-layout-c0AGh5` 失败仍保留；不写成首次就全绿。签名按配置跳过，这些是本机 unsigned win-unpacked 验证，不是安装器验收。

首次真实 Harness 页面 smoke `electron-harness-WORK67` 的认证、工作区、独立会话及 191 项插件 inventory（0 failed、核心模块 ready）通过，但最终 ok=false：健康页仍要求旧 profiles/node_modules 投影，将 529 个依赖全部误报 missing。修复 `PluginHealthCatalog`：使用可信官方 descriptor 核对实际 materialized 包清单；缺失、篡改和链接仍拒绝，兼容官方 bundle.patch 路径数组。专项 46/46、实际 vendor 与第二包运行库均只读扫描 529/529 healthy；这只是新源码的扫描，不能称第二包旧 ASAR 已修好。见 `plugin-health-layout-fix/report.json`。

最终 `pack-My8nLr` 包含该修复：真实 builder exit 0、前后源码相同、child closed，after-pack 官方全树、外部 process host、固定 Node/PS7 及 ASAR 接线核验通过。`electron-harness-iY9yqV/report.json` 真 EXE exit 0 且 smoke.ok=true：HTTP 200、认证、工作区同步、独立 workspace-write 会话、529/529 健康依赖、191 项 inventory（161 active、0 failed）、3 核心模块 ready、Skills/MCP/hook 状态符合当前契约。`electron-basic-OdJQbo/report.json` 基础启动/zh-CN/safeStorage 通过；`final-package-identity.json` 确认新 EXE Windows 元数据为 lulu / DSH Desktop / 1.1.14。两次启动均不使用真实用户数据或 Key，未发模型请求。

完整 18 项布局和独立终端报告属于第二包，未包装成最终包重新全项验收。第三包未更改内核负载/终端代码，但仍需后续完整交付验收。`final-process-readback.json` 在 2026-10-07T13:38:06Z 对 owned 候选可执行路径/命令标记的时点检查为 0 个残留，没有停止用户进程；不是全生命周期进程追踪。

### 发布 Blocking：切换会话丢失待发送附件

`electron-attachments-ZW1tSz` 初次失败；同字节包的隔离诊断 `attachment-diagnosis-cjAxlg` 再次复现：4 个待发送附件 → 另一工作区会话 → 原 session ID，文本草稿恢复但附件栏为 0。不是旧数量选择器错误；未重新拖入或放宽断言制造通过。

包内代码与 vendor 摘要相同。源码支持的解释链为：主视图释放旧 session reference → count 为 0 时退休 session scope → conversation shell dispose 并释放 draft attachments → 新 shell 仅恢复持久化文本/引用。并未逐个注入探针观测每次 dispose，因此区分“现象已复现”与“源码支持的根因链”。本轮尚未修改上游源码或重新生成 descriptor；下一切片应在官方会话/附件生命周期修复，避免另造桌面附件系统。验收至少覆盖同/跨工作区来回切换、发送/移除/删除释放、会话隔离及退出清理。

首次附件 EXE 退出 `2147483651`（stderr 有 PostQueuedCompletionStatus）没有在再现中重复；后次 exit 0 但 smoke=false，仍算失败，不能称异常退出已经修好。

### Office 预览：旧 UI 验收契约失效，尚未完整通过

`electron-preview-ovhwcF` 在 Office canvas 等待失败。普通格式阶段已走完，不代表全部交互通过。官方新 OfficeBody 不再有旧 `data-office-font-notice`，缺字体提示移到 toolbar 且按需出现；canvas 的隐藏状态也移动到父元素；XLSX 现走独立 spreadsheet 预览，不再是统一 Office PDF 预览。

两次只读诊断表明 DOCX 已转换两页，逐页中文 marker 与非空 bitmap 可见于 DOM/像素数据。第二次诊断首次出现 bitmap 时的采样截图被“添加 API Key / 稍后配置”弹窗覆盖；随后两页曾具有可见布局，稍后 sidebar 折叠并继承 visibility:hidden。不能混合不同时点为“始终隐藏”，也不能把旧 helper 超时或临时 0% 读数定性为产品转换/显示缺陷，更不能据此把 UI 验收改为通过。下一步用官方真实按钮可靠完成首次引导，等待 dialog 消失及 root.inert=false，再按当前激活文件、可见且有内容的 canvas/表格检查，保留逐页/单元格内容与源文件不变断言。无真实用户凭据，无模型请求。

## 后续门禁

1. 优先修复官方附件草稿生命周期，再补新版首次引导与 Office/Spreadsheet 实际 UI 验收；不要降低原跨会话附件保留要求。随后软件 Key 优先级、代理、插件、Office/Wiki/Git 与交互；现有空会话 smoke 不能替代完整模型/历史分页/用户资料迁移。
2. 完整官方终端生命周期、工作区切换及私有 PS7 所支持 Windows 分支；不以独立原生脚本通过替代产品触达。
3. Setup/Portable、签名状态、备份覆盖、安装态 Key/代理/会话资料保留与回滚。
4. 公开发布范围和素材分发来源、公开下载完整性；Stable 晋升仍需单独明确命令。历史未决发布范围不被定时授权代替。

不重建已经通过且输入未变的官方源码、冻结锁或 Office 负载；新失败以真实触发条件收窄修复。
