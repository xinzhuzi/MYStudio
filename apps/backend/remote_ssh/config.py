"""ssh-remote.json 读写(11-03 sidecar-ssh-module R1)。

范式照 remote-engine.json:
  读 = comfyui_bridge.remote_engine_url_from_settings(损坏仅告警回退默认,
       engines/image_engine/comfyui_bridge.py:139-164);
  写 = engine_manager.set_remote_engine 的 tmp+replace 原子写
       (comfyui/engine_manager.py:2624-2659)。

host 空 = 未配置(SSH 链整体 fail-open 到现状);UI 保存时 host 空则预填
远端引擎 URL 的 hostname(与设置页引擎地址行同源)。写后触发 SSHService
重载(keeper 热重读配置,无需重启 sidecar)。
"""

from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import urlparse

CONFIG_FILE_NAME = "ssh-remote.json"
DEFAULT_SSH_PORT = 22
DEFAULT_TUNNEL_LOCAL_PORT = 17596
# Windows 令牌真源主路径(deploy-dual.sh:29-34 注释链;中文路径冒烟已证可读)
DEFAULT_REMOTE_TOKEN_CONFIG_PATH = "E:/IP/漫影工作室/python/profiles/image-gen/config.json"
# %APPDATA% 同构路径的模板(用户名拼入;冒烟对照脚本同款)
_APPDATA_TOKEN_CONFIG_TEMPLATE = (
    "C:/Users/{user}/AppData/Roaming/漫影工作室/python/profiles/image-gen/config.json"
)


def default_config() -> dict:
    """默认配置(host 空 = 未配置)。"""
    return {
        "host": "",
        "port": DEFAULT_SSH_PORT,
        "user": "",
        "keyPath": "",
        "tunnelEnabled": True,
        "tunnelLocalPort": DEFAULT_TUNNEL_LOCAL_PORT,
        "tokenConfigPaths": [],
    }


def default_token_config_paths(user: str = "") -> list[str]:
    """令牌真源默认两条:安装位主路径 + %APPDATA% 同构回退路径。"""
    paths = [DEFAULT_REMOTE_TOKEN_CONFIG_PATH]
    if user:
        paths.append(_APPDATA_TOKEN_CONFIG_TEMPLATE.format(user=user))
    return paths


def effective_token_config_paths(cfg: dict) -> list[str]:
    """实际生效的令牌真源列表:配置显式给了就用配置,空则给默认两条。"""
    explicit = [p for p in (cfg.get("tokenConfigPaths") or []) if isinstance(p, str) and p.strip()]
    if explicit:
        return explicit
    return default_token_config_paths(cfg.get("user") or "")


def config_path() -> Path:
    """ssh-remote.json 位置 = comfyui 家(与 remote-engine.json 同家)。"""
    # 惰性 import(照 comfyui_bridge 同款):krea2 等链零额外加载
    from comfyui.manifest import comfy_home

    return comfy_home() / CONFIG_FILE_NAME


def load_config() -> dict:
    """读配置;缺文件=默认(常态静默),损坏=告警一行后回退默认。"""
    cfg = default_config()
    try:
        data = json.loads(config_path().read_text(encoding="utf-8"))
    except OSError:
        return cfg  # 缺文件=未配置(常态,静默)
    except (json.JSONDecodeError, ValueError):
        print("[remote-ssh] ssh-remote.json 损坏,已忽略并回退默认", flush=True)
        return cfg
    if not isinstance(data, dict):
        # 顶层数组/字符串等非对象形态:同判损坏(照 remote-engine.json 口径)
        print("[remote-ssh] ssh-remote.json 损坏(非对象),已忽略并回退默认", flush=True)
        return cfg
    _merge_known_fields(cfg, data)
    return cfg


def save_config(payload: dict) -> dict:
    """UI 保存(POST /comfy/ssh/config):校验合并 → tmp+replace 原子写 → 通知重载。

    host 空时预填远端引擎 URL 的 hostname(与引擎地址行同源);仍取不到则
    保存空串(=未配置态)。tokenConfigPaths 是落盘字段但 UI 保存体永不携带
    (ComfySshConfigInput 五字段):payload 未给时继承旧档,手编辑的自定义
    令牌真源不被一次保存清空(R1 契约)。返回保存后的完整配置(回显)。
    """
    if not isinstance(payload, dict):
        raise ValueError("请求体必须是 JSON 对象")
    # 惰性 import:comfyui_bridge 顶层不依赖本包,无环
    from engines.image_engine.comfyui_bridge import remote_engine_url_from_settings

    normalized = dict(payload)
    if not str(normalized.get("host") or "").strip():
        remote_url = remote_engine_url_from_settings() or ""
        normalized["host"] = urlparse(remote_url).hostname or ""
    cfg = default_config()
    _merge_known_fields(cfg, normalized)
    # payload 未带 tokenConfigPaths(UI 常态)→ 继承旧档;显式给了列表(含空
    # 表=有意清回默认两条)则尊重 payload,不偷改
    if not isinstance(normalized.get("tokenConfigPaths"), list):
        inherited = load_config().get("tokenConfigPaths")
        if inherited:
            cfg["tokenConfigPaths"] = inherited
    path = config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)
    _notify_service_reload()
    return cfg


def _merge_known_fields(cfg: dict, data: dict) -> None:
    """已知字段逐一吸收:类型不对/越界的静默回退默认(宽进严出)。"""
    host = str(data.get("host") or "").strip()
    if host:
        cfg["host"] = host
    port = data.get("port")
    if isinstance(port, int) and not isinstance(port, bool) and 1 <= port <= 65535:
        cfg["port"] = port
    user = str(data.get("user") or "").strip()
    if user:
        cfg["user"] = user
    key_path = str(data.get("keyPath") or "").strip()
    if key_path:
        cfg["keyPath"] = key_path
    if isinstance(data.get("tunnelEnabled"), bool):
        cfg["tunnelEnabled"] = data["tunnelEnabled"]
    tunnel_port = data.get("tunnelLocalPort")
    if isinstance(tunnel_port, int) and not isinstance(tunnel_port, bool) and 1 <= tunnel_port <= 65535:
        cfg["tunnelLocalPort"] = tunnel_port
    paths = data.get("tokenConfigPaths")
    if isinstance(paths, list):
        cleaned = [str(p).strip() for p in paths if isinstance(p, str) and p.strip()]
        if cleaned:
            cfg["tokenConfigPaths"] = cleaned


def _notify_service_reload() -> None:
    """写后触发 SSHService 重载;失败不阻断保存(fail-open)。"""
    try:
        # 惰性 import 避免 config↔service 顶层互环(service 顶层 import config)
        from remote_ssh import service as _service

        _service.notify_config_changed()
    except Exception as exc:  # noqa: BLE001 — 保存成功优先,重载只降级
        print(f"[remote-ssh] 配置已保存但服务重载通知失败: {exc}", flush=True)
