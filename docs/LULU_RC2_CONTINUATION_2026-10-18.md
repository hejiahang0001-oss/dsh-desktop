# lulu 1.1.17 / rc.2 交付续作（2026-10-18）

## 用户决定与边界

用户在上一轮说明隔离搜狗缓存 / LocalLow 新增宽权限风险后回复“接受，继续迭代”。本轮据此继续验证，保持系统、输入法、DACS 和现有 ACL 不变；不再重复询问该风险或已授权的随机标记权限测试。

接受范围对应 [rc.2 固定来源及证据](HARNESS_UPSTREAM_v0.2.1-rc.2.md) 中 `approval-allow-mdjOgR/ACL-REVIEW-20261018.md`：合成 home 的搜狗、LocalLow、NVIDIA 范围内 81 路径 / 301 个不同异常 ACE。原严格扫描失败保留，不等于全部 ACL 通过；创建者及跨用户实际影响仍未证实。正式资料、密文 Key、代理、会话和覆盖前后权限不得放宽。

此决定不豁免正常退出、Job 成员清空、最终包交互、Portable、备份覆盖、资料保留或公开下载门禁。Stable 不自动更新，不强停用户程序。

## 本轮聚焦

1. 修正首次使用测试漏识别官方“开始使用 / Get started”弹窗的问题，只使用官方可见、可命中的关闭操作；不登录、不写 Key、不修改 inert 或隐藏界面。品牌验收增加无弹窗及输入/导航可命中检查。
2. 补正常退出诊断：由拥有 Job 句柄的观察者记录退出后成员 PID、创建时间和进程名，独立保留进程消失与 Job 清空结果；不延长验收超时，不猜测输入法或音效程序是根因。
3. 复用已通过的来源链、内核构建和权限行为。新源码改动对应的新包须重新绑定，不把旧候选冒充最终包。

## 当前交付状态

源码 1.1.17 / Harness 0.2.1-rc.2；已安装 1.1.16 / 0.2.1-alpha.2；公开 Pre-release 1.1.14，Stable 1.1.12。尚未覆盖安装或公开本轮候选。

## 已取得的验证证据

- 首次使用/品牌专项 45/45、退出观察专项 19/19 通过。首次全量 `test-WXmdyr` 为 1110 项 / 1107 通过 / 3 失败，退出码 1、源码输入保持；三项均是旧终端 DOM 夹具未实现新增的 `getBoundingClientRect` 可见性契约，不能将该轮写成全绿。修正夹具不放宽产品观察器或焦点/凭据断言。
- 终端夹具补齐后相关 48/48 通过。第二轮完整 `test-Z4KELR` 为 1110 项 / 1108 通过 / 2 失败：README 当前候选完整文件名遗漏，以及代理测试的固定 Node 子进程异常退出 `3221225477 / 0xc0000005`，后者 stderr 为空、没有匹配 Node PID 的系统崩溃证据。README 已补齐真实候选包名，版本专项 6/6 通过；代理故障继续窄复核，不跳过或改为自动重试。同期 OpenConsole / cpbgrd64.dll 的系统事件不等于已经证明是本次 Node 的原因。
- 代理原样有限复核三轮均 8/8、输入不变，未复现崩溃，根因仍未定位。证据 `rc1/proxy-crash-check-117/run-9TCqaq/report.json` SHA256 `4ec8d0967149a1cca4d474ffedbc4e15db3ceaf5ddca0820312e94c8aab549cd`；额外两轮 `run-xc3QTr/report.json` SHA256 `86d44ffa05b2f9356f512fa002336ed554002347ab3ea02c57f9c1a9466649ce`。没有修改代理业务、DACS、输入法或超时来换取通过。
- 最终 `artifacts/stable-readiness-20261007/test-QmsSqo/result.json`：1110/1110、0 失败、0 跳过，exit 0、源码输入不变；SHA256 `e4bef5ba85e1f0f8ef5b5b3c9c372d27106eb3dbe9c8d8739801098b97186eda`。这是一轮新的完整通过，不追改前两轮失败。
- 退出诊断 `artifacts/v1.1.17-safe-exit-aBQe8U/diagnostic-report.json`（SHA256 `96dea089d78fe33869cc8250f7daa28dc6232ca232f5820f92d9b7e8e5cd3942`）：产品根进程正常退出 0；退出时 Job 中有 SogouExe、SGTool、SogouExe，3 秒后仅 SGTool 留存，直至 15 秒上限仍未归零。此后仅控制器自有隔离 Job 失败清理，原输入保持。该轮明确为旧候选的诊断，不是当前源码验收通过。
- 新诊断只记录 Job 成员 PID、创建时间和进程文件名，不读取命令行、环境或用户正文。进程名与存续已实证，但不单凭名字证明厂商身份、启动机制或根因。严格 Job 清空门禁不豁免 SGTool，不强停用户输入法。
- 安装前只读准备确认旧安装 1.1.16 的 EXE/ASAR 与保留计划一致；仍有 4 个已安装 runtime/node.exe 进程由 codex.exe 派生，尚不能视为已解除文件占用。未开始备份或覆盖，未改变集成。

