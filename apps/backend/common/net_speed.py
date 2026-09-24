"""pip 下载线路实测择路(09-24 根修,下载前测速+国内镜像)——引擎依赖安装共用,零第三方依赖。

实弹:引擎更新卡 35%(pip 依赖段)——官方 PyPI 经本机代理仅 30-60KB/s
(89.8MB 传递依赖要 20-50 分钟),而清华镜像直连 36.7MB/s(三个数量级差)。
策略=**下载前实测择路**:候选线路并行探测(numpy simple 页任一 .whl 的
Range 下载速率),快者胜——「要测速,并且要使用镜像,多重方式都要做」。
镜像滞后是实锤(09-24 阿里 simple 页最新仅 0.1.47,官方/清华已 0.1.48),
故镜像线只做首选、失败回退由调用方按现行「官方源+代理」原路兜底,而非
--extra-index-url 混源(摘净代理后官方件只会 18KB/s 裸直连,平添依赖混淆面)。

候选线路 5 条:清华/阿里/腾讯镜像(均为只读 PyPI 镜像、无第三方上传面,
零依赖混淆风险)恒直连;官方源经代理线仅当 outbound_proxy_url() 非 None;
官方直连线仅当 MYSTUDIO_OUTBOUND_PROXY 未显式设置(设 URL=用户钦定代理
形态;空串=强制直连,现行线即直连无须再探)。MYSTUDIO_OUTBOUND_PROXY
语义同 net_outbound(单一真源,本模块只读不重定义)。

择路保险:改变现行行为的路线(镜像、或代理在场时的官方直连)须快过现行
线 1.5× 才切——境外快网场景自动静默退化为现行行为。探测单线总预算 4s·
16MB 上限·16KB 小块读(慢线也能完成若干块拿到非零分),结果 10 分钟缓存
(同一次安装/更新链的多个 _pip 调用只探一轮);探测期间持锁,并发至多探
一轮。全部线路 0 分 → pick_pip_route() 返回 None,调用方走现行原路。
"""
from __future__ import annotations

import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from urllib import parse as urlparse, request

from common.net_outbound import outbound_proxy_url

_ROUTE_TTL_S = 600.0
_PROBE_TOTAL_BUDGET_S = 4.0   # 单线总预算(读块间 deadline 检查兜底)
_PROBE_CONNECT_TIMEOUT_S = 2.0
_PROBE_READ_TIMEOUT_S = 1.5   # 单块 socket 读超时(尽力下调;拿不到内部 sock 则沿用连接超时)
_PROBE_MAX_BYTES = 16 * 1024 * 1024  # 16MB 字节上限:快线够分辨,慢线读不完按实得字节计分
_PROBE_CHUNK = 16 * 1024      # 16KB 小块读:慢线也能完成若干块拿到非零分
_SWITCH_FACTOR = 1.5          # 改变现行行为的路线须快过现行线该倍数才切

# 只读 PyPI 镜像(无第三方上传面,零依赖混淆风险),恒直连
_MIRRORS = (
    ("清华镜像", "https://pypi.tuna.tsinghua.edu.cn/simple"),
    ("阿里镜像", "https://mirrors.aliyun.com/pypi/simple"),
    ("腾讯镜像", "https://mirrors.cloud.tencent.com/pypi/simple"),
)
_OFFICIAL_INDEX = "https://pypi.org/simple"
_PROBE_PACKAGE = "numpy"  # 探测靶:核心基础设施件,simple 页 URL 永稳定(任一 .whl 皆可)
_USER_AGENT = "MYStudio-comfy-host/1.0"

_WHEEL_HREF_RE = re.compile(r'href="([^"]+\.whl)[^"]*"')

_route_cache: tuple[float, "PipRoute | None"] | None = None
_route_lock = threading.Lock()


