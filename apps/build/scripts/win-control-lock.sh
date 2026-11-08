#!/usr/bin/env bash
# ============================================================
# win-control-lock.sh —— 多会话控同一台 Windows 的单写者锁
# (.claude/CLAUDE.md「多会话 Windows 控制协议」配套工具,协议细则见该节)
#
# 用法:
#   win-control-lock.sh status                                   # 锁内容(pretty JSON)+在途概况(python.exe/17000/GPU)
#   win-control-lock.sh check                                    # 锁判断:空闲 exit 0;被他人持有 exit 3(打印持有者)
#   win-control-lock.sh lock --owner ID --purpose TEXT --level L1|L2|L3 [--ttl-min N]
#                                                                # 原子获取:他人持有未过期 exit 3;owner==自己未过期=续期覆盖 exit 0;
#                                                                # 否则写锁 exit 0(过期/损坏锁覆盖并注明前持有者)
#   win-control-lock.sh release --owner ID [--force]             # 仅 owner 匹配可删;--force 强删(打印警告);无文件也算成功
#   无子命令=报用法并 exit 1;子命令必须显式给出(机器契约,不做隐式默认)
#
# 参数(全局,子命令前后均可):
#   --host USER@HOST   SSH 目标;默认读 WIN_SSH_HOST,再默认 zbj@192.168.0.101
#   --path WIN_PATH    Windows 侧锁文件,默认 C:\Users\ZBJ\.win-control.json(文件不存在=FREE)
#   --ttl-min N        lock 有效分钟数,默认 30;0=写入即刻过期(测试/占位即弃用)
#
# 退出码约定(协议级,机器契约——exit code 是契约,输出是人类可读):
#   0 = 成功/锁空闲    3 = 锁被持(check=非空闲含自己持有;lock=他人持有;release=owner 不符)    4 = ssh 不可达
#
# 工艺(为什么这么绕——三层编码坑全避开,同 apps/build/scripts/flux3_daojie_ssh.py:19-27 实证工艺):
#   1) 远端读锁→判断→写/删锁整段作为一个 python 载荷单发 ssh 完成——严禁先 cat 后 echo
#      两步拼(两步之间是竞态窗口);载荷内读→判→写全程再持 <锁>.guard 文件字节锁
#      (Windows=msvcrt.locking/Unix=fcntl.flock)跨 ssh 会话互斥,check-then-act 竞态消除,
#      并发双 lock 恰一人成功;写本身走 temp+os.replace(读者要么见旧锁要么见新锁,永不见半个 JSON)。
#   2) python 载荷与所有含中文/用户输入的字段一律 base64 传输(bash 侧 printf %s | base64
#      组装),规避 GBK codepage / CRLF / 引号转义三类坑;远端用 $env:PYTHONIOENCODING='utf-8'
#      控编码(仓库无 -X utf8 先例,不立新例)。
#   3) 载荷经 ssh stdin 喂给远端 python(-c 只留解码器,PS 命令恒短),整条 PowerShell 命令再
#      base64(UTF-16-LE)走 -EncodedCommand——ssh 命令串零引号嵌套;坑:载荷内联进 -c 会把
#      EncodedCommand 撑到 ~23K 字符,爆 cmd.exe 8191 字符命令行上限(GBK 报「命令行太长。」)。
#      PS 末尾显式 exit 透传 python 退出码(PS -Command 不自动透传 $LASTEXITCODE,这是坑)。
#   4) Mac 侧回读 tr -d '\r' 去 CRLF;ssh rc=255(ssh 自身错,含不可达/超时/认证失败)=exit 4,
#      其余非零 rc=远端 python 业务码原样透传。
# ============================================================
set -euo pipefail

DEST="${WIN_SSH_HOST:-zbj@192.168.0.101}"
LOCK_PATH='C:\Users\ZBJ\.win-control.json'
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=8)

die() { echo "❌ $*" >&2; exit 1; }
say() { echo "[$(date +%H:%M:%S)] $*"; }

b64() { printf '%s' "$1" | base64 | LC_ALL=C tr -d '\n'; }

