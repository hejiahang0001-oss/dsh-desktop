# Harness rc.2 桌面桥接与传输预检 — 2026-09-26

这是同一未发布 V1.1.14 的阶段记录，不是完成换核或发布的声明。

## 官方核查与版本身份

2026-09-26 **20:46:36 北京时间**（12:46:36 UTC）核对全部 22 Releases、23 tags 与 27 npm 版本，最高完整版本仍为 **0.1.7-rc.2**，标签 `dsh-v0.1.7-rc.2`，提交 `477b4f420553e8a52c2fbccc464d7561b239c443`。版本集合及各 tag 提交与昨日一致；npm `latest=0.1.5-rc.3`、`next=0.1.7-rc.2`，不按 dist-tag 名称猜测最高版本。

- [官方发布](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.7-rc.2)：预发布，发布于 2026-09-24T14:10:21Z。
- [Q&A #7026](https://github.com/deepseek-ai/deepseek-harness/discussions/7026)：仍为一条社区评论，关联 `NONE`，无新回复和采纳答案；不视作维护者确认。
- kit 0.1.1 的声明源码仓库经网页及认证 REST 核查仍返回 404，`gitHead` 为空；Node API 对应源码可获取性门禁未解除。不重复下载昨日已核验归档，不作法律结论。
- 核查原始证据：`artifacts/upstream-checks/2026-09-26/check.json`。

产品 `package.json=1.1.14`，当前固定 Harness **0.1.6-alpha.2** / `ddefc45fbc7f8e46dd73185e68295696d1297887`。本轮不改根依赖、锁和 vendor，不追踪 master，不另开迭代版本。

## 官方复用与桌面保留

| 能力 | 本次决定及原因 |
|---|---|
| 会话队列/插话状态 | 直接读取官方 inbox 投影的 `next-turn` / `next-step`，删除桌面读取不存在的旧 `queues` 字段；不建立第二套队列 |
| 后台命令状态 | alpha.2 使用其公开基线 jobs；rc.2 使用官方按 SessionId 隔离的 JobRegistry，只读并校验数据 |
| HTTP/HTTPS 代理传输 | 优先官方 `dsh-http-proxy`；桌面继续负责软件代理设置与环境清理、Key 最高优先级，不放宽 TLS |
| Office/Wiki 与工作区 | 官方执行工作区不自动等于桌面工具的 `DSH_CWD`；发现既存切换风险，必须修复后才能扩大验收 |
| 安全、发布与恢复 | 加密 Key、代理入口、Office/Wiki 校验/备份、Git Review、导航/sandbox/回环限制均保留；没有按同名删除保护 |

更完整的新增/修复/破坏性变化比较沿用 [Sep25 rc.2 评估](HARNESS_UPSTREAM_v0.1.7-rc.2.md)，不重复造版本或把旧测试改标为 rc.2。

## 已实施：会话状态兼容窄修

原 `runtime/dsh-desktop-tools/session-control.mjs` 读取 `control.queues`。当前真实 alpha.2 已经只有 `{jobs, projections}`，rc.2 又移除了 jobs，因此这不是单纯 rc.2 新引入的问题。旧测试 fixture 含并不存在的 queues，掩盖了实际不相容。

现改为官方 inbox 投影，保留 queued/steering/pending 分类；对 rc.2 仅在公开 registry 契约可用时以目标 SessionId 读 jobs。缺失/畸形状态、未知 job status、跨会话 owner 均明确拒绝，不以空数组伪装“空闲”。冷会话按只读 observation 读取并释放，权限、审批、会话与目录绑定不放宽。

- `bridge-red.tap`：修复前 **21 项，4 通过 / 17 失败**，证明旧 fixture 的问题；原失败堆栈保留。
- `bridge-green.tap`：修复后 **21/21**，包括真实形状的 alpha.2/rc.2、占用拒绝、任务生命周期、畸形数据无创建/发送、观察释放及原历史/权限回归。
- 另直接导入实际 vendored alpha.2 SessionControlController，用隔离内存服务产生真实基线，再经桌面桥得到 queued=1/pending=1。不是整套 Loader 或用户会话验收。
- rc.2 会话部分目前仍为精确官方源码契约与 fixture；尚未通过完整 rc.2 服务组合。alpha.2 冷会话缺 jobs 基线时失败关闭，不能宣称冷交接完整可用。

详细复现、源码行号和边界见本日 `bridge-review.md`。

## 本日验证结果

首轮全量子命令 exit 0，631 项 / 629 通过 / 2 跳过，但运行前后桥接代码与测试摘要不同，因此 **拒绝作为最终验收证据**；`source-test.log`、`test-result.json` 和 `initial-source-validation-rejection.json` 原样保留。冻结后的全量 `pnpm test` 于 2026-09-26T13:00:04Z 完成：**631 项 / 629 通过 / 0 失败 / 2 跳过 / 0 取消，99271.0838 ms，exit 0**，源码及测试摘要前后一致，见 `source-test-final.log` / `test-final-result.json`。两个跳过依赖已清理的旧固定版本源码检出（launch proxy 优先级、官方 Queue/Steer/Stop 归属），不计为通过、不用 rc.2 检出冒充旧版。根生产依赖审计零已知发现，范围仅 5 个根生产依赖，不是新 Harness 完整运行库审计。

真实隔离传输探针首次 **6/6**（5043.8176 ms），主线程读脚本后独立复跑 **6/6**（4945.2063 ms），均零失败/跳过/取消。证据分别为 `network-probe/run-84iTAF/`、`network-probe/run-MgO8hv/`，汇总 `network-probe/evidence.json`。固定官方 rc.2 proxy/API-key adapter 和 BlockAssembler，原生 fetch 未替换；新增 5 依赖及复用 58 依赖分别重新审计，所有风险等级均零发现。

已验证本地 HTTP absolute-form 转发、HTTPS CONNECT 与可信证书、中文 Messages SSE 首段在响应结束前可见、回环绕过及软件 direct 清理环境代理；401 与截断响应失败、中途取消只保留中断文本；不受信/域名不符的 TLS 连接拒绝。所有监听为随机端口 127.0.0.1，代理仅映射固定测试域名到隔离服务，无关目标拒绝；临时证书仅由测试子进程信任，没有修改系统证书库。

明确边界：本次网络使用合成 CredentialProvider，不贯穿软件 IPC/DPAPI；Sep25 的 IPC 是另一份隔离证据。没有调用真实 DeepSeek/付费 API，没有验收企业代理/PAC/认证。direct 仅验收回环实际直连；服务器分段写入不能证明客户端一定跨 UTF-8 ReadableStream chunk；取消后的连接闭合包含适配器 finally/dispatcher 清理，不能独立归因即时 Abort。临时测试私钥已清理，不涉及用户凭据。

## 新发现与后续优先级

**Blocking：切工作区后桌面工具可能继续使用旧 `DSH_CWD`（尚未修复）。** 插件 apply 时冻结 A 路径，桌面切到 B 复用 Harness；官方 Shell 按 B 执行，但 Office/Wiki 脚本仍可能把 A 当 `--workspace`。纯内存调用真实桌面插件已复现 executionWorkspace=B / collectedWorkspace=A；未对真实文件实施错误写入。建议固定工具路径不变，每次从可信 execution/session 绑定解析工作区，缺失即拒绝。验收必须包括 A→B→A、交错会话、缺绑定与实际相对文件落点。

**Important：工具卸载清理尚不完整。** 终端读取桥的模块级 listener/pending 不受当前卸载回调管理。需要动态验证挂载→等待请求→卸载→迟到回复→重挂载，断言旧请求取消、listener 恢复基线。没有证据证明必然跨会话泄露或每次重挂载增长，不作扩大判断。

下一切片优先修工作区绑定，再补卸载/真正 rc.2 服务组合及 V4 持久化与冷分页；随后新安全锁和 source-build、真实模型/Office、Setup/Portable、备份覆盖和资料保留、公开下载验证。Office 对应来源、旧 Portable 失败及 V1.1.13 发布范围选择仍独立保留；不因局部通过解除门禁。

## 交付与知识边界

源码候选 V1.1.14 有新增窄修，固定运行库仍 0.1.6-alpha.2；没有生成本版安装包、覆盖安装、上传草稿或公开资产。本机安装 V1.1.13 / 0.1.6-alpha.1、已有私有草稿和 Stable V1.1.12 均未改变。本日未使用真实 Key、用户资料或付费模型；签名、第二台电脑与长期老化未验证。

本轮知识按 wiki-update 同步到配置解析得到的既有 Obsidian 项目；是否成功以 `artifacts/upstream-checks/2026-09-26/verification.json` 的最终回读为准，不以本文计划替代验收。QMD 仅在已配置时刷新。
