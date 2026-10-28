# win_nightbatch_guard_1028.ps1 -- 夜批发车前置守护(D8 裁定三段:探活 -> 自拉 -> 报警禁发)
#
# 依据:.trellis/tasks/10-28-windows-mystudio-q21-mainline/design.md §2.3/§2.4、
#       prd.md §三 D8 / §五 W9、research/phase2-3-receipt-1028.md(S7/S12)、
#       research/final-sweep-1028.md(判静勘误 §一.5末/§四.1/§四.4;回滚通道不存在 §一.5末)。
#
# 三段(design §2.3;两处笔误按代码事实修正,见下):
#   ①probe   GET http://127.0.0.1:17595/health(超时 $ProbeTimeoutSec;免鉴权——真身路由是
#            /health 不是 /healthz,apps/backend/image_gen/server.py:214-223,design 文本的
#            /healthz 系文档笔误,实现以代码为准)。通=守护过(exit 0),附记引擎 17000 状态。
#   ②recover ①不通 -> 拉起 manying-studio.exe(进程名=manying-studio,非 anying——design 文本
#            的 anying-studio.exe 系 findstr 子串笔误,phase0 探子 A1 钉死真名);进程已在驾则
#            不重复拉(幂等)。然后轮询 17595(/health)+17000(/system_stats),上限 $TimeoutSec
#            (缺省 5min)。引擎由首个 execute 请求按需拉起(prd §二.20:image_gen/pipeline.py:278
#            / comfyui/execute.py:299 调 ensure_engine_ready),故引擎未就绪不单独判死。
#   ③abort   侧车仍不通 -> 写日志 + exit 2 禁发。夜批发车脚本必须以本脚本 exit 0 为发车前置。
#   ④判静门  可选(-RequireQueueIdle,并行基准役实弹期必加):前三段全过后、exit 0 前,持续
#            采样引擎 GET /queue,要求 queue_running+queue_pending 全空贯穿观察窗(缺省
#            900s=15min,-QuietWindowSec 可调);任一样本非空或 /queue 不可达 -> exit 2 禁发。
#            依据=复核证伪第一条(final-sweep-1028.md §四.4):单点 output 快照判「引擎 idle」
#            不成立,判静须含 /queue 现查+持续观察窗,禁凭单点;判静语义与 repo 同款
#            (apps/backend/engines/image_engine/engine_health.py:94-101:running+pending 均空才算空,
#            探不到=证不了静按不空处置 fail-closed)。蕴含引擎 17000 须可达;仅覆盖引擎侧信号——
#            完整判静还须 Mac 侧 vram-4x.csv 停增+output 停更(README §三),发车人 Mac 侧观察,
#            本脚本不代劳。
#
# 用法(夜批发车脚本前置调用;Windows PowerShell 5.1 兼容;本文件须存 UTF-8 带 BOM——
#       1028 Windows 首跑实证:无 BOM 时 5.1 按 ANSI/GBK 读件,中文注释错读炸出 :101/:120
#       意外"}"解析错 exit 1;加 BOM 后同内容解析零错。代码字符串仍全 ASCII):
#   powershell -NoProfile -ExecutionPolicy Bypass -File win_nightbatch_guard_1028.ps1
#   引擎直投轨(发车直打 17000 /prompt,不经 execute 链,如 FastH3 批产)加 -RequireEngine:
#   引擎未就绪也判 abort 禁发(execute 轨则不需要——首笔请求会按需拉引擎)。
#   并行基准役(fasth3-upscale-shootout-1028)实弹期发车前置加 -RequireQueueIdle(④判静门,
#   README §三):/queue 非静即禁发,防排队插入污染其逐秒 VRAM 计时。
#
# 参数(均有缺省,通常裸跑即可):
#   -AppExe            App 主程序(缺省=$env:LOCALAPPDATA\Programs\manying-studio\manying-studio.exe,
#                      NSIS 默认位,phase0 A1/A2 实证)
#   -LogFile           日志(缺省=E:\IP\tmp\logs\win_nightbatch_guard_1028.log,追加写)
#   -ProbeTimeoutSec   单次探活超时(缺省 5s;curl -m)
#   -TimeoutSec        ②轮询上限(缺省 300s=5min,design §2.3)
#   -PollIntervalSec   轮询间隔(缺省 10s;④判静门采样同用此间隔)
#   -RequireEngine     引擎 17000 也作硬门(缺省关:侧车通即过,引擎按需拉起)
#   -RequireQueueIdle  ④判静门(缺省关):引擎 /queue 全空(running+pending)贯穿观察窗才放行;
#                      并行基准役实弹期必加(判静不过禁发,任务纪律)
#   -QuietWindowSec    ④判静观察窗(缺省 900s=15min;任务纪律:观察窗>=15min,禁凭单点)
#
# 退出码:0=守护过,可发车;2=abort 禁发(侧车不通,或 -RequireEngine 下引擎不通,
#        或 -RequireQueueIdle 下 /queue 非静/不可达);
#        3=本地配置错禁发(App exe 不存在/拉起失败)。日志行同时落 Write-Host 与 -LogFile。
#
# 回滚通道(引擎管辖权,design §2.1/§2.6:EngineDurable 禁用留档=极端回滚通道,恒不删定义):
#   schtasks /Change /TN EngineDurable /ENABLE
#   schtasks /Run /TN EngineDurable
#   (启用+重跑任务=引擎回到计划任务旧管辖,17000 由其拉起,本守护段照常工作。)
#   数据/种子面(daojie-data/json 真源/四指路件,final-sweep-1028.md §一.5末)如实标注:
#   无回滚通道——W8 播种链全链零备份,旧档已覆写销毁,Windows 侧无法回退到播种前,
#   Mac 正向重刷为唯一路。勿设想任何 Windows 侧回退手段。
#
# 已知边界(1028 实测,research/phase2-3-receipt-1028.md §二 S7;如实,非脚本缺陷):
#   App 启动本身不拉侧车(侧车 spawn 仅由渲染层动作触发,image-generation-engine.ts:153-176
#   生成前自愈/设置页「准备运行时」),且 App 家共享 Python 3.12 尚未配置(Phase 1b 人工步)
#   ——冷启场景侧车大概率 5min 内不就绪,本脚本将走 ③abort 禁发。禁发优于白等一夜(D8
#   否决裸探活门的同一逻辑);Phase 1b 完成后侧车随渲染层动作在驾,守护即可放行。

