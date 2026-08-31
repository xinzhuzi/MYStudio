#!/usr/bin/env python3
"""model_cache env/行为对拍:重构前基线 vs 重构后复核。

用法:
  python3 apps/build/scripts/model_cache_env_parity.py --save     # 重构前打基线
  python3 apps/build/scripts/model_cache_env_parity.py --compare  # 重构后逐项对拍

原理:每个场景在隔离子进程(HOME→临时目录、清 HF*/MYSTUDIO*/MANYING* env)中
import 包模块、对伪造缓存夹具调用公共函数,输出 JSON 快照;两份快照必须逐字节一致。
"""
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
BACKEND = REPO / "apps" / "backend"
BASELINE = Path(__file__).resolve().parent / "model-cache-parity-baseline.json"

PINNED_CONTENT = b"pinned-model-bytes-0123456789"
PINNED_SHA = hashlib.sha256(PINNED_CONTENT).hexdigest()
OTHER_CONTENT = b"other-bytes"

PROBE = r"""
import json, sys, os
from pathlib import Path
out = {}
tmp = Path(sys.argv[1])
pkg = sys.argv[2]
scenario = sys.argv[3]

import importlib
m = importlib.import_module(f"{pkg}.model_cache")

def p(v):
    if isinstance(v, Path): return str(v)
    if isinstance(v, (list, tuple)): return [p(x) for x in v]
    if hasattr(v, "_asdict") or hasattr(v, "__dataclass_fields__"):
        return {k: p(getattr(v, k)) for k in v.__dataclass_fields__}
    if isinstance(v, dict): return {k: p(x) for k, x in v.items()}
    return v

hf1, hf2, hf3, pin1, pin2 = (tmp / d for d in ("hf1", "hf2", "hf3", "pin1", "pin2"))

if pkg == "tts":
    out["primary"] = p(m.primary_hf_cache_dir())
    out["download_dir"] = p(m.download_hf_cache_dir())
    out["cache_dirs"] = p(m.hf_cache_dirs())
    out["repo_name"] = p(m.repo_cache_name("test/model"))
    out["repo_dir_default"] = p(m.repo_cache_dir("test/model"))
    out["repo_dir_explicit"] = p(m.repo_cache_dir("test/model", hf1))
    out["find_complete"] = p(m.find_cached_repo(("test/model",), cache_dirs=[hf1]))
    out["find_incomplete"] = p(m.find_cached_repo(("test/model",), cache_dirs=[hf2]))
    out["tok_ok"] = p(m.has_cached_repo_files("test/tok", ("tokenizer.json",), cache_dirs=[hf3]))
    out["tok_missing"] = p(m.has_cached_repo_files("test/model", ("tokenizer.json",), cache_dirs=[hf1]))
elif pkg == "depth_estimation":
    out["primary"] = p(m.primary_hf_cache_dir())
    out["download_dir"] = p(m.download_hf_cache_dir())
    out["cache_dirs"] = p(m.hf_cache_dirs())
    out["repo_dir"] = p(m.repo_cache_dir("test/model", hf1))
    out["find_hit"] = p(m.find_cached_depth_model(("test/model",)))
    out["find_miss"] = p(m.find_cached_depth_model(("test/none",)))
elif pkg == "upscale":
    out["primary"] = p(m.primary_model_dir())
    out["candidates"] = p(m.model_candidate_dirs())
    out["sha_of_pinned"] = m.file_sha256(pin1 / "dover_mobile.pth")
    out["find_wrong_pin"] = p(m.find_cached_upscale_model("realesrgan-x4plus-anime-6b"))
    out["verify_wrong_pin"] = p(m.verify_model_sha256("realesrgan-x4plus-anime-6b"))
elif pkg == "video_qc":
    out["primary"] = p(m.primary_model_dir())
    out["candidates"] = p(m.model_candidate_dirs())
    out["find_wrong_pin"] = p(m.find_cached_video_qc_model("dover-mobile"))
    out["verify_wrong_pin"] = p(m.verify_model_sha256("dover-mobile"))
print(json.dumps(out, ensure_ascii=False, sort_keys=True))
"""


