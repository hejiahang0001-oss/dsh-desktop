# Harness 0.1.7-alpha.2：预检与恢复保护

检查：2026-09-23 08:38:25 北京时间。**V1.1.14 未发布候选的升级准备；目标已确认，内核尚未替换。**

## 来源与状态

- [0.1.7-alpha.1](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.7-alpha.1)：标签 `dsh-v0.1.7-alpha.1`、提交 `c36a83ff6bb95e3f82cf79f9be7c724270a8aa61`，9 月 22 日 14:16:27 北京时间发布。
- [0.1.7-alpha.2](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.7-alpha.2)：标签 `dsh-v0.1.7-alpha.2`、提交 `00102833dfaee1da9f48a3a8eae9d34005a75218`，9 月 22 日 23:49:49 北京时间发布；预发布、非草稿。
- 核对 20 个 Releases、21 个标签、25 个 npm 版本。npm `alpha=0.1.7-alpha.2`；`latest=0.1.5-rc.2`、`next=0.1.5-rc.3` 均低于现有 `0.1.6-alpha.2`，不只按后缀判断。
- 新标签干净检出：`artifacts/upstream-dsh-0.1.7-alpha.2`，HEAD 与上述提交一致。官方 pnpm 仍为 11.7.0，Node 要求 `^22.19.0 || >=24.0.0`；不联动升级桌面 Electron/Node/pnpm。
- 新源码 workspace SHA-256：`c5efad389f40127764a5072d98fdc5926ab5d6aa0417d6a83939baf988f78f1f`；lock SHA-256：`b86256be5afec5814a404747893cab392a73b40901d14fa8135f663fb42c8d40`。未生成新桌面安全锁或运行库。
- 准备分支 `codex/v1.1.14-harness-0.1.7-alpha2`，仍沿用未发布 V1.1.14。当前固定运行库 `0.1.6-alpha.2` 不变；原分支、证据及未提交修改保留。既有安装 V1.1.13 / 0.1.6-alpha.1、私有草稿与 Stable V1.1.12 不变，本轮未重新进行安装或远端资产验收。

## 官方能力对比与取舍

| 官方新增或修复（两个发布累计） | 采用决定 | 必须保留/验证 |
|---|---|---|
| 原生表格预览、选表/单元格/复制/公式、特殊内容修复 | 使用官方，不另建表格查看器 | Office 安全检查、备份与产物收据；预览不等于生成或编辑 |
| 队列编辑换行、历史滚动、代码块复制、重启后回复与草稿恢复 | 随内核使用官方，不拦截 Queue/Steer/Stop | 真实插话/重连/跨会话草稿验收 |
| 会话固定/归档/搜索、运行任务停止确认 | 优先用官方会话界面 | 原生安全退出、工作区保护 |
| 默认应用打开文件、Diff 与临时改动卡 | 只接公开接口的安全交集 | 受限路径、持久 Git Review/恢复，不能开放任意命令 |
| 插件取消/恢复/失败隔离与 registry 选择 | 优先官方管理 | 私有源不覆盖；完整生命周期通过前不删桌面受控安装 |
| Windows sandbox 删除边界、PowerShell 和后台续跑修复 | 随固定内核采用 | 宿主隔离、逐项授权、进程所有权 |
| Session V4、Messages-only、Profile 设置、Remote 流/字节与 token 预算 | 先做显式迁移适配 | 不能直接替换包或机械改名 |

本轮未删除旧能力：普通预览和队列早已归官方，剩余桌面补充的权限及持久化语义不等价。软件优先加密 Key、代理、Office/Wiki 与 Windows 保护保留。实验性语音、Browser/Computer Use、官方桌面壳迁移、ERP 和远程桥均不纳入。

## 源码核对后的迁移门禁

