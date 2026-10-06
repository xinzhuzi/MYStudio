"""MyQi21ApiPE 机器自检+有界重试(1006 B案)单元测试。

三检纯函数(负向逐条/透明黑名单/色词逐字)+补发链路 mock(urllib 假两稿:
第一稿缺负向词→补发→第二稿全→取第二稿;以及重试未更优→保留第一稿)。
"""
from __future__ import annotations

import io
import json
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from engines.comfyui.my_nodes.nodes import my_qi21_api_pe as apipe  # noqa: E402

SUBJ = "一位年轻女修，青玉色道袍束月白腰带，腰侧悬暗红剑穗长剑。"
COLORS = ("青玉色", "月白", "暗红")


class TestSubjectColors(unittest.TestCase):
    def test_extracts_pattern_colors_from_subject(self):
        got = apipe._subject_colors(SUBJ)
        for c in COLORS:
            self.assertIn(c, got, f"应提取色词:{c}")

    def test_canon_names_in_subject_found(self):
        got = apipe._subject_colors("袍角一点朱红，鞘口鎏金")
        self.assertIn("朱红", got)
        self.assertIn("鎏金", got)


    def test_overlap_boundary_no_false_positive(self):
        """阶下青灰:取真色词青灰,弃跨界误报下青(1006实弹教训)。"""
        got = apipe._subject_colors("视线越过阶下青灰云海望向远处")
        self.assertIn("青灰", got)
        self.assertNotIn("下青", got)

    def test_whitespace_normalized_containment(self):
        """负向"软 3D体积塑形"(带空格)不得误报缺"软3D体积塑形"。"""
        v = apipe._self_check("青玉色道袍束月白腰带暗红剑穗",
                              "模糊,软 3D体积塑形", ["模糊", "软3D体积塑形"],
                              False, SUBJ)
        self.assertEqual(v, [])


    def test_env_bound_color_exempt_in_transparent(self):
        """阶下青灰云海:透明开青灰随云海合法删(不检);关模式仍检。"""
        subj2 = "视线越过阶下青灰云海望向远处，身着青玉色道袍。"
        self.assertNotIn("青灰", apipe._subject_colors(subj2, True))
        self.assertIn("青灰", apipe._subject_colors(subj2, False))
        self.assertIn("青玉色", apipe._subject_colors(subj2, True))

    def test_negative_needle_whitespace_normalized(self):
        """词表针"光面现代 CG 特写"带空格,输出连写不得误报(1006实弹)。"""
        v = apipe._self_check("青玉色道袍束月白腰带暗红剑穗",
                              "模糊,光面现代CG特写",
                              ["模糊", "光面现代 CG 特写"], False, SUBJ)
        self.assertEqual(v, [])


    def test_verb_color_no_false_positive(self):
        """剑柄缠灰银丝:取灰银,弃动词跨界误报缠灰(1006实弹)。"""
        got = apipe._subject_colors("剑柄缠灰银丝，鞘口垂暗红剑穗")
        self.assertIn("灰银", got)
        self.assertNotIn("缠灰", got)

    def test_stage_word_flagged_when_dropped(self):
        """筑基后期丢失=身份漂移,机检点名。"""
        v = apipe._self_check("年轻女修青玉色道袍(境界词丢了)", "模糊",
                              ["模糊"], False, "一位筑基后期的年轻女修，青玉色道袍。")
        self.assertIn("境界丢:筑基后期", v)


    def test_strip_env_sentences_pure_env_dropped(self):
        """纯环境句(无主体锚)整句删;带主体色词的混句保留。"""
        subj2 = ("一位年轻女修，青玉色道袍束月白腰带，腰侧悬暗红剑穗长剑，"
                 "视线越过阶下青灰云海望向远处，衣袂被山风微微掀起。")
        pos = ("透明底立绘素材，青玉色道袍束月白腰带，素银簪固定发型，"
               "乌木剑鞘白玉剑格齐全，右手轻按剑柄姿态从容，"
               "长发半束发际线清晰，鞋靴完整可穿。"
               "背景为多色相铺陈的山水基底：淡墨远山、青绿草木各安其位。"
               "视线越过阶下青灰云海望向远处。")
        out = apipe._strip_env_sentences(pos, subj2)
        self.assertNotIn("山水基底", out)   # 纯环境句:整句删
        self.assertNotIn("草木", out)
        self.assertIn("青灰云海", out)      # 混句:带主体色词青灰,保留交补发
        self.assertIn("青玉色道袍", out)

    def test_strip_env_sentences_overdelete_guard(self):
        """误删保护:删完低于下限(25%/40字)回退原文。"""
        pos = "背景为远山。云海翻涌。天空辽阔。"
        self.assertEqual(apipe._strip_env_sentences(pos, SUBJ), pos)

    def test_part_noun_flagged_when_dropped(self):
        """部件名词表:乌木剑鞘丢失(剑鞘不在场)机检点名(1006道具案)。"""
        v = apipe._self_check("青锋剑白玉剑格俱全(鞘丢了)", "模糊",
                              ["模糊"], False, "乌木剑鞘包鎏金，白玉剑格。")
        self.assertIn("部件丢:剑鞘", v)
        self.assertNotIn("部件丢:剑格", v)


    def test_off_mode_env_keep(self):
        """关模式对称检:主体句云海被删=违例(1007美宣案)。"""
        subj2 = "女修立于孤峰之巅，脚下青灰云海翻涌，天际旧金色晨光。"
        v = apipe._self_check("女修立于孤峰之巅，衣袂翻飞。", "模糊",
                              ["模糊"], False, subj2)
        self.assertIn("环境丢:云海", v)
        v2 = apipe._self_check("女修立于孤峰之巅，脚下青灰云海翻涌。", "模糊",
                               ["模糊"], False, subj2)
        self.assertNotIn("环境丢:云海", v2)


    def test_hot_colors_full_fallback_42(self):
        """v9:不接线兜底=42色全量(教材已不带色库,兜底不得缺canon名)。"""
        apipe._ctx_cache.update(mtime=None, style=None, colors=None)
        _, colors = apipe._context_materials()
        self.assertIn("★在用", colors)
        self.assertIn("碧玉", colors)      # canon玉石组(非在用,考全库)
        self.assertIn("冲突裁决序", colors)
        self.assertGreater(len(colors), 800)


    def test_env_paren_notes_stripped(self):
        """透明开:括号补注里的环境词整段剥(1007 v9案:"(虽背景透明…山门石阶…)")。"""
        pos = ("她伫立在画面的视觉中心（虽背景透明，但姿态暗示其原立于山门石阶最上一级），"
               "腰侧悬系一条石青剑绦。视线越过阶下（原为青灰云海与淡墨远山）。")
        out = apipe._strip_env_parens(pos)
        self.assertNotIn("山门石阶", out)
        self.assertNotIn("云海", out)
        self.assertNotIn("（", out)
        self.assertIn("石青剑绦", out)

    def test_no_colors_no_extraction(self):
        self.assertEqual(apipe._subject_colors("山门石阶蜿蜒而上"), [])