# 用法块=头部注释第 3 行起、打到收尾「# ====」线(模式截止,防头注释增删后行号漂移)
usage_stdout() { grep '^#' "$0" | sed -n '3,$p' | sed '/^# =/q'; }

# ── ① 参数解析(while+case,同 commit_gate.sh 风格) ────────────────────────
CMD=""
OWNER=""
PURPOSE=""
LEVEL=""
TTL_MIN=""
TTL_EXPLICIT=0
FORCE=0

while [ $# -gt 0 ]; do
  case "$1" in
    status|check|lock|release) CMD="$1"; shift ;;
    --host)    [ $# -ge 2 ] || die "--host 需要参数"; DEST="$2"; shift 2 ;;
    --path)    [ $# -ge 2 ] || die "--path 需要参数"; LOCK_PATH="$2"; shift 2 ;;
    --owner)   [ $# -ge 2 ] || die "--owner 需要参数"; OWNER="$2"; shift 2 ;;
    --purpose) [ $# -ge 2 ] || die "--purpose 需要参数"; PURPOSE="$2"; shift 2 ;;
    --level)   [ $# -ge 2 ] || die "--level 需要参数"; LEVEL="$2"; shift 2 ;;
    --ttl-min) [ $# -ge 2 ] || die "--ttl-min 需要参数"; TTL_MIN="$2"; TTL_EXPLICIT=1; shift 2 ;;
    --force)   FORCE=1; shift ;;
    -h|--help) usage_stdout; exit 0 ;;
    *) die "未知参数或子命令:$1(用法:win-control-lock.sh status|check|lock|release …,-h 看全用法)" ;;
  esac
done

if [ -z "$CMD" ]; then
  echo "❌ 缺少子命令:status|check|lock|release 必须显式给出(-h 看全用法)" >&2
  usage_stdout >&2
  exit 1
fi

case "$TTL_MIN" in
  '') TTL_MIN=30 ;;
  *[!0-9]*) die "--ttl-min 须为非负整数(得到:$TTL_MIN)" ;;
esac

if [ "$CMD" = "lock" ]; then
  [ -n "$OWNER" ]   || die "lock 需要 --owner ID(会话身份标识)"
  [ -n "$PURPOSE" ] || die "lock 需要 --purpose TEXT(干什么用;长任务须含 schtasks 日志路径)"
  case "$LEVEL" in
    L1|L2|L3) ;;
    *) die "lock --level 必须 L1|L2|L3(得到:${LEVEL:-空})" ;;
  esac
  if { [ "$LEVEL" = "L2" ] || [ "$LEVEL" = "L3" ]; } && [ "$TTL_EXPLICIT" -ne 1 ]; then
    say "⚠️ ${LEVEL} 长任务未显式给 --ttl-min(默认 30 分):任务跑超 30 分后锁自动过期、他人可覆盖而原任务仍占机——按任务时长给足"
  fi
fi

if [ "$CMD" = "release" ]; then
  if [ -z "$OWNER" ] && [ "$FORCE" -ne 1 ]; then
    die "release 需要 --owner ID(或 --force 强删)"
  fi
fi

# ── ② python 载荷(整段单发;占位符 _XXXV_ 由 bash 侧 base64 填入) ────────
# heredoc 带引号=全字面;base64 字母表 [A-Za-z0-9+/=] 不含下划线,占位符无碰撞风险。
PY=$(cat <<'PYEOF'
import base64, datetime, json, os, subprocess, sys, tempfile

def _B(s):
    return base64.b64decode(s).decode('utf-8')

CMD     = _B('_CMDV_')
LOCK    = _B('_LOCKV_')
OWNER   = _B('_OWNV_')
PURPOSE = _B('_PURV_')
LEVEL   = _B('_LVLV_')
HOSTTAG = _B('_HOSTV_')
TTL     = _TTLV_
FORCE   = _FORCEV_

def p(s=''):
    print(s)

def utcnow():
    return datetime.datetime.now(datetime.timezone.utc)

def read_lock():
    """返回 (lock_dict|None, note)。note 非空=锁文件损坏(按可覆盖处理)。"""
    try:
        with open(LOCK, 'r', encoding='utf-8-sig') as f:
            return json.load(f), None
    except FileNotFoundError:
        return None, None
    except Exception as e:
        return None, '锁文件损坏(%s)' % e

def acq_dt(lk):
    dt = datetime.datetime.fromisoformat(str(lk.get('acquired', '')))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=datetime.timezone.utc)
    return dt

