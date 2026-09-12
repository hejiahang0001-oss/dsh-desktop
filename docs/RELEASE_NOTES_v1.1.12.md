# DSH Desktop V1.1.12 — Latest / Pre-release

本机已由 V1.1.11 覆盖到 V1.1.12，并通过安装态验收。只更新 Latest / Pre-release，Stable 保持 V1.1.0。

- 固定 Harness `0.1.5-rc.2`，采用官方 Flash 模型接入、文档预览、`present` 文件交付和反馈/可靠性修复。
- 桌面文件搜索与 Git Review 的查看入口已转到官方 Sidebar，删除重复的普通文档/图片/PDF 预览界面。Office 校验、摘要回执、备份恢复、Wiki、原生代理和最高优先级加密 Key 保留。
- Session 格式仍为 V3；新事件可能不被旧版本识别，回退只能使用独立升级前备份，不能让旧程序读取升级后的活动资料。
- 固定八项精确安全依赖补丁；只对实际构建、运行库和安装态验证结果作承诺。

## 已验证

- 已安装软件的六项基础检查、官方五类预览、三页中文 PDF、键盘搜索、双文件标签和窄窗/全屏控件通过。
- 使用隔离测试配置及加密保存的 Key，真实 Queue、向上插话、Ctrl+Enter、Stop、present 交付和 Excel/Word 读取通过；原文件未修改。
- 覆盖前备份 38 份会话/设置文件；安装和测试后逐项摘要不变，三个加密相关文件也保持不变。安装程序退出码为 0，完整内容指纹与已验收安装包一致。
- Setup、Portable、blockmap、SHA-256 清单四项资产的远端大小和摘要均与本机一致；[独立匿名完整下载](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/34679978281) 4/4、校验清单 3/3 通过。详细证据见仓库 `docs/VALIDATION.md`。

安装器仍未签名，自动安装保持关闭。另一台 Windows、至少 24 小时老化、超大或加密文件、原生分屏拖动及任意 Office 视觉版式不在本次验收范围。Office 恢复交互和 Portable 性能列入 V1.1.13。
