# alpha.4 适配续作：候选清理、完整构建与包集

## 范围与不变项

继续[同一 alpha.4 适配](HARNESS_UPSTREAM_v0.2.1-alpha.4.md)，固定官方标签`dsh-v0.2.1-alpha.4`、提交`86a402200d95fecef4529d969836f1fe13c6cb0d`。源码/本机仍1.1.16 / alpha.2，下一交付拟1.1.17；公开Pre-release1.1.14、Stable1.1.12不变。旧退出后历史/ACL失败未被本轮源码证据消除。

## 用户授权与实际清理

用户明确同意只删除`artifacts/stable-readiness-20261007/`下三套早期1.1.16的`output`，不归档D盘，保留日志、1.1.15和最终1.1.16、全部用户资料。删除前核对绝对路径及父链/子树无reparse point、Setup实际版本、文件清单、进程占用；删除后核验目标不存在和保留文件SHA256一致。

| 删除目标 | 文件数 | 逻辑字节数 |
|---|---:|---:|
| dist-SZqatc/output | 5 | 641,963,413 |
| dist-YPbNuf/output | 15,645 | 1,790,020,821 |
| dist-zDabGK/output | 5 | 641,960,630 |

共约2.863GiB，已永久删除，不能原样恢复；不代表每一逻辑字节都等于独占磁盘空间。C盘可用实测3.183→6.058GiB（包含同时其他系统写入波动），随后6.066GiB。保留三目录全部外层验证日志、`dist-otcyNy`的1.1.15双包及`dist-JNNUUW`最终1.1.16双包/展开程序；所核验保留文件摘要不变。未读取、移动或删除用户资料，不修改D盘。

回执：`artifacts/upstream-checks/2026-10-16/cleanup-36e3319dc29e444197f2e0430552e984/result.json`。只读预检先误假设各目录均保有`win-unpacked`而退出，未删任何文件；实际Setup身份核对后修正检查器，原失败见`cleanup-preflight-note.json`。检查及删除执行器为`cleanup-approved-candidates.ps1`，旧日志仍保留历史原路径，不重建被批准删除的包。

## 完整构建实际结果

已执行隔离`build:official`，9个gate通过、0失败/跳过，用时333.04秒；实际构建进程exit0且close已观察，控制命令也已结束。16,231项源码前后摘要均为`06c34d160ca52424ba2702e243e5a759d7602c8615367c2eecbc4b8b2599de92`，来源/补丁/锁/工具链摘要保持。产物清单12,602文件、187,296,204字节；323个客户端产物由官方record核对（集合SHA256 `dcb88b73f08e6ad00a828fe09cbf1122622f684b50ec485e6b6f3f960ee46fb5`），环境为`official / 86a4022 / 0.2.1-alpha.4 / DeepSeek Harness`。

构建回执：`artifacts/upstream-checks/2026-10-16/controlled-build-alpha4-wSYfrd/result.json`，SHA256 `032b1c7b312b62345071af9fd59db913a04b2bfd4ca0750c814a1aecfaef1288`。来源/产物清单和stdout/stderr均在同目录。运行最低可用空间约5.732GiB，未触发止损。该结果是完整编译/类型和产物一致性通过，不是完整上游测试、桌面运行时闭包、Windows原生消费者、真实模型、新Setup/Portable或覆盖/公开验收。

## 后续执行边界

依赖已冻结安装、六层40后像已核验，5组源码专项521通过/1项Windows条件跳过；这些均不重做。本轮使用固定Node24.19.0、pnpm11.28.5，单DAG构建worker，启动至少5GiB、运行保留2.5GiB动态空间阈值；单DAG worker不等于编译器内部单线程。此执行器只build，不自动pack/deploy/覆盖本机。

官方完整构建含Host/Client编译、bundle、Web和aggregate checks，不能使用`--scope artifacts`替代；其Windows `build:native-system --host-addon-only`为平台无目标后直接退出，不是Windows native编译通过。Office/Koffi/现有原生依赖仍需后续实际宿主验证。`official`是上游编译配置名称，不表示lulu是DeepSeek官方产品。

清理与本次完整构建阶段已完成。后续按新来源包集、实际依赖闭包及宿主专项，再正式绑定拟1.1.17、最终根测试/双包/覆盖及公开验收；不能直接套用硬编码alpha.2/37后像/298包的旧执行器。以后准备双包及安装前仍须重新测量空间，不能把本次约6GiB作为永久充足结论。未经新的明确授权，不再删除其他1.1.15及以后产物。

## 包集准入修正

新pack-only执行器直接引用上述成功build原始回执及源码/全部产物清单，六阶段仅生成隔离包集，不安装、重新build或改正式绑定。继续禁用依赖生命周期脚本；这会跳过native entry官方`prepack`的文件检查，独立评审据此发现漏检。已改为核对实际TGZ中的四个JS/类型导出文件及与固定源码相同的exports，同时核对所选包与原packed包字节一致。纯辅助测试7/7通过，首次负例失败保留；不是原生运行成功的证明。

实际pack于2026-10-16T13:10:51.378Z开始、13:16:12.572Z结束，六阶段exit0/close且源码输入保持，控制命令exit0并已结束。官方选择器生成302个包（23,309,902字节，不含外部生产依赖），逐包身份、SHA512、原tar/所选tar SHA256核对通过；descriptor SHA256为`6150544f285b390a7c7db0ff0d418df6401a98634f62230584fdee090099451e`。native入口四项实际存在，未把官方Windows空native编译步骤当运行验证。

pack回执：`artifacts/upstream-checks/2026-10-16/controlled-pack-alpha4-a5Qoxy/result.json`，SHA256 `f8f2ec3285e087e28653be890c7fcccca97dcf6d74f928687de28f81d5d53634`。脚本SHA256 `96433288318a6000c588349383f7b014dc052717bb4dda37947574a2c4a36ba1`；16,231项源码前后完整清单和摘要与build一致，原build产物全部保持，仅native-ts新增49字节`native/system/tsconfig.tsbuildinfo`（最终12,603项）。运行最低可用6.140GiB，未触发止损；其他程序造成的磁盘波动不归因为本任务额外释放。没有新的Setup/Portable、实际运行时部署、覆盖或公开上传。

正式来源链后续须以明确的新回执格式分支核验`source-frozen-build-only`与`source-frozen-pack-only`，保留其原始schema1/字节；不得把新回执改写成历史schema2或伪造旧字段以通过门禁。source profile已被构建固定摘要，后续部署状态应另记，不回填该profile。相对源码路径须安全解析到项目内；旧格式兼容分支仍保留。构建、pack和安装回执各自证明不同阶段，不相互替代。

## 精确续作位置

直接复用成功build与302包集，接着生成该包集对应的生产依赖锁/冻结安装/审计和物化清单，验证真实Host、Office/原生消费者及权限语义；同时新增明确格式的来源验收分支与拒绝测试。不得从原源码安装或完整build/pack重来，也不得伪用alpha.2旧包等价证明。正式绑定、新双包及安装/发布验收仍未完成。授权清理已闭合，不再等待用户重复答复该选择。
