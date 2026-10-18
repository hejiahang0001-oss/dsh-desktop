# V1.1.14 — 真实 Cordis 卸载验证与修正

本轮继续上一轮，不增加版本、不换核。

## 更正与根因

上一轮VM夹具把任意 `on('dispose')` 当成卸载回调，不能证明真实框架行为。实际固定Cordis 4.0.2通过effect的disposables卸载，并不发出该普通事件。因此上一轮虽10项/全量通过，真实卸载后pending仍未取消。

先用实际 vendored Cordis、实际 defineTool、实际桌面插件ESM和fork IPC复现：30秒探针超时，读取1次、取消0次，证据 `artifacts/upstream-checks/2026-09-29/reload-red.json`。这不是凭启动器返回码推断通过。

修正两处注册：终端清理使用 `ctx.effect(() => disconnect)`，会话控制监听使用 `ctx.effect(() => attachSessionControl(ctx))`；模拟夹具同步改为effect契约。没有更改确认策略、只读范围、Key、代理、用户资料或官方终端。

## 新验证

- 同一真实探针3轮挂载→发起读取→卸载→重新挂载通过；3次read/3次cancel、每轮message监听回到基线、disconnect监听归零、已卸载工具拒绝调用，进程正常退出0。证据 `reload-result.json`，探针源码 `reload-child.mjs` / `reload-parent.cjs`。
- 相关10项测试通过，零跳过。实际tools注册服务和会话服务仍是受控夹具；未验证原生确认UI、真实模型、完整Harness预设加载或0.2.0框架行为。
- 全量638项、636通过、0失败、2原有跳过、0取消，250763.5728ms，退出0；日志 `artifacts/upstream-checks/2026-09-29/effect-full.log`。依赖未改，沿用本日上一切片根生产5包零发现审计，不冒称重新审计或新内核审计。

## 状态

上一轮“真实插件重载待验证”现在收窄为“固定Cordis+真实IPC三轮通过，完整产品热重载/UI待验证”。仍未完成0.2.0-rc.2升级。固定0.1.6-alpha.2、源码V1.1.14，本轮没有安装发布动作，Stable不变。下一步新目标框架/服务组合和工作区授权，不以本探针替代完整交付。
