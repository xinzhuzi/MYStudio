#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""qi21 单口战役实弹证2探针:引擎家部署副本(单口版)MyQi21PromptSelect 实调。

stdin=JSON:
  mode=compose:装配全文/PE出文/pe开关/透明模式/RGBA官方头句/RGBA官方尾句/W1收束句
    (null→None;布尔/字符串直传)→ compose() → stdout {md5,len,head40}
  mode=strip:text → strip_word_family(text) → {changed,orig_len,stripped_len}

与在跑引擎热读同一份部署副本(F5 口径对偶:验的就是引擎跑的代码)。
退出码 0=正常;2=件加载/执行异常(异常文本进 stdout JSON error 字段)。
"""
from __future__ import annotations

import contextlib
import hashlib
import importlib.util
import io
import json
import sys
from pathlib import Path

DEPLOY = (Path("~/Library/Application Support/漫影工作室/comfyui")
          / "ComfyUI/custom_nodes/my-nodes/nodes/my_qi21_prompt_select.py").expanduser()


def main() -> int:
    try:
        req = json.loads(sys.stdin.read())
        spec = importlib.util.spec_from_file_location("mqps_singleport", DEPLOY)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        sink = io.StringIO()  # 件内 print(如装配全文未接线中文警告)不得污染 stdout JSON
        if req.get("mode") == "strip":
            text = req["text"]
            with contextlib.redirect_stdout(sink):
                stripped = mod.strip_word_family(text)
            print(json.dumps({
                "changed": stripped != text,
                "orig_len": len(text), "stripped_len": len(stripped),
                "nodePrints": sink.getvalue()[-200:],
            }, ensure_ascii=False))
            return 0
        with contextlib.redirect_stdout(sink):
            out = mod.MyQi21PromptSelect().compose(
                装配全文=req.get("装配全文"),
                PE出文=req.get("PE出文"),
                pe开关=req.get("pe开关"),
                透明模式=bool(req.get("透明模式", False)),
                RGBA官方头句=req.get("RGBA官方头句"),
                RGBA官方尾句=req.get("RGBA官方尾句"),
                W1收束句=req.get("W1收束句"),
            )
        text = out[0]
        print(json.dumps({
            "md5": hashlib.md5(text.encode("utf-8")).hexdigest(),
            "len": len(text), "head40": text[:40],
            "nodePrints": sink.getvalue()[-200:],
        }, ensure_ascii=False))
        return 0
    except Exception as exc:  # noqa: BLE001 — 探针:异常即结果
        print(json.dumps({"error": f"{type(exc).__name__}: {exc}"[:400]}, ensure_ascii=False))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
