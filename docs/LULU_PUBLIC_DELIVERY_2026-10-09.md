# lulu V1.1.14：公开交付与 Stable 就绪记录

记录日期：2026-10-09（北京时间）。承接[安装后资料保全](LULU_RELEASE_READINESS_2026-10-09.md)；旧日期报告、失败和未验证范围不改写。

## 实际交付身份

- 本机：lulu **1.1.14 / Harness 0.2.1-alpha.1**，原安装和资料目录不变，安装态及原资料正常退出后的保全通过。
- 上游：`dsh-v0.2.1-alpha.1` / `5badb15009ae1756c3afe0ae0cef1faafc290ccc`，使用固定来源及已记录的兼容补丁，不采用未发布 master。
- 发行源码与标签：`v1.1.14` → `de113816abd1aea4729e8b2704143a1b6261bf60`。
- [PR #85](https://github.com/hejiahang0001-oss/dsh-desktop/pull/85) 已创建，尚未合并；开发手册的公开门禁要求 PR/CI，不要求先合并到 main。
- [公开 Pre-release](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v1.1.14)：Release ID `407102006`，发布时间 `2026-10-08T18:12:33Z`（北京时间 10 月 9 日 02:12:33）。实际 `draft=false / prerelease=true`。
- GitHub Latest/Stable 仍为 **v1.1.12**，旧 v1.1.13 私有草稿未改动。本次没有发布 `latest.yml`，也没有晋升 Stable。

## 复用官方与桌面保留

官方继续负责 Agent、主会话、模型、权限、队列/插话/Stop、文件及 Office 主能力；采用官方运行库清单、校验器及接口，删除等价的桌面重复实现。保留软件优先加密 Key、代理设置、Office/Wiki 校验与备份、Git Review、Windows 进程/沙箱保护及最小附件草稿补充。界面与图标显示 lulu；× 隐藏到托盘，托盘提供明确退出入口。原应用身份及升级通道不迁移，不涉及 ERP 或远程命令桥。

## 源码与包的验证关系

- 最终本地 `pnpm test` **912/912，0 失败、0 跳过**；391 项输入在测试前后不变。
- [CI 37817814410](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/37817814410) 对精确发行提交的三项 job 全部成功：源码质量、生产依赖安全、包与语义数据契约。CI 源码测试是 **906 通过、0 失败、6 跳过**；包契约 26/26。
- 6 项跳过因干净 runner 不带完整 vendored runtime，并不代表真实内核集成通过；本机完整运行库、安装包与真实交互证据单独保留。不将旧 alpha.2 CI 称作新核构建验证。
- 首轮 CI `37816195306` 的 1 项失败保留。仅将依赖本地 metadata 的复制契约拆成始终运行的夹具契约与真实 metadata 集成断言：缺 vendor 显式跳过，存在空/错误 runtime 仍失败。相对 `9e412408596e48785693063e45f2dcf595785df7` 只改一个测试文件和收尾文档，未改产品、运行库或冻结包。
- 冻结包 ASAR SHA-256：`107169a5c8b36cbe809e6e2057b994a1c79b2d66660555e3e75339aa320adf2c`。已有打包、Setup/Portable、真实 UI/模型/权限、Office、归档退出、备份覆盖与安装验证继续按精确身份复用，不重复打包。

## 四份公开资产

本次上传命令已正常结束；GitHub 返回的四项大小、状态 `uploaded` 和 SHA-256 与本地冻结产物全部相符。文件名保留 DSH Desktop 以延续发行身份，程序显示为 lulu。

| 文件 | 字节数 | SHA-256 |
|---|---:|---|
| `DSH-Desktop-Setup-1.1.14.exe` | 318826801 | `ecc60da24ba3550f43db8cf03b32b42336589d2b99c1162a7041fdab1baea9ce` |
| `DSH-Desktop-Setup-1.1.14.exe.blockmap` | 331393 | `4490c49cf4d3a5d27b1678a94433dac0fb2fc3bceee5bfead5b168f585ac097d` |
| `DSH-Desktop-Portable-1.1.14.exe` | 318079491 | `87e859566edcadf36c936d5948e549bdc1adcf4415f3d56f6873cb18d150985f` |
| `SHA256SUMS-v1.1.14.txt` | 297 | `660321e29af98f87753b32f98d3093a389b4dbde302bb184e6ce3dbf04fcdcf0` |

### 匿名回下载：完整四资产通过，保留一次网络中断

验证始于全新 `release/public-NTErHh` 目录，无旧下载缓存、Authorization 或 Cookie。安装版和 blockmap 完整 HTTP 200 后摘要通过；Portable 的初次 HTTP 200 在 244940800 字节时中断，两个立即重试未收到 HTTP 响应，原 `ok=false` 回执保留，具体网络中断原因未证实。

连接复查正常后，先备份并核对中断前缀，再续传 `bytes=244940800-`。服务器实际返回 **206**，`Content-Range: bytes 244940800-318079490/318079491`，剩余长度 **73138691**；最终完整 Portable 与冻结摘要一致。校验清单为匿名 HTTP 200。四文件均已实际下载且完整大小/SHA-256 通过，主控另行读取文件重算一致；不是四次一次性 200，也不是用本地旧缓存替代网络证据。完成时间 `2026-10-08T18:38:42.940Z`。

本次只修复验证过程的网络恢复，不改变产品、安装包或发布门槛；旧失败、原 partial 副本与成功续传回执都保留。没有重新安装、重跑模型或重建同一冻结包。

## 资料与宿主边界

正常退出后的 28 份原历史、7 条草稿、加密凭据/加密字段、代理和设置原字节迁移已通过保全比较。临停 `dsh_agent` 配置已精确恢复，CLI 为 enabled=true；MCP 仅验证初始化和五工具目录，不称为客户端热重载或远程端到端验证。安装前私有备份与原失败证据留在本地，不入公开资产。

只承诺 **Windows 11 x64 已验证**；安装包未签名，不承诺自动升级。Windows 10、其他电脑、长期老化和未覆盖的 IME 等仍未验证。显卡缓存宽权限和既有 Windows 祖先权限为用户分别接受的主机风险，未宣称修复或整机安全，不修改 DACS、系统 ACL 或沙箱来隐藏失败。用户提供的噜噜素材分发权未独立核实，未作授权/合作声明。本项目不是 DeepSeek 官方产品。

## 证据索引

以下路径相对 `artifacts/stable-readiness-20261007/`；不公开原始用户资料。

| 证据 | SHA-256 |
|---|---|
| `test-RlVX4H/result.json` | `220626b2eac6145192d4b9ffb8b07f771778256f630f1cd439ea118e81b42210` |
| `release/ci-1791481101116.json` | `cd01f6cba004b515722b45939e42c7c4ecea39a6b3d0c10e3ce82d5b4716eaec` |
| `release/FINAL_SOURCE_PACKAGE_BINDING_de113816.json` | `4b6ba4a7725a0e48f9d7bb2978c2491978b4b16614900c7a99cefd8a8d1714a1` |
| `release/release-1791483162819.json` | `10d04b01948c80a02675c31463b933e63f757dce67590e152f8664578400100e` |
| `release/release-1791483162819-tag.json` | `f79a35f97f03400b503ead77ba2cee40e06b794a285919c6367885c9b5ee253f` |
| `release/public-NTErHh/network-receipt.json`（原失败） | `7f6ef2ab9892e2b7d11d98fabdb70517ea6c691d888f352430f1560eaa4e920a` |
| `release/resume-JHi6oO/network-receipt.json`（成功续传） | `430fc50c6124b2bae9adfbd7bcb9afa56a24038b4354319cafee02a27e5aedc4` |
| `release/public-NTErHh/artifacts/public-v1.1.14/verification.json` | `03c2e3c43ddbbae3012ba390d8c4e93db2b9c9083667c30edd1bb3e868f784ce` |

## 结论与后续

本次约定范围的技术、安装、资料保全及公开交付验收已通过。此页作为最终 wiki-update 的固定来源；知识库实际写后回读结果单独记录在 PROGRESS，只有同步成功才宣布全部收尾完成。

后续优先收集本机日常使用和其他 Windows 11 设备的反馈，另行验证尚未覆盖的环境，不将这些项目冒充已验。继续按已发布的官方标签触发小版本适配，保留必要桌面补充。Stable 晋升仍需用户单独明确命令，不随本次 Pre-release 自动改变。
