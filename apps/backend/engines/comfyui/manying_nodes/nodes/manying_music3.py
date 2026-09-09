# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""Music3 本地作曲节点(09-09 用户裁定:MiniMax M3 转入 ComfyUI 使用)。

文本 → AUDIO:HTTP 调应用托管的 mlx-serve(本地 bf16,免费不联网),
与 辅助→音乐 页同一引擎同一配置;serve 未起时大白话指路。"""

from __future__ import annotations

import json
import os
import urllib.request
from pathlib import Path

# 端口/配置解析三档:env 显式 > userData 配置账 > 默认 11273(冷门端口裁定)
_DEFAULT_SERVE = "http://127.0.0.1:11273"


def resolve_serve_url() -> str:
    env = os.environ.get("MYSTUDIO_MUSIC3_SERVE_URL", "").strip()
    if env:
        return env.rstrip("/")
    user_data = os.environ.get("MYSTUDIO_USER_DATA", "").strip()
    if not user_data:
        cand = Path.home() / "Library" / "Application Support" / "漫影工作室"
        user_data = str(cand) if cand.is_dir() else ""
    if user_data:
        cfg = Path(user_data) / "music3-mlxserv-config.json"
        try:
            port = json.loads(cfg.read_text(encoding="utf-8")).get("port")
            if isinstance(port, int) and 0 < port < 65536:
                return f"http://127.0.0.1:{port}"
        except (OSError, ValueError):
            pass
    return _DEFAULT_SERVE


def _http_json(url: str, payload: dict, timeout: float) -> bytes:
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}, method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


class ManyingMusic3:
    """漫影 Music3 本地作曲:提示词/歌词 → 整曲音频(本地 MLX 引擎)。"""

    CATEGORY = "manying"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "prompt": ("STRING", {"multiline": True, "default": "", "placeholder": "风格与内容描述(如:中国风史诗战斗曲)"}),
                "lyrics": ("STRING", {"multiline": True, "default": "[Instrumental]", "placeholder": "歌词;纯音乐留 [Instrumental]"}),
                "duration_seconds": ("INT", {"default": 60, "min": 10, "max": 300}),
                "steps": ("INT", {"default": 30, "min": 4, "max": 100}),
                "seed": ("INT", {"default": 7, "min": 0, "max": 2**31 - 1}),
            }
        }

    RETURN_TYPES = ("AUDIO",)
    RETURN_NAMES = ("audio",)
    FUNCTION = "run"

    def run(self, prompt, lyrics, duration_seconds, steps, seed):
        import torch

        serve = resolve_serve_url()
        payload = {
            "prompt": prompt or "",
            "lyrics": (lyrics or "").strip() or "[Instrumental]",
            "duration_seconds": int(duration_seconds),
            "steps": int(steps),
            "seed": int(seed),
        }
        try:
            wav_bytes = _http_json(f"{serve}/v1/audio/music-generations", payload, timeout=660.0)
        except OSError as exc:
            raise RuntimeError(
                f"本地音乐引擎(mlx-serve)未响应:先在 应用「辅助→音乐」页点「准备运行时」再回来跑这个节点。({exc})"
            ) from exc
        if len(wav_bytes) < 44:
            raise RuntimeError(f"本地音乐引擎返回过短({len(wav_bytes)}B),请重试")

        import io

        import soundfile as sf

        data, sample_rate = sf.read(io.BytesIO(wav_bytes), dtype="float32")
        waveform = torch.from_numpy(data)
        if waveform.dim() == 1:
            waveform = waveform.unsqueeze(0)  # 单声道 → (1, samples)
        elif waveform.dim() == 2:
            waveform = waveform.T.contiguous()  # sf.read 给 (帧, 声道) → (声道, 帧)
        # AUDIO 惯例 (batch=1, channels, samples)
        return ({"waveform": waveform.unsqueeze(0), "sample_rate": sample_rate},)
