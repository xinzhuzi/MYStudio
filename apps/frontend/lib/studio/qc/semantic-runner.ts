/**
 * L4 语义 VLM 层(渲染端 runner)——每镜代表帧 → 有标准答案的问答题。
 * prompt 组装/回复解析/聚合为纯函数(可单测);多模态调用经注入抽象,
 * 生产适配走 callFeatureMultimodalAPI(image_understanding binding)。
 */

export interface SemanticQcShotInput {
  shotId: string;
  ordinal: number;
  /** project-file:// URL(主进程已提取的代表帧) */
  frameUrl: string;
  /** 该镜剧本描述;空=该镜跳过 */
  description: string;
}

export interface SemanticQcShotResult {
  shotId: string;
  ordinal: number;
  status: "pass" | "fail" | "unparsed" | "skipped";
  reason?: string;
}

export type MultimodalCaller = (messages: Array<{ role: string; content: unknown }>) => Promise<string>;

/** 单镜不通过升级章节嫌疑的连败阈值。 */
const CONSECUTIVE_FAIL_SUSPECT = 3;
/** fail 率超过该比例升级章节级 blocker 提示。 */
const FAIL_RATE_SUSPECT = 0.1;

export function buildSemanticPrompt(shot: SemanticQcShotInput, total: number): string {
  return [
    `这是某视频第 ${shot.ordinal}/${total} 镜的代表帧。`,
    `该镜剧本描述:「${shot.description}」`,
    "请严格只回答一个 JSON 对象(不要其它文字):{\"pass\": true 或 false, \"reason\": \"不超过40字的说明\"}",
    "判定标准:画面呈现的核心内容(人物/场景/动作主体)与描述明显不符才算 fail;画风/构图/光影差异不算 fail。",
  ].join("\n");
}

/** 容错解析:剥 markdown 围栏/前后噪声,提取首个 JSON 对象。 */
export function parseSemanticReply(content: string): { pass: boolean; reason: string } | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(content);
  const candidates = [fenced?.[1], content];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start < 0 || end <= start) continue;
    try {
      const parsed = JSON.parse(candidate.slice(start, end + 1)) as { pass?: unknown; reason?: unknown };
      if (typeof parsed.pass === "boolean") {
        return { pass: parsed.pass, reason: typeof parsed.reason === "string" ? parsed.reason : "" };
      }
    } catch {
      // 试下一个候选
    }
  }
  return null;
}

export function aggregateSemanticResults(
  results: SemanticQcShotResult[],
): {
  findings: Array<{
    code: string;
    severity: "warn" | "blocker" | "info";
    shotId?: string;
    shotOrdinal?: number;
    message: string;
    evidence: Record<string, unknown>;
  }>;
  stats: { checked: number; passed: number; failed: number; skipped: number };
} {
  const checked = results.filter((r) => r.status !== "skipped").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const passed = results.filter((r) => r.status === "pass").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const findings: Array<{
    code: string;
    severity: "warn" | "blocker" | "info";
    shotId?: string;
    shotOrdinal?: number;
    message: string;
    evidence: Record<string, unknown>;
  }> = [];

  for (const result of results) {
    if (result.status === "fail") {
      findings.push({
        code: "chapter-qc.semantic.shot-mismatch",
        severity: "warn",
        shotId: result.shotId,
        shotOrdinal: result.ordinal,
        message: `第 ${result.ordinal} 镜画面与剧本描述不符:${result.reason ?? "无说明"}`,
        evidence: { reason: result.reason ?? "" },
      });
    }
  }

  // 连败 ≥3 或 fail 率 >10% → 章节级嫌疑(blocker 级提示人工复核)
  let consecutive = 0;
  let maxConsecutive = 0;
  for (const result of results) {
    if (result.status === "fail") {
      consecutive += 1;
      maxConsecutive = Math.max(maxConsecutive, consecutive);
    } else if (result.status === "pass") {
      consecutive = 0;
    }
  }
  if (checked > 0 && (maxConsecutive >= CONSECUTIVE_FAIL_SUSPECT || failed / checked > FAIL_RATE_SUSPECT)) {
    findings.push({
      code: "chapter-qc.semantic.chapter-suspect",
      severity: "blocker",
      message: `语义层多镜不符(连续失败 ${maxConsecutive} 镜,fail 率 ${((failed / checked) * 100).toFixed(1)}%),疑似系统性问题,请人工复核`,
      evidence: { maxConsecutive, failed, checked },
    });
  }
  return { findings, stats: { checked, passed, failed, skipped } };
}

export interface RunSemanticQcOptions {
  shots: SemanticQcShotInput[];
  call: MultimodalCaller;
  /** 把 frameUrl 变成 data URL(生产=projectFiles.readAsBase64;测试注入) */
  readFrameDataUrl: (frameUrl: string) => Promise<string | null>;
  /** 费用护栏:调用上限(默认 镜数+5) */
  maxCalls?: number;
}

export async function runSemanticQcLayer(
  options: RunSemanticQcOptions,
): Promise<{ results: SemanticQcShotResult[]; findings: ReturnType<typeof aggregateSemanticResults>["findings"]; stats: { checked: number; passed: number; failed: number; skipped: number } }> {
  const { shots, call, readFrameDataUrl } = options;
  const maxCalls = options.maxCalls ?? shots.length + 5;
  const total = shots.length;
  const results: SemanticQcShotResult[] = [];
  let callsUsed = 0;

  for (const shot of shots) {
    if (!shot.description || !shot.description.trim()) {
      results.push({ shotId: shot.shotId, ordinal: shot.ordinal, status: "skipped", reason: "无镜描述" });
      continue;
    }
    if (callsUsed >= maxCalls) {
      results.push({ shotId: shot.shotId, ordinal: shot.ordinal, status: "skipped", reason: "费用护栏触发" });
      continue;
    }
    const dataUrl = await readFrameDataUrl(shot.frameUrl);
    if (!dataUrl) {
      results.push({ shotId: shot.shotId, ordinal: shot.ordinal, status: "skipped", reason: "代表帧读取失败" });
      continue;
    }
    callsUsed += 1;
    let reply: string | null = null;
    // 解析失败重试一次
    for (let attempt = 0; attempt < 2 && reply === null; attempt += 1) {
      try {
        const content = await call([
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: dataUrl } },
              { type: "text", text: buildSemanticPrompt(shot, total) },
            ],
          },
        ]);
        const parsed = parseSemanticReply(content);
        if (parsed) {
          results.push({
            shotId: shot.shotId,
            ordinal: shot.ordinal,
            status: parsed.pass ? "pass" : "fail",
            reason: parsed.reason,
          });
          reply = content;
          break;
        }
        if (attempt === 1) {
          results.push({ shotId: shot.shotId, ordinal: shot.ordinal, status: "unparsed", reason: "模型回复无法解析" });
          reply = "unparsed";
        }
      } catch (error) {
        if (attempt === 1) {
          results.push({
            shotId: shot.shotId,
            ordinal: shot.ordinal,
            status: "skipped",
            reason: error instanceof Error ? error.message : String(error),
          });
          reply = "error";
        }
      }
    }
  }

  const aggregated = aggregateSemanticResults(results);
  return { results, ...aggregated };
}
