import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DAOJIE_SUBJECT_STYLE_WORDS,
  stripDaojieSubjectStyleWords,
} from "./daojie-style-word-strip";

/** 门禁词表真源(python)——与测试件相对定位,仓库内恒可达。 */
const GATE_PY = new URL(
  "../../../backend/comfyui/my_nodes/nodes/_gongbi_gate.py",
  import.meta.url,
);

function gateStyleWordsFromPythonSource(): string[] {
  const src = readFileSync(GATE_PY, "utf-8");
  const m = src.match(/_STYLE_WORDS\s*=\s*\(([^)]*)\)/);
  if (!m) throw new Error("_STYLE_WORDS not found in _gongbi_gate.py");
  return Array.from(m[1].matchAll(/"([^"]+)"/g), (x) => x[1]);
}

describe("daojie subject style word strip (1115 A 裁)", () => {
  it("词表与引擎门禁 _gongbi_gate.py:_STYLE_WORDS 逐字同步(漂移即红)", () => {
    expect([...DAOJIE_SUBJECT_STYLE_WORDS]).toEqual(gateStyleWordsFromPythonSource());
  });

  it("含「工笔线描照亮脸和手」样板文的分镜主体句,剥离产物零画风词命中", () => {
    const boilerplate =
      "【构图】中景,两人对峙;背景具体道具(灯/卷轴/门框/雨帘);工笔线描照亮脸和手。画幅 16:9 单人中景。;有台词:近景或中近景,说话人物正对镜头";
    const { text, stripped } = stripDaojieSubjectStyleWords(boilerplate);
    expect(stripped["工笔"]).toBe(1);
    for (const word of DAOJIE_SUBJECT_STYLE_WORDS) {
      expect(text.includes(word), `残留画风词 ${word}`).toBe(false);
    }
    expect(text).toContain("照亮脸和手"); // 非词族字样不误伤
    expect(text).toContain("画幅 16:9");
  });

  it("多处命中全剥;干净文本原样返回且零剥离计数", () => {
    const dirty = "工笔白描工笔,连环画质感";
    const r1 = stripDaojieSubjectStyleWords(dirty);
    expect(r1.stripped).toEqual({ 工笔: 2, 白描: 1, 连环画: 1 });
    expect(r1.text).toBe(",质感");
    const clean = "赵四立于高台,俯瞰劳列,铅灰雾压河面";
    const r2 = stripDaojieSubjectStyleWords(clean);
    expect(r2.stripped).toEqual({});
    expect(r2.text).toBe(clean);
  });
});