def build_fixtures(tmp: Path) -> dict[str, Path]:
    hf1 = tmp / "hf1" / "models--test--model"
    (hf1 / "snapshots" / "rev1").mkdir(parents=True)
    (hf1 / "snapshots" / "rev1" / "model.safetensors").write_bytes(b"weights")
    hf2 = tmp / "hf2" / "models--test--model"
    (hf2 / "blobs").mkdir(parents=True)
    (hf2 / "blobs" / "abc.incomplete").write_bytes(b"x")
    (hf2 / "snapshots" / "rev1").mkdir(parents=True)
    (hf2 / "snapshots" / "rev1" / "model.safetensors").write_bytes(b"weights")
    hf3 = tmp / "hf3" / "models--test--tok"
    (hf3 / "snapshots" / "rev1").mkdir(parents=True)
    (hf3 / "snapshots" / "rev1" / "tokenizer.json").write_bytes(b"{}")
    pin1, pin2 = tmp / "pin1", tmp / "pin2"
    pin1.mkdir(); pin2.mkdir()
    (pin1 / "dover_mobile.pth").write_bytes(PINNED_CONTENT)
    (pin2 / "dover_mobile.pth").write_bytes(OTHER_CONTENT)
    home = tmp / "home"
    (home / ".cache" / "huggingface" / "hub").mkdir(parents=True)
    (home / "Library" / "Caches" / "huggingface" / "hub").mkdir(parents=True)
    return {"hf1": hf1, "hf2": hf2, "hf3": hf3, "pin1": pin1, "pin2": pin2, "home": home}


def run_scenario(tmp: Path, pkg: str, scenario: str, extra_env: dict[str, str]) -> dict:
    env = {"HOME": str(tmp / "home"), "PATH": "/usr/bin:/bin", "PYTHONPATH": str(BACKEND)}
    env.update(extra_env)
    r = subprocess.run(
        [sys.executable, "-c", PROBE, str(tmp), pkg, scenario],
        capture_output=True, text=True, env=env, cwd=str(BACKEND), timeout=60,
    )
    if r.returncode != 0:
        return {"__probe_error__": r.stderr.strip()[-400:]}
    # 临时目录每轮不同,归一化后再比对
    return json.loads(r.stdout.replace(str(tmp), "<TMP>"))


def collect() -> dict:
    results: dict[str, dict] = {}
    with tempfile.TemporaryDirectory(prefix="mc-parity-") as td:
        tmp = Path(td)
        fx = build_fixtures(tmp)
        scenarios = [
            ("tts", "no-env", {}),
            ("tts", "tts-dir", {"MANYING_TTS_MODELS_DIR": str(tmp / "tts_cache")}),
            ("tts", "voicebox", {"VOICEBOX_MODELS_DIR": str(tmp / "vb_cache")}),
            ("tts", "hf-hub", {"HF_HUB_CACHE": str(tmp / "hf_cache")}),
            ("tts", "hf-home", {"HF_HOME": str(tmp / "hf_home")}),
            ("depth_estimation", "no-env", {}),
            ("depth_estimation", "depth-dir", {"MYSTUDIO_DEPTH_MODEL_DIR": str(tmp / "d_cache")}),
            ("depth_estimation", "hf-home", {"HF_HOME": str(tmp / "hf_home")}),
            ("depth_estimation", "hf-hub-hit", {"HF_HUB_CACHE": str(tmp / "hf1")}),
            ("upscale", "no-env", {}),
            ("upscale", "upscale-dir", {"MYSTUDIO_UPSCALE_MODEL_DIR": str(fx["pin1"])}),
            ("video_qc", "no-env", {}),
            ("video_qc", "qc-dir", {"MYSTUDIO_VIDEO_QC_MODEL_DIR": str(fx["pin1"])}),
        ]
        for pkg, name, extra in scenarios:
            results[f"{pkg}:{name}"] = run_scenario(tmp, pkg, name, extra)
    return results


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "--compare"
    data = collect()
    if mode == "--save":
        BASELINE.write_text(json.dumps(data, ensure_ascii=False, indent=1, sort_keys=True), encoding="utf-8")
        print(f"基线已存: {BASELINE}({len(data)} 场景)")
        sys.exit(0)
    if not BASELINE.exists():
        print("!! 无基线,先 --save"); sys.exit(2)
    base = json.loads(BASELINE.read_text(encoding="utf-8"))
    diffs = []
    for key in sorted(set(base) | set(data)):
        if json.dumps(base.get(key), sort_keys=True) != json.dumps(data.get(key), sort_keys=True):
            diffs.append(key)
            print(f"✗ {key}\n  基线: {json.dumps(base.get(key), ensure_ascii=False, sort_keys=True)[:300]}\n  现值: {json.dumps(data.get(key), ensure_ascii=False, sort_keys=True)[:300]}")
    if diffs:
        print(f"\n对拍失败: {len(diffs)} 场景漂移"); sys.exit(1)
    print(f"对拍通过: {len(data)} 场景全部一致")
