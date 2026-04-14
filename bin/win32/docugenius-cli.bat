@echo off
REM DocuGenius CLI for Windows
chcp 65001 >nul 2>&1
setlocal

set PYTHONIOENCODING=utf-8
set PYTHONUTF8=1

if "%~1"=="" (
    echo DocuGenius CLI - Document to Markdown Converter with Image Extraction
    echo Usage: docugenius-cli ^<file^> [extract_images] [output_path]
    echo.
    echo Supported formats:
    echo   - Text files: .txt, .md, .markdown
    echo   - Data files: .json, .csv, .xml, .html
    echo   - Documents: .docx, .xlsx, .pptx, .pdf
    echo.
    echo Note: Python must be installed and available in PATH.
    exit /b 1
)

if not exist "%~1" (
    echo Error: File not found: "%~1"
    exit /b 1
)

python --version >nul 2>&1
if errorlevel 1 (
    echo Error: Python is not installed or not in PATH
    echo Please install Python from https://python.org
    exit /b 1
)

set "SCRIPT_DIR=%~dp0"
set "CONVERTER=%SCRIPT_DIR%..\converter.py"

if not exist "%CONVERTER%" (
    echo Error: converter.py not found at "%CONVERTER%"
    echo Please reinstall the DocuGenius extension.
    exit /b 1
)

python "%CONVERTER%" "%~1" "%~2" "%~3"
exit /b %ERRORLEVEL%
