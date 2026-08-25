---
name: word-docx
description: 在当前工作区内创建、检查或受控修改可编辑的 Word DOCX 文档。适用于用户要求生成 Word、DOCX、报告、方案、纪要或修改既有 DOCX 文本的任务。
whenToUse: 用户要求创建或修改 Word/DOCX 文档，并希望得到工作区内可直接打开的文件时使用。
user-invocable: true
disable-model-invocation: false
metadata:
  owner: DSH Desktop
  version: 0.5.20
---

# DSH Desktop Word DOCX

使用 DSH Desktop 随软件离线提供的受控 DOCX 工具，不下载第三方生成器，不修改 Harness Agent 循环，也不要把密钥、会话正文或工作区外文件传给工具。

## 能力与边界

- `create`：根据 JSON 规格生成可编辑 DOCX，支持标题、副标题、1–3 级标题、段落、项目符号、编号、表格、PNG/JPEG 图片、分页、页眉和页脚。
- `replace-text`：对已有 DOCX 的单个 Word 文本节点做精确替换；若文本被 Word 拆成多个格式片段，必须向用户说明本版本不会跨片段猜测替换。
- `inspect`：在交付前检查 DOCX ZIP、必需 OOXML 条目、段落和表格结构。
- 所有输入、规格和输出都必须在当前工作区内；工具拒绝路径穿越、符号链接/重解析点、超限 JSON、超限 DOCX、ZIP 越界和不支持的压缩方法。
- 图片只从当前工作区读取真实 PNG/JPEG；单图小于 12 MiB、总计小于 32 MiB、最多 24 张，不接受远程 URL、SVG、伪装格式或链接路径。
- 默认不覆盖已有输出；只有用户明确要求覆盖，或修改操作明确把输出指向原文件时，才使用 `--overwrite`。覆盖会保留同目录 `.dsh-backup-*` 副本。

## 固定运行方式

在 PowerShell 中调用软件注入的绝对路径环境变量。不要自行寻找系统 Node，不要改用 `npm`、`npx`、Python 或在线转换服务。

```powershell
& $env:DSH_DESKTOP_NODE $env:DSH_DESKTOP_DOCX_TOOL create --workspace $env:DSH_CWD --spec '<工作区内规格.json>' --output '<工作区内输出.docx>'
```

```powershell
& $env:DSH_DESKTOP_NODE $env:DSH_DESKTOP_DOCX_TOOL replace-text --workspace $env:DSH_CWD --input '<工作区内输入.docx>' --spec '<工作区内替换.json>' --output '<工作区内输出.docx>'
```

```powershell
& $env:DSH_DESKTOP_NODE $env:DSH_DESKTOP_DOCX_TOOL inspect --workspace $env:DSH_CWD --input '<工作区内输出.docx>'
```

路径参数必须作为独立参数传递并加引号，不拼接成二次执行的命令字符串。

## 创建规格

先在工作区写入 UTF-8 JSON。字段示例：

```json
{
  "title": "项目周报",
  "subtitle": "2026 年第 35 周",
  "author": "项目组",
  "language": "zh-CN",
  "header": "项目周报 · 内部资料",
  "footer": "由 DSH Desktop 生成",
  "sections": [
    { "kind": "heading", "level": 1, "text": "本周进展" },
    { "kind": "paragraph", "text": "本周完成核心工作。" },
    { "kind": "bullets", "items": ["事项一", "事项二"] },
    { "kind": "numbered", "items": ["先完成验证", "再交付文件"] },
    { "kind": "image", "path": "assets/overview.png", "alt": "产品界面概览", "widthInches": 5.5 },
    {
      "kind": "table",
      "table": {
        "widths": [3000, 6000],
        "rows": [["项目", "说明"], ["状态", "已完成"]]
      }
    },
    { "kind": "pageBreak" },
    { "kind": "heading", "level": 1, "text": "下周计划" }
  ]
}
```

不要在 JSON 中虚构用户未提供的审批、签字、财务金额或完成事实。内容较复杂时，先把事实、推断和计划分开组织，再生成文档。

## 替换规格

```json
{
  "replacements": [
    { "find": "旧项目名称", "replace": "新项目名称" },
    { "find": "2026-08-24", "replace": "2026-08-25" }
  ]
}
```

如果任意 `find` 没有命中，工具会整体失败并且不写出结果。不要为了绕过失败改成宽泛替换。

## 必做验证

1. 先运行 `inspect`，要求返回 `ok: true`、`valid: true`，并核对 `paragraphs`、`tables`、`images` 与预期一致。
2. 如果本机安装了 Microsoft Word，可用 Word 打开交付文件进行分页、表格、页眉页脚的视觉检查；不要让 Word 自动覆盖源文件。
3. 若当前环境无法做视觉渲染，必须明确写“结构验证已通过，未完成视觉渲染”，不能把结构检查说成完整视觉验收。
4. 最终回复给出 DOCX 的绝对路径、是否覆盖、备份路径（若有）、结构检查结果和视觉检查状态。

## 失败处理

- 工具返回 JSON 错误时，先根据 `code` 修正规格或路径；不要删除原文件。
- `text-not-found` 表示没有全部命中，原文件和输出不会改变。
- `outside-workspace` 或 `reparse-path` 是安全边界，不能通过复制密钥、改变环境变量或关闭检查来规避。
- 输出已存在但用户没有授权覆盖时，换一个明确的新文件名。