class TestSelfCheck(unittest.TestCase):
    def test_negative_missing_token_flagged(self):
        v = apipe._self_check("青玉色道袍束月白腰带暗红剑穗", "模糊,水印",
                              ["模糊", "水印", "剑穗断裂"], False, SUBJ)
        self.assertEqual(v, ["负向缺:剑穗断裂"])

    def test_all_pass_clean(self):
        pos = "青玉色道袍束月白腰带暗红剑穗,立于山门石阶,云海翻涌"
        v = apipe._self_check(pos, "模糊,水印,剑穗断裂",
                              ["模糊", "水印", "剑穗断裂"], False, SUBJ)
        self.assertEqual(v, [])

    def test_transparent_blacklist(self):
        pos = "青玉色道袍束月白腰带暗红剑穗,背景为云海,已移除远景"
        v = apipe._self_check(pos, "模糊", ["模糊"], True, SUBJ)
        joined = ";".join(v)
        for tok in ("背景", "云海", "已移除", "远景"):
            self.assertIn(tok, joined, f"透明开应点名:{tok}")

    def test_transparent_off_tolerates_env_words(self):
        pos = "青玉色道袍束月白腰带暗红剑穗,背景为云海"
        v = apipe._self_check(pos, "模糊", ["模糊"], False, SUBJ)
        self.assertEqual(v, [])

    def test_color_drop_flagged(self):
        v = apipe._self_check("道袍束腰带剑穗(色词全失)", "模糊", ["模糊"], False, SUBJ)
        dropped = [x for x in v if x.startswith("色词丢:")]
        self.assertTrue(set(COLORS) <= {x[4:] for x in dropped})


