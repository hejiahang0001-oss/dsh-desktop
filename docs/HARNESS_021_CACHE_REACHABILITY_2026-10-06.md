# Harness 0.2.1-alpha.1 缓存调用路径核验 — 2026-10-06

## 结论与官方状态

没有新 Harness 发布，继续同一 V1.1.14 / lulu 候选。真实官方事件导出模块的正常及带 `max-stale` 请求均没有调用 HTTP 缓存策略；显式启用缓存的对照组则确实命中缓存。这排除了本次已枚举、默认配置的事件导出路径上的缓存复用触发，**不是整个客户端不可达证明，也不是依赖已修复或安全门禁豁免**。

- 检查时间 `2026-10-06T00:01:20.1615785Z`（北京时间 08:01）。[官方发布](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-alpha.1)仍为 `0.2.1-alpha.1`，标签 `dsh-v0.2.1-alpha.1`，提交 `5badb15009ae1756c3afe0ae0cef1faafc290ccc`，发布时间 `2026-10-03T06:42:19Z`。npm alpha 同版，latest/next 仍为 `0.2.0-rc.2`。未采用未发布 master。
- [GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp)仍未撤回，high、受影响 `<=4.2.0`、first patched version 为 null。库维护者在 [issue 56](https://github.com/kornelski/http-cache-semantics/issues/56)对 CVE 分类有异议；争议不等于公告撤回或产品泄漏事实。
- Office 于 `2026-10-06T00:02:06Z`复核：kit `0.1.5`，公开源码提交 `b19bb73c74ed893b8a5d1716d32df32a113ed31b` / manifest `0.1.3`、无 tag/release，npm 无 gitHead；精确对应仍未建立。[讨论 7026](https://github.com/deepseek-ai/deepseek-harness/discussions/7026)没有新增维护者答复。保持用户“完整能力、核实后发布”的选择。

本轮未改候选锁、正式绑定或用户数据；没有完整新核安装/构建、打包、覆盖安装或公开发布。正式 Harness 仍为 `0.1.6-alpha.2`，Stable 未改。未使用真实凭据或模型服务。

## 实际调用边界

固定源码中，生产直接使用 got 的已枚举位置为 `packages/telemetry/otel/src/event-transport.ts`；普通事件消费者位于 `packages/host/product-telemetry-otel/src/index.ts`。事件导出 POST 未传 cache/cacheOptions，got `14.6.6` 默认 cache 为 undefined；只有 options.cache 为真才进入 CacheableRequest。**不能把 POST 方法本身作为安全边界。**

会话日志另走 OTel SDK HTTP 通道。桌面 overlay 关闭 `session-log-deepseek` 不等于关闭全部产品事件导出；本轮没有启动完整产品确认最终插件组合，也没有验证第三方扩展或未来配置。

## 验证与证据

直接导入固定 0.2.1 的真实 `event-transport.ts` 和 `transport.ts`，逐字节匹配上述提交。仅对这两个源文件的四个外部 import 做精确解析重定向；没有改写源码、替换 got/HTTP 或伪造导出器。复用旧隔离目录依赖前，核对 33 个选定依赖快照的版本和 peer 解析与 0.2.1 候选锁一致，**不复用旧源码测试结果**。

独立内容复核覆盖五个关键发布包：got 51、cacheable-request 11、http-cache-semantics 4、OTLP exporter-base 309、transformer 390 个发行文件；registry SRI 及逐文件 SHA-256 均相符。这不是全部递归依赖文件认证。

| 真实操作 | 服务器收到 | 缓存策略调用 | 结果 |
| --- | --- | --- | --- |
| 连续两批正常事件 | 2 POST | 0 | 两次成功，内容各自到达 |
| 两批实际携带 max-stale 的事件，响应 aged/no-cache/合成 Cookie | 2 POST | 0 | 两次成功，未复用缓存 |
| 服务端收到后取消，再尝试导出 | 1 POST | 0 | 正确取消，后续零请求，重复 shutdown 幂等 |
| 同一 got/CachePolicy 实例，显式 Map 缓存、两次 GET | 1 GET | storable 2 / satisfies 1 / evaluate 1 | 第二次来自缓存，证明检测有效 |

首轮及主线程独立复跑均 **4/4 通过、0 失败/跳过、exit 0**，项目 Node `24.19.0`。四个回环服务器均停止监听、零剩余连接，无强制清理。子进程使用最小环境、完全合成数据，请求无 Authorization；不读取 Key、代理配置或用户会话。独立探针评审未发现 Blocking/Important。

```powershell
& .\vendor\runtime\win32-x64\node.exe artifacts/harness-021-reachability-20261006/probe/run-probe.cjs
```

证据根目录 `artifacts/harness-021-reachability-20261006/`：

- `check.json`：版本、来源和阶段状态。
- `probe/SPECIFICATION.md`、`probe/RESULT.md`：规范、范围和首轮结果。
- `probe/run-2026-10-06T00-07-21-764Z-f499a953/`：首轮。
- `probe/run-2026-10-06T00-09-00-926Z-5c4deddf/`：主线程独立复跑；command、identity、observations、TAP、stderr 均保留。
- `review/`：独立静态路径、发布内容与探针审查。
- `boundary-before.json`：9 个候选/正式输入的前置摘要，收口时逐项比对。

## 能力归属与下一步决定

继续使用官方事件导出/会话日志实现；本轮没有新增桌面替代，也没有删除能力。软件优先的加密 Key、代理、Office/Wiki 校验与备份、Git Review、Windows 宿主保护全部保留。直接改成 SDK HTTP 并非已证实等价替换：重试、限流、取消和错误语义需另行验证；直接升级 4.3.0 也不能把昨日失败行为描述为修复。

今天缩小了风险范围，但不自动把 candidate `security.status=blocked` / `promotionAllowed=false` 改为通过。下一步应明确裁决：是否接受**仅在已检查默认官方路径未启用缓存、其他路径未全覆盖**的限定结论，继续隔离的完整候选构建与兼容验收；该选择不授权安装、发布或关闭 Office/角色分发来源门禁。未获确认前保留输入，等待可信修复/公告澄清，不在每日检查中重复同一探针或全量旧核测试。

后续仍须完成新核完整安装/构建、真实插件组合与数据迁移、桌面/模型交互、审计与审查、Office 精确来源、覆盖前备份、安装态/便携版及公开下载验证；Stable 仍需单独命令。
