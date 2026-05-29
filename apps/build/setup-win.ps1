# MYStudio Windows 本地开发环境配置
# 用法: powershell -ExecutionPolicy Bypass -File apps\build\setup-win.ps1
$ErrorActionPreference = "Stop"

$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path "$ScriptDir\..\.."
$BackendDir  = "$ProjectRoot\apps\backend"
$PythonDir   = "$BackendDir\python"
$PythonBin   = "$PythonDir\python.exe"
$AppsDir     = "$ProjectRoot\apps"

# ─── 1. 下载 Python (python-build-standalone) ───
if (-not (Test-Path $PythonBin)) {
  Write-Host "[setup] 下载 Python 3.12 (python-build-standalone)..."
  $Url = "https://github.com/indygreg/python-build-standalone/releases/download/20241016/cpython-3.12.7+20241016-x86_64-pc-windows-msvc-install_only.tar.gz"
  $Tmp = "$env:TEMP\python-win.tar.gz"
  Invoke-WebRequest -Uri $Url -OutFile $Tmp
  if (Test-Path $PythonDir) { Remove-Item -Recurse -Force $PythonDir }
  tar -xzf $Tmp -C $BackendDir
  Remove-Item $Tmp
  Write-Host "[setup] Python 安装完成: $(& $PythonBin --version)"
} else {
  Write-Host "[setup] Python 已存在: $(& $PythonBin --version)"
}

# ─── 2. 安装 PyTorch (CUDA) + 后端依赖 ───
Write-Host "[setup] 安装 PyTorch (CUDA 12.1)..."
& $PythonBin -m pip install --quiet torch --index-url https://download.pytorch.org/whl/cu121
Write-Host "[setup] 安装后端依赖..."
& $PythonBin -m pip install --quiet -r "$BackendDir\requirements.txt"
if (-not (& $PythonBin -c "import torch, transformers, huggingface_hub" 2>$null; $?)) {
  Write-Error "依赖安装失败"; exit 1
}
Write-Host "[setup] Python 依赖安装完成"

# ─── 3. 安装 Node.js 依赖 ───
if (-not (Test-Path "$AppsDir\node_modules\electron")) {
  Write-Host "[setup] 安装 Node.js 依赖..."
  Push-Location $AppsDir; npm install; Pop-Location
} else {
  Write-Host "[setup] Node.js 依赖已存在，跳过"
}

Write-Host "[setup] ✅ 配置完成！打包: cd apps; npm run build:win"
