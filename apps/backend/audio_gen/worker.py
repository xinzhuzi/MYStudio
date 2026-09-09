"""CLI 服务面(spawn 面:python -m audio_gen.worker)。

推理底层已拆至 engines/audio_engine/(09-09 引擎层统一);本文件只留
argparse/probe/artifact 编排,零模型逻辑。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from engines.audio_engine.generate import DEFAULT_MODEL, AudioGenError, generate_music
from engines.audio_engine.model_cache import (
    AUDIO_MODELS,
    find_cached_audio_model,

)

def main() -> None:
    parser = argparse.ArgumentParser(description="MYStudio local music generation worker")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--probe", action="store_true")
    group.add_argument("--generate", action="store_true")
    parser.add_argument("--prompt", type=str)
    parser.add_argument("--seconds", type=float, default=15.0)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--output", type=str)
    parser.add_argument("--artifact", type=str, help="Optional artifact JSON output path")
    args = parser.parse_args()

    if args.probe:
        spec = AUDIO_MODELS.get(args.model)
        cached = find_cached_audio_model(spec["repo_ids"]) if spec else None
        print(json.dumps({
            "status": "ready" if cached else "blocked",
            "model": args.model,
            "sizeMb": cached["size_mb"] if cached else None,
        }, ensure_ascii=False))
        return

    if args.generate:
        if not args.prompt or not args.output:
            print(json.dumps({"status": "blocked", "code": "missing-args", "message": "--generate 需要 --prompt 和 --output"}))
            sys.exit(2)
        try:
            result = generate_music(args.prompt, args.output, args.seconds, args.model)
        except AudioGenError as exc:
            payload = {"status": "blocked", "code": exc.code, "message": exc.message}
            if args.artifact:
                Path(args.artifact).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
            print(json.dumps(payload, ensure_ascii=False))
            sys.exit(2)
        if args.artifact:
            Path(args.artifact).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(result, ensure_ascii=False))
        return


if __name__ == "__main__":
    main()
