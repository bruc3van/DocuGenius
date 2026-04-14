@echo off
REM DocuGenius CLI for Windows
REM This batch file provides document conversion functionality

REM Set UTF-8 code page and enable delayed expansion
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

REM Set environment variables for better Unicode support
set PYTHONIOENCODING=utf-8
set PYTHONUTF8=1

REM Check if Python is available
python --version >nul 2>&1
if errorlevel 1 (
    echo Error: Python is not installed or not in PATH
    echo Please install Python from https://python.org
    echo You can download it from: https://www.python.org/downloads/
    echo Make sure to check "Add Python to PATH" during installation
    exit /b 1
)

REM Check Python version (should be 3.6+)
for /f "tokens=2" %%i in ('python --version 2^>^&1') do set PYTHON_VERSION=%%i

REM Check and install required Python packages for document conversion
set FILE_EXT=%~x1

if /i "%FILE_EXT%"==".docx" (
    python -c "import docx" >nul 2>&1
    if errorlevel 1 (
        pip install --user python-docx >nul 2>&1
    )
)
if /i "%FILE_EXT%"==".xlsx" (
    python -c "import openpyxl" >nul 2>&1
    if errorlevel 1 (
        pip install --user openpyxl >nul 2>&1
    )
)
if /i "%FILE_EXT%"==".pptx" (
    python -c "import pptx" >nul 2>&1
    if errorlevel 1 (
        pip install --user python-pptx >nul 2>&1
    )
)
if /i "%FILE_EXT%"==".pdf" (
    REM Install pdfplumber for PDF text extraction
    python -c "import pdfplumber" >nul 2>&1
    if errorlevel 1 (
        pip install --user pdfplumber >nul 2>&1
    )
)

REM Check if file argument is provided
if "%~1"=="" (
    echo DocuGenius CLI - Document to Markdown Converter with Image Extraction
    echo Usage: docugenius-cli ^<file^>
    echo.
    echo Supported formats:
    echo   - Text files: .txt, .md, .markdown
    echo   - Data files: .json, .csv, .xml, .html
    echo   - Documents: .docx, .xlsx, .pptx, .pdf ^(with image extraction^)
    echo.
    echo Features:
    echo   - Converts documents to Markdown format
    echo   - Extracts images from PDF, DOCX, and PPTX files
    echo   - Organizes images in structured folders
    echo   - Maintains image quality and proper references
    echo.
    echo Note: For optimal functionality, install:
    echo   pip install python-docx python-pptx openpyxl pdfplumber
    echo   ^(Dependencies are auto-installed when needed^)
    exit /b 1
)

REM Check if file exists
if not exist "%~1" (
    echo Error: File not found: "%~1"
    echo Please check the file path and try again.
    exit /b 1
)

REM Get the directory where this batch file is located
set SCRIPT_DIR=%~dp0

REM Check if converter.py exists
if not exist "%SCRIPT_DIR%..\converter.py" (
    echo Error: converter.py not found in %SCRIPT_DIR%..
    echo Please reinstall the DocuGenius extension.
    exit /b 1
)

REM Run the Python converter script directly
python "%SCRIPT_DIR%..\converter.py" "%~1" "%~2" 2>nul
if errorlevel 1 (
    echo Error: Conversion failed for "%~1"
    exit /b 1
)
exit /b 0
