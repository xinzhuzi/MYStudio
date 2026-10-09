#!/usr/bin/env python3
"""qi21 官方参数化·契约测试重锚补丁(1008;恰N命中,幂等跳过)。

前提:并行 R3 役正活跃编辑同一测试文件(17:38/17:43 两次写),本补丁由
调度方在 mtime 稳定后应用,避免读改写互相覆盖。
补丁:①链常量 ②签名 ③census ④a循环入口 ④b链断言块 ④clora扇出
④d seed扇出 ⑤test_sampler_params ⑥test_steps_panel ⑦seed单源测试
⑧qi21 lora_slot 调用传链参。
"""
import shutil
import sys
import time
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
T = REPO / "apps/backend/engines/comfyui/tests/test_qwen21_workflow_contract.py"
BAK = REPO / "apps/build/scripts/backups/qi21_viggle_v03_official_1008"

OLD_LOOP = '''    for (sid, want_steps, model_want, pos_b), want_cfg in zip(
            ((ks_direct, STEPS_DIRECT, (-10, b_idx["model"]), pos_direct),
             (ks_viggle, STEPS_VIGGLE, (lora_id, 0), pos_accel)), ks_cfgs):'''
NEW_LOOP = '''    _vig_is_chain = viggle_chain is not None
    _ks_entries = [
        ((ks_direct, STEPS_DIRECT, (-10, b_idx["model"]), pos_direct), ks_cfgs[0])
    ] + (
        [] if _vig_is_chain else
        [((ks_viggle, STEPS_VIGGLE, (lora_id, 0), pos_accel), ks_cfgs[1])])
    for (sid, want_steps, model_want, pos_b), want_cfg in _ks_entries:'''

OLD_STEPS = '''        assert sorted(n["widgets_values"][K_SAMPLER_WV["steps"]]
                      for n in (x_nodes[QI21_SAMPLER_ID], x_nodes[QI21_SAMPLER_VIG_ID])) \\
            == sorted([STEPS_DIRECT, STEPS_VIGGLE])'''
NEW_STEPS = '''        # 1008 官方参数化:qi21 viggle 支路步数=官方 6σ 表长(链内 CustomSigmas)
        if x_nodes[QI21_SAMPLER_VIG_ID]["type"] == "SamplerCustomAdvanced":
            _cs = [n for n in x_nodes.values() if n["type"] == "CustomSigmas"]
            assert len(_cs) == 1 and _cs[0]["widgets_values"][1] == 0
            _n_sig = len([v for v in str(_cs[0]["widgets_values"][0]).split(",") if v.strip()])
            assert sorted([x_nodes[QI21_SAMPLER_ID]["widgets_values"][K_SAMPLER_WV["steps"]],
                           _n_sig]) == sorted([STEPS_DIRECT, STEPS_VIGGLE])
        else:
            assert sorted(n["widgets_values"][K_SAMPLER_WV["steps"]]
                          for n in (x_nodes[QI21_SAMPLER_ID], x_nodes[QI21_SAMPLER_VIG_ID])) \\
                == sorted([STEPS_DIRECT, STEPS_VIGGLE])'''