def judge(lk):
    """返回 (被持?, 说明)。lk=None → (False, '')。过期/TTL≤0/解析失败=未持。"""
    if not lk:
        return False, ''
    try:
        ttl = int(lk.get('ttl_min', 30))
    except Exception:
        ttl = 0
    if ttl <= 0:
        return False, 'TTL≤0 即刻过期'
    try:
        exp = acq_dt(lk) + datetime.timedelta(minutes=ttl)
    except Exception:
        return False, 'acquired 解析失败,按过期'
    if utcnow() >= exp:
        return False, '已于 %s 过期' % exp.astimezone().isoformat(timespec='seconds')
    return True, '将于 %s 过期' % exp.astimezone().isoformat(timespec='seconds')

def show_holder(lk, prefix=''):
    p('%sowner=%s | purpose=%s | level=%s | acquired=%s | ttl_min=%s | host=%s' % (
        prefix, lk.get('owner', '?'), lk.get('purpose', '?'), lk.get('level', '?'),
        lk.get('acquired', '?'), lk.get('ttl_min', '?'), lk.get('host', '?')))

def write_lock():
    d = {'owner': OWNER, 'purpose': PURPOSE, 'level': LEVEL,
         'acquired': datetime.datetime.now().astimezone().isoformat(timespec='seconds'),
         'ttl_min': TTL, 'host': HOSTTAG}
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(LOCK) or '.', prefix='.win-control-')
    with os.fdopen(fd, 'w', encoding='utf-8') as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
    os.replace(tmp, LOCK)
    return d

def sh(args, timeout=20):
    return subprocess.run(args, capture_output=True, timeout=timeout,
                          encoding='utf-8', errors='replace')

def qout(r, label):
    """在途探查子进程 rc 检查:非零=如实报失败返回 None(防空闲假阴性);零=返回 stdout。"""
    if r.returncode != 0:
        err = (r.stderr or '').strip().splitlines()
        p('%s: 查询失败 rc=%d%s' % (label, r.returncode,
          (' | ' + err[0][:100]) if err else '(无 stderr)'))
        return None
    return r.stdout or ''

GUARD = LOCK + '.guard'

def critical(fn):
    """读→判→写/删全程持 guard 文件字节锁(Windows=msvcrt.locking / Unix=fcntl.flock,
    两原语皆无的环境直通降级)——跨 ssh 会话互斥,消除单发载荷内的 check-then-act 竞态。"""
    import time
    fd = os.open(GUARD, os.O_CREAT | os.O_RDWR)
    lockit = unlockit = None
    try:
        import msvcrt
        lockit = lambda: msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
        unlockit = lambda: msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
    except ImportError:
        try:
            import fcntl
            lockit = lambda: fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            unlockit = lambda: fcntl.flock(fd, fcntl.LOCK_UN)
        except ImportError:
            pass
    if lockit is None:
        try:
            return fn()
        finally:
            os.close(fd)
    deadline = time.time() + 5.0
    while True:
        try:
            lockit()
            break
        except OSError:
            if time.time() >= deadline:
                os.close(fd)
                p('❌ 锁 guard 忙(另一操作持守卫超 5 秒),稍后重试')
                sys.exit(1)
            time.sleep(0.05)
    try:
        return fn()
    finally:
        try:
            unlockit()
        except Exception:
            pass
        os.close(fd)

