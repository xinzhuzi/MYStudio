import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { HyperFramesOverlayRequestV1, validateHyperFramesOverlayRequest } from "@rendering/contracts/video-workflow";
import { installUncaughtExceptionGuard } from "../../../runtime/uncaught-exception-guard";
import { collectDegradedRegistryTemplates } from "./hf-composition";
import { renderSegments } from "./hf-segments";
import { HyperFramesWorkerResult, TOOL_VERSION } from "./hf-shared";

// utility 子进程有独立运行时,主进程的 uncaughtException 守卫罩不到这里;
// undici setTypeOfService EINVAL(上游 undici#5544)必须各自过滤。
installUncaughtExceptionGuard({
  writeLog: (entry) => {
    console.warn(`[hyperframes-worker] ${entry.level}: ${entry.message}`);
  },
});

function parseArgs(argv: string[]): { requestPath: string; artifactPath: string } {
  const value = (name: string): string => {
    const index = argv.indexOf(name);
    const result = index >= 0 ? argv[index + 1] : undefined;
    if (!result || result.startsWith("--")) throw new Error(`缺少 ${name} 参数`);
    return result;
  };
  return { requestPath: value("--request"), artifactPath: value("--output") };
}

function writeJson(filePath: string, value: HyperFramesWorkerResult): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryPath, filePath);
}

function blocked(request: Partial<HyperFramesOverlayRequestV1>, code: string, message: string): HyperFramesWorkerResult {
  return {
    schemaVersion: 1,
    projectId: typeof request.projectId === "string" ? request.projectId : "unknown",
    chapterId: typeof request.chapterId === "string" ? request.chapterId : "unknown",
    revision: typeof request.revision === "number" ? request.revision : 0,
    status: "blocked",
    sourceArtifactSha256: typeof request.sourceArtifactSha256 === "string" ? request.sourceArtifactSha256 : "0".repeat(64),
    inputSha256: typeof request.inputSha256 === "string" ? request.inputSha256 : "0".repeat(64),
    alphaFormat: request.alphaFormat ?? "prores-4444-mov",
    windows: Array.isArray(request.windows) ? request.windows : [],
    toolVersion: TOOL_VERSION,
    generatedAt: Date.now(),
    code,
    message,
  };
}


function run(request: HyperFramesOverlayRequestV1, artifactPath: string): HyperFramesWorkerResult {
  const validated = validateHyperFramesOverlayRequest(request);
  if (!validated.success) return blocked(request, "invalid-request", validated.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
  if (!path.isAbsolute(artifactPath) || !path.isAbsolute(request.outputPath)) return blocked(request, "output-path-mismatch", "worker artifact 与 overlay 输出路径都必须是绝对路径");
  const cliPath = process.env.MYSTUDIO_HYPERFRAMES_CLI?.trim();
  const nodePath = process.env.MYSTUDIO_HYPERFRAMES_NODE?.trim();
  if (!cliPath || !path.isAbsolute(cliPath) || !fs.existsSync(cliPath)) return blocked(request, "hyperframes-cli-missing", "HyperFrames CLI 未在应用级 profile 中准备");
  if (!nodePath || !path.isAbsolute(nodePath) || !fs.existsSync(nodePath)) return blocked(request, "node-runtime-missing", "HyperFrames 必须使用应用级 Electron Node");
  const projectDir = fs.mkdtempSync(path.join(path.dirname(request.outputPath), `.hyperframes-${process.pid}-`));
  try {
    renderSegments(validated.value, cliPath, nodePath, projectDir);
    if (!fs.existsSync(request.outputPath)) throw new Error("HyperFrames CLI 未生成输出文件");
    const outputSha256 = validated.value.alphaFormat === "png-sequence"
      ? crypto.createHash("sha256").update(fs.readdirSync(request.outputPath).sort().join("\n")).digest("hex")
      : crypto.createHash("sha256").update(fs.readFileSync(request.outputPath)).digest("hex");
    const degradedTemplateIds = collectDegradedRegistryTemplates(validated.value);
    return {
      schemaVersion: 1,
      projectId: validated.value.projectId,
      chapterId: validated.value.chapterId,
      revision: validated.value.revision,
      status: "accepted",
      sourceArtifactSha256: validated.value.sourceArtifactSha256,
      inputSha256: validated.value.inputSha256,
      alphaFormat: validated.value.alphaFormat,
      outputPath: request.outputPath,
      outputSha256,
      windows: validated.value.windows,
      ...(degradedTemplateIds.length ? { degradedTemplateIds } : {}),
      toolVersion: TOOL_VERSION,
      generatedAt: Date.now(),
    };
  } catch (error) {
    // 08-22 观测性补:execFileSync 的 stderr 藏着 HY CLI 真实根因(strict 违例
    // /浏览器崩溃等),此前被吞只剩命令行本身——排障必须能看见。
    const detail = error instanceof Error
      ? `${error.message}${typeof (error as unknown as { stderr?: unknown }).stderr === "string" && ((error as unknown as { stderr: string }).stderr).trim() ? ` | stderr: ${((error as unknown as { stderr: string }).stderr).trim().slice(-600)}` : ""}`
      : String(error);
    return blocked(validated.value, "render-failed", detail);
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
}

function main(): void {
  let outputPath: string | undefined;
  try {
    const args = parseArgs(process.argv.slice(2));
    outputPath = args.artifactPath;
    const request = JSON.parse(fs.readFileSync(args.requestPath, "utf8")) as unknown;
    const result = run(request as HyperFramesOverlayRequestV1, args.artifactPath);
    writeJson(args.artifactPath, result);
    if (result.status !== "accepted") process.exitCode = 2;
  } catch (error) {
    if (outputPath) writeJson(outputPath, blocked({}, "worker-failed", error instanceof Error ? error.message : String(error)));
    process.exitCode = 2;
  }
}

if (process.env.MYSTUDIO_HYPERFRAMES_WORKER === "1") main();

export { HEAVY_CSS_TOKENS, HEAVY_ELEMENT_BUDGET, MAX_WINDOWS_PER_COMPOSITION, SUPPORTED_TEMPLATES, TOOL_VERSION, animationPhaseStyle, buildHyperFramesWorkerTemporaryOutputPath, escapeHtml, estimateHeavyElementCount, moveValidatedOutput, numberParameter, textParameter } from "./hf-shared";
export type { HyperFramesSegmentWindow, HyperFramesWorkerResult } from "./hf-shared";
export { REGISTRY_DEP_REF, inlineSafeJs, isRegistryTemplate, loadRegistryTemplate, materializeRegistryTemplate, registryTemplateCache, resolveRegistryAssetsRoot } from "./hf-templates";
export type { MaterializedRegistryTemplate } from "./hf-templates";
export { renderWindow } from "./hf-window";
export { buildHyperFramesCliArgs, buildHyperFramesCompositionHtml, collectDegradedRegistryTemplates } from "./hf-composition";
export { assertOutputDuration, assertPngSequenceOutput, assertRenderedAlphaOutput, quoteConcatPath, renderSegments, splitHyperFramesRenderSegments, toFrameBoundaryUs, windowEndUs } from "./hf-segments";
export type { HyperFramesRenderSegment } from "./hf-segments";