1. **V4 历史**：`packages/session/session-format-v3-to-v4/src/migration.ts` 需要显式子会话目录事实，改变工具结果和消息来源，修补缺失 turn/end 时可能改变序号。仅使用官方迁移；隔离副本验证父子关系、冷读/分页/交接与原文，不让旧程序读取已迁移的活动资料。
2. **协议**：`packages/llm/llm-deepseek/src/config.ts` 明确拒绝旧 `protocol` 字段，默认基址为 `https://api.deepseek.com/anthropic`。不得盲删自定义中转设置；软件 Key 优先、端点与代理需真实请求验收，公开凭据接口仍在不等于兼容已通过。
3. **设置**：`packages/settings/settings/src/index.ts` 先将 settings.yaml 改名为 settings.yaml.imported，再逐节写 Profile；失败节只留在改名文件，未自动重试。config-editor 将设置写入 Profile 的 cordis.patch.yml，另有 home 级覆盖。因此仅备份旧 settings.yaml 存在恢复缺口。
4. **Remote/扩展配置**：Workspace 字节读取为 readBytes，spill 的 maxInlineBytes 改为 maxInlineTokens，旧数值不能直接沿用。桌面检索未发现自定义 spill 字段或旧 files.read 调用，但连接、文件交付及插件实际行为仍未验收。

## 本轮实现及验证

- `electron/support-backup.cjs` 新增三个固定位置：`harness/settings.yaml.imported`、`harness/cordis.patch.yml`、`harness/profiles/<profile>/cordis.patch.yml`。不迁移真实配置，不扩大任意目录白名单；凭据、代理、临时文件及链接路径仍排除。
- 回归验证配置逐字节保留、源文件不变、清单/摘要、篡改拒绝、无关文件与凭据排除、Windows Junction 拒绝。仅合成数据；普通备份仍不承诺内容脱敏，不保证用户手写内容没有秘密。
- 基线 pnpm test：621 项，619 通过、0 失败、2 跳过，289580.2575 ms。最终：**623 项，621 通过、0 失败、2 跳过**，212622.4411 ms。两个跳过项均因旧固定上游源码检出已清理（官方代理与 Queue/Steer/Stop 源检查），不算通过，也未改成使用新源码冒充旧版本验收。
- 红灯复现缺失 settings.yaml.imported；首次文件软链接测试同时遇到 Windows EPERM，改为真实支持的目录 Junction 用例，保留失败日志，不宣称文件软链接已测。专项 **7/7**，零跳过。pnpm 脚本通过既有 node.cmd 解析至 Codex Node，确认同为 v24.19.0；未改包装器。
- 桌面生产依赖审计：5 个根生产依赖无已知发现；不代替新 Harness 实际运行库审计。新改动审查无未解决阻断，不能据此认定整个升级通过。
- 证据：`artifacts/upstream-checks/2026-09-23-alpha7/` 下 check.json、baseline-test.log、baseline-audit.json、backup-red.log、backup-green.log、final-test.log。未重复构建旧包、未调用模型。

## Office 源码及交付停止线

- 新标签仍固定 kit 和 Windows 引擎 `0.0.1`；声明源码仓库今日仍 HTTP 404。[Q&A #7026](https://github.com/deepseek-ai/deepseek-harness/discussions/7026)仍仅此前社区回复，没有新回复或采纳答案。
- 组件 npm 已变为 latest=0.0.3、next=0.0.1-2，但不属于本标签的替换授权。额外核对 0.0.1-2 归档 SHA-512 与 registry 一致，33 文件仍只有编译 JS、声明及许可等，无 src/、sources/、source map；未解决固定 0.0.1 对应源码问题。归档 SHA-256：`701204df9fb5eabfb3f8047db94f4044c2fd057e7d4505c3f0a66b0e6765a6c9`。0.0.3 仅核对元数据，未做内容/兼容验收。
- 按升级 Skill 保留当前内核。公开分发仍等精确源码材料；不作法律结论，不靠忽略检查发布。
- 下一切片：隔离 V3→V4 与旧设置预检 → Messages/Key/代理/插件契约 → 精确安全锁与新运行库 → 真实交互 → Setup/Portable → 备份覆盖/资料保留 → Latest/Pre-release/匿名下载。旧 V1.1.13 发布范围的待决选择仍有效。
- 本轮未换核、打包、安装、推送、上传或公开，Stable 未变；签名、其他电脑及长期老化仍未验证。Obsidian 同步另外记录，不把阶段性进展当成完整迭代闭环。
