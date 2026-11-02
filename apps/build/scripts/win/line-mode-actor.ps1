# line-mode-actor.ps1 - Line-mode actor executor (deployed to
# C:\Users\ZBJ\.lmstudio\, run by scheduled task MY-LineMode-actor as
# ZBJ with S4U logon type, per D3 decision 2026-11-01).
#
# Protocol (attempt_id handshake with engine-side line_mode_server.py):
#   1. Read C:\Users\ZBJ\.lmstudio\line-mode-action.json (absent -> exit).
#   2. Immediately write line-mode-result.json {attempt_id,status:'running'}
#      placeholder (tmp + Move-Item -Force atomic).
#   3. Dispatch action. READ + WHITELIST ONLY, all argv are fixed arrays:
#        lms_ps            -> lms ps --json            (read-only)
#        lms_status        -> lms status               (read-only)
#        schtasks_query    -> schtasks /Query /TN <task> /FO CSV /NH
#        watchdog          -> RETIRED 2026-11-02: LMStudio-Watchdog task was
#                             deleted; LM Studio is started on demand by
#                             my_qi21_api_pe._ensure_lm_service. Returns a
#                             done receipt (supersedes 1101 D4a).
#        load9b            -> lms load --gpu max --parallel 1 -c 32768 -y
#                             qwen3.5-9b-uncensored-hauhaucs-aggressive
#                             (idempotent: lms ps probe first, skip if loaded)
#        unload <id>       -> lms unload <id>  (id regex-validated, array argv,
#                             no string concat, no shell)
#   4. Every command runs under a hard budget (Start-Job + Wait-Job -Timeout:
#      lms_ps/status/query/watchdog 30s, unload 120s, load9b 300s) — a hung
#      lms call can no longer wedge the actor forever and block the task
#      (review#7; the scheduled task is also registered MultipleInstances
#      Parallel by the deploy script as a second net).
#   5. Write result {attempt_id,status:'done'|'error',stdout summary,exit_code}.
#   6. UTF-8 log at %USERPROFILE%\.lmstudio\actor.log.
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

$LmsDir = Join-Path $env:USERPROFILE '.lmstudio'
$LmsExe  = Join-Path $LmsDir 'bin\lms.exe'
$ActionPath = Join-Path $LmsDir 'line-mode-action.json'
$ResultPath = Join-Path $LmsDir 'line-mode-result.json'
$LogPath    = Join-Path $LmsDir 'actor.log'
$NineB = 'qwen3.5-9b-uncensored-hauhaucs-aggressive'

function Log($m) {
  try {
    Add-Content -Path $LogPath -Encoding UTF8 -Value ("{0} {1}" -f (Get-Date -Format 'MM-dd HH:mm:ss'), $m)
  } catch {}
}

function Write-Result($obj) {
  # Atomic: tmp + Move-Item -Force (readers never see a half file).
  $tmp = "$ResultPath.tmp"
  $obj | ConvertTo-Json -Compress -Depth 4 | Out-File -FilePath $tmp -Encoding utf8
  Move-Item -Force -Path $tmp -Destination $ResultPath
}

