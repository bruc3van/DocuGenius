# DocuGenius

> 本地文档转 Markdown 工具，让 AI 编程工具直接读懂你的业务文档。

[![Version](https://img.shields.io/badge/version-2.5.8-blue)](https://github.com/brucevanfdm/DocuGenius/releases)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

DocuGenius 是一个 VSCode 插件，将 Word、Excel、PowerPoint、PDF 转换为结构化的 Markdown，让 Trae AI、CodeBuddy、Cursor 等 AI 编程工具能够原生理解你的产品文档、数据表格和技术资料。

## 快速开始

### 安装

**方式一：插件市场（推荐）**

在 VSCode / Trae / CodeBuddy 插件市场搜索 `DocuGenius`，点击安装。

**方式二：手动安装**

1. 下载最新 `.vsix`：[GitHub Releases](https://github.com/brucevanfdm/DocuGenius/releases/latest)
2. 在编辑器中选择「从 VSIX 安装」

### 使用

**转换单个文件**

右键点击文档 → 选择 `[DocuGenius] Convert to Markdown` → 输出到 `DocuGenius/` 目录

**批量转换**

右键点击文件夹 → 选择 `[DocuGenius] Process All Files in Folder`

转换完成后，直接在 AI 问答窗口中引用这些 Markdown 文件即可。

## 支持格式

| 格式 | 扩展名 | 转换效果 |
|------|--------|----------|
| Word | `.docx` | 保留文本层级、提取图片到 `images/` |
| Excel | `.xlsx` | 转为结构化 Markdown 表格 |
| PowerPoint | `.pptx` | 逐页提取文本和图片 |
| PDF | `.pdf` | 高质量文字提取 |

## 特性

- **纯本地处理** — 文档不上传云端，敏感数据更安全
- **无数量限制** — 不受云端知识库文件数量/大小限制
- **AI 原生格式** — 输出结构化 Markdown，适配各类 AI 编程工具
- **批量转换** — 支持整个文件夹一键处理

## 典型场景

- **产品材料创作**：基于历史 PRD 快速生成新方案
- **数据分析**：将 Excel 指标表交给 AI 生成分析结论
- **竞品研究**：批量转换竞品 PDF 资料，生成结构化对比报告
- **需求管理**：从产品文档中提取功能清单、核对参数细节

## 效果对比

转换前：

```
项目/
├── 产品需求.docx     # AI 无法直接读取
├── 用户数据.xlsx     # AI 难以理解结构
└── 技术文档.pdf      # 需要手动复制粘贴
```

转换后：

```
项目/
├── 原始文档/
│   ├── 产品需求.docx
│   ├── 用户数据.xlsx
│   └── 技术文档.pdf
└── DocuGenius/        # AI 可直接引用的知识库
    ├── 产品需求.md
    ├── 用户数据.md
    ├── 技术文档.md
    └── images/
        ├── 产品需求/
        └── 技术文档/
```

## 系统要求

- **macOS**：开箱即用（Intel / Apple Silicon）
  - 正式发布包内置通用 macOS 二进制，同时支持 Intel 和 Apple Silicon
  - 无需额外安装 Rosetta 2
- **Windows**：需预先安装 Python 3.6+
  - 首次转换时，DocuGenius 会先提示你安装一套**共享本地运行时**
  - 这套运行时只会安装在扩展自己的存储目录中，并在所有工作区之间复用
  - 不会向每个项目目录单独创建 `.venv`，也不会把依赖安装到当前工作区

## Windows 运行时说明

在 Windows 上，DocuGenius 会使用系统里的 Python **只做一次引导**：

1. 检测本机是否存在可用的 Python
2. 在扩展的全局存储目录里创建一套共享运行时
3. 将 `python-docx`、`openpyxl`、`python-pptx`、`pdfplumber` 安装到这套共享运行时
4. 后续所有工作区都复用这套运行时进行转换

如果你需要手动处理运行时，可以从命令面板使用：

- `DocuGenius: Install Shared Runtime`
- `DocuGenius: Repair Shared Runtime`
- `DocuGenius: Show Runtime Status`

## 常见问题

**Q: 与 Claude Project / ChatGPT Project 有什么区别？**

A: DocuGenius 是本地转换方案，无文件数量和大小限制，且完全支持 Excel 表格转换。转换后的 Markdown 可在任意 AI 编程工具中使用，成本更低，数据更安全。

**Q: 文档数据是否安全？**

A: 文档转换过程完全在本地执行，不会上传到任何服务器。使用 AI 问答时调用云端大模型属于正常的 AI 工具使用流程。

**Q: 是否支持预览 Office 和 PDF 文件？**

A: 不支持。DocuGenius 专注文档转换，如需在 IDE 中预览原始文件，建议搭配 Office Viewer 类插件使用。

**Q: Windows 会不会给每个项目都安装一份依赖？**

A: 不会。DocuGenius 现在会把 Windows 运行时安装到扩展自己的共享目录中，所有工作区共用一份，不会污染每个项目目录。

## 作者

- X: [@bruc3van](https://x.com/bruc3van)
- GitHub: [@bruc3van](https://github.com/bruc3van)