## 新候选包（本地，未安装或公开）

当时源码通过后仅构建一套 `artifacts/stable-readiness-20261007/dist-MoXZ8p`，构建退出 0、源码输入保持；构建回执 SHA256 `22bc38338fcbd500fde426d0c2eafc7e17d6ddd767d510755d9bfa4782406e42`。此包早于下述设置及终端验收修正，不是修正后的最终包。旧 `dist-wktxIa` 保留作历史诊断，不再用作当前源码验收。

| 产物 | 字节数 | SHA256 |
|---|---:|---|
| Setup 1.1.17 | 319522728 | `ac047e8fb5eba98df2ccd26d8cae9f7c2eac09dfd6ecaea4db5f36280357bd73` |
| Portable 1.1.17 | 318737034 | `406433808a568b410c9c7d29938ed01894fb40ad1ebbcb1b8c530cb39de640f3` |
| 解包 EXE | 238198272 | `a82bb3dc5c51338286cabc4a2f6c4974338b490cf3dc6e2e840969c1fd26b704` |
| app.asar | 4257645 | `d33cee34759661ea2b18f5fefa00242d4cb5ba87564be5b48f16fd1e10964611` |

完整负载比对 `portable/payload-olZ6GQ/report.json` 通过：16041 文件 / 1147297625 字节 / 树 SHA256 `153d53454dc83e2201b30db7117f0e271e72e6ae61c1b5d063d57ef9f3f64a14`；报告 SHA256 `626d79a2b4c60486e9e906f1cf018e94998c1c642530b5dcb382de909f2016ff`。Windows 显示身份 lulu / 1.1.17 通过，兼容可执行文件名仍为 DSH Desktop。没有签名承诺、其他电脑或长期老化结论；仍需最终交互、正常退出、Portable 实际启动、备份覆盖及资料保留。

静态验收 `rc1/package-117-EKBNZf/report.json` 三阶段（负载、Windows 身份、治理）均退出 0、输入保持，SHA256 `74b9139edcc911fb740a1587431d48880ac4f6d91aafc93e48667fd219979d22`。静态通过不等于界面或完整发行通过。

## 新包实机交互结果

三个测试由隔离 Job 容纳全部自有后代，串行运行，不使用原资料或模型。以下三轮均根进程退出 0、Job 自然归零、输入保持，无强制清理；不因此追改旧完整安全退出的 SGTool 残留结果。

- 品牌通过：`owned-ui-smoke-117/brand-QwPwJ5/report.json` SHA256 `517c1c0d6a656e54ea40019f1c36d5655249303e0c93a71d1e0c912b0f121745`。浅色、深色、1024 紧凑窗口均无遮挡弹窗，输入/导航可命中，噜噜图片解码且无水平外溢；主控已回看 `electron-brand-DUEJic` 三张实图。
- 布局失败：`owned-ui-smoke-117/layout-tYNwJ4/report.json` SHA256 `9d08474245142b77e77fb19470a12c3dcf09146556e2c45d66f0717cbb2945a6`。生成七种布局截图后，进入官方模型设置返回 false。根因定位到共享桌面 `models-settings` 动作仍要求直接 Settings 控件；rc.2 已将入口放入 Account menu / 账号菜单，实际软件 Key 设置菜单及模型诊断也调用该动作。因此必须修产品接线，不能只修改测试或忽略失败。
- 终端失败：`owned-ui-smoke-117/terminal-Ggdg6N/report.json` SHA256 `fc4f0dff14f2b60255dde0073ad83e1212c709d43f14be57b427c9bc09d8b360`。终端清单及实图显示 cmd.exe 在运行、输入焦点正常；测试首个 metadata 轮询要求 rc.2 已不再公开的 controllerId，尚未执行原生键盘标记命令。须按新公开契约验证可写行为，不能把两个缺失字段相等当作“读取清单不抢占输入”通过。