def _resp(pos: str, neg: str) -> bytes:
    body = json.dumps({"rewritten_prompt": pos, "negative_prompt": neg,
                       "wh_ratio": "2:3"}, ensure_ascii=False)
    return json.dumps({"choices": [{"message": {"content": body}}]},
                      ensure_ascii=False).encode("utf-8")


class _FakeResp:
    def __init__(self, payload: bytes):
        self._p = payload

    def read(self) -> bytes:
        return self._p


class TestRewriteRetry(unittest.TestCase):
    KW = dict(正向提示词=SUBJ, 负向提示词="剑穗断裂", 类型句正向="",
              类型句负向="模糊,水印", 画幅宽=1024, 画幅高=1536,
              透明模式=False, 系统提示词="教材", 色卡="色卡材料",
              美术风格底座="风格", api_url="http://fake",
              model="fake-model", temperature=0.7, max_tokens=512,
              timeout_sec=10)

    def _run(self, fake_urlopen, alive=True):
        buf = io.StringIO()
        # 1007 起 POST 走 _LAN_OPENER.open(绕系统代理)+发前 _alive 探活,
        # mock 靶随之换位;alive=False 可测「探活不通→透传」路
        with patch.object(apipe._LAN_OPENER, "open", side_effect=fake_urlopen), \
                patch.object(apipe, "_alive", return_value=alive), \
                patch.object(apipe, "_load_bases_node", return_value={}), \
                redirect_stdout(buf):
            out = apipe.MyQi21ApiPE().rewrite(**self.KW)
        return out, buf.getvalue()

    def test_thinking_effort_wiring(self):
        """1007 思考档位接线:关闭→顶层 reasoning_effort=none;思考(xhigh)→
        不发该参数(模板原生);无效的 chat_template_kwargs 与 /no_think 尾巴
        不再出现(1234 实弹定谳;「低」档实测无衰减已移除)。"""
        pos = "青玉色道袍束月白腰带暗红剑穗的完整描述。"
        bodies = []

        def fake(req, timeout=10):
            bodies.append(json.loads(req.data.decode()))
            return _FakeResp(_resp(pos, "模糊,水印,剑穗断裂"))

        out, _ = self._run(fake)  # KW 未设→默认「关闭」档
        self.assertEqual(bodies[0].get("reasoning_effort"), "none")
        self.assertNotIn("chat_template_kwargs", bodies[0])
        self.assertNotIn("/no_think", bodies[0]["messages"][-1]["content"])

        bodies.clear()
        kw = dict(self.KW)
        kw["thinking_effort"] = "思考(xhigh)"
        buf = io.StringIO()
        with patch.object(apipe._LAN_OPENER, "open", side_effect=fake), \
                patch.object(apipe, "_alive", return_value=True), \
                patch.object(apipe, "_load_bases_node", return_value={}), \
                redirect_stdout(buf):
            apipe.MyQi21ApiPE().rewrite(**kw)
        self.assertNotIn("reasoning_effort", bodies[0])

    def test_probe_dead_skips_heavy_post_and_marks_status(self):
        """1007 探活:死主机 3s 快跳,不发整发生成请求,状态字段标透传。"""
        calls = {"n": 0}

        def never(req, timeout=10):
            calls["n"] += 1
            return _FakeResp(_resp("不该出稿", ""))

        out, log = self._run(never, alive=False)
        self.assertEqual(calls["n"], 0, "探活不通不得发整发生成请求")
        self.assertTrue(out["ui"]["api_pe_status"][0].startswith("透传"))
        self.assertIn("均不可达", out["ui"]["api_pe_status"][0])
        self.assertIn("探活不通", log)

    def test_success_status_names_served_model(self):
        """1007 状态字段:成功稿标 AI扩写OK+模型名(JS 上画布用)。"""
        pos = "青玉色道袍束月白腰带暗红剑穗的完整描述。"

        def fake(req, timeout=10):
            return _FakeResp(_resp(pos, "模糊,水印,剑穗断裂"))

        out, _ = self._run(fake)
        self.assertEqual(out["ui"]["api_pe_status"][0], "AI扩写OK:fake-model")

    def test_retry_recovers_missing_negative(self):
        pos = "青玉色道袍束月白腰带暗红剑穗的完整描述,云海在远处翻涌。"
        seq = [_resp(pos, "模糊,水印"), _resp(pos, "模糊,水印,剑穗断裂")]
        calls = {"n": 0}

        def fake_urlopen(req, timeout=10):
            r = _FakeResp(seq[min(calls["n"], len(seq) - 1)])
            calls["n"] += 1
            return r

        out, log = self._run(fake_urlopen)
        self.assertIn("剑穗断裂", out["result"][1], "第二稿负向应补齐用户负面词")
        self.assertEqual(calls["n"], 2, "应补发恰好一次")
        self.assertIn("机器自检", log)
        self.assertIn("取第二稿", log)

    def test_retry_not_better_keeps_first(self):
        pos = "青玉色道袍束月白腰带暗红剑穗的完整描述。"
        seq = [_resp(pos, "模糊,水印"), _resp(pos, "模糊")]  # 第二稿更差
        calls = {"n": 0}

        def fake_urlopen(req, timeout=10):
            r = _FakeResp(seq[min(calls["n"], len(seq) - 1)])
            calls["n"] += 1
            return r

        out, log = self._run(fake_urlopen)
        self.assertEqual(out["result"][1], "模糊,水印", "应保留第一稿")
        self.assertIn("保留第一稿", log)

    def test_clean_first_draft_no_retry(self):
        pos = "青玉色道袍束月白腰带暗红剑穗的完整描述,云海翻涌。"
        calls = {"n": 0}

        def fake_urlopen(req, timeout=10):
            r = _FakeResp(_resp(pos, "模糊,水印,剑穗断裂"))
            calls["n"] += 1
            return r

        out, log = self._run(fake_urlopen)
        self.assertEqual(calls["n"], 1, "全过稿不应补发")
        self.assertNotIn("机器自检", log)
        self.assertIn("剑穗断裂", out["result"][1])



class TestColorWiring(unittest.TestCase):
    """1007 B案:色卡输入槽真通(连线值进系统消息,没连热读兜底)。"""

    def test_wired_colors_appended_to_system(self):
        sysmsg = apipe._build_system("教材正文", "色卡节内容ABC")
        self.assertIn("教材正文", sysmsg)
        self.assertIn("色卡节内容ABC", sysmsg)
        self.assertLess(sysmsg.index("教材正文"), sysmsg.index("色卡节内容ABC"))

    def test_hot_colors_fallback(self):
        apipe._ctx_cache.update(mtime=None, style=None, colors=None)  # 防前序测试缓存污染
        sysmsg = apipe._build_system("教材正文", None)
        self.assertIn("教材正文", sysmsg)
        self.assertIn("项目色卡", sysmsg)  # 热读色卡节(在用词清单)拼入

if __name__ == "__main__":
    unittest.main()
