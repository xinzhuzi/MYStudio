#!/bin/bash
# ============================================================
# lmstudio-win-remote.sh — Mac 指挥 Windows(192.168.0.101)上的 LM Studio
#
# 用法:
#   lmstudio-win-remote.sh status              # 查服务与模型装载状态
#   lmstudio-win-remote.sh chat "你好" [vl4b|9b|27b] [off]   # 第3参 off=硬关思考;直接用 URL 对 Windows 模型发话(未装载则 JIT 自动装载)
#   lmstudio-win-remote.sh load                # 装载默认模型 qwen3-vl-4b(1007 用户令转正;JIT 法,本版无 /models/load 端点)
#   lmstudio-win-remote.sh load 27b            # 装载 27B(18.74GB,4060Ti 8G 部分offload,较慢)
#   lmstudio-win-remote.sh unload              # 卸载当前模型(REST 不支持时走 ssh lms unload)
#   lmstudio-win-remote.sh start               # 服务没起时经 SSH 计划任务拉起(常用于 Windows 重启后)
#   lmstudio-win-remote.sh doctor              # 全链路体检(网段/ping/端口/REST + 三层卡点自检)
#
# 环境变量:
#   LMS_WIN_HOST   默认 192.168.0.101
#   LMS_WIN_PORT   默认 1234
#   LMS_WIN_USER   默认 zbj(免密 SSH 已配)
#
# 漫影管线接法(qi21 [4013] MyQi21ApiPE 的 api_url 槽):
#   本机模型 = http://127.0.0.1:1234
#   Windows  = http://192.168.0.101:1234   ← 把 api_url 换成这个即用 Windows 算力
#
# ---------- 2026-10-06 打通时排掉的三层卡点 + 1007 第四卡(复发时按此查) ----------
# 1) LM Studio 服务器默认只绑 127.0.0.1 → 官方路子 `lms server start --bind 0.0.0.0`
#    (手改 http-server-config.json 会被守护进程覆写回,勿走此路)
# 2) lms 守护进程跟着 SSH 会话死,SSH 里 start 的服务会话一断就没了
#    → 已建 Windows 计划任务 LMStudio-LAN-Server(登入自启,可随时 schtasks /Run)
# 3) Windows 防火墙 + WLAN 画像 Public 拦 1234 入站
#    → 已加规则 LMStudio-LAN-1234(仅放行 192.168.0.0/24)+ 画像改 Private
#    (Windows 换 WiFi/重配网络后画像可能弹回 Public,doctor 会点名)
# 4) LM Studio 程序级 Block 防火墙规则(授权弹窗被取消时 Windows 自动生成)
#    压过端口级放行(Block>Allow)→ 外部 1234 超时"假死"(服务其实活着,1007 定谳)
#    → doctor 已点名;Windows 看门狗计划任务 LMStudio-Watchdog(每 5 分钟)自动禁用
#      +自愈服务/装载;详见 docs/comfyui-kb/LMStudio-Windows远程排查.md
# 备份: http-server-config.json 原件 = 同名+.bak-lan-1006
#
# 模型档案(Windows 侧, lms ls 实查 1006/1007):
#   vl4b(默认常驻,1007 用户令) = qwen/qwen3-vl-4b  3.33GB 全显存,带眼看图,OCR 最快最准(5s/张),批量转录首选
#   9b  = qwen3.5-9b-uncensored-hauhaucs-aggressive       6.55GB Q4_K_M(4060Ti 全进显存,~32 tok/s;qi21 AI扩写文本主力,需文本算力时 load 9b)
#   27b = qwen3.8-27b-uncensored-hauhaucs-aggressive-mtp  18.74GB(部分offload)
#   视觉三件(1007 实弹入册,发图走 content 数组 image_url/base64,与 OpenAI 同构):
#   vl4b  = qwen/qwen3-vl-4b                3.33GB 全显存,OCR 最快最准(5s/张,中文逐字满分),批量转录首选
#   vl30b = qwen3-vl-30b-a3b-instruct      19.64GB(主件+mmproj,~7.7G显存+余进内存),版面/表格理解最强,
#           但 3-5 tok/s 慢且偶有字级误读(墨→黑),疑难终审用;装载 lms load --gpu max -c 32768 -y qwen3-vl-30b-a3b-instruct
#   9b 本身带 mmproj 即原生看图(1007 平反实测:中文 OCR 近满分)——轻判定直接用 9b 不必换件
#   坑: aggressive 思考型 finetune,enable_thinking=false 与 /no_think 均被无视,
#       completion 全额先烧思考链 → max_tokens 必须给足(本脚本默认 4096,~32 tok/s 下最长约 2 分钟)
#   坑: JIT 退路装载=默认 ctx 8192 → qi21 提示词结构性饿死(正文 0 字),勿依赖;大窗走 load 子命令
# ============================================================
set -uo pipefail