本套 MoXZ8p 双包不得公开或覆盖安装。后续先修两处已定位差异并做开发态窄验，再决定替代包；保留本套构建、静态成功及交互失败证据。完整安全退出、Portable 实际启动、备份覆盖与资料保留尚未通过，不回写旧失败为通过。

## 设置与终端的定点修正

- 产品共享动作 `electron/harness-ui-actions.cjs`：通过唯一、可见、可命中的官方 Account menu / 账号菜单打开 Settings，进入唯一可见设置弹窗中的 Models，并核对 `aria-current="true"`。保留官方直接 Settings 入口兼容；不读取 Key、不用私有框架状态、不接管官方设置。SHA256 `bae605b7f51ff6d27cf1408b2f85cb4509305aac64be312f864c69f73e18c9e1`。新旧导航专项 33/33 通过，失败先行证据见 `rc1/models-settings-navigation-117/DIAGNOSIS.md`。
- 终端验收 `electron/official-terminal-smoke.cjs`：不再依赖已删除的 controllerId。保持八项原验收能力，通过第二终端在两次只读 list 前后的独立原生键盘随机回执证明仍可输入，不能用两个 undefined 相等代替。保持焦点、无弹窗、工作区、无继承 Key、显式关闭、原超时和失败条件；不修改产品终端实现。SHA256 `d2c4e602618e300be01beab863cef678b1d2b7193ef1e9318fb55552a0bf5d93`。相关 56/56 通过，失败先行及修正见 `rc1/terminal-smoke-review-rc2/red-green.md`。
- `electron/main.cjs` 仅增加五个静态初始化阶段标签，便于区分 runtime / dock / panel / credential-ready / terminal-smoke。独立审查通过字节反证确认没有更改预算、权限或控制流程。它们是最近阶段标签，不是完成时间；不能从最后保留标签直接断言故障位置。

独立二次审查发现并关闭一项 Important：最初的“已有菜单”路径虽要求唯一 Settings 菜单项，却未确认属于账号菜单，可能误点其他同名入口。最终两条路径都必须先确认唯一可见、启用、可命中的 Account launcher 且 `aria-expanded="true"`；无归属、折叠、重复 owner、点击后不确认展开四个反例先得到 22 项 / 18 通过 / 4 失败，再修成新旧专项 37/37 全部通过。复核无新增 Blocking/Important，未改变 Key、权限或超时。最终动作源码 SHA256 `5c5233607e4c558bd234493fda097c72012902975cd1823920a6ad03c0208d2e`，测试 SHA256 `f5499bec54bfef29222f952cf80e07de023765c8c8fb6aca49e45e13f078210f`；详见 `rc1/models-settings-navigation-117/OWNERSHIP-REVIEW.md`。

该归属补正前全量 `test-gT7Vqx` 1136/1136、0 跳过、exit0、输入保持，回执 SHA256 `31486db4f057661cc83100b6aa8039fb1c95427fb8a0d647b5e0333369134f0e`；不能作为补正后的最终源码门禁。

## 开发态窄验（不是最终包验收）

使用固定 Electron 43.5.0 / Node 24.19.0、正式 rc.2 vendor、新建隔离 home/profile/workspace、零模型请求；控制器必须有显式执行和 UI 槽位，受限 Job 180 秒根进程 / 15 秒清空上限，失败只清理自有 Job。四项控制器纯测试及独立复核通过；只冻结列明源码、HTML、桌面插件、Wiki helper、运行库描述等输入，不宣称重验全部 vendor 或 node_modules。