@dataclass(frozen=True)
class PipRoute:
    """择路结果:index_url 给 pip -i;strip_proxy=子进程 env 摘净代理;
    is_fallback=现行线路(09-19 官方源+代理原样,调用方走不变路径)。"""

    label: str
    index_url: str
    speed_bps: float
    strip_proxy: bool
    is_fallback: bool

    @property
    def speed_text(self) -> str:
        """人读速率:≥1MB/s 一位小数 MB/s,否则整数 KB/s。"""
        mbps = self.speed_bps / (1024.0 * 1024.0)
        if mbps >= 1.0:
            return f"{mbps:.1f}MB/s"
        return f"{max(1, round(self.speed_bps / 1024.0))}KB/s"

    @property
    def note(self) -> str:
        """进度消息注记(如「(清华镜像·实测35.2MB/s)」);现行线路空串(消息保持原样)。"""
        if self.is_fallback:
            return ""
        return f"({self.label}·实测{self.speed_text})"


@dataclass(frozen=True)
class _Line:
    """候选线路:index_url 即 simple 索引;proxy_url=官方经代理线(探测走它),
    None=直连探测(镜像线与官方直连线);is_fallback=该线即现行行为。"""

    label: str
    index_url: str
    strip_proxy: bool
    is_fallback: bool
    proxy_url: str | None = None


def _candidate_lines() -> list[_Line]:
    """组候选线路:三镜像恒在恒直连;官方经代理线仅当探测到代理(=现行线);
    官方直连线仅当 MYSTUDIO_OUTBOUND_PROXY 未显式设置(代理在场时它是
    改变行为的 strip 线,同样受 1.5× 保险约束)。"""
    proxy_url = outbound_proxy_url()
    explicit = os.environ.get("MYSTUDIO_OUTBOUND_PROXY")
    lines = [_Line(label, index, strip_proxy=True, is_fallback=False)
             for label, index in _MIRRORS]
    if proxy_url:
        lines.append(_Line("官方源", _OFFICIAL_INDEX, strip_proxy=False,
                           is_fallback=True, proxy_url=proxy_url))
    if explicit is None:
        lines.append(_Line("官方源(直连)", _OFFICIAL_INDEX, strip_proxy=True,
                           is_fallback=not proxy_url))
    return lines


def _whl_url_from_simple(html: str, page_url: str) -> str | None:
    """simple 页取最后一个 .whl 的下载 URL(任一 .whl 皆可,容忍页面改版/路径漂移)。

    镜像相对布局 ../../packages/<hash>/<file> 与官方绝对 files.pythonhosted.org
    两格式通吃(urljoin;09-24 实测三镜像 href 为逐字节同 hash 相对路径),
    #sha256 片段剥除;无 .whl 返回 None。
    """
    hrefs = _WHEEL_HREF_RE.findall(html)
    if not hrefs:
        return None
    return urlparse.urljoin(page_url, hrefs[-1]).split("#", 1)[0]


def _opener_for(line: _Line) -> request.OpenerDirector:
    """线路专属 opener:直连线=显式空代理(环境变量里的代理也不沾,防父进程
    继承的 Clash 变量污染探测);官方代理线=ProxyHandler 走 outbound 探测结果。"""
    if line.proxy_url:
        return request.build_opener(
            request.ProxyHandler({"http": line.proxy_url, "https": line.proxy_url}))
    return request.build_opener(request.ProxyHandler({}))


def _tighten_read_timeout(resp) -> None:
    """把响应 socket 的读超时降到 _PROBE_READ_TIMEOUT_S(单块卡死快速止损)。

    摸的是 http.client 内部结构(fp.raw._sock),版本间可能变——getattr 链
    尽力而为,拿不到就沿用 urlopen 的连接超时兜底,绝不炸。
    """
    sock = getattr(getattr(resp, "fp", None), "raw", None)
    sock = getattr(sock, "_sock", None)
    if sock is not None:
        try:
            sock.settimeout(_PROBE_READ_TIMEOUT_S)
        except OSError:
            pass


