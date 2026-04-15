#!/usr/bin/env python3
"""
Build script to create executables for DocuGenius
Creates native binary for macOS and batch script for Windows
"""

import os
import sys
import subprocess
import shutil
from pathlib import Path

def run_command(cmd, capture_output=True):
    """Run a command and return success status"""
    try:
        if capture_output:
            result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
            return result.returncode == 0, result.stdout, result.stderr
        else:
            result = subprocess.run(cmd, shell=True)
            return result.returncode == 0, "", ""
    except Exception as e:
        return False, "", str(e)

def normalize_macos_arch_name(arch_name):
    """Normalize architecture aliases used by the workflow."""
    if not arch_name:
        return None

    normalized = arch_name.strip().lower()
    aliases = {
        "x64": "x86_64",
        "amd64": "x86_64",
        "x86_64": "x86_64",
        "arm64": "arm64",
        "aarch64": "arm64",
    }
    return aliases.get(normalized, normalized)

def inspect_macos_binary_architectures(binary_path):
    """Inspect a macOS binary with `file` and return normalized architectures."""
    success, stdout, stderr = run_command(f'file -b "{binary_path}"')
    if not success:
        error_output = stderr.strip() or stdout.strip() or "unknown error"
        raise RuntimeError(f"Failed to inspect binary architecture: {error_output}")

    file_output = stdout.strip()
    architectures = []
    for arch in ("x86_64", "arm64"):
        if arch in file_output:
            architectures.append(arch)

    if not architectures:
        raise RuntimeError(f"Could not determine binary architecture from: {file_output}")

    return architectures, file_output

def create_darwin_binary(expected_arch=None):
    """Create macOS binary using PyInstaller"""
    print("Building DocuGenius macOS binary...")

    # Detect current architecture
    import platform
    current_arch = platform.machine()
    print(f"Current system architecture: {current_arch}")
    expected_arch = normalize_macos_arch_name(expected_arch)
    if expected_arch:
        print(f"Expected output architecture: {expected_arch}")

    # Use the shared converter.py as entry point for PyInstaller
    cli_file = str(Path('bin/converter.py').resolve())

    try:
        # Create virtual environment for building
        env_dir = "build_env_darwin"
        if os.path.exists(env_dir):
            shutil.rmtree(env_dir)

        python_cmd = sys.executable
        print(f"Using Python: {python_cmd}")
        print(f"Creating build environment: {env_dir}")
        success, _, _ = run_command(f'"{python_cmd}" -m venv {env_dir}')
        if not success:
            print("Failed to create virtual environment")
            return False

        # Install PyInstaller and document processing libraries
        print("Installing PyInstaller and document libraries...")
        install_cmd = f". {env_dir}/bin/activate && pip install pyinstaller python-docx python-pptx openpyxl pdfplumber"
        success, _, _ = run_command(install_cmd)

        if not success:
            print("Failed to install required libraries")
            return False

        # Build the executable
        print("Building executable...")
        build_cmd = f". {env_dir}/bin/activate && python -m PyInstaller --onefile --name docugenius-cli --strip --optimize=2 {cli_file}"
        success, stdout, stderr = run_command(build_cmd, capture_output=True)

        if not success:
            print("Failed to build executable")
            if stdout:
                print("STDOUT:", stdout)
            if stderr:
                print("STDERR:", stderr)
            return False

        # Check if the executable was created
        exe_path = "dist/docugenius-cli"

        if not os.path.exists(exe_path):
            print("Executable not found after build")
            return False

        # Create the bin/darwin directory if it doesn't exist
        darwin_dir = Path("bin/darwin")
        darwin_dir.mkdir(parents=True, exist_ok=True)

        # Copy the executable to the bin directory
        target_path = darwin_dir / "docugenius-cli"

        shutil.copy2(exe_path, target_path)
        os.chmod(target_path, 0o755)

        built_architectures, file_output = inspect_macos_binary_architectures(target_path)
        print(f"Binary architecture: {', '.join(built_architectures)}")
        print(f"`file` output: {file_output}")

        if expected_arch and built_architectures != [expected_arch]:
            raise RuntimeError(
                f"Expected a {expected_arch} binary, but built {', '.join(built_architectures)}. "
                "Check the GitHub Actions runner label and Python architecture."
            )

        print(f"Binary created: {target_path}")
        print(f"File size: {os.path.getsize(target_path) / (1024*1024):.1f} MB")

        # Clean up build artifacts
        cleanup_dirs = ['build', 'dist', env_dir]
        for dir_name in cleanup_dirs:
            if os.path.exists(dir_name):
                shutil.rmtree(dir_name)

        for spec_file in Path('.').glob('*.spec'):
            spec_file.unlink()

        print("Cleaned up build artifacts")
        return True

    except Exception as e:
        print(f"Failed to create binary: {e}")
        return False

def create_windows_batch():
    """Create Windows batch file"""
    print("Creating DocuGenius Windows batch file...")

    # Create the bin/win32 directory if it doesn't exist
    win32_dir = Path("bin/win32")
    win32_dir.mkdir(parents=True, exist_ok=True)

    batch_content = '''@echo off
REM DocuGenius CLI for Windows
chcp 65001 >nul 2>&1
setlocal

set PYTHONIOENCODING=utf-8
set PYTHONUTF8=1

if "%~1"=="" (
    echo DocuGenius CLI - Document to Markdown Converter with Image Extraction
    echo Usage: docugenius-cli ^<file^> [extract_images] [output_path] [image_output_folder]
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
set "CONVERTER=%SCRIPT_DIR%..\\converter.py"

if not exist "%CONVERTER%" (
    echo Error: converter.py not found at "%CONVERTER%"
    echo Please reinstall the DocuGenius extension.
    exit /b 1
)

python "%CONVERTER%" "%~1" "%~2" "%~3" "%~4"
exit /b %ERRORLEVEL%
'''

    target_path = win32_dir / "docugenius-cli.bat"

    try:
        with open(target_path, 'w') as f:
            f.write(batch_content)

        print(f"Windows batch file created: {target_path}")
        print(f"File size: {os.path.getsize(target_path)} bytes")
        return True

    except Exception as e:
        print(f"Failed to create batch file: {e}")
        return False

def main():
    print("DocuGenius Binary Builder")

    current_platform = sys.platform

    if len(sys.argv) > 1:
        target = sys.argv[1].lower()
    else:
        target = "all"

    expected_arch = normalize_macos_arch_name(sys.argv[2]) if len(sys.argv) > 2 else None

    success = True

    if target in ["all", "darwin", "macos"]:
        if current_platform == "darwin" or target != "all":
            success &= create_darwin_binary(expected_arch=expected_arch)
        else:
            print("Skipping macOS binary (not on macOS)")

    if target in ["all", "windows", "win32"]:
        success &= create_windows_batch()

    if success:
        print("\nBinary build completed successfully!")
        print("\nGenerated files:")
        if os.path.exists("bin/darwin/docugenius-cli"):
            size = os.path.getsize("bin/darwin/docugenius-cli") / (1024*1024)
            print(f"   - bin/darwin/docugenius-cli ({size:.1f} MB)")
        if os.path.exists("bin/win32/docugenius-cli.bat"):
            size = os.path.getsize("bin/win32/docugenius-cli.bat")
            print(f"   - bin/win32/docugenius-cli.bat ({size} bytes)")
    else:
        print("\nBuild failed!")
        sys.exit(1)

if __name__ == "__main__":
    main()
