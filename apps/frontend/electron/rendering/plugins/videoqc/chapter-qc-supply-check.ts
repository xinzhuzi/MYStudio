/**
 * 供给完整性自检(1102 骨干⓪)——跑分之前先证「物料在、可读、条数对」。
 *
 * 对标上游 `Vchitect/VBench/integrity_check/{check_corrupted,check_count,check_image_suite}.py`:
 * 它们在评价器启动前把「文件数对不对、片子能不能解、prompt 归不归这个维」钉死,
 * 结论不过关就不许往下打分。我们此前没有这一层,所以出过两类事故:
 *   ① L1 零素材假绿——分镜/工件一条没读到,五个层照样「通过」;
 *   ② 口径假空——手工跑 `model_inventory` 时没带 `MYSTUDIO_VIDEO_QC_MODEL_DIR`,
 *      读到不存在的 `~/.mystudio/video-qc-models` 就报「权重缺失」。
 * 两者本质同一个缺口:**先证供给,再谈结论**。
 *
 * 分层纪律:本件**不改任何层的 status**(层语义与渲染交付契约不动),只在三态板上加
 * `supply-integrity` 一行。缺料=该行 unverified(不放行),读不到片子/声明有台词却零字幕
 * 这类硬矛盾=该行 fail。这样既堵住假绿,又不动「QC 是体检不是门禁」的老口径。
 */

import type { ChapterQcFindingV1, ChapterQcSupplyCheckV1 } from "./chapter-qc-types";

type SupplyVerdict = ChapterQcSupplyCheckV1["checks"][number]["verdict"];

export interface ChapterQcSupplyInput {
  /** ffprobe 是否出数(时长/fps 均为有限正数) */
  mediaReadable: boolean;
  durationS?: number;
  fps?: number;
  /** 镜区间条数(render-plan 或 artifact EDL 复算结果) */
  spanCount: number;
  /** 分镜表里本章声明的镜数(0=没读到 store) */
  declaredShotCount: number;
  /** 镜区间口径:render-plan(权威)/ artifact EDL(未压缩,会漂)/ 无 */
  timelineSource: "render-plan" | "edl" | "none";
  /** 逐镜期望集是否非空(分镜语义读到了才算有) */
  expectationShotCount: number;
  /** 台词类断言声明为 expected 的镜数(这些镜必须带字幕物料) */
  speechDeclaredShots: number;
  /** 工件字幕 cue 条数 */
  subtitleCueCount: number;
  /**
   * 本章台本(旁白/台词文本)是否读到了。`diffSubtitlesAgainstScript` 在 `scriptText===undefined`
   * 时整段返回 null,字幕文本门于是零越限——零越限不是「字幕没错字」,是没比过。
   */
  scriptPresent?: boolean;
  /** L5/代表帧物料:抽出的帧数与应有镜数 */
  extractedFrameCount: number;
  /** 侧车可用性 */
  vadAvailable: boolean;
  faceAvailable: boolean;
  /**
   * 本轮是否真跑过侧车。structural blocker 短路时 L2 整层没执行,`*Available` 只是初始值,
   * 这时报 ok 等于拿「配了」冒充「实测能用」——必须显式记成未实探。缺省视为已实探(旧调用口径)。
   */
  sidecarsEvidenced?: boolean;
  /** L3 DOVER 模型是否就绪 */
  aestheticModelReady: boolean;
  /** 分镜条目的产出状态:非 ready 或被打 stale 的镜数 */
  unreadyShotCount: number;
  /** 分镜声明了参考图但标记 missing 的条数 */
  missingReferenceCount: number;
}

interface SupplyCheck {
  checkId: string;
  label: string;
  verdict: SupplyVerdict;
  detail?: string;
}

const finitePositive = (value: number | undefined): boolean =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

