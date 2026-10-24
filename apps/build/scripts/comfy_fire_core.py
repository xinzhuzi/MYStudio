"""出图稳定核心 v1(10-24,任务 .trellis/tasks/10-24-stable-fire-core)。

把战役脚本各自复制的「提交→轮询→取片→空片门禁→失败分类→重掷纪律」收敛为单一
实现,修复 10-24 晏燎量产役暴露的四缺陷(grill 定稿在案,证据见任务 prd.md):

  ① 门禁类确定性失败不再白烧重掷:classify_failure 分三类——
     waste(空片/画幅/alpha 内容判废)→ 允许换 seed 重掷一次;
     deterministic(门禁拒单/_gongbi/主体句/node_errors/上传防线/模板断言)→ 不重掷直报;
     transient(超时/断连)→ 重掷一次,但先过队列闸。
  ② 重掷前强制队列清零闸:wait_queue_clear(GET /queue 双空才放行),杀「超时自动
     重掷→第一单未完→两单并发」通道(10-23 深夜 12 连败同构根因)。
  ③ deadline 可配置:env MYSTUDIO_FIRE_DEADLINE_S(默认 900),替代脚本内硬编码。
  ④ 空片门禁背景锚升级边界环中位(env MYSTUDIO_FIRE_ANCHOR=ring|pixel,默认 ring;
     算法回流自 App 链 apps/backend/engines/image_engine/output_gate.py,阈值不变:
     <400KB / 非背景占比<8%;pixel=旧单像素兼容口径)。

自包含约束:stdlib + PIL/numpy(脚本环境既有),零引擎/App 依赖;传输层可注入
(FakeTransport)供离线单测。在役消费方:yanliao_kv_viewsheet_1023.py、
yanliao_stage_fronts_1023.py(迁移记录见任务 implement 账)。
"""
from __future__ import annotations

import io
import json
import os
import time
import urllib.request as ureq
from urllib.parse import quote, urlencode

# ── 失败分类 ─────────────────────────────────────────────────────────
# 三类口径(prd.md Requirement 1):
#   waste        内容判废(图已生成但废)→ 换 seed 重掷一次有收益
#   deterministic 确定性失败(重掷必再败)→ 不重掷直报
#   transient    瞬时失败(超时/断连)→ 重掷一次,先过队列闸
_WASTE_PATTERNS = ('空片嫌疑', '空片', '画幅门禁', 'alpha 门禁')
_DETERMINISTIC_PATTERNS = ('门禁', '拒单', '_gongbi', '主体句', 'node_errors',
                           'validation', 'invalid workflow', 'Prompt is invalid',
                           'upload 三层防线', '参考背景态断言', '模板', '幂等跳过',
                           '缺档', '缺节点', '序与', '断言', '输出缺失',
                           'Return type mismatch')
_TRANSIENT_PATTERNS = ('超时', 'timed out', 'Timeout', 'URLError', 'Connection',
                       'refused', 'reset by peer', 'out of memory', 'OOM',
                       'HTTP 5', 'Bad Gateway')


def classify_failure(exc: BaseException) -> str:
    """按消息特征分类失败;未匹配的未知错误默认 transient(重掷一次,受队列闸保护)。"""
    msg = str(exc)
    for p in _WASTE_PATTERNS:
        if p in msg:
            return 'waste'
    for p in _DETERMINISTIC_PATTERNS:
        if p in msg:
            return 'deterministic'
    for p in _TRANSIENT_PATTERNS:
        if p in msg:
            return 'transient'
    return 'transient'


# ── 配置(env 覆盖,默认值=迁移前行为) ────────────────────────────────
def deadline_s(default: float = 900.0) -> float:
    """单发轮询 deadline;env MYSTUDIO_FIRE_DEADLINE_S 覆盖(缺陷③)。"""
    try:
        v = float(os.environ.get('MYSTUDIO_FIRE_DEADLINE_S', default))
        return v if v > 0 else default
    except (TypeError, ValueError):
        return default


def anchor_mode() -> str:
    """内容占比背景锚口径:ring(默认,边界环中位)/pixel(旧单像素兼容)。"""
    return 'pixel' if os.environ.get('MYSTUDIO_FIRE_ANCHOR', 'ring').strip().lower() == 'pixel' else 'ring'


