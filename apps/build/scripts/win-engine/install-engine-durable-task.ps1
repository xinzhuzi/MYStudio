# install-engine-durable-task.ps1 -- 幂等创建/更新 Windows 引擎守护调度任务。
# 2026-10-25 收编（moss-win-campaign T1）：EngineDurable 的 /TR 实体已入仓
# （同目录 engine_task.py），本件把"重建守护"做成一键幂等操作。
#
# 用法（Windows PowerShell，无需管理员）：
#   powershell -ExecutionPolicy Bypass -File install-engine-durable-task.ps1
#   powershell -ExecutionPolicy Bypass -File install-engine-durable-task.ps1 -PythonExe D:\Python312\python.exe
# 重启引擎：schtasks /Run /TN EngineDurable
# 校验：schtasks /Query /TN EngineDurable /V /FO LIST（"要运行的任务"应指向本目录脚本）
param(
  [string]$PythonExe = "D:\Python312\python.exe",
  [string]$TaskName = "EngineDurable"
)

$ErrorActionPreference = "Stop"
$ScriptPath = Join-Path $PSScriptRoot "engine_task.py"
if (-not (Test-Path $ScriptPath)) {
  Write-Error "engine_task.py not found next to this script: $ScriptPath"
  exit 1
}
if (-not (Test-Path $PythonExe)) {
  Write-Error "python.exe not found: $PythonExe"
  exit 1
}

# schtasks /TR 限 261 字符且不认 UNC 带空格：路径含空格时用引号包裹
$Action = "`"$PythonExe`" `"$ScriptPath`""
$Existing = schtasks /Query /TN $TaskName 2>$null
if ($LASTEXITCODE -eq 0) {
  schtasks /Delete /TN $TaskName /F | Out-Null
  Write-Host "[update] removed existing task $TaskName"
}
schtasks /Create /TN $TaskName /SC ONCE /ST 23:59 /F /TR $Action | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Error "schtasks /Create failed (exit $LASTEXITCODE)"
  exit 1
}
Write-Host "[ok] $TaskName -> $Action"
Write-Host "[hint] start engine:  schtasks /Run /TN $TaskName"
Write-Host "[hint] verify:        schtasks /Query /TN $TaskName /V /FO LIST"
