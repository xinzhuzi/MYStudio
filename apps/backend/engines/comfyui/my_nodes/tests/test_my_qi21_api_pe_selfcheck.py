"""MyQi21ApiPE 机器自检+零违例接收门(1006 B案立;1008 S1 负向解耦终裁重构)。

六检纯函数(透明残留/环境丢/色词丢/境界丢/部件丢+正负撞词)——「负向三源在场」
检随 1008 解耦退役(对象=模型负向稿,输出侧已不采信;终稿负向恒由三源源词程序
构造,结构性不缺词)。接收门:首稿零违例直收;违例=补发一次,重试稿零违例才收;
重试仍有违例/重试解析失败/补发请求失败=拒收模型稿回退装配 direct 正稿
(拒收可见性=节点 print 日志+引擎 history,零新画布口)——不以违例变少作为
通过条件(旧「违例更少者胜」门就此退役)。
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

PADDING = "填充" * 150  # 1008 最短长度门绕过(测原逻辑不测长度)
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
        """撞词两侧空白归一:正向"软 3D体积塑形"(带空格)照样撞负向 token
        "软3D体积塑形"(C14 配方延至撞词检,2006 实弹教训防漏判)。"""
        v = apipe._self_check("青玉色道袍束月白腰带暗红剑穗,画面带软 3D体积塑形",
                              ["软3D体积塑形"], False, SUBJ)
        self.assertIn("正负撞词:软3D体积塑形", v)


    def test_env_bound_color_exempt_in_transparent(self):
        """阶下青灰云海:透明开青灰随云海合法删(不检);关模式仍检。"""
        subj2 = "视线越过阶下青灰云海望向远处，身着青玉色道袍。"
        self.assertNotIn("青灰", apipe._subject_colors(subj2, True))
        self.assertIn("青灰", apipe._subject_colors(subj2, False))
        self.assertIn("青玉色", apipe._subject_colors(subj2, True))

    def test_negative_needle_whitespace_normalized(self):
        """词表针"光面现代 CG 特写"带空格:正向连写/带空格两形态都判撞
        (空白归一双侧同规,旧在场检 C14 教训延撞词检)。"""
        v = apipe._self_check("青玉色道袍束月白腰带暗红剑穗,光面现代CG特写",
                              ["光面现代 CG 特写"], False, SUBJ)
        self.assertEqual([x for x in v if x.startswith("正负撞词:")],
                         ["正负撞词:光面现代 CG 特写"])


    def test_verb_color_no_false_positive(self):
        """剑柄缠灰银丝:取灰银,弃动词跨界误报缠灰(2006实弹)。"""
        got = apipe._subject_colors("剑柄缠灰银丝，鞘口垂暗红剑穗")
        self.assertIn("灰银", got)
        self.assertNotIn("缠灰", got)

    def test_stage_word_flagged_when_dropped(self):
        """筑基后期丢失=身份漂移,机检点名。"""
        v = apipe._self_check(PADDING + "年轻女修青玉色道袍(境界词丢了)", ["模糊"],
                              False, "一位筑基后期的年轻女修，青玉色道袍。")
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
        pos = "远处有远山。云海翻涌。天空辽阔。远山淡墨退开。远景收入云雾。天空留白透气。远处山门石阶完好。" * 5
        v = apipe._self_check(PADDING + "青锋剑白玉剑格俱全(鞘丢了)", ["模糊"],
                              False, "乌木剑鞘包鎏金，白玉剑格。")
        self.assertIn("部件丢:剑鞘", v)
        self.assertNotIn("部件丢:剑格", v)


    def test_off_mode_env_keep(self):
        """关模式对称检:主体句云海被删=违例(2007美宣案)。"""
        subj2 = "女修立于孤峰之巅，脚下青灰云海翻涌，天际旧金色晨光。"
        v = apipe._self_check("女修立于孤峰之巅，衣袂翻飞。", ["模糊"],
                              False, subj2)
        self.assertIn("环境丢:云海", v)
        v2 = apipe._self_check("女修立于孤峰之巅，脚下青灰云海翻涌。", ["模糊"],
                               False, subj2)
        self.assertNotIn("环境丢:云海", v2)

    def test_hot_colors_full_fallback_42(self):
        """v9:不接线兜底=42色全量(教材已不带色库,兜底不得缺canon名)。"""
        apipe._ctx_cache.update(mtime=None, style=None, colors=None)
        _, colors = apipe._context_materials()
        self.assertIn("★在用", colors)
        self.assertIn("碧玉", colors)      # canon玉石组(非在用,考全库)
        self.assertIn("冲突裁决序", colors)
        # 1009 ID/hex 剥除后清单合法缩短(内容完整性由上三行断言把守)
        self.assertGreater(len(colors), 600)


    def test_env_paren_notes_stripped(self):
        """透明开:括号补注里的环境词整段剥(2007 v9案:"(虽背景透明…山门石阶…)")。"""
        pos = ("她伫立在画面的视觉中心（虽背景透明，但姿态暗示其原立于山门石阶最上一级），"
               "腰侧悬系一条石青剑绦。视线越过阶下（原为青灰云海与淡墨远山）。")
        out = apipe._strip_env_parens(pos)
        self.assertNotIn("山门石阶", out)
        self.assertNotIn("云海", out)
        self.assertNotIn("（", out)
        self.assertIn("石青剑绦", out)

    def test_no_colors_no_extraction(self):
        self.assertEqual(apipe._subject_colors("山门石阶蜿蜒而上"), [])


class TestPosNegClash(unittest.TestCase):
    """1008 用户令「不应让模型生成正负不冲突吗」:正负撞词检=正负冲突唯一残余面
    (负向已源词程序构造,正向稿撞负向 token=同一画面既要求又禁画)。
    豁免表语义分组(_CLASH_EXEMPT):唯一在案=「大气透视」(教材第六步关模式明令
    氛围词)≠负向「透视」(多视图/表情差分型机位/形变缺陷义);干跑 A/B/C 三轮
    (十型装配文/教材指令词/实弹样例稿)零假红在档(S1 批)。"""

    def test_clash_flagged(self):
        v = apipe._pos_neg_clash("广角透视变形的脸部特写", ["透视", "模糊"])
        self.assertEqual(v, ["正负撞词:透视"])

    def test_clean_no_clash(self):
        self.assertEqual(apipe._pos_neg_clash("五指完整姿态自然", ["透视", "模糊"]), [])

    def test_exempt_atmospheric_perspective(self):
        """大气透视=合法氛围术语,剥除后检「透视」不误杀(干跑B 唯一命中组)。"""
        self.assertEqual(
            apipe._pos_neg_clash("大气透视把远山推出层次", ["透视"]), [])
        # 同稿既有大气透视又有真缺陷词仍拦:「透视缩短」不在豁免表,原词命中
        v = apipe._pos_neg_clash("大气透视层次分明,手臂有透视缩短", ["透视缩短"])
        self.assertEqual(v, ["正负撞词:透视缩短"])

    def test_exemption_not_over_broad(self):
        """豁免只剥声明的词组:裸「透视」缺陷用法仍命中。"""
        self.assertEqual(
            apipe._pos_neg_clash("构图透视失调", ["透视"]), ["正负撞词:透视"])

    def test_clash_via_self_check(self):
        v = apipe._self_check("青玉色道袍束月白腰带暗红剑穗,带水印痕迹",
                              ["水印"], False, SUBJ)
        self.assertEqual([x for x in v if x.startswith("正负撞词:")],
                         ["正负撞词:水印"])


class TestSelfCheck(unittest.TestCase):
    def test_all_pass_clean(self):
        pos = "青玉色道袍束月白腰带暗红剑穗,立于山门石阶,云海翻涌填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充"
        v = apipe._self_check(pos, ["模糊", "水印", "剑穗断裂"], False, SUBJ)
        self.assertEqual(v, [])

    def test_transparent_blacklist(self):
        pos = "青玉色道袍束月白腰带暗红剑穗,背景为云海,已移除远景填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充"
        v = apipe._self_check(pos, ["模糊"], True, SUBJ)
        joined = ";".join(v)
        for tok in ("背景", "云海", "已移除", "远景"):
            self.assertIn(tok, joined, f"透明开应点名:{tok}")

    def test_transparent_off_tolerates_env_words(self):
        pos = "青玉色道袍束月白腰带暗红剑穗,背景为云海填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充"
        v = apipe._self_check(pos, ["模糊"], False, SUBJ)
        self.assertEqual(v, [])

    def test_color_drop_flagged(self):
        v = apipe._self_check(PADDING + "道袍束腰带剑穗(色词全失)", ["模糊"], False, SUBJ)
        dropped = [x for x in v if x.startswith("色词丢:")]
        self.assertTrue(set(COLORS) <= {x[4:] for x in dropped})


def _resp(pos: str, neg: str | None = None, raw: str | None = None) -> bytes:
    """模型答文工厂:默认单键契约(1008 S2)+可选负向键(检验忽略)/原始噪声文。"""
    if raw is not None:
        body = raw
    else:
        obj = {"rewritten_prompt": pos}
        if neg is not None:
            obj["negative_prompt"] = neg
        body = json.dumps(obj, ensure_ascii=False)
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
        # 2007 起 POST 走 _LAN_OPENER.open(绕系统代理)+发前 _alive 探活,
        # mock 靶随之换位;alive=False 可测「探活不通→透传」路
        with patch.object(apipe._LAN_OPENER, "open", side_effect=fake_urlopen), \
                patch.object(apipe, "_alive", return_value=alive), \
                patch.object(apipe, "_load_bases_node", return_value={}), \
                redirect_stdout(buf):
            out = apipe.MyQi21ApiPE().rewrite(**self.KW)
        return out, buf.getvalue()

    @staticmethod
    def _expected_neg() -> str:
        """确定性终稿负向=三源源词(型负面+空锁层+外部主体)清洗后原样。"""
        return apipe._sanitize_negative("模糊, 水印, 剑穗断裂")

    def test_thinking_effort_wiring(self):
        """2007 思考档位接线:关闭→顶层 reasoning_effort=none;思考(xhigh)→
        不发该参数(模板原生);无效的 chat_template_kwargs 与 /no_think 尾巴
        不再出现(1234 实弹定谳;「低」档实测无衰减已移除)。"""
        pos = "青玉色道袍束月白腰带暗红剑穗的完整描述。填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充"
        bodies = []

        def fake(req, timeout=10):
            bodies.append(json.loads(req.data.decode()))
            return _FakeResp(_resp(pos))

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

    def test_model_context_has_no_negative_list(self):
        """2008 S1 输入侧解耦:用户消息(画面上下文块)不得再含[负面词清单]——
        模型上下文=正向装配文+正稿结构/画幅/透明运行约束;负向三源只进程序构造。"""
        pos = "青玉色道袍束月白腰带暗红剑穗的完整描述。填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充"
        bodies = []

        def fake(req, timeout=10):
            bodies.append(json.loads(req.data.decode()))
            return _FakeResp(_resp(pos))

        self._run(fake)
        user = bodies[0]["messages"][-1]["content"]
        self.assertNotIn("[负面词清单]", user)
        self.assertNotIn("negative_prompt", user)
        self.assertIn("[画幅] 1024×1536", user)
        self.assertIn("[透明] 关", user)
        self.assertIn(SUBJ, user, "装配正向全文仍须送模型(改写对象)")
        # 系统消息仍带色卡(色库在系统侧,不在用户侧)
        self.assertIn("色卡材料", bodies[0]["messages"][0]["content"])

    def test_probe_dead_skips_heavy_post_and_marks_status(self):
        """2007 探活:死主机 3s 快跳,不发整发生成请求,状态字段标透传。"""
        calls = {"n": 0}

        def never(req, timeout=10):
            calls["n"] += 1
            return _FakeResp(_resp("不该出稿"))

        out, log = self._run(never, alive=False)
        self.assertEqual(calls["n"], 0, "探活不通不得发整发生成请求")
        self.assertTrue(out["ui"]["api_pe_status"][0].startswith("透传"))
        self.assertIn("均不可达", out["ui"]["api_pe_status"][0])
        self.assertIn("探活不通", log)

    def test_success_status_names_served_model(self):
        """2007 状态字段:成功稿标 AI扩写OK+模型名(JS 上画布用)。"""
        pos = "青玉色道袍束月白腰带暗红剑穗的完整描述。填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充"

        def fake(req, timeout=10):
            return _FakeResp(_resp(pos))

        out, _ = self._run(fake)
        self.assertEqual(out["ui"]["api_pe_status"][0], "AI扩写OK:fake-model")

    def test_clean_first_draft_no_retry(self):
        """首稿零违例:直收,不补发。"""
        pos = "青玉色道袍束月白腰带暗红剑穗的完整描述,云海翻涌。填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充"
        calls = {"n": 0}

        def fake_urlopen(req, timeout=10):
            r = _FakeResp(_resp(pos))
            calls["n"] += 1
            return r

        out, log = self._run(fake_urlopen)
        self.assertEqual(calls["n"], 1, "全过稿不应补发")
        self.assertNotIn("机器自检", log)
        self.assertEqual(out["result"][1], self._expected_neg(),
                         "终稿负向=三源确定性构造,与模型稿无关")

    def test_retry_clean_takes_second(self):
        """重试合格:首稿丢色词→补发→第二稿零违例→取第二稿。"""
        bad = "青玉色道袍束月白腰带的完整描述。"          # 丢 暗红剑穗→色词丢
        good = "青玉色道袍束月白腰带暗红剑穗的完整描述。" + "画面细节丰富。" * 40
        seq = [_resp(bad), _resp(good)]
        calls = {"n": 0}

        def fake_urlopen(req, timeout=10):
            r = _FakeResp(seq[min(calls["n"], len(seq) - 1)])
            calls["n"] += 1
            return r

        out, log = self._run(fake_urlopen)
        self.assertEqual(calls["n"], 2, "应补发恰好一次")
        self.assertIn("机器自检", log)
        self.assertIn("取第二稿", log)
        self.assertIn("暗红", out["result"][0], "零违例重试稿应被接收")
        self.assertEqual(out["result"][1], self._expected_neg())

    def test_retry_still_dirty_rejects_even_if_fewer(self):
        """重试仍有违例=拒收——违例变少不算过(旧「更少者胜」门退役,1008)。"""
        worse = "道袍束腰带的描述。"                        # 丢全部三色词
        better = "青玉色道袍束月白腰带的描述。"             # 只丢 暗红(1 项<3 项)
        seq = [_resp(worse), _resp(better)]
        calls = {"n": 0}

        def fake_urlopen(req, timeout=10):
            r = _FakeResp(seq[min(calls["n"], len(seq) - 1)])
            calls["n"] += 1
            return r

        out, log = self._run(fake_urlopen)
        self.assertEqual(calls["n"], 2, "应补发恰好一次")
        self.assertIn("拒收", log)
        self.assertIn("回退", log)
        self.assertEqual(out["ui"]["api_pe_status"][0], "拒收回退:自检违例未清,透传装配正稿")
        self.assertTrue(out["result"][0].startswith("主体句:" + SUBJ),
                        "拒收=回退已装配 direct 正稿(主体句领衔三层,1009标签)")
        self.assertEqual(out["result"][1], self._expected_neg(),
                         "回退路负向=同一确定性结果(首稿/重试/回退三路同值)")

    def test_retry_parse_failure_rejects(self):
        """首稿违例+重试解析失败(无 rewritten_prompt)=拒收回退。"""
        bad = "青玉色道袍束月白腰带的完整描述。"
        seq = [_resp(bad), _resp(None, raw="完全不是JSON的答文")]
        calls = {"n": 0}

        def fake_urlopen(req, timeout=10):
            r = _FakeResp(seq[min(calls["n"], len(seq) - 1)])
            calls["n"] += 1
            return r

        out, log = self._run(fake_urlopen)
        self.assertIn("拒收", log)
        self.assertIn("重试稿解析失败", log)
        self.assertTrue(out["result"][0].startswith("主体句:" + SUBJ))

    def test_retry_request_failure_rejects(self):
        """首稿违例+补发请求失败=拒收回退(旧=保留第一稿,2008 终裁改拒收)。"""
        bad = "青玉色道袍束月白腰带的完整描述。"
        calls = {"n": 0}

        def fake_urlopen(req, timeout=10):
            calls["n"] += 1
            if calls["n"] == 1:
                return _FakeResp(_resp(bad))
            raise OSError("connection reset")

        out, log = self._run(fake_urlopen)
        self.assertEqual(calls["n"], 2)
        self.assertIn("拒收", log)
        self.assertIn("补发失败", log)
        self.assertTrue(out["result"][0].startswith("主体句:" + SUBJ))
        self.assertEqual(out["result"][1], self._expected_neg())

    def test_first_draft_parse_failure_passthrough(self):
        """首稿解析失败=透传装配正稿+确定性负向(1006 容错面,负向同值化)。"""
        calls = {"n": 0}

        def fake_urlopen(req, timeout=10):
            calls["n"] += 1
            return _FakeResp(_resp(None, raw="完全不是JSON的答文"))

        out, log = self._run(fake_urlopen)
        self.assertEqual(calls["n"], 1, "解析失败不触发自检补发")
        self.assertIn("解析失败", log)
        self.assertTrue(out["result"][0].startswith("主体句:" + SUBJ))
        self.assertEqual(out["result"][1], self._expected_neg())
        self.assertTrue(out["ui"]["api_pe_status"][0].startswith("透传"))

    def test_model_negative_key_ignored(self):
        """2008 输出侧解耦:模型负向键一律不采信(存在则忽略)——终稿负向恒=
        三源源词程序构造;模型自创/改写负向(含脏词)不泄漏进输出。"""
        pos = "青玉色道袍束月白腰带暗红剑穗的完整描述。填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充"
        model_neg = "远处,背景,自创负面词,模糊"          # 脏词+自创词+改写

        def fake(req, timeout=10):
            return _FakeResp(_resp(pos, neg=model_neg))

        out, _ = self._run(fake)
        self.assertEqual(out["result"][1], self._expected_neg())
        self.assertNotIn("自创负面词", out["result"][1])
        self.assertNotIn("远处", out["result"][1])
        self.assertEqual(out["ui"]["api_pe_neg"][0], out["result"][1])

    def test_rejection_log_visible_in_history(self):
        """拒收回退可见性=节点 print 日志(引擎 history 可查;零新画布口):
        「拒收→回退→日志可查」三连取证。"""
        bad = "青玉色道袍束月白腰带,画面带水印痕迹。"      # 色词丢+正负撞词:水印
        worse = "青玉色道袍束月白腰带,画面带水印与模糊。"  # 仍违例
        seq = [_resp(bad), _resp(worse)]
        calls = {"n": 0}

        def fake_urlopen(req, timeout=10):
            r = _FakeResp(seq[min(calls["n"], len(seq) - 1)])
            calls["n"] += 1
            return r

        out, log = self._run(fake_urlopen)
        self.assertIn("机器自检", log)
        self.assertIn("正负撞词:水印", log, "拒收前违例点名须含撞词项")
        self.assertIn("拒收:重试稿仍有", log)
        self.assertIn("引擎 history 可查本行", log)
        self.assertTrue(out["result"][0].startswith("主体句:" + SUBJ))
        self.assertEqual(out["result"][1], self._expected_neg())


class TestColorWiring(unittest.TestCase):
    """2007 B案:色卡输入槽真通(连线值进系统消息,没连热读兜底)。"""

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
