export interface SubtitleCue {
  startUs: number;
  endUs: number;
  text: string;
}

export interface SubtitleCodecWarning {
  code: string;
  message: string;
  cueIndex?: number;
}

export interface SubtitleCodecResult {
  cues: SubtitleCue[];
  warnings: SubtitleCodecWarning[];
}

const SRT_TIMING = /^(\d{1,}):(\d{2}):(\d{2})[,.](\d{3})\s+-->\s+(\d{1,}):(\d{2}):(\d{2})[,.](\d{3})$/;

export function parseSrt(value: string): SubtitleCodecResult {
  const warnings: SubtitleCodecWarning[] = [];
  const cues: SubtitleCue[] = [];
  const blocks = normalizeLines(value)
    .split(/\n{2,}/)
    .map((block) => block.split("\n"))
    .filter((lines) => lines.some((line) => line.trim()));

  blocks.forEach((rawLines, blockIndex) => {
    const lines = rawLines.map((line) => line.trimEnd());
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) {
      warnings.push(warning("subtitle.srt.timing", "SRT cue 缺少有效时间行", blockIndex));
      return;
    }
    const match = lines[timingIndex]!.trim().match(SRT_TIMING);
    if (!match) {
      warnings.push(warning("subtitle.srt.timing", "SRT cue 时间格式无效", blockIndex));
      return;
    }
    const startUs = clockPartsToUs(match.slice(1, 5));
    const endUs = clockPartsToUs(match.slice(5, 9));
    const text = lines.slice(timingIndex + 1).join("\n").trim();
    if (endUs <= startUs) {
      warnings.push(warning("subtitle.time.range", "字幕结束时间必须晚于开始时间", blockIndex));
      return;
    }
    if (!text) {
      warnings.push(warning("subtitle.text.empty", "字幕文本不能为空", blockIndex));
      return;
    }
    cues.push({ startUs, endUs, text });
  });

  return { cues, warnings };
}

export function parseAssDialogue(value: string): SubtitleCodecResult {
  const warnings: SubtitleCodecWarning[] = [];
  const cues: SubtitleCue[] = [];
  const lines = normalizeLines(value).split("\n");
  let inEvents = false;
  let format: string[] | undefined;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith("[") && line.endsWith("]")) {
      inEvents = line.toLowerCase() === "[events]";
      continue;
    }
    if (!inEvents) continue;
    if (line.toLowerCase().startsWith("format:")) {
      format = line.slice(line.indexOf(":") + 1).split(",").map((field) => field.trim().toLowerCase());
      continue;
    }
    if (!line.toLowerCase().startsWith("dialogue:")) continue;
    const cueIndex = cues.length;
    if (!format) {
      warnings.push(warning("subtitle.ass.format_missing", "ASS Events 缺少 Format 行", cueIndex));
      continue;
    }
    const fields = splitAssFields(line.slice(line.indexOf(":") + 1).trimStart(), format.length);
    const record = Object.fromEntries(format.map((name, index) => [name, fields[index]?.trim() ?? ""]));
    const startUs = parseAssTime(record.start);
    const endUs = parseAssTime(record.end);
    if (startUs === undefined || endUs === undefined) {
      warnings.push(warning("subtitle.ass.timing", "ASS Dialogue 时间格式无效", cueIndex));
      continue;
    }
    if (endUs <= startUs) {
      warnings.push(warning("subtitle.time.range", "字幕结束时间必须晚于开始时间", cueIndex));
      continue;
    }
    if (record.style && record.style.toLowerCase() !== "default") {
      warnings.push(warning("subtitle.ass.style_ignored", `ASS 样式已忽略: ${record.style}`, cueIndex));
    }
    if (record.effect) {
      warnings.push(warning("subtitle.ass.effect_ignored", `ASS 效果已忽略: ${record.effect}`, cueIndex));
    }
    const rawText = record.text ?? "";
    const hasTags = /\{[^}]*\}/.test(rawText);
    const text = rawText
      .replace(/\{[^}]*\}/g, "")
      .replace(/\\[Nn]/g, "\n")
      .replace(/\\h/g, " ")
      .trim();
    if (hasTags) {
      warnings.push(warning("subtitle.ass.tags_stripped", "ASS 不支持的覆盖标签已剥离", cueIndex));
    }
    if (!text) {
      warnings.push(warning("subtitle.text.empty", "字幕文本不能为空", cueIndex));
      continue;
    }
    cues.push({ startUs, endUs, text });
  }

  return { cues, warnings };
}

export function serializeSrt(cues: readonly SubtitleCue[]) {
  return [...cues]
    .sort((left, right) => left.startUs - right.startUs || left.endUs - right.endUs || left.text.localeCompare(right.text))
    .map((cue, index) => [
      String(index + 1),
      `${formatSrtTime(cue.startUs)} --> ${formatSrtTime(cue.endUs)}`,
      cue.text.trim(),
      "",
    ].join("\n"))
    .join("\n");
}

function normalizeLines(value: string) {
  return value.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
}

function clockPartsToUs(parts: string[]) {
  const [hours, minutes, seconds, milliseconds] = parts.map(Number);
  return (((hours! * 60 + minutes!) * 60 + seconds!) * 1_000 + milliseconds!) * 1_000;
}

function parseAssTime(value: string | undefined) {
  const match = value?.match(/^(\d+):(\d{2}):(\d{2})[.](\d{1,2})$/);
  if (!match) return undefined;
  const centiseconds = Number(match[4]!.padEnd(2, "0"));
  return (((Number(match[1]) * 60 + Number(match[2])) * 60 + Number(match[3])) * 100 + centiseconds) * 10_000;
}

function splitAssFields(value: string, count: number) {
  const fields: string[] = [];
  let rest = value;
  for (let index = 1; index < count; index += 1) {
    const comma = rest.indexOf(",");
    if (comma < 0) {
      fields.push(rest);
      rest = "";
      break;
    }
    fields.push(rest.slice(0, comma));
    rest = rest.slice(comma + 1);
  }
  fields.push(rest);
  while (fields.length < count) fields.push("");
  return fields;
}

function formatSrtTime(valueUs: number) {
  const milliseconds = Math.max(0, Math.floor(valueUs / 1_000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1_000);
  const remainder = milliseconds % 1_000;
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)},${pad(remainder, 3)}`;
}

function pad(value: number, length: number) {
  return String(value).padStart(length, "0");
}

function warning(code: string, message: string, cueIndex: number): SubtitleCodecWarning {
  return { code, message, cueIndex };
}
