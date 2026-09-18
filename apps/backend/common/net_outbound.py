"""出站网络代理(09-19 根修,动态路由)——侧车/下载链共用,零第三方依赖。

实弹:GitHub/HF 直连超时(插件更新卡 25% 十分钟后报错),本机常驻代理
(Clash 系,HTTP 端口 7897/7890 一族)1.5s 可达。策略=**域名级动态路由**:
本机回环与国内域名(.cn/阿里云镜像族)恒直连(不依赖 Clash 规则模式,
开全局也不绕远);境外域名探测到本机代理就走,探测不到直连。探测优先
而非「直连失败再回退」——直连对 GitHub 是整段超时死,先试直连等于每次
白等满超时;探测 250ms×候选端口,60s 缓存一次。

三类用法:
- 子进程(git/pip,目标均为境外源):env 注入 proxy_env_vars();
- urllib 直下:urlopen_outbound(Request(...))(路由器自动分流);
- 进程内下载库(huggingface_hub/requests):with outbound_proxy_env():
  (临时设 os.environ,库的 trust_env 机制自动接管,退出还原)。

MYSTUDIO_OUTBOUND_PROXY 显式覆盖(空串=强制直连)。引擎进程自身的出站
(ComfyUI 内 HF 下载等)不在此管——走设置页环境变量表由用户控制。
"""
from __future__ import annotations

import os
import socket
import time
from contextlib import contextmanager
from urllib import parse as urlparse, request

_PROXY_CANDIDATE_PORTS = (7897, 7890, 7899, 1087, 1080)
_PROXY_CACHE_TTL_S = 60.0
_outbound_proxy_cache: tuple[float, str | None] | None = None

_LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})
# 域名级直连名单(09-19 动态路由):国内源代码层强制直连——不依赖 Clash 的
# 规则模式(用户开全局模式时,国内流量卷进节点反而慢/失败)。
# .cn 后缀通配(modelscope.cn/清华镜像族)+ 阿里云镜像族(非 .cn 后缀)。
_DIRECT_HOST_SUFFIXES = (
    ".cn",
    ".aliyun.com",
    ".aliyuncs.com",
    ".taobao.com",
)


def _routes_direct(host: str) -> bool:
    """该主机是否恒直连:本机回环 + 国内域名后缀。"""
    if host in _LOOPBACK_HOSTS:
        return True
    return any(host.endswith(suffix) for suffix in _DIRECT_HOST_SUFFIXES)


def outbound_proxy_url() -> str | None:
    """本机出站代理地址;无显式配置且探测不到本机代理时返回 None(直连)。"""
    global _outbound_proxy_cache
    explicit = os.environ.get("MYSTUDIO_OUTBOUND_PROXY")
    if explicit is not None:
        return explicit.strip() or None
    now = time.monotonic()
    if _outbound_proxy_cache is not None and now - _outbound_proxy_cache[0] < _PROXY_CACHE_TTL_S:
        return _outbound_proxy_cache[1]
    found: str | None = None
    for port in _PROXY_CANDIDATE_PORTS:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.25):
                found = f"http://127.0.0.1:{port}"
                break
        except OSError:
            continue
    _outbound_proxy_cache = (now, found)
    return found


def proxy_env_vars() -> dict[str, str] | None:
    """代理环境变量表(git/pip 子进程与进程内下载库共用);无代理返回 None。"""
    url = outbound_proxy_url()
    if not url:
        return None
    return {
        "http_proxy": url, "https_proxy": url, "all_proxy": url,
        "HTTP_PROXY": url, "HTTPS_PROXY": url, "ALL_PROXY": url,
        # 本机回环(引擎 127.0.0.1:17xxx、sidecar 互访)绝不走代理
        "no_proxy": "127.0.0.1,localhost", "NO_PROXY": "127.0.0.1,localhost",
    }


def urlopen_outbound(req: request.Request, timeout: float):
    """外网 HTTP 统一口(urllib):域名级动态路由(09-19)。

    规则:本机回环与国内域名(见 _DIRECT_HOST_SUFFIXES)恒直连——引擎健康
    检查(system_stats/object_info)进了代理会被 Clash 拒掉、引擎被误判为挂,
    国内源(ModelScope 等)直连本来就快;其余境外域名探测到本机代理则走
    ProxyHandler,否则直连。
    """
    host = (urlparse.urlsplit(req.full_url).hostname or "").lower()
    if _routes_direct(host):
        return request.urlopen(req, timeout=timeout)
    proxy = outbound_proxy_url()
    if proxy:
        opener = request.build_opener(request.ProxyHandler({"http": proxy, "https": proxy}))
        return opener.open(req, timeout=timeout)
    return request.urlopen(req, timeout=timeout)


@contextmanager
def outbound_proxy_env():
    """进程内下载库(huggingface_hub/requests,trust_env 读环境变量)的代理窗口。

    探测到代理 → 临时写入 os.environ,退出原样还原(含删除原先没有的键);
    无代理 → 什么都不做。
    """
    env = proxy_env_vars()
    if not env:
        yield
        return
    saved = {key: os.environ.get(key) for key in env}
    os.environ.update(env)
    try:
        yield
    finally:
        for key, value in saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