if CMD == 'status':
    def _status_lock():
        lk, note = read_lock()
        p('── 锁(%s)──' % LOCK)
        if lk is None:
            if note:
                p('⚠️ ' + note)
                p('状态: 空闲(损坏锁视为可覆盖)')
            else:
                p('状态: 空闲(FREE)')
        else:
            p(json.dumps(lk, ensure_ascii=False, indent=2))
            held, why = judge(lk)
            if held:
                show_holder(lk, '状态: 🔒 被持 · ')
                p('        ' + why)
            else:
                show_holder(lk, '状态: 空闲 · ')
                p('        ' + why + '(可覆盖)')
    critical(_status_lock)
    p()
    p('── 在途概况 ──')
    try:
        r = sh(['powershell', '-NoProfile', '-Command',
                "[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); "
                "(Get-CimInstance Win32_Process -Filter \"Name='python.exe'\") | "
                "ForEach-Object { '{0}|{1}' -f $_.ProcessId, $_.CommandLine }"])
        out = qout(r, 'python.exe 进程')
        if out is not None:
            procs = [l for l in out.splitlines() if l.strip()]
            p('python.exe 进程: %d 个' % len(procs))
            for l in procs[:15]:
                p('  ' + l[:160])
            if len(procs) > 15:
                p('  …另有 %d 个未列' % (len(procs) - 15))
    except Exception as e:
        p('python.exe 进程: 查询异常(%s)' % e)
    try:
        r = sh(['netstat', '-ano'])
        out = qout(r, '端口 17000')
        if out is not None:
            rows = [l.strip() for l in out.splitlines()
                    if ':17000' in l and 'LISTEN' in l.upper()]
            p('端口 17000 LISTEN: %d' % len(rows))
            for l in rows[:10]:
                p('  ' + l)
    except Exception as e:
        p('端口 17000: 查询异常(%s)' % e)
    try:
        r = sh(['nvidia-smi', '--query-gpu=name,utilization.gpu,memory.used,memory.total',
                '--format=csv,noheader'])
        out = qout(r, 'GPU')
        if out is not None:
            if out.strip():
                p('GPU: ' + ' / '.join(x.strip() for x in out.splitlines() if x.strip()))
            else:
                p('GPU: 查询 rc=0 但无输出(nvidia-smi 异常)')
    except FileNotFoundError:
        p('GPU: nvidia-smi 不在(跳过)')
    except Exception as e:
        p('GPU: 查询异常(%s)' % e)
    sys.exit(0)

elif CMD == 'check':
    def _check():
        lk, note = read_lock()
        if lk is None:
            if note:
                p('⚠️ ' + note)
                p('✅ 锁空闲(损坏锁视为可覆盖)')
            else:
                p('✅ 锁空闲(锁文件不存在=FREE)')
            sys.exit(0)
        held, why = judge(lk)
        if held:
            cur = str(lk.get('owner', ''))
            tag = ('🔒 被自己持有(非空闲;续期用 lock)· '
                   if (OWNER != '-' and cur == OWNER) else '🔒 被他人持有 · ')
            show_holder(lk, tag)
            p('   ' + why + ' —— 拿锁请与该会话协商或等过期')
            sys.exit(3)
        show_holder(lk, '✅ 锁空闲 · ')
        p('   ' + why + '(check 视为可获取)')
        sys.exit(0)
    critical(_check)

elif CMD == 'lock':
    if LEVEL not in ('L1', 'L2', 'L3'):
        p('❌ level 必须 L1|L2|L3(得到:%s)' % LEVEL)
        sys.exit(1)
    if not OWNER or OWNER == '-':
        p('❌ lock 需要 --owner')
        sys.exit(1)
    def _lock():
        lk, note = read_lock()
        prev_owner = None
        self_renew = False
        if lk is not None:
            held, why = judge(lk)
            cur = str(lk.get('owner', ''))
            if held:
                if cur == OWNER:
                    self_renew = True  # 自己持有未过期锁=续期/重入,放行覆盖
                else:
                    p('❌ 锁被他人持有,未获取')
                    show_holder(lk, '   ')
                    p('   ' + why)
                    sys.exit(3)
            else:
                prev_owner = cur or '?'
        d = write_lock()
        p('✅ 已获取锁:')
        p(json.dumps(d, ensure_ascii=False, indent=2))
        if note:
            p('⚠️ ' + note)
        if self_renew:
            p('ℹ️ 覆盖自己未过期旧锁(续期/重入)')
        elif prev_owner:
            p('ℹ️ 覆盖了过期锁,前持有者 owner=%s' % prev_owner)
        if TTL <= 0:
            p('⚠️ ttl_min=%d:写入即刻过期(任何后续 check 均视为空闲)' % TTL)
        sys.exit(0)
    critical(_lock)