param(
  [string]$AppExe = "$env:LOCALAPPDATA\Programs\manying-studio\manying-studio.exe",
  [string]$LogFile = "E:\IP\tmp\logs\win_nightbatch_guard_1028.log",
  [int]$ProbeTimeoutSec = 5,
  [int]$TimeoutSec = 300,
  [int]$PollIntervalSec = 10,
  [switch]$RequireEngine,
  [switch]$RequireQueueIdle,
  [int]$QuietWindowSec = 900
)

$ErrorActionPreference = "Stop"

$SidecarUrl = "http://127.0.0.1:17595/health"
$EngineUrl = "http://127.0.0.1:17000/system_stats"
$QueueUrl = "http://127.0.0.1:17000/queue"

# 日志:时间戳行,Write-Host + 追加落档;落档失败不阻断守护判定(如实降级只打屏)。
function Write-Log([string]$Level, [string]$Message) {
  $line = "{0} [{1}] {2}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Level, $Message
  Write-Host $line
  try {
    $logDir = Split-Path -Parent $LogFile
    if ($logDir -and -not (Test-Path $logDir)) {
      New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    }
    Add-Content -Path $LogFile -Value $line -Encoding ASCII
  } catch {
    Write-Host ("[WARN] cannot write log file ({0}): {1}" -f $LogFile, $_.Exception.Message)
  }
}

# 探活:curl.exe(-s 静默含错误,-f HTTP 4xx/5x 判败,-m 超时;-o NUL 丢弃响应体)。
# 注意必须写 curl.exe——PowerShell 5.1 里裸 curl 是 Invoke-WebRequest 的别名。
function Test-HttpOk([string]$Url) {
  curl.exe -s -f -m $ProbeTimeoutSec -o NUL $Url
  return ($LASTEXITCODE -eq 0)
}

# ④判静门单采样:GET /queue,queue_running+queue_pending 均空=True(Where-Object 滤 null 防
# PS5.1 空数组/缺字段变 $null 时 @($null).Count=1 的坑)。探不到/解析失败=False——证不了静
# 按不静处置(fail-closed),语义与 repo 同款 engine_health.py:94-101 一致。
function Test-QueueIdle {
  $raw = curl.exe -s -m $ProbeTimeoutSec $QueueUrl
  if ($LASTEXITCODE -ne 0) { return $false }
  if (-not $raw) { return $false }
  try {
    $q = ConvertFrom-Json ($raw -join "")
  } catch {
    return $false
  }
  $running = @($q.queue_running | Where-Object { $null -ne $_ }).Count
  $pending = @($q.queue_pending | Where-Object { $null -ne $_ }).Count
  if ($running -ne 0 -or $pending -ne 0) {
    Write-Log "WARN" ("queue-idle sample: NOT idle (queue_running={0}, queue_pending={1})" -f $running, $pending)
    return $false
  }
  return $true
}