# ── 传输层(可注入) ──────────────────────────────────────────────────
class UrllibTransport:
    """真引擎传输;单测注入 FakeTransport 替代。"""

    def __init__(self, engine: str):
        self.engine = engine.rstrip('/')

    def get_json(self, path: str, timeout: float = 10):
        return json.load(ureq.urlopen(self.engine + path, timeout=timeout))

    def post_json(self, path: str, payload: dict, timeout: float = 30):
        r = ureq.Request(self.engine + path, data=json.dumps(payload).encode(),
                         headers={'Content-Type': 'application/json'})
        try:
            return json.load(ureq.urlopen(r, timeout=timeout))
        except ureq.HTTPError as e:
            # 4xx=引擎校验拒单(确定性, 重掷必再拒), body 供分类器看 node_errors/门禁字样;
            # 5xx=服务端瞬时(可重掷), 不拼 body——网关页若恰含 validation 等确定性关键字
            # 会被错杀掉唯一一次重掷(grill 1024 R2-N6)。
            tag = '拒单 ' if e.code < 500 else ''
            if e.code < 500:
                body = ''
                try:
                    body = e.read().decode('utf-8', errors='ignore')[:300]
                except Exception:
                    pass
                raise RuntimeError(f'{tag}HTTP {e.code}: {body}') from None
            raise RuntimeError(f'HTTP {e.code}: {e.reason}') from None

    def fetch_bytes(self, path: str, timeout: float = 300) -> bytes:
        return ureq.urlopen(self.engine + path, timeout=timeout).read()


# ── 队列闸(缺陷②核心) ───────────────────────────────────────────────
def queue_clear(tr, timeout: float = 5) -> bool:
    """/queue 双空(running+pending 均空)=引擎无在途单。查询失败按未清空处理(fail-closed)。"""
    try:
        q = tr.get_json('/queue', timeout=timeout)
        return not q.get('queue_running') and not q.get('queue_pending')
    except Exception:
        return False


def wait_queue_clear(tr, deadline_s: float = 180, poll_s: float = 10,
                     log=None) -> bool:
    """轮询等待队列清零;到 deadline 仍非空=False(调用方须停线,不得重掷)。"""
    t0 = time.monotonic()
    while time.monotonic() - t0 < deadline_s:
        if queue_clear(tr):
            return True
        if log:
            log('队列未清零,重掷暂缓(并发在途防线,10-23 12 连败根因)')
        time.sleep(poll_s)
    return queue_clear(tr)


# ── 引擎探活(沿两脚本既有口径) ──────────────────────────────────────
def engine_alive(tr) -> bool:
    try:
        tr.get_json('/system_stats', timeout=3)
        return True
    except Exception:
        return False


def wait_engine(tr, deadline_s: float = 180, poll_s: float = 5) -> bool:
    t0 = time.monotonic()
    while time.monotonic() - t0 < deadline_s:
        if engine_alive(tr):
            return True
        time.sleep(poll_s)
    return False


# ── 提交→轮询→取片(单一实现) ────────────────────────────────────────
def submit(tr, graph: dict, client_id: str) -> str:
    r = tr.post_json('/prompt', {'prompt': graph, 'client_id': client_id})
    pid = r.get('prompt_id')
    if not pid:
        ne = r.get('node_errors')
        if ne:
            raise RuntimeError(f'拒单 node_errors: {str(ne)[:300]}')
        raise RuntimeError(f'引擎未返回任务编号: {str(r)[:200]}')
    return pid


def await_output(tr, pid: str, tag: str, filename_prefix: str = '',
                 timeout: float = None, log=None) -> bytes:
    """轮询 /history 至 success 取 /view 字节;引擎报错原样抛出由 classify 分类。"""
    timeout = deadline_s() if timeout is None else timeout
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        time.sleep(15)
        try:
            rec = tr.get_json('/history/' + quote(pid)).get(pid)
        except Exception:
            time.sleep(20)
            continue
        if rec is None:
            continue
        if rec['status']['status_str'] != 'success':
            # 把 status.messages(节点异常文本, 含门禁拒单字样)带进异常供分类器判读
            st = rec.get('status', {})
            msgs = str(st.get('messages', ''))[:400]
            raise RuntimeError(f'{tag} 引擎报错: {st.get("status_str", "?")} {msgs}')
        for im in [i for o in rec['outputs'].values() for i in o.get('images', [])]:
            if filename_prefix and not im['filename'].startswith(filename_prefix):
                continue
            return tr.fetch_bytes('/view?' + urlencode(
                {'filename': im['filename'], 'subfolder': im.get('subfolder', ''),
                 'type': im.get('type', 'output')}))
        raise RuntimeError(f'{tag} 输出缺失(确定性): 无 {filename_prefix or "有效"}输出')
    raise TimeoutError(f'{tag} 超时({int(timeout)}s)')


