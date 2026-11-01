# lmstudio-watchdog.ps1 — LM Studio LAN 服务看门狗(计划任务 LMStudio-Watchdog 每5分钟)
# 四查四救(1007 立,docs/comfyui-kb/LMStudio-Windows远程排查-1007.md):
#   ① 服务死 → 重拉计划任务 LMStudio-LAN-Server
#   ② 模型卸载(TTL 1h 闲置自动卸) → 调优重装 9B(gpu max / parallel 1 / ctx 32768)
#   ③ 程序级 Block 防火墙规则(授权框被取消自动生成,压过端口放行=假死真凶) → 禁用
#   ④ 重复实例(:2 并存,lms load 对已装载模型不替换只叠加,8G 卡挤显存) → unload 去重
# 日志: %USERPROFILE%\.lmstudio\watchdog.log(>100KB 自清)
#
# 1101 档位感知补丁(2026-11-01,1101 自动化改版;部署件经
# apps/build/scripts/win/line-mode-actor-deploy.py 覆盖,原件备份 .bak-<date>):
# 救②补装 9B 前先读 C:\Users\ZBJ\.win-line-mode.json,mode+state 连判(评审#4/#6):
#   mode=video(任何 state)  → 跳过补装(H3 专属显存)
#   mode=image 且 state∈{active,'',legacy} → 照常补装(档位本职;''=旧手动
#     schema 无 state 字段,信任 mode,与引擎侧 legacy 兼容读同语义)
#   mode=image 且 state∈{switching,degraded,failed,none} → 跳过+日志
#     (切换器序列进行中/自愈中——此刻补装会绕过队列守卫在 H3 在途时抢显存,
#      且与切换器经 actor 的 load9b 并发,产生 :2 重复实例双占显存)
#   解析失败/文件损坏/mode 字段缺失 → 保守跳过+告警(无自动回退)
#   文件不存在=未部署/初始态 → 原生补装照旧
# 其余三救(①③④)恒活不动——video 档仅停补装 9B 一救。
$ErrorActionPreference = 'SilentlyContinue'
$log = "$env:USERPROFILE\.lmstudio\watchdog.log"
if ((Get-Item $log -ErrorAction SilentlyContinue).Length -gt 100KB) { Remove-Item $log }
function Log($m) { Add-Content -Path $log -Value ("{0} {1}" -f (Get-Date -Format 'MM-dd HH:mm'), $m) }

# ① 服务在吗(本机 127.0.0.1 探活,不穿防火墙)
$alive = $false
try { $alive = (Invoke-WebRequest -Uri 'http://127.0.0.1:1234/lmstudio-greeting' -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200 } catch {}
if (-not $alive) {
  Log "greeting 不通 → 重拉 LMStudio-LAN-Server"
  schtasks /Run /TN "LMStudio-LAN-Server" | Out-Null
  Start-Sleep -Seconds 20
  try { $alive = (Invoke-WebRequest -Uri 'http://127.0.0.1:1234/lmstudio-greeting' -UseBasicParsing -TimeoutSec 5).StatusCode -eq 200 } catch {}
  if ($alive) { Log "重拉 20s 后恢复" } else { Log "重拉后仍不通(下轮再试)" }
}

# ② 模型在位吗(仅当完全无模型装载时补装;有模型在用=不抢显存)
$loaded = $false
$dupes = @()
if ($alive) {
  try {
    $j = Invoke-RestMethod -Uri 'http://127.0.0.1:1234/api/v0/models' -TimeoutSec 5
    $loaded = [bool]($j.data | Where-Object { $_.state -eq 'loaded' -and $_.id -notlike '*:2' })
    $dupes = @($j.data | Where-Object { $_.id -like '*:2' -and $_.state -eq 'loaded' })
  } catch {}
  if (-not $loaded -and $dupes.Count -eq 0) {
    # ── 1101 档位感知(mode+state 连判):不抢 H3 显存、不与切换器打架 ──
    $skipRefill = $false
    $modeFile = 'C:\Users\ZBJ\.win-line-mode.json'
    if (Test-Path $modeFile) {
      try {
        $modeObj = Get-Content $modeFile -Raw -Encoding UTF8 | ConvertFrom-Json
        $modeVal = [string]$modeObj.mode
        $stateVal = [string]$modeObj.state
        if ($modeVal -eq 'video') {
          Log "档位=video → 跳过补装 9B(line_mode_server 档位感知)"
          $skipRefill = $true
        } elseif ($modeVal -eq 'image') {
          if ($stateVal -in @('active', '', 'legacy')) {
            # image 档已到位(或旧 schema 信任 mode):照常补装(档位本职)
          } else {
            Log "档位=image 但 state=$stateVal(切换器治理中)→ 跳过补装防抢显存/防并发叠加"
            $skipRefill = $true
          }
        } else {
          Log "档位字段缺失/异常('$modeVal')→ 保守跳过补装+告警(无自动回退)"
          $skipRefill = $true
        }
      } catch {
        Log "档位文件损坏/解析失败 → 保守跳过补装+告警(无自动回退)"
        $skipRefill = $true
      }
    }
    if (-not $skipRefill) {
      Log "无模型装载 → 调优装载 9B"
      & "$env:USERPROFILE\.lmstudio\bin\lms.exe" load --gpu max --parallel 1 -c 32768 -y qwen3.5-9b-uncensored-hauhaucs-aggressive | Out-Null
    }
  }
}

# ④ 重复实例去重(:2 并存挤显存,1007 实录)
foreach ($d in $dupes) {
  Log "重复实例 $($d.id) → lms unload 去重"
  & "$env:USERPROFILE\.lmstudio\bin\lms.exe" unload $d.id | Out-Null
}

# ③ 程序级 Block 规则冒头了吗
$blocks = Get-NetFirewallRule -DisplayName 'LM Studio' | Where-Object { $_.Action -eq 'Block' -and $_.Enabled -eq 'True' }
if ($blocks) {
  Log "发现 $(($blocks | Measure-Object).Count) 条启用中的 LM Studio Block 规则 → 禁用"
  $blocks | Disable-NetFirewallRule
}
