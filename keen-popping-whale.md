# DocuGenius 转换逻辑升级计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**目标:** 将 DocuGenius 的 Python 文档转换引擎替换为 bruce-doc-converter 的高质量转换逻辑，提升加粗/斜体保留、多级列表编号、合并单元格表格处理、装饰性图片过滤等能力。

**架构方案:** 替换两个平台的 `converter.py`（内容相同的跨平台 Python 脚本），保持与 TypeScript 侧 `callConverter()` 的 CLI 接口兼容，同时在 TypeScript 侧传入 `outputPath` 以支持正确的图片相对路径。

**技术栈:** Python 3（python-docx, openpyxl, python-pptx, pdfplumber）、TypeScript（VSCode Extension API）

## 背景

当前 DocuGenius 使用的 `converter.py` 做的是最基础的转换：
- DOCX：只取段落文本，不保留加粗/斜体，不处理多级列表编号
- XLSX：不处理合并单元格，不处理日期/数值格式
- PPTX：简单遍历 shape.text，缺乏结构化
- PDF：基础 pdfplumber 提取，无位置排序

bruce-doc-converter 的 `convert_document.py`（约 2900 行）提供：
- Run 级别格式保留（加粗、斜体合并分组避免 `**a****b**` 碎片化）
- 从 numbering.xml 解析真实多级列表编号（1. / 1.1. / 中文数字 / 带圈数字）
- 合并单元格 grid span 感知表格输出
- OOXML `adec:decorative` + 尺寸/比例启发式装饰图片过滤
- PDF 文本和表格按 Y 坐标位置合并排序

## 关键文件

| 文件 | 角色 |
|------|------|
| `bin/win32/converter.py` | 待替换（当前简单版） |
| `bin/darwin/converter.py` | 待替换（与 win32 相同） |
| `bin/win32/image_extractor.py` | 保留不动（新 converter 失败时仍可 fallback） |
| `bin/darwin/image_extractor.py` | 保留不动 |
| `src/converter.ts:256-338` | `callConverter()` — 小改：传 outputPath 给 Python |
| `C:\Users\Bruce\VSCodeProject\bruce-doc-converter\scripts\convert_document.py` | 源文件（只读参考） |

## 任务 1：修改 TypeScript 传递 outputPath

**文件:** `src/converter.ts`

**当前代码（第 272-276 行）：**
```typescript
if (isPythonConverter) {
    const extractImages = this.configManager.shouldExtractImages();
    fullCommand = `"${command}" "${filePath}" ${extractImages ? 'true' : 'false'}`;
}
```

**改为：**
```typescript
if (isPythonConverter) {
    const extractImages = this.configManager.shouldExtractImages();
    const outputPath = this.getOutputPath(filePath);
    fullCommand = `"${command}" "${filePath}" ${extractImages ? 'true' : 'false'} "${outputPath}"`;
}
```

注意：`getOutputPath()` 是 private 方法，在 `callConverter()` 调用时无需 outputPath 存在，因为 TypeScript 之后还会把 stdout 写入该路径。这一步是让 Python 知道图片应该放在哪里。

## 任务 2：替换 Python 转换脚本

**目标文件:** `bin/win32/converter.py`（完成后直接复制到 `bin/darwin/converter.py`）

新的 `converter.py` 由 bruce-doc-converter 的 `convert_document.py` 裁剪而来：

**保留的核心函数（全部来自 `convert_document.py`）：**
- 所有常量定义（`OOXML_IMAGE_NAMESPACES`, `_IMAGE_SIGNATURES` 等）
- 所有辅助函数（`_normalize_text`, `_escape_plain_markdown_text`, `_format_inline_markdown` 等）
- `check_dependencies()` — 自动安装依赖
- `convert_docx()` — 高质量 Word 转换
- `convert_xlsx()` — 带合并单元格的 Excel 转换
- `convert_pptx()` — PowerPoint 转换
- `convert_pdf()` — PDF 文本+表格位置排序转换
- 所有图片提取辅助函数（`_is_decorative_image`, `_detect_image_format` 等）
- `_setup_image_output_dir()` — 图片目录设置
- `_resolve_markdown_output_path()` — 输出路径计算

**移除的函数（不需要）：**
- `convert_md()` — Markdown→DOCX，DocuGenius 不需要
- `_ensure_shared_node_modules()` 等 Node.js 相关函数
- `batch_convert()` — 批量转换（TypeScript 侧已处理批量）
- `_iter_batch_input_files()` — 同上

**修改 `main()` 函数（关键改动）：**

```python
def main():
    if sys.platform == 'win32':
        import codecs
        try:
            sys.stdout.reconfigure(encoding='utf-8')
            sys.stderr.reconfigure(encoding='utf-8')
        except Exception:
            pass

    if len(sys.argv) < 2:
        print("Usage: converter.py <file_path> [extract_images] [output_path]")
        sys.exit(1)

    file_path = sys.argv[1]
    extract_images = True
    if len(sys.argv) > 2 and sys.argv[2].lower() in ('false', 'no', '0'):
        extract_images = False
    output_path = sys.argv[3] if len(sys.argv) > 3 else None

    # 确定图片输出目录
    image_save_dir = None
    image_rel_dir = None
    file_ext = os.path.splitext(file_path)[1].lower()
    if extract_images and file_ext in ('.docx', '.xlsx', '.pptx'):
        if output_path:
            # 图片放在 output_path 同级的 images/ 目录
            out_dir = os.path.dirname(os.path.abspath(output_path))
            image_save_dir = os.path.join(out_dir, 'images')
            image_rel_dir = 'images'
        else:
            # fallback：放在输入文件目录的 images/ 下
            image_save_dir = os.path.join(os.path.dirname(os.path.abspath(file_path)), 'images')
            image_rel_dir = 'images'

    # 调用对应转换函数
    try:
        deps_ok, err = check_dependencies(file_ext)
        if not deps_ok:
            print(f"Error: {err}", file=sys.stderr)
            sys.exit(1)

        if file_ext == '.docx':
            markdown_content, _ = convert_docx(file_path, image_save_dir, image_rel_dir)
        elif file_ext == '.xlsx':
            markdown_content, _ = convert_xlsx(file_path, image_save_dir, image_rel_dir)
        elif file_ext == '.pptx':
            markdown_content, _ = convert_pptx(file_path, image_save_dir, image_rel_dir)
        elif file_ext == '.pdf':
            markdown_content = convert_pdf(file_path)
        else:
            print(f"Unsupported file type: {file_ext}")
            sys.exit(1)

        print(markdown_content)
    except Exception as e:
        print(f"Error: {str(e)}", file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    main()
```

## 任务 3：将 win32 版本复制到 darwin

`bin/darwin/converter.py` 内容与 `bin/win32/converter.py` 完全相同（Python 跨平台）。

## 验证

1. 在 VSCode 中用扩展对一个包含**加粗、斜体、多级列表**的 `.docx` 文件执行转换，检查输出 Markdown 是否保留了格式
2. 对一个包含**合并单元格**的 `.xlsx` 文件转换，检查表格输出是否正确
3. 对一个 `.pdf` 文件转换，检查文本提取是否正常
4. 开启图片提取设置，对包含图片的 `.docx` 转换，检查 `DocuGenius/images/` 目录下是否有图片，以及 Markdown 中是否有 `![](images/xxx.png)` 引用
5. 编译 TypeScript：`npm run compile`，确认无报错
