"""t2i's head/body/tail reference contract for the legacy select wrapper."""
import importlib.util
import json
from pathlib import Path

import pytest

NODE = Path(__file__).resolve().parents[1] / "nodes/my_qi21_final_output.py"
SPEC = importlib.util.spec_from_file_location("final_output_round12", NODE)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
RGBA = json.loads(MODULE._BASES_JSON.read_bytes())["rgba"]


@pytest.mark.parametrize("body", [None, "", " \t正文\n原样保留。 \n", RGBA["w1_closing"]])
@pytest.mark.parametrize("transparent", [False, True])
@pytest.mark.parametrize("negative", [None, " \t", "  负面原文  "])
def test_final_output_only_wraps_head_body_tail(body, transparent, negative):
    direct = body if body is not None else ""
    expected = f'{RGBA["head"]} {direct} {RGBA["tail"]}' if transparent else direct
    assert MODULE.MyQi21FinalOutput().compose(
        正向提示词=body, 负向提示词=negative, 透明模式=transparent) == (
            expected, (negative or "").strip())
