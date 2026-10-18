# V1.1.14 完整内核适配执行记录

用户要求持续推进到完整适配，不再以单个组件测试通过作为版本收口。

## 固定输入与边界

- 目标仍为官方已发布0.2.0-rc.2，tag dsh-v0.2.0-rc.2，提交639ed015397290b3745d163aafe02ffee4aa3f84，已经git精确核对。
- 独立源码目录artifacts/harness-source-0.2.0-rc.2；339个workspace项目。源构建指定pnpm11.7.0，桌面项目pnpm11.19.0不变。
- 网络首次clone发生TLS early EOF；后由既有官方仓库fetch精确tag并本地独立clone成功。原源码、vendor及用户资料未替换。
- 首次安装继承代理出现ECONNREFUSED；Node直连registry只读HTTP200后，仅构建子进程移除代理环境并限制并发4重试，系统/软件代理不改。

## 新发现：完整依赖范围

原上游锁生产审计663项，41条告警（16 high、24 moderate、1 low），见artifacts/harness-020-upstream-audit.json。这与旧隔离组件111项零发现属于不同范围，不互相替代。需固定修复依赖、重新生成候选安全锁并完整复验；不得原样晋升或降低安全门禁。

Office目标锁仍使用kit0.1.1；npm最新0.1.2不自动引入。声明源码仓库本次REST仍404，公开来源门禁保留，不据此作法律结论。

## 已验证增量（2026-09-30）

- 独立源码采用精确安全覆盖后，生产依赖662项审计零告警（harness-020-security-audit.json）；不等于正式包审计。
- 官方V3→V4迁移20个文件382项测试，在安全覆盖前后均通过；未对用户真实会话执行迁移。
- 首次完整构建因Vitest4.1.11默认spy类型不可移植而失败。两处测试夹具补充明确函数签名后客户端类型检查通过，build:official重跑退出0，记录347个客户端产物。日志harness-020-build.log、harness-020-client-typecheck.log、harness-020-build-retry.log。
- 用户开启Windows开发者模式后，文件符号链接权限失败消失；媒体引用21通过、1个Windows不适用FIFO原有跳过。
- 客户端测试加载器未解析workspace包自身引用。隔离源码补充包自身清单解析，并增加无self-link的junction回归；不修改正式运行时权限。
- 控制器、查询、包清单、浏览器生命周期、音频组合43文件907通过/1原有跳过，退出0，见harness-020-controller-query-fixed.log。此前8套件失败证据保留。不是全仓测试或桌面完整交互通过。
- 所有修改仍在隔离源码；正式vendor、已安装程序、Stable保持不变。后续必须将已验收补丁纳入可复现构建输入，不能仅依赖artifacts目录。
- 官方release:verify确认318个DSH包，38个编译校验模块通过；独立deploy并用pnpm pack补齐327个DSH/vendor包，CLI回报0.2.0-rc.2。仅候选负载，不是可发布产物。
- 真进程组合：实际桌面凭据和工具插件、HTTP200、本地认证、workspace-status、task-create(workspace-write/ask)、status、history-page三轮通过；另一次真实fork通过。Windows safeStorage空白隔离资料也完成上述前四项。没有调用真实模型，没有读取用户Key或原会话。
- 首次探针遗漏shell环境变量，曾出现shell插件未激活；补齐宿主变量后重试。另一次凭据保存失败暂未复现，保留harness020-host-LVGlCl/startup.log，不将三次成功当成根因已解决。
- Electron直接启动器退出0但后台仍运行的探针已回收；改为等待实际进程结束并检查结果日志。harness-020-host-dpapi-wait.log记录真实safeStorage结果及子进程退出；不是覆盖安装证明。
- 后续10轮隔离启动/受限会话/分页/分叉全部通过，日志harness-020-host-stress-1.log至10.log；未复现不等于解释了早先凭据失败。全部本轮探针进程已退出。
- 可复现候选输入已保存runtime/harness-020-candidate/source.patch和pnpm-lock.yaml，补丁反向检查通过；正式构建入口仍未切换，不能依赖已有负载绕过发布门禁。
- 复查官方讨论7026仍Unanswered、1条社区评论，Office声明源码仓库仍404；不把社区分析当维护者许可或来源问题已解决。

## 必须完成的顺序

1. 完整依赖安装与安全锁；保留原始失败证据。
2. 上游复杂迁移测试、完整源码构建及来源/包完整性检查。
3. 桌面插件组合、Key优先级、代理、工作区、文件/Office/Wiki与真实模型。
4. 完整源码回归、审查、Setup/Portable与安装态保留验证。
5. 按现有授权仅Latest/Pre-release；公开来源或交付范围未解决时停止发布，Stable不变。

该记录是执行中状态，不是完成证明。版本、正式内核绑定尚未改动。