| 运行 | 功能结果 | 整体结果及证据 SHA256 |
|---|---|---|
| `dev-ui-smoke-117/layout-eRHTJF` | 初始化报 `This operation was aborted`，没有布局截图，未到设置修复动作 | 失败；`ff1f9fb263a1616376e89ed83ab87c82073a38f0a23bc0a7c45ee91d6dea98da` |
| `dev-ui-smoke-117/terminal-mPkFDz` | 八项终端功能全部通过 | Job 未清空，失败；`37763ca8029aa7a5bd2d19ee636778032534ab76bfe355027dc89ad9b819251b` |
| `dev-ui-smoke-117/layout-csjEvt` | 布局及官方模型设置成功，关闭后面板状态保留；主控回看设置、正常及双面板紧凑实图 | Job 未清空，失败；`2493bb564f4f03a96bdfd6d30dbefb84db9c57d9ae0a60a82608a177fa056ff0` |
| `dev-ui-smoke-117/layout-514b0P` | 最终账号归属补正后，七种布局及官方模型设置成功，关闭后面板状态保留；主控回看新设置实图 | Job 未清空，失败；`9e89731ae7739cd835611c9cfdc7207321c2c48f0b0ca5115d037ca3a08a7704` |

后三轮 `smoke.ok=true` 不改变各自 `report.ok=false`：根程序正常退出 0，但 Job 最后持续留下 SGTool.exe，15 秒后仍未清空，控制器仅清理自身隔离 Job；输入均保持。不能据此宣布完整正常退出、修复后新包、安装态或 Stable 通过。搜狗输入法对照仍待用户可配合时进行，未更改系统或默认输入法，也未强停用户进程。

03:31 仅只读核对 `Get-WinUserLanguageList` 与所列 TIP 的 HKLM LanguageProfile 描述：本机 zh-Hans-CN 已启用搜狗拼音及 Microsoft Pinyin，未列出独立英文键盘。此前提出的“系统英文键盘”对照应改为已有微软拼音，不新增语言、不改默认；仅切搜狗自己的中/英模式不能隔离搜狗组件。尚未执行这个输入源对照，不能宣称切换能解决退出问题。

第一次 Abort 疑似 credential-ready 本地 Remote 默认 3 秒请求中止，但没有直接请求阶段证据；后三轮未复现，不能说根因已找到或故障已修复。`keyNotInherited` 仅是隔离终端未继承该环境变量，不是原用户 Key 迁移证明；IME、跨 Host 重启恢复、其他 shell、另一电脑仍未验。

## 下一步与空间边界

最终修正后的全量 `artifacts/stable-readiness-20261007/test-exIFOg/result.json` 已完成：1140/1140、0 失败、0 跳过、exit0、源码输入保持、无超时，119616.9835ms。回执 SHA256 `4768ea01b391831a83a1a1f6f542ca83578c64df93cdcfaae1530729902dd24a`。这次包括账号菜单归属修正；不将较早的 1110 或 1136 全测当作最终源码证据。

下一步先闭合正常退出输入源对照，再用替代包重新绑定需要重验的交互和 Portable，最后执行备份覆盖、正式资料/凭据/权限保全及公开 Pre-release。沿用已有效的内核来源、构建、生产依赖审计和权限行为，不重发真实模型全套。全部本轮构建/测试命令均已结束，无后台测试继续；只清理控制器自身隔离 Job，不强停原用户进程。

03:08 空间核实 C 盘可用约 4.14 GiB，失效候选 `dist-MoXZ8p/output` 为 16046 文件 / 1785901752 字节（约 1.66 GiB）。已单独询问是否可在修正验证后删除该 output 并生成替代包，尚无答复；本轮未删除、不转存 D 盘，日志、截图、源码、1.1.15、已安装对应最终 1.1.16 和用户资料全部保留。不能把先前仅限三套旧候选的删除许可扩大到它。

03:32 源码回归后只读复核 C 盘余量 4286304256 字节，约 3.99 GiB。正常退出门禁未闭合且替代包清理范围待答复，本轮不再占空间重复出包，不覆盖或公开 MoXZ8p。安装版仍 1.1.16 / alpha.2，公开 Pre-release 1.1.14、Stable 1.1.12 保持。