HOST="${LMS_WIN_HOST:-192.168.0.101}"
PORT="${LMS_WIN_PORT:-1234}"
USER_="${LMS_WIN_USER:-zbj}"
BASE="http://${HOST}:${PORT}"
MODEL_VL4B="qwen/qwen3-vl-4b"
MODEL_9B="qwen3.5-9b-uncensored-hauhaucs-aggressive"
MODEL_27B="qwen3.8-27b-uncensored-hauhaucs-aggressive-mtp"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=8)

# Mac 侧 Clash 若设了 http_proxy 环境变量会截流局域网请求,恒绕过
CURL=(curl --noproxy '*' -sS -m 30)

die() { echo "❌ $*" >&2; exit 1; }
say() { echo "[$(date +%H:%M:%S)] $*"; }

pick_model() {  # $1=vl4b(默认,1007 用户令)|9b|27b|完整模型键
  case "${1:-vl4b}" in
    vl4b) echo "$MODEL_VL4B" ;;
    9b)  echo "$MODEL_9B" ;;
    27b) echo "$MODEL_27B" ;;
    *)   echo "$1" ;;
  esac
}

rest_up() { "${CURL[@]}" -m 6 "$BASE/lmstudio-greeting" 2>/dev/null | grep -q lmstudio; }

cmd_status() {
  rest_up || die "REST 不通($BASE)。先跑: $0 start  或  $0 doctor"
  "${CURL[@]}" "$BASE/api/v0/models" | python3 -c "
import json,sys
for m in json.load(sys.stdin)['data']:
    print(f\"{m['id']:<52} {m['state']:<11} max_ctx={m.get('max_context_length')} loaded_ctx={m.get('loaded_context_length')}\")"
}

cmd_start() {
  rest_up && { say "服务已在跑: $BASE"; return 0; }
  say "REST 不通,经 SSH 触发计划任务 LMStudio-LAN-Server ..."
  ssh "${SSH_OPTS[@]}" "$USER_@$HOST" 'schtasks /Run /TN "LMStudio-LAN-Server"' >/dev/null 2>&1 \
    || die "SSH 触发失败(机器没开/不在同网段?)"
  for i in $(seq 1 15); do
    sleep 2
    rest_up && { say "✅ 服务已起: $BASE"; return 0; }
  done
  die "30 秒内服务未就绪,登 Windows 看: schtasks /Query /TN LMStudio-LAN-Server /V"
}

cmd_load() {
  local model; model="$(pick_model "${1:-}")"
  rest_up || cmd_start
  # 首选 SSH 调优装载(--gpu max --parallel 1,实测 32→44 tok/s;JIT 默认=parallel4切KV+卸载不拉满)
  # -c 32768 大窗必带:qi21 新提示词 4001tok 输入+aggressive 思考链(关不掉)须 ~5k 生成位,
  #   8192 默认窗=生成位被压到 4.2k 全烧思考→正文 0 字(1006 实测结构性饿死);
  #   32k 窗同弹 125s 正文 989 字,decode 仅 42.5→39.5 tok/s(8k/24k prompt 档)
  # 27B 装载显存装不下全 offload,仍用 --gpu max 让它自己分配
  if ssh "${SSH_OPTS[@]}" "$USER_@$HOST" "lms load --gpu max --parallel 1 -c 32768 -y $model" >/dev/null 2>&1; then
    say "已发调优装载(gpu max / parallel 1 / ctx 32768): $model"
  else
    say "SSH 不可用,退 JIT 装载 $model(配置为默认,速度略低)..."
    "${CURL[@]}" -m 600 -X POST "$BASE/v1/chat/completions" \
      -H 'Content-Type: application/json' \
      -d "{\"model\": \"$model\", \"messages\": [{\"role\": \"user\", \"content\": \"hi\"}], \"max_tokens\": 1}" >/dev/null
  fi
  for i in $(seq 1 45); do
    local state; state="$("${CURL[@]}" "$BASE/api/v0/models" 2>/dev/null | python3 -c "
import json,sys
try: print(next(m['state'] for m in json.load(sys.stdin)['data'] if m['id']=='$model'))
except Exception: print('unknown')")"
    [ "$state" = "loaded" ] && { say "✅ $model 已装载"; return 0; }
    sleep 2
  done
  die "90 秒内未确认装载(27B 较慢可再等后跑 $0 status)"
}

cmd_unload() {
  local model; model="$(pick_model "${1:-}")"
  rest_up || die "REST 不通,无从卸载"
  # 本版 LM Studio 无 /models/unload 端点,REST 试完走 SSH 的 lms CLI
  "${CURL[@]}" -X POST "$BASE/api/v0/models/unload" -H 'Content-Type: application/json' \
    -d "{\"model\": \"$model\"}" 2>/dev/null | grep -q '"error"' \
    && say "REST 不支持 unload,转 SSH: lms unload" \
    && ssh "${SSH_OPTS[@]}" "$USER_@$HOST" "lms unload $model"
  say "卸载指令已发,状态确认: $0 status"
}

cmd_chat() {
  local msg="${1:?用法: $0 chat \"消息\" [9b|27b] [off]}"; shift || true
  local model; model="$(pick_model "${1:-9b}")"
  shift || true
  local effort="${1:-}"
  rest_up || cmd_start
  say "→ $model @ $BASE${effort:+ (思考档:$effort)}"
  # 1007:off=顶层 reasoning_effort=none 硬关思考(实弹小问句 124s/1803思考tok→1s/0);
  # chat_template_kwargs 被 LM Studio 层丢弃、「低」档无衰减,均勿用
  local payload; payload="$(python3 -c 'import json,sys
d = {"model": sys.argv[1],
     "messages": [{"role": "user", "content": sys.argv[2]}],
     "max_tokens": 4096, "temperature": 0.7}
if len(sys.argv) > 3 and sys.argv[3] == "off":
    d["reasoning_effort"] = "none"
print(json.dumps(d))' "$model" "$msg" "$effort")"
  "${CURL[@]}" -m 600 -X POST "$BASE/v1/chat/completions" \
    -H 'Content-Type: application/json' -d "$payload" \
    | python3 -c "
import json,sys
d = json.load(sys.stdin)
m = d['choices'][0]['message']
print(m.get('content') or '(content 空——思考链没想完:此finetune思考关不掉(软开关/参数均被无视),只能加大max_tokens等它想完)')
u = d.get('usage', {})
print(f\"--- tokens: {u.get('completion_tokens', '?')} (思考 {u.get('completion_tokens_details', {}).get('reasoning_tokens', 0)}) ---\")"
}

cmd_doctor() {
  echo "=== Mac 侧 ==="
  local my_ip; my_ip="$(ifconfig 2>/dev/null | awk '/inet /{print $2}' | grep "^${HOST%.*}." | head -1)"
  [ -n "$my_ip" ] && say "✅ 同网段($my_ip)" || say "⚠️ 本机无 ${HOST%.*}.x 地址(不在 TP-LINK WiFi?跨网段时探测不可信)"
  ping -c 1 -t 3 "$HOST" >/dev/null 2>&1 && say "✅ ping 通" || die "ping 不通(Windows 没开?)"
  if rest_up; then say "✅ REST 通: $BASE"
  else
    say "❌ REST 不通(端口被拦/服务没起)。Windows 侧按四层卡点排查:"
    say "   1) 服务起没起:   ssh $USER_@$HOST 'schtasks /Run /TN \"LMStudio-LAN-Server\"'"
    say "   2) 绑定对不对:   ssh $USER_@$HOST 'netstat -ano | findstr :$PORT'  (须 0.0.0.0:$PORT)"
    say "   3) 画像弹回 Public: ssh $USER_@$HOST 'powershell Get-NetConnectionProfile'(须 Private)"
  fi
  # 卡点4(1007):程序级 Block 压端口级 Allow=假死真凶;ping/SSH通+1234超时+本机自测通=指纹
  local fw; fw="$(ssh "${SSH_OPTS[@]}" "$USER_@$HOST" "powershell -NoProfile -Command \"Get-NetFirewallApplicationFilter | Where-Object Program -like '*LM*Studio*' | Get-NetFirewallRule | Format-Table DisplayName,Action,Enabled,Direction,Profile -AutoSize | Out-String\"" 2>/dev/null)"
  if printf '%s' "$fw" | grep -Eq "Block +True"; then
    say "❌ 有启用中的 LM Studio 程序级 Block 规则(Block>Allow 压端口放行=1007 假死真凶)"
    say "   修复: Get-NetFirewallRule -DisplayName 'LM Studio' | Where-Object Action -eq 'Block' | Disable-NetFirewallRule"
    say "   (看门狗 LMStudio-Watchdog 每 5 分钟也会自动禁)"
  else
    say "✅ 无启用中的程序级 Block 规则(卡点4)"
  fi
  echo "=== Windows 模型 ==="
  rest_up && cmd_status
}

case "${1:-doctor}" in
  status)  cmd_status ;;
  load)    shift; cmd_load "$@" ;;
  unload)  shift; cmd_unload "$@" ;;
  chat)    shift; cmd_chat "$@" ;;
  start)   cmd_start ;;
  doctor)  cmd_doctor ;;
  *)       grep '^#' "$0" | sed -n '3,30p'; exit 1 ;;
esac