PATCHES = [
    ('EDIT_SAMPLER_VIG_ID, EDIT_SEED_ID = 7012, 7014\n',
     'EDIT_SAMPLER_VIG_ID, EDIT_SEED_ID = 7012, 7014\n'
     '# 1008 官方参数化(用户令):qi21 viggle 支路=SamplerCustomAdvanced 官方链\n'
     '# (v0.3 口径:6σ 定制表逐字+BasicGuider cfg1 单正条件+euler;官方 ViggleTurboSigmas\n'
     '# 以已装 KJNodes CustomSigmas 等位替用,interpolate_to_steps=0=不插值)\n'
     'QI21_VIG_CHAIN = {"noise": 7017, "select": 7018, "guider": 7019, "sigmas": 7020}\n'
     'VIGGLE_OFFICIAL_SIGMAS = "1.0, 0.9375, 0.875, 0.75, 0.5, 0.25"\n', 1),

    ('                           note_id: int | None = None,\n'
     '                           ks_cfgs: tuple = (1, 1),',
     '                           note_id: int | None = None,\n'
     '                           ks_cfgs: tuple = (1, 1),\n'
     '                           viggle_class: str = "KSampler",\n'
     '                           viggle_chain: dict | None = None,', 1),

    ('    want_census = {sel_id: SPEED_SELECT_CLASS, ks_direct: "KSampler",\n'
     '                   ks_viggle: "KSampler", lora_id: "LoraLoaderModelOnly",\n'
     '                   t8_id: T8_CLASS, seed_id: "PrimitiveInt"}\n'
     '    if note_id is not None:\n'
     '        want_census[note_id] = "Note"\n',
     '    want_census = {sel_id: SPEED_SELECT_CLASS, ks_direct: "KSampler",\n'
     '                   ks_viggle: viggle_class, lora_id: "LoraLoaderModelOnly",\n'
     '                   t8_id: T8_CLASS, seed_id: "PrimitiveInt"}\n'
     '    if note_id is not None:\n'
     '        want_census[note_id] = "Note"\n'
     '    if viggle_chain:\n'
     '        want_census.update({viggle_chain["noise"]: "RandomNoise",\n'
     '                            viggle_chain["select"]: "KSamplerSelect",\n'
     '                            viggle_chain["guider"]: "BasicGuider",\n'
     '                            viggle_chain["sigmas"]: "CustomSigmas"})\n', 1),

    (OLD_LOOP, NEW_LOOP, 1),

    ('        _lat = i_links[next(i["link"] for i in ks["inputs"] if i["name"] == "latent_image")]\n'
     '        assert (_lat["origin_id"], _lat["origin_slot"]) == (-10, b_idx["latent"]), \\\n'
     '            f"{name}: [{sid}].latent_image 应接 -10 latent 槽(三支路同源)"\n',
     '        _lat = i_links[next(i["link"] for i in ks["inputs"] if i["name"] == "latent_image")]\n'
     '        assert (_lat["origin_id"], _lat["origin_slot"]) == (-10, b_idx["latent"]), \\\n'
     '            f"{name}: [{sid}].latent_image 应接 -10 latent 槽(三支路同源)"\n'
     '    if _vig_is_chain:\n'
     '        # 1008 官方链:SamplerCustomAdvanced+BasicGuider(cfg1 单正条件,负向不接)\n'
     '        # +CustomSigmas 官方6σ 逐字+RandomNoise(seed 单源改喂 noise_seed)\n'
     '        vc = viggle_chain\n'
     '        sc = i_nodes[ks_viggle]\n'
     '        assert sc["type"] == "SamplerCustomAdvanced", f"{name}: [{ks_viggle}] 应官方链采样器"\n'
     '        _in = {i["name"]: i for i in sc["inputs"]}\n'
     '        for nm, want in (("noise", (vc["noise"], 0)), ("guider", (vc["guider"], 0)),\n'
     '                         ("sampler", (vc["select"], 0)), ("sigmas", (vc["sigmas"], 0)),\n'
     '                         ("latent_image", (-10, b_idx["latent"]))):\n'
     '            _l = i_links[_in[nm]["link"]]\n'
     '            assert (_l["origin_id"], _l["origin_slot"]) == want, \\\n'
     '                f"{name}: [{ks_viggle}].{nm} 上游应 {want}(官方链接线)"\n'
     '        assert not any(i["name"] == "negative" for i in sc["inputs"]), \\\n'
     '            f"{name}: 官方链无负向槽(cfg1=空负向)"\n'
     '        _gu = i_nodes[vc["guider"]]\n'
     '        _gl = i_links[next(i["link"] for i in _gu["inputs"] if i["name"] == "model")]\n'
     '        assert (_gl["origin_id"], _gl["origin_slot"]) == (lora_id, 0), \\\n'
     '            f"{name}: BasicGuider.model 应=LoRA 后"\n'
     '        _gp = i_links[next(i["link"] for i in _gu["inputs"] if i["name"] == "conditioning")]\n'
     '        assert (_gp["origin_id"], _gp["origin_slot"]) == (-10, b_idx[pos_accel]), \\\n'
     '            f"{name}: BasicGuider.conditioning 应=加速支路正源槽(cfg1)"\n'
     '        _sel_n = i_nodes[vc["select"]]\n'
     '        assert _sel_n["widgets_values"] == ["euler"], f"{name}: 链采样器应 euler"\n'
     '        _sg_n = i_nodes[vc["sigmas"]]\n'
     '        assert _sg_n["widgets_values"][1] == 0, f"{name}: CustomSigmas 插值必须 0(官方表逐字)"\n'
     '        _sv = [v.strip() for v in str(_sg_n["widgets_values"][0]).split(",") if v.strip()]\n'
     '        assert [float(x) for x in _sv] == [1.0, 0.9375, 0.875, 0.75, 0.5, 0.25], \\\n'
     '            f"{name}: 官方 6σ 表逐字(v0.3 口径),得 {_sv}"\n'
     '        _rn = next(i for i in i_nodes[vc["noise"]]["inputs"] if i["name"] == "noise_seed")\n'
     '        assert "widget" in _rn and i_links[_rn["link"]]["origin_id"] == seed_id, \\\n'
     '            f"{name}: RandomNoise.noise_seed 应接 [{seed_id}] 单源"\n', 1),

    ('    lora_fans = sorted(lora["outputs"][0]["links"] or [])\n'
     '    assert len(lora_fans) == 1 and i_links[lora_fans[0]]["target_id"] == ks_viggle, \\',
     '    lora_fans = sorted(lora["outputs"][0]["links"] or [])\n'
     '    _lora_feed = viggle_chain["guider"] if viggle_chain else ks_viggle\n'
     '    assert len(lora_fans) == 1 and i_links[lora_fans[0]]["target_id"] == _lora_feed, \\', 1),

    ('    want_targets = sorted([(ks_direct, "seed"), (ks_viggle, "seed"), (t8_id, "seed")])',
     '    want_targets = sorted([(ks_direct, "seed"), (t8_id, "seed")]\n'
     '                          + ([(viggle_chain["noise"], "noise_seed")] if viggle_chain\n'
     '                             else [(ks_viggle, "seed")]))', 1),

    ('                samplers = [n for n in _xsg(graph)["nodes"] if n["type"] == "KSampler"]\n'
     '                assert len(samplers) == 2, \\\n'
     '                    f"{name}: 加速子图内 KSampler 应恰 2 个(直出/viggle 支路),得 {len(samplers)}"\n'
     '                assert sorted(s["widgets_values"][K_SAMPLER_WV["steps"]] for s in samplers) \\\n'
     '                    == sorted([STEPS_DIRECT, STEPS_VIGGLE]), \\\n'
     '                    f"{name}: 两支路 steps 应=40/6(面板=生效值;1002 viggle 考据)"',
     '                samplers = [n for n in _xsg(graph)["nodes"] if n["type"] == "KSampler"]\n'
     '                # 1008 官方参数化:qi21 viggle 支路=官方链(KSampler 仅直出)\n'
     '                if name == "qi21":\n'
     '                    assert len(samplers) == 1, \\\n'
     '                        f"{name}: 加速子图内 KSampler 应恰 1 个(直出;viggle=官方链),得 {len(samplers)}"\n'
     '                    _cs = [n for n in _xsg(graph)["nodes"] if n["type"] == "CustomSigmas"]\n'
     '                    assert len(_cs) == 1 and _cs[0]["widgets_values"][1] == 0\n'
     '                    assert len([v for v in str(_cs[0]["widgets_values"][0]).split(",") if v.strip()]) \\\n'
     '                        == STEPS_VIGGLE, f"{name}: 官方 6σ 步数"\n'
     '                else:\n'
     '                    assert len(samplers) == 2, \\\n'
     '                        f"{name}: 加速子图内 KSampler 应恰 2 个(直出/viggle 支路),得 {len(samplers)}"\n'
     '                    assert sorted(s["widgets_values"][K_SAMPLER_WV["steps"]] for s in samplers) \\\n'
     '                        == sorted([STEPS_DIRECT, STEPS_VIGGLE]), \\\n'
     '                        f"{name}: 两支路 steps 应=40/6(面板=生效值;1002 viggle 考据)"', 1),

    (OLD_STEPS, NEW_STEPS, 1),

    ('        for nid in (QI21_SAMPLER_ID, QI21_SAMPLER_VIG_ID, QI21_T8):\n'
     '            inp = next((i for i in x_nodes[nid]["inputs"] if i.get("name") == "seed"), None)\n'
     '            assert inp is not None and "widget" in inp and inp.get("link") is not None, \\\n'
     '                f"qi21 [{nid}].seed 应 widget 转输入接 [{QI21_SEED_ID}](不再外露 widget)"',
     '        _seed_fans = ((QI21_SAMPLER_ID, "seed"), (QI21_T8, "seed"),\n'
     '                      (QI21_VIG_CHAIN["noise"], "noise_seed"))  # 1008 官方链噪声件\n'
     '        for nid, want_name in _seed_fans:\n'
     '            inp = next((i for i in x_nodes[nid]["inputs"] if i.get("name") == want_name), None)\n'
     '            assert inp is not None and "widget" in inp and inp.get("link") is not None, \\\n'
     '                f"qi21 [{nid}].{want_name} 应 widget 转输入接 [{QI21_SEED_ID}](不再外露 widget)"', 1),

    ('            note_id=QI21_ACC_NOTE_ID,   # 1004 D6b:加速子图 [7016] 负向生效档位 Note\n'
     '            ks_cfgs=(4, 1),             # 1004 D6a:[7010] cfg4 负向真实生效;[7012] 恒 1',
     '            note_id=QI21_ACC_NOTE_ID,   # 1004 D6b:加速子图 [7016] 负向生效档位 Note\n'
     '            ks_cfgs=(4, 1),             # 1004 D6a:[7010] cfg4 负向真实生效;[7012] 恒 1\n'
     '            viggle_class="SamplerCustomAdvanced", viggle_chain=QI21_VIG_CHAIN,'
     '  # 1008 官方参数化', 1),
]


def main() -> None:
    text = T.read_text(encoding="utf-8")
    if "QI21_VIG_CHAIN" in text:
        print("[skip] 补丁已在位(幂等)")
        return
    shutil.copy2(T, BAK / "test_qwen21_workflow_contract.pre_vigchain.py")
    for i, (old, new, n) in enumerate(PATCHES, 1):
        c = text.count(old)
        assert c == n, f"[恰N拦停] 补丁{i} 期望 {n} 处,实为 {c} 处(锚漂移或并行改写)"
        text = text.replace(old, new)
    T.write_text(text, encoding="utf-8")
    print(f"[OK] {len(PATCHES)} 处重锚补丁应用毕(副本={BAK})")


if __name__ == "__main__":
    try:
        main()
    except AssertionError as e:
        print(f"FAIL: {e}", file=sys.stderr)
        sys.exit(1)