# ④判静门(-RequireQueueIdle 开时生效):观察窗 $QuietWindowSec 内每 $PollIntervalSec 采样一次,
# 任一样本非静(含 /queue 不可达)即 exit 2 禁发——单点判静已被复核证伪(final-sweep-1028.md
# §四.4),须持续观察窗;并行基准役在跑时排队插入会污染其逐秒计时,禁发优于白等一夜(D8 同逻辑)。
function Invoke-QueueIdleGate {
  if (-not $RequireQueueIdle) { return }
  Write-Log "INFO" ("queue-idle gate: sampling {0} every {1}s for {2}s (single-point quiet check disproven, final-sweep-1028.md 4.4)" -f $QueueUrl, $PollIntervalSec, $QuietWindowSec)
  $deadline = (Get-Date).AddSeconds($QuietWindowSec)
  $samples = 0
  while ($true) {
    if (-not (Test-QueueIdle)) {
      Write-Log "ERROR" "abort: engine /queue not idle (or unreachable) -- parallel campaign may be live, DO NOT DISPATCH (insert would pollute its per-second timing)"
      exit 2
    }
    $samples++
    if ((Get-Date) -ge $deadline) { break }
    Start-Sleep -Seconds $PollIntervalSec
  }
  Write-Log "INFO" ("queue-idle gate PASS: {0} samples over {1}s window all idle" -f $samples, $QuietWindowSec)
}

Write-Log "INFO" ("guard start: sidecar={0} engine={1} requireEngine={2} timeout={3}s" -f $SidecarUrl, $EngineUrl, $RequireEngine, $TimeoutSec)

# ---------------- ① probe ----------------
$sidecarUp = Test-HttpOk $SidecarUrl
$engineUp = Test-HttpOk $EngineUrl

if ($sidecarUp -and ($engineUp -or (-not $RequireEngine))) {
  if ($engineUp) {
    Write-Log "INFO" "guard PASS (probe): sidecar healthy + engine ready"
  } else {
    Write-Log "WARN" "guard PASS (probe): sidecar healthy, engine not up -- execute chain pulls it on first request (prd fact 20)"
  }
  Invoke-QueueIdleGate
  exit 0
}

if ($sidecarUp) {
  # 侧车在驾但 -RequireEngine 且引擎不在:侧车由 App 拉起,App 必已在驾,无需再拉;
  # 直接进轮询窗等引擎(等 EngineDurable 调度/在驾引擎自愈等任何来源)。
  Write-Log "WARN" "probe: sidecar healthy but engine required and not up -> poll for engine only"
} else {
  Write-Log "WARN" "probe: sidecar unreachable -> recover"
}

# ---------------- ② recover ----------------
if (-not $sidecarUp) {
  $appProc = Get-Process -Name "manying-studio" -ErrorAction SilentlyContinue
  if ($null -eq $appProc) {
    if (-not (Test-Path $AppExe)) {
      Write-Log "ERROR" ("abort(config): app exe not found: {0}" -f $AppExe)
      exit 3
    }
    Write-Log "INFO" ("recover: starting app: {0}" -f $AppExe)
    try {
      Start-Process -FilePath $AppExe -WorkingDirectory (Split-Path -Parent $AppExe)
    } catch {
      Write-Log "ERROR" ("abort(config): failed to start app: {0}" -f $_.Exception.Message)
      exit 3
    }
  } else {
    # 幂等:已在驾不重复拉。对「在驾但侧车缺席」不强杀重启——S7 实证重启 App 亦不拉侧车。
    $firstPid = ($appProc | Select-Object -First 1).Id
    Write-Log "INFO" ("recover: app already running (first pid {0}), not restarting" -f $firstPid)
  }
}

$deadline = (Get-Date).AddSeconds($TimeoutSec)
while ($true) {
  $sidecarUp = Test-HttpOk $SidecarUrl
  $engineUp = Test-HttpOk $EngineUrl
  if ($sidecarUp -and $engineUp) { break }
  if ((Get-Date) -ge $deadline) { break }
  Start-Sleep -Seconds $PollIntervalSec
}

# ---------------- ③ abort / pass ----------------
if ($sidecarUp -and $engineUp) {
  Write-Log "INFO" "guard PASS (recover): sidecar healthy + engine ready"
  Invoke-QueueIdleGate
  exit 0
}
if ($sidecarUp) {
  if ($RequireEngine) {
    Write-Log "ERROR" ("abort: sidecar ok but engine 17000 not ready within {0}s (-RequireEngine, direct-dispatch track) -- DO NOT DISPATCH" -f $TimeoutSec)
    exit 2
  }
  Write-Log "WARN" "guard PASS (recover): sidecar healthy, engine not up -- execute chain pulls it on first request (design 2.3 note, prd fact 20)"
  Invoke-QueueIdleGate
  exit 0
}
Write-Log "ERROR" ("abort: sidecar 17595 unreachable after {0}s recover window -- DO NOT DISPATCH" -f $TimeoutSec)
exit 2