export function runSupplyCheck(input: ChapterQcSupplyInput): ChapterQcSupplyCheckV1 {
  const checks: SupplyCheck[] = [];
  const push = (checkId: string, label: string, verdict: SupplyVerdict, detail?: string) => {
    checks.push({ checkId, label, verdict, ...(detail ? { detail } : {}) });
  };

  if (!input.mediaReadable || !finitePositive(input.durationS)) {
    push("media-readable", "成片可解(ffprobe 出时长)", "blocked", "ffprobe 未给出有限正时长,后续各层的任何数字都不可信");
  } else {
    push("media-readable", "成片可解(ffprobe 出时长)", "ok", `${input.durationS!.toFixed(2)}s / ${input.fps?.toFixed(2) ?? "NA"}fps`);
  }

  if (input.spanCount === 0) {
    push("shot-spans", "镜区间可归因", input.declaredShotCount > 0 ? "blocked" : "gap",
      input.declaredShotCount > 0
        ? `分镜声明 ${input.declaredShotCount} 镜,成片一侧一条镜区间都没复算出来:逐镜归因全线无证据`
        : "既无分镜声明也无工件 EDL:时间轴类结论只能整体缺证");
  } else {
    push("shot-spans", "镜区间可归因", "ok", `${input.spanCount} 镜`);
  }

  if (input.timelineSource === "render-plan") {
    push("timeline-authority", "时间轴口径权威", "ok", "current-render-plan 复算(与成片逐帧对齐)");
  } else if (input.timelineSource === "edl") {
    push("timeline-authority", "时间轴口径权威", "gap", "退回 artifact EDL 未压缩口径:镜归因可漂 ~30s,逐镜结论只能算线索");
  } else {
    push("timeline-authority", "时间轴口径权威", "gap", "render-plan 与 EDL 均缺:镜级归因不成立");
  }

  if (input.expectationShotCount === 0) {
    push("expectations-declared", "分镜语义已读(逐镜期望的锚)", "gap",
      input.declaredShotCount > 0
        ? `store 有 ${input.declaredShotCount} 镜但语义字段一条没读到:「该动/该说/该有人」全无可对照声明`
        : "无工作流 store:一切逐镜门只能缺证");
  } else {
    push("expectations-declared", "分镜语义已读(逐镜期望的锚)", "ok", `${input.expectationShotCount} 镜带期望`);
  }

  if (input.speechDeclaredShots > 0 && input.subtitleCueCount === 0) {
    push("subtitle-material", "字幕文本对照物料(台本+cue)", "blocked",
      `${input.speechDeclaredShots} 镜声明台词却零字幕 cue:文本一致/覆盖类结论的前提不成立`);
  } else if (input.scriptPresent === false) {
    push("subtitle-material", "字幕文本对照物料(台本+cue)", "gap",
      `台本未读到(${input.subtitleCueCount} 条 cue 无人对照):字幕文本 diff 整段跳过,零越限不等于没错字`);
  } else if (input.scriptPresent === undefined) {
    push("subtitle-material", "字幕文本对照物料(台本+cue)", "gap",
      "调用方没报台本在场与否:字幕文本门的对照物无从核实");
  } else {
    push("subtitle-material", "字幕文本对照物料(台本+cue)", "ok", `${input.subtitleCueCount} 条 cue / 台本在场`);
  }

  if (input.spanCount > 0 && input.extractedFrameCount === 0) {
    push("frame-material", "判读帧物料", "gap", "零帧物料:多模态判读行(角色/文字/跨镜/语义)必然缺证");
  } else if (input.extractedFrameCount > 0) {
    push("frame-material", "判读帧物料", "ok", `${input.extractedFrameCount} 帧`);
  } else {
    push("frame-material", "判读帧物料", "gap", "无镜区间,未抽帧");
  }

  const sidecarsProbed = input.sidecarsEvidenced !== false;
  const sidecarDetail = (available: boolean, fallback: string): string | undefined =>
    sidecarsProbed
      ? (available ? undefined : fallback)
      : "structural blocker 短路,本轮未实探:配置里有托管 Python 不等于这一趟跑通了";
  push("sidecar-vad", "Silero VAD 侧车可用", sidecarsProbed && input.vadAvailable ? "ok" : "gap",
    sidecarDetail(input.vadAvailable, "语音段退回 silencedetect 补集:带 BGM 成片里它看不见语音间隙"));
  push("sidecar-face", "YuNet 人脸侧车可用", sidecarsProbed && input.faceAvailable ? "ok" : "gap",
    sidecarDetail(input.faceAvailable, "五官/手指维无自动证据(须装机托管 Python + 人脸权重)"));
  push("model-aesthetic", "DOVER 观感模型就绪", input.aestheticModelReady ? "ok" : "gap",
    input.aestheticModelReady ? undefined : "L3 跳过:观感基线行只能缺证");

  if (input.declaredShotCount > 0 && input.unreadyShotCount > 0) {
    push("shot-readiness", "分镜产出状态齐备", "gap",
      `${input.unreadyShotCount}/${input.declaredShotCount} 镜非 ready 或被打 stale:成片可能基于旧素材`);
  } else {
    push("shot-readiness", "分镜产出状态齐备", input.declaredShotCount > 0 ? "ok" : "gap",
      input.declaredShotCount > 0 ? undefined : "无分镜可核");
  }

  if (input.missingReferenceCount > 0) {
    push("reference-assets", "参考资产在场", "gap", `${input.missingReferenceCount} 条声明的参考图标记缺失`);
  } else {
    push("reference-assets", "参考资产在场", input.declaredShotCount > 0 ? "ok" : "gap",
      input.declaredShotCount > 0 ? undefined : "无分镜可核");
  }

  const gaps = checks.filter((check) => check.verdict === "gap").length;
  const blocked = checks.filter((check) => check.verdict === "blocked").length;
  return { checks, gaps, blocked };
}

/**
 * 供给自检 → finding:blocked 记 warn(能打穿 supply-integrity 成 fail),
 * gap 只记 info(把「缺什么」留在板行的 missing 里,不冒充越限)。
 */
export function buildSupplyFindings(supply: ChapterQcSupplyCheckV1): ChapterQcFindingV1[] {
  const findings: ChapterQcFindingV1[] = [];
  for (const check of supply.checks) {
    if (check.verdict === "ok") continue;
    findings.push({
      code: check.verdict === "blocked" ? "chapter-qc.supply.blocked" : "chapter-qc.supply.gap",
      layer: "structural",
      severity: check.verdict === "blocked" ? "warn" : "info",
      message: `供给自检 ${check.label}: ${check.verdict === "blocked" ? "硬矛盾" : "缺料"}${check.detail ? `(${check.detail})` : ""}`,
      evidence: { checkId: check.checkId, verdict: check.verdict, ...(check.detail ? { detail: check.detail } : {}) },
    });
  }
  if (findings.length === 0) {
    findings.push({
      code: "chapter-qc.supply.ok",
      layer: "structural",
      severity: "info",
      message: `供给自检 ${supply.checks.length} 项全过:物料、时间轴口径与侧车可用性均已核实`,
      evidence: { checks: supply.checks.length },
    });
  }
  return findings;
}