# ── 上传三层防线与内存纪律(单一实现, 两入口共用) ─────────────────────
def upload_image(tr, img_path, timeout: float = 120) -> str:
    """三层防线上传: ①overwrite=true ②捕获引擎返回名(同名异容静默改名防线) ③md5 回拉
    比对不一致停线。手搓 multipart(零 requests 依赖), 返回引擎实载名。"""
    import hashlib
    from pathlib import Path
    p = Path(img_path)
    raw = p.read_bytes()
    md5_local = hashlib.md5(raw).hexdigest()
    boundary = 'STfirecore'
    body = ((f'--{boundary}\r\nContent-Disposition: form-data; name="overwrite"\r\n\r\ntrue\r\n'
             f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="'
             f'{p.name}"\r\nContent-Type: image/png\r\n\r\n').encode()
            + raw + f'\r\n--{boundary}--\r\n'.encode())
    r = ureq.Request(tr.engine + '/upload/image', data=body,
                     headers={'Content-Type': f'multipart/form-data; boundary={boundary}'})
    name = json.load(ureq.urlopen(r, timeout=timeout))['name']
    back = tr.fetch_bytes('/view?' + urlencode(
        {'filename': name, 'subfolder': '', 'type': 'input'}), timeout=60)
    if hashlib.md5(back).hexdigest() != md5_local:
        raise RuntimeError(f'upload 三层防线③: 引擎实载 md5 不一致({name} '
                           f'local={md5_local[:8]})——停线')
    return name


def mem_free_pct() -> float:
    """macOS 宿主空闲内存百分比(memory_pressure -Q)。"""
    import subprocess
    out = subprocess.run(['memory_pressure', '-Q'], capture_output=True, text=True).stdout
    for ln in out.splitlines():
        if 'free percentage' in ln:
            return float(ln.split(':')[-1].strip().rstrip('%'))
    return 100.0


def maybe_free_memory(tr, log, min_pct: float = 30.0, settle_s: float = 10):
    """发前内存纪律: 空闲<min_pct 先 POST /free 再提交;失败吞错记日志——
    止损动作不得变成新故障点(grill 1024 #7)。"""
    try:
        if mem_free_pct() < min_pct:
            log(f'内存空闲<{min_pct:g}%, POST /free 回收')
            tr.post_json('/free', {'unload_models': True, 'free_memory': True}, timeout=10)
            time.sleep(settle_s)
    except Exception as exc:
        log(f'/free 回收失败(忽略继续): {exc}')


# ── 空片门禁(阈值不变,锚升级;缺陷④) ────────────────────────────────
def _bg_anchor(comp, mode: str):
    """背景锚:ring=外圈 8px 边界环逐通道中位;pixel=旧单像素 [20,20] 兼容口径。"""
    if mode == 'pixel':
        return comp[20, 20]
    import numpy as np
    ring = 8
    mask = np.zeros(comp.shape[:2], dtype=bool)
    mask[:ring, :] = mask[-ring:, :] = True
    mask[:, :ring] = mask[:, -ring:] = True
    return np.median(comp[mask], axis=0)


