# MYStudio Windows 本地开发环境配置
# 用法: powershell -ExecutionPolicy Bypass -File apps\build\setup-win.ps1
$ErrorActionPreference = "Stop"

$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path "$ScriptDir\..\.."
$AppsDir     = "$ProjectRoot\apps"

Write-Host ""
Write-Host "MYStudio 本地开发环境配置"
Write-Host ""

if (-not (Test-Path "$AppsDir\node_modules\electron")) {
  Write-Host "[setup] 安装 Node.js 依赖..."
  Push-Location $AppsDir
  npm install
  Pop-Location
} else {
  Write-Host "[setup] Node.js 依赖已存在，跳过"
}

Write-Host "[setup] Python 运行环境不在 setup 阶段安装，也不会写入后端源码目录"
Write-Host "[setup] 首次使用本地 TTS 前，请在应用设置 > Python 配置中点击“开始配置”"
Write-Host "[setup] Python runtime 会安装到项目存储路径下的 runtime/python"
Write-Host "[setup] 配置完成。打包: cd apps; npm run build:win"