elif CMD == 'release':
    def _release():
        lk, note = read_lock()
        if lk is None:
            if note:  # 文件存在但损坏:删除残留,杜绝后续每次操作都撞告警
                try:
                    os.remove(LOCK)
                    p('⚠️ ' + note + '——已删除损坏锁文件,视为已释放')
                except OSError as e2:
                    p('⚠️ ' + note + ';且删除失败(%s),请手工删除后重试' % e2)
            else:
                p('✅ 锁文件不存在,视为已释放')
            sys.exit(0)
        cur = str(lk.get('owner', ''))
        if FORCE:
            p('⚠️ --force 强删他人锁!')
            show_holder(lk, '   被删者 ')
            os.remove(LOCK)
            p('✅ 已删除(强制)')
            sys.exit(0)
        if cur == OWNER:
            os.remove(LOCK)
            p('✅ 已释放(owner=%s)' % OWNER)
            sys.exit(0)
        p('❌ owner 不符,未删除(当前 owner=%s;确认强删加 --force)' % cur)
        show_holder(lk, '   当前 ')
        sys.exit(3)
    critical(_release)

else:
    p('❌ 未知子命令:%s' % CMD)
    sys.exit(1)
PYEOF
)

# ── ③ 占位符注入(所有字段走 base64;空值用占位 '-') ────────────────────────
CMD_B=$(b64 "${CMD}")
LOCK_B=$(b64 "$LOCK_PATH")
OWN_B=$(b64 "${OWNER:--}")
PUR_B=$(b64 "${PURPOSE:--}")
LVL_B=$(b64 "${LEVEL:--}")
HOST_B=$(b64 "$(hostname -s)")
PY="${PY//_CMDV_/$CMD_B}"
PY="${PY//_LOCKV_/$LOCK_B}"
PY="${PY//_OWNV_/$OWN_B}"
PY="${PY//_PURV_/$PUR_B}"
PY="${PY//_LVLV_/$LVL_B}"
PY="${PY//_HOSTV_/$HOST_B}"
PY="${PY//_TTLV_/$TTL_MIN}"
PY="${PY//_FORCEV_/$FORCE}"

# ── ④ 单发执行(载荷 base64 经 ssh stdin 喂入;PS 命令恒短再 EncodedCommand;rc 透传,255→4) ──
# 坑(1031 实测定谳):载荷内联进 -c 会让 EncodedCommand 膨胀到 ~23K 字符,爆 cmd.exe
# 8191 字符命令行上限(远端报 GBK「命令行太长。」);故载荷走 stdin(同 flux3_daojie_ssh.py 工艺)。
ERR_TMP=$(mktemp)
trap 'rm -f "$ERR_TMP"' EXIT

payload=$(printf '%s' "$PY" | base64 | LC_ALL=C tr -d '\n')
ps_cmd="\$ProgressPreference='SilentlyContinue'; \$exe='D:\Python312\python.exe'; if(-not(Test-Path \$exe)){\$exe='python'}; \$rc=1; \$env:PYTHONIOENCODING='utf-8'; & \$exe -c \"import base64,sys;exec(base64.b64decode(sys.stdin.buffer.read()))\"; if(\$LASTEXITCODE -ne \$null){\$rc=\$LASTEXITCODE}; exit \$rc"
ps_b64=$(printf '%s' "$ps_cmd" | iconv -f UTF-8 -t UTF-16LE | base64 | LC_ALL=C tr -d '\n')

set +e
out=$(printf '%s' "$payload" | ssh "${SSH_OPTS[@]}" "$DEST" "powershell -NoProfile -EncodedCommand ${ps_b64}" 2>"$ERR_TMP")
rc=$?
set -e

if [ -n "$out" ]; then printf '%s\n' "$out" | LC_ALL=C tr -d '\r'; fi

if [ "$rc" -eq 255 ]; then
  say "❌ ssh 不可达(${DEST})"
  [ -s "$ERR_TMP" ] && LC_ALL=C tr -d '\r' < "$ERR_TMP" | sed -n '1,3p' >&2
  exit 4
fi

if [ -s "$ERR_TMP" ]; then LC_ALL=C tr -d '\r' < "$ERR_TMP" >&2; fi
exit "$rc"
