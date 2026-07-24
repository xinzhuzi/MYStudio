import { describe, expect, it } from "vitest";
import {
  parseAssDialogue,
  parseSrt,
  serializeSrt,
} from "./subtitle-codec";

describe("subtitle codec", () => {
  it("round-trips CRLF SRT with multiline text", () => {
    const parsed = parseSrt([
      "1",
      "00:00:00,125 --> 00:00:02,500",
      "第一行",
      "第二行",
      "",
      "2",
      "00:00:03.000 --> 00:00:04.250",
      "第三行",
      "",
    ].join("\r\n"));

    expect(parsed.warnings).toEqual([]);
    expect(parsed.cues).toEqual([
      { startUs: 125_000, endUs: 2_500_000, text: "第一行\n第二行" },
      { startUs: 3_000_000, endUs: 4_250_000, text: "第三行" },
    ]);

    expect(parseSrt(serializeSrt(parsed.cues)).cues).toEqual(parsed.cues);
  });

  it("maps ASS Dialogue fields and strips unsupported styling with warnings", () => {
    const parsed = parseAssDialogue([
      "[Script Info]",
      "Title: Test",
      "[Events]",
      "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
      "Dialogue: 0,0:00:01.20,0:00:03.45,Fancy,,0,0,0,shake,{\\an8}{\\b1}第一行\\N第二行,含逗号",
    ].join("\n"));

    expect(parsed.cues).toEqual([
      { startUs: 1_200_000, endUs: 3_450_000, text: "第一行\n第二行,含逗号" },
    ]);
    expect(parsed.warnings.map((warning) => warning.code)).toEqual(expect.arrayContaining([
      "subtitle.ass.style_ignored",
      "subtitle.ass.effect_ignored",
      "subtitle.ass.tags_stripped",
    ]));
  });

  it("skips malformed cues and reports precise warnings", () => {
    const parsed = parseSrt("1\ninvalid timing\ntext\n\n2\n00:00:05,000 --> 00:00:04,000\nbackwards\n");
    expect(parsed.cues).toEqual([]);
    expect(parsed.warnings).toEqual([
      expect.objectContaining({ code: "subtitle.srt.timing" }),
      expect.objectContaining({ code: "subtitle.time.range" }),
    ]);
  });

  it("rejects SRT clock components outside their ranges", () => {
    const parsed = parseSrt([
      "1",
      "00:00:60,000 --> 00:01:00,000",
      "invalid seconds",
      "",
      "2",
      "00:60:00,000 --> 01:00:00,000",
      "invalid minutes",
    ].join("\n"));

    expect(parsed.cues).toEqual([]);
    expect(parsed.warnings).toEqual([
      expect.objectContaining({ code: "subtitle.srt.timing", cueIndex: 0 }),
      expect.objectContaining({ code: "subtitle.srt.timing", cueIndex: 1 }),
    ]);
  });

  it("rejects ASS clock components outside their ranges", () => {
    const parsed = parseAssDialogue([
      "[Events]",
      "Format: Start, End, Text",
      "Dialogue: 0:00:60.00,0:01:00.00,invalid seconds",
      "Dialogue: 0:60:00.00,1:00:00.00,invalid minutes",
    ].join("\n"));

    expect(parsed.cues).toEqual([]);
    expect(parsed.warnings).toEqual([
      expect.objectContaining({ code: "subtitle.ass.timing", cueIndex: 0 }),
      expect.objectContaining({ code: "subtitle.ass.timing", cueIndex: 0 }),
    ]);
  });
});