try {
  if (-not (Test-Path $ActionPath)) { exit 0 }
  $action = Get-Content $ActionPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $attemptId = [string]$action.attempt_id
  $name = [string]$action.action
  if (-not $attemptId) { Log 'action file missing attempt_id, ignore'; exit 0 }

  # Placeholder first: engine polls attempt_id + status.
  Write-Result @{ attempt_id = $attemptId; status = 'running' }

  $stdout = ''
  $exitCode = 0
  $argv = @()
  # Hard per-action budget (review#7): a hung lms call gets Stop-Job'd at the
  # budget instead of wedging the actor forever (which, with a single-instance
  # task policy, would silently swallow every later /Run).
  $budget = 30
  switch ($name) {
    'lms_ps'     { $argv = @($LmsExe, 'ps', '--json') }
    'lms_status' { $argv = @($LmsExe, 'status') }
    'watchdog' {
      # 1102 retired: LMStudio-Watchdog scheduled task was deleted (LM Studio
      # is now started on demand by my_qi21_api_pe._ensure_lm_service);
      # enabling a nonexistent task would always fail. Soft-retire the action
      # (done receipt) so unknown callers degrade gracefully. Supersedes the
      # 1101 D4a always-enabled ruling.
      Write-Result @{ attempt_id = $attemptId; status = 'done'; exit_code = 0;
                      stdout = 'watchdog retired (1102): LM Studio on-demand via qi21 node' }
      Log "watchdog action retired (1102)"
      exit 0
    }
    'load9b' {
      $budget = 300
      # Idempotent (anti-dupe): probe lms ps first, skip when already loaded.
      $probe = & $LmsExe ps --json 2>$null | Out-String
      $already = $false
      if ($probe.Trim().StartsWith('[')) {
        foreach ($m in @($probe | ConvertFrom-Json)) {
          if ([string]$m.identifier -eq $NineB) { $already = $true }
        }
      }
      if ($already) {
        Write-Result @{ attempt_id = $attemptId; status = 'done'; exit_code = 0;
                        stdout = '9B already loaded (idempotent skip)' }
        Log "load9b skip: $NineB already loaded"
        exit 0
      }
      $argv = @($LmsExe, 'load', '--gpu', 'max', '--parallel', '1', '-c', '32768', '-y', $NineB)
    }
    'unload' {
      $budget = 120
      $id = [string]$action.params.identifier
      if ($id -notmatch '^[A-Za-z0-9._-]+$') {
        Write-Result @{ attempt_id = $attemptId; status = 'error'; exit_code = 87;
                        stdout = "unload rejected: invalid identifier '$id'" }
        Log "unload rejected invalid identifier"
        exit 0
      }
      $argv = @($LmsExe, 'unload', $id)
    }
    'schtasks_query' {
      $task = [string]$action.params.task
      if ($task -notmatch '^[A-Za-z0-9._ -]+$') {
        Write-Result @{ attempt_id = $attemptId; status = 'error'; exit_code = 87;
                        stdout = "query rejected: invalid task '$task'" }
        exit 0
      }
      $argv = @('schtasks', '/Query', '/TN', $task, '/FO', 'CSV', '/NH')
    }
    default {
      Write-Result @{ attempt_id = $attemptId; status = 'error'; exit_code = 87;
                      stdout = "unknown action '$name'" }
      Log "unknown action '$name'"
      exit 0
    }
  }

  # Fixed-array argv invocation under a hard timeout (review#7): no string
  # concat, no shell; Start-Job isolates the call so a hang is stoppable.
  $job = Start-Job -ArgumentList (,$argv) -ScriptBlock {
    param($a)
    $o = & $a[0] $a[1..($a.Count - 1)] 2>&1 | Out-String
    [pscustomobject]@{ out = $o; code = $LASTEXITCODE }
  }
  if (Wait-Job $job -Timeout $budget) {
    $r = @(Receive-Job $job)[0]
    $stdout = [string]$r.out
    $exitCode = [int]$r.code
    # review#10: result file carries the FULL stdout (engine side must be able
    # to json.loads lms ps output, which alone exceeds 2000 chars); the log
    # line keeps only a short diagnostic prefix.
    $diag = $stdout.Substring(0, [Math]::Min(200, $stdout.Length))
    if ($exitCode -ne 0) {
      Write-Result @{ attempt_id = $attemptId; status = 'error'; exit_code = $exitCode;
                      stdout = $stdout; stdout_diag = $diag }
      Log "$name failed exit=$exitCode diag=$diag"
    } else {
      Write-Result @{ attempt_id = $attemptId; status = 'done'; exit_code = 0;
                      stdout = $stdout; stdout_diag = $diag }
      Log "$name ok"
    }
  } else {
    Stop-Job $job -Force
    Write-Result @{ attempt_id = $attemptId; status = 'error'; exit_code = 124;
                    stdout = "actor timeout: $name exceeded ${budget}s (job force-stopped)" }
    Log "$name TIMEOUT after ${budget}s (force-stopped)"
  }
  Remove-Job $job -Force -ErrorAction SilentlyContinue
} catch {
  try {
    Write-Result @{ attempt_id = "$attemptId"; status = 'error'; exit_code = 1;
                    stdout = ("actor exception: " + $_.Exception.Message) }
  } catch {}
  Log "actor exception: $($_.Exception.Message)"
}
