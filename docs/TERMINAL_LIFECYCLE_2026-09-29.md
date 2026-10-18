# V1.1.14 — 兼容终端读取插件卸载清理

## 范围与根因

继续同一候选，不换核、不改变官方终端、不新增终端执行权限。旧插件在模块加载时注册 process.message 监听，pending Map 也属模块全局；apply 只注册会话控制器的卸载，不清理终端读取。卸载后监听残留，待处理调用最多继续等115秒。

## 实施与复用

监听和请求状态改为每次 apply 独立所有；dispose/disconnect 移除两类监听并取消所有待处理读取。取消向仍连接的宿主发送原有 cancel 协议；断连不发送，发送异常仍清理本地计时器/AbortSignal监听/请求名额。结算幂等，卸载后拒绝新调用。

继续保留兼容终端的当前会话/工作区绑定、原生逐次确认、只读和长度限制。官方主终端与其工具调度不重写；这里是独有Electron IPC宿主清理，不是官方新功能的重复实现。

官方目标 0.2.0-rc.2 的 `packages/shell/shell-env/src/index.ts` 已通过 GitHub Contents API 阅读，blob `36752364dd34deb432dc93ca5ae2ef4bcfd50685`；仍按 collect(execution) 调用 contributor.resolve(execution)，注册走 effect-scoped disposal。此项源码契约支持上一阶段目录快照设计，但未验证全部0.2.0工具/迁移契约。

## 验证与评审

- 红阶段：卸载后 message listener 数量实际1、预期0，1项失败，退出1。
- 绿阶段：新增4项覆盖卸载/重复卸载、pending取消/卸载后拒绝、断连、成功返回与同步发送异常释放；连同宿主/打包边界测试共10/10，退出0、零跳过。
- 测试通过 VM 执行实际插件主体，替换defineTool和会话控制器为隔离夹具；不是实际Cordis插件重载或原生确认界面的端到端验证。
- 根生产5包审计零已知发现；不是整个新Harness运行时审计。证据 `artifacts/upstream-checks/2026-09-29/terminal-lifecycle-audit.json`。
- 全量 pnpm test：638项、636通过、0失败、2原有跳过、0取消，288876.1226ms、退出0。证据 `artifacts/upstream-checks/2026-09-29/terminal-lifecycle-full.log`；不以两项旧检出缺失的跳过豁免交付要求。
- 自审：本窄修未发现新增Blocking；宿主确认、取消协议、未知响应忽略、会话控制卸载路径均保留。完整新核服务与真实插件重载仍须验收，不解除全部发布门禁。

## 状态与下一步

固定0.1.6-alpha.2、源码V1.1.14；本轮未打包、覆盖安装或发布，最近核实安装V1.1.13及Stable V1.1.12未改变，用户资料/凭据未使用或迁移。

下一步验证真实插件卸载重载及终端确认取消，再完成0.2.0可选自动化/模型迁移与工作区真实授权。通过完整验收后才进入Setup/Portable及交付；官方Office普通生成/检查复用保留原顺序，安全备份回执不删。