def _probe_line(line: _Line) -> float:
    """单线实测(numpy .whl Range 下载速率,字节/秒);任一环节异常=0 分不炸。

    两段:simple 页解析拿文件 URL(失败整线 0 分)→ Range GET bytes=0-16M
    小块读计分(中途断流/超时按已得字节计分,不丢慢线的部分读)。
    """
    try:
        opener = _opener_for(line)
        page_url = f"{line.index_url.rstrip('/')}/{_PROBE_PACKAGE}/"
        page_req = request.Request(page_url, headers={"User-Agent": _USER_AGENT})
        with opener.open(page_req, timeout=_PROBE_CONNECT_TIMEOUT_S) as resp:
            html = resp.read(_PROBE_MAX_BYTES).decode("utf-8", "replace")
        file_url = _whl_url_from_simple(html, page_url)
        if not file_url:
            return 0.0
    except Exception:
        return 0.0
    got, start = 0, 0.0
    try:
        dl_req = request.Request(file_url, headers={
            "User-Agent": _USER_AGENT,
            "Range": f"bytes=0-{_PROBE_MAX_BYTES - 1}",
        })
        with opener.open(dl_req, timeout=_PROBE_CONNECT_TIMEOUT_S) as resp:
            _tighten_read_timeout(resp)
            start = time.monotonic()
            deadline = start + _PROBE_TOTAL_BUDGET_S
            while got < _PROBE_MAX_BYTES:
                chunk = resp.read(_PROBE_CHUNK)
                if not chunk:
                    break
                got += len(chunk)
                if time.monotonic() >= deadline:
                    break
    except Exception:
        pass  # 中途断流:按已得字节计分(0 字节自然归 0)
    elapsed = time.monotonic() - start
    return got / elapsed if (got and elapsed > 0) else 0.0


def _safe_speed(fut) -> float:
    try:
        return float(fut.result())
    except Exception:
        return 0.0


def _probe_all() -> PipRoute | None:
    """并行实测全部候选线并择路;无非零分线 → None(调用方走现行原路)。

    择路规则:按速度降序,取第一条「非零分 且(现行线,或快过现行线
    1.5×)」的线——现行线不在候选(如 MYSTUDIO_OUTBOUND_PROXY=空串)时
    按现行线 0 分处理,镜像非零即切(镜像也是直连,不违强制直连语义)。
    """
    lines = _candidate_lines()
    if not lines:
        return None
    with ThreadPoolExecutor(max_workers=len(lines)) as pool:
        futures = [(line, pool.submit(_probe_line, line)) for line in lines]
        speeds = {line: _safe_speed(fut) for line, fut in futures}
    ranked = sorted(lines, key=lambda ln: speeds[ln], reverse=True)
    current_speed = next((speeds[ln] for ln in lines if ln.is_fallback), 0.0)
    for cand in ranked:
        speed = speeds[cand]
        if speed <= 0:
            break  # 降序排名,后面只会更差
        if cand.is_fallback or speed >= current_speed * _SWITCH_FACTOR:
            return PipRoute(label=cand.label, index_url=cand.index_url,
                            speed_bps=speed, strip_proxy=cand.strip_proxy,
                            is_fallback=cand.is_fallback)
    return None


def pick_pip_route() -> PipRoute | None:
    """实测择路(TTL 600s 缓存;探测期间持锁,并发调用至多探一轮);全失败=None。"""
    global _route_cache
    with _route_lock:
        now = time.monotonic()
        if _route_cache is not None and now - _route_cache[0] < _ROUTE_TTL_S:
            return _route_cache[1]
        route = _probe_all()
        _route_cache = (time.monotonic(), route)
        return route


def pip_route_note(route: PipRoute | None = None) -> str:
    """pip 进度消息的线路注记(如「(清华镜像·实测35.2MB/s)」)。

    现行线路返回空串(消息保持 09-24 前原样);缺省取缓存/现探——消息拼装
    时机=pip 必跑,探测结果随后续 _pip 直接复用,不白探。
    """
    if route is None:
        route = pick_pip_route()
    return route.note if (route is not None and not route.is_fallback) else ""


def invalidate_pip_route() -> None:
    """镜像实弹失败时作废缓存(下一轮 _pip 重新探测自愈)。"""
    global _route_cache
    with _route_lock:
        _route_cache = None