def blank_gates(b: bytes, tag: str, *, min_bytes: int = 400_000, min_fg: float = 0.08,
                max_full_trans=None, want_ratio=None, ratio_tol: float = 0.05,
                mode: str = None) -> dict:
    """空片三门(+可选 alpha/画幅门);违规抛 RuntimeError(消息前缀与迁移前一致,
    classify 归 waste)。返回统计 {'kb','fg','full_trans','w','h'} 供落盘日志。"""
    from PIL import Image
    import numpy as np
    if len(b) < min_bytes:
        raise RuntimeError(f'{tag} 空片嫌疑: 文件仅{len(b) // 1024}KB(<{min_bytes // 1024}KB), 弃用')
    im = Image.open(io.BytesIO(b))
    has_alpha = im.mode == 'RGBA'
    arr = np.asarray(im.convert('RGBA') if has_alpha else im.convert('RGB'),
                     dtype=np.float32)
    h, w = arr.shape[:2]
    if want_ratio is not None:
        ratio = w / h
        if abs(ratio - want_ratio) > ratio_tol:
            raise RuntimeError(f'{tag} 画幅门禁: {w}×{h} 比{ratio:.3f} 出 {want_ratio}±{ratio_tol}')
    full_trans = 0.0
    if has_alpha:
        alpha = arr[..., 3]
        full_trans = float((alpha == 0).mean())
        if max_full_trans is not None and full_trans > max_full_trans:
            raise RuntimeError(f'{tag} alpha 门禁: 全透占比{full_trans * 100:.1f}%'
                               f'(>{max_full_trans * 100:.0f}%) 判失败重掷')
        wa = alpha[..., None] / 255.0
        comp = arr[..., :3] * wa + 255.0 * (1 - wa)  # 白底合成后量非背景
    else:
        comp = arr
    bg = _bg_anchor(comp, mode if mode is not None else anchor_mode())
    fg = float((np.abs(comp - bg).max(axis=2) > 20).mean())
    if fg < min_fg:
        raise RuntimeError(f'{tag} 空片: 非背景占比{fg * 100:.1f}%(<{min_fg * 100:.0f}%), 弃用')
    return {'kb': len(b) // 1024, 'fg': fg, 'full_trans': full_trans, 'w': w, 'h': h}


# ── 重掷纪律(缺陷①②的收口点) ───────────────────────────────────────
def fire_with_discipline(fire_once_fn, seed: int, tag: str, tr, log,
                         reroll_delta: int = 1000, queue_wait_s: float = 180,
                         engine_wait_s: float = 180) -> tuple[int, str]:
    """单发+分类重掷纪律。fire_once_fn(seed)->任意(通常 Path);返回 (exit, note)。

    waste/transient → wait_engine + 队列清零闸后重掷 seed+1000 一次;
    deterministic   → 不重掷直报;重掷仍败 → exit 1。两掷即止,无第三掷。
    queue_wait_s/engine_wait_s 仅供离线单测压缩等待窗。
    """
    try:
        fire_once_fn(seed)
        return 0, ''
    except Exception as exc:
        cls = classify_failure(exc)
        if cls == 'deterministic':
            log(f'{tag} 确定性失败[{cls}], 不重掷直报: {exc}')
            return 1, cls
        if cls == 'waste':
            log(f'{tag} 内容判废[{cls}]: {exc} → 换 seed 重掷一次')
        else:
            log(f'{tag} 瞬时失败[{cls}]: {exc} → 等引擎复活+队列清零后重掷一次')
        if not wait_engine(tr, deadline_s=engine_wait_s):
            log(f'{tag} 引擎未复活, 放弃')
            return 1, cls
        time.sleep(20)  # 先等引擎静置, 再过闸——闸过到提交之间的窗口最小化(grill 1024 #10)
        # 队列闸:第一单可能仍在跑(超时>deadline 场景),双空才许重掷(12 连败防线)
        if not wait_queue_clear(tr, deadline_s=queue_wait_s, poll_s=10, log=log):
            log(f'{tag} 队列未清零, 停线不重掷(并发在途, 人工核查引擎)')
            return 1, cls + '+queue-busy'
        try:
            fire_once_fn(seed + reroll_delta)
            return 0, cls + '+rerolled'
        except Exception as exc2:
            cls2 = classify_failure(exc2)
            log(f'{tag} 重掷仍失败[{cls2}]: {exc2}')
            # 上报「重掷」的分类=引擎状态的最新证据(grill 1024 R2-N1/N5):
            # 重掷超时/断连=引擎健康未知, 不得被首掷 waste 掩盖(批层停线判据依赖);
            # 重掷确定性拒单=引擎应答过、无在途风险, 批层可续跑后续件。
            return 1, cls2 + '+reroll-failed'
