# 2026-10-05：0.2.1-alpha.1 依赖复核，未换核

## 本轮结论

继续同一 V1.1.14 / lulu 候选，不新开版本。2026-10-05 08:01（UTC+8）检查：Harness 最新已发布标签仍为 `dsh-v0.2.1-alpha.1`，提交 `5badb15009ae1756c3afe0ae0cef1faafc290ccc`；GitHub 发布于 `2026-10-03T06:42:19Z`，npm alpha 相同，latest/next 仍为 `0.2.0-rc.2`。没有采用 master 未发布代码。

新情况是 `http-cache-semantics@4.3.0` 已发布，但**不能据此关闭昨天的安全门禁**：两版对报告涉及的缓存请求仍呈现相同处理行为；同时维护者对该 CVE 的部分前提提出了异议。没有证据证明 lulu 已发生泄露，也没有证据支持把 4.3.0 描述为该问题的修复版本。本轮保留候选原锁，不添加审计例外。

来源：[Harness Release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-alpha.1)、[npm 元数据](https://registry.npmjs.org/http-cache-semantics)、[GitHub Advisory](https://github.com/advisories/GHSA-ch52-4w7c-c8xp)、[维护者回复](https://github.com/kornelski/http-cache-semantics/issues/56#issuecomment-5975759591)。

## 已核验事实及限制

- 4.3.0 发布于 `2026-10-04T02:56:05.593Z`，npm gitHead 为 `b1d4bd682fbab0252985de45219f4e7497c0067c`；4.2.1 仍未发布。两版下载包 SHA-512 与各自 registry integrity 相符；这不等于独立验证 registry 签名。
- 4.3.0 的主要源码差异是响应状态访问与 Vary 匹配修正；`evaluateRequest` 中的 max-stale 分支和 `maxAge` 的相关处理没有改变。
- 固定 Node `v24.19.0`、固定时钟、合成 URL/Cookie、零网络探针：两版在 Set-Cookie（无 public）、proxy-revalidate、no-cache 三种条件下，加入 max-stale 后仍允许直接复用；没有 max-stale 时拒绝复用。合法 public 过期响应和 must-revalidate 拒绝作为控制例。主线程已独立复跑观察探针，结果一致。
- GitHub Advisory 仍标示 affected `<=4.2.0`、patched `None`。库维护者于 `2026-10-04T02:24:46Z` 回应：Set-Cookie 本身不禁止共享，应使用适当的 Cache-Control/private，并将 issue 关闭为 not planned。故本报告称“报告行为未改变且安全判定有争议”，不将其写成官方承认的漏洞或 lulu 的已证实泄露。
- 包级复现不等于产品可利用性。当前已检查的 Harness `packages/telemetry/otel/src/event-transport.ts` 使用 `got.post`，没有显式配置缓存；完整依赖路径及是否存在其他缓存调用尚未完成运行时核验，不能直接授予豁免。

## 能力归属和发布边界

### 检测对照：零告警不等于该行为已修复

独立最小工作区用 pnpm `11.7.0` 锁定 4.3.0，lockfile-only 退出 0、无实际安装；`audit --prod --json` 仅检查该 1 项依赖，退出 0、零告警。但拒绝性回归结果：4.2.0 为 11 项 / 7 通过 / 4 失败；4.3.0 为 12 项 / 9 通过 / 3 失败（均退出 1）。Vary 控制由失败变为通过，三项本轮关注的处理要求仍未满足。主线程独立复跑 4.3.0 得到相同结果。

完整日志见 `artifacts/hcs-review-20261005/{regression-4.2.0.log,regression-4.3.0.log,main-verification-4.3.0.log}`，审计见 `artifacts/harness-021-20261005/audit-control/audit-prod.json`。首次 304 夹具缺少匹配 ETag 的额外失败已另存，不计入最终判断。首次最小工作区没有隔离 pnpm workspace，误识别桌面根，退出 0 不能作为有效控制；补齐边界重跑后才计入。根锁及 workspace 的 Git diff 均为空，原 dirty package 未擅自回退。最小控制 workspace 的 pnpm 年龄例外未进入真实候选。

### 保留决定

官方输入法、排队/停止、草稿、工具输出、插件样式等复用决定沿用 [10 月 4 日能力对比](HARNESS_UPSTREAM_v0.2.1-alpha.1.md)，没有新增 Harness 功能需要本轮重新对比或删除。软件优先的加密 Key、代理、Office/Wiki 校验与备份、Git Review 和 Windows 宿主安全全部保留；lulu 只保留既有展示改造，不改变数据身份。

Office 本轮复查仍为 kit `0.1.5`、公开源码提交 `b19bb73c74ed893b8a5d1716d32df32a113ed31b` / 清单 `0.1.3`，没有 tag/release/gitHead 将二者精确对应，Harness 讨论 #7026 没有维护者新回复。用户“完整能力保留、核实后发布”的选择不变。

| 状态层 | 本轮状态 |
|---|---|
| 正式源码运行时绑定 | `0.1.6-alpha.2`，不变 |
| 新核候选 | `0.2.1-alpha.1`，保留原补丁和锁；禁止晋升 |
| 本地安装 / 用户资料 / 凭据 | 未覆盖、未迁移、未使用真实 Key；旧安装未重新验收 |
| 构建 / 安装包 / GitHub 发布 | 本轮未执行；不把历史或最小探针当新核验收 |
| Stable | 未修改 |

## 下一步调整

1. 不再只等待不存在的 4.2.1，也不依据更高版本或审计区间自动放行；先对 `otel → got → cacheable-request → http-cache-semantics` 做完整产品可达性和缓存配置核验。
2. 将维护者解释、审计数据库状态与产品运行证据分别记录。如需依赖移除/替换或接受残余风险，单独形成评审；本轮不作豁免、不自行改第三方缓存语义。
3. 门禁解决后继续新核实际依赖安装/构建、自动化迁移、lulu 新页面交互与完整安装交付，复用有效历史证据但不冒用旧内核通过结论。

本轮检查快照：`artifacts/harness-021-check-20261005.json`；包级探针与复核：`artifacts/hcs-review-20261005/`。Obsidian 同步仅在实际写入、回读校验后报告完成。
