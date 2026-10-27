// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as gate from "./final-audio-acceptance";
import { hashFileSha256, measureRenderedMediaLoudness, type LoudnessMeasurementExec } from "./render-smoke-evidence";

function fixture(integrated = -14, peak = -1.5) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "audio-acceptance-"));
  const filePath = path.join(dir, "fixture.mp4");
  fs.writeFileSync(filePath, "offline fixture bytes, not media");
  const exec: LoudnessMeasurementExec = async (_exe, args) => args[0] === "-version"
    ? { stdout: "ffmpeg version offline-fixture" }
    : { stderr: `Summary:\nIntegrated loudness:\n I: ${integrated} LUFS\nLoudness range:\n LRA: 2 LU\nTrue peak:\n Peak: ${peak} dBFS\n` };
  const meter = vi.fn((input: Parameters<typeof measureRenderedMediaLoudness>[0]) => measureRenderedMediaLoudness({ ...input, exec }));
  return { filePath, rawLogPath: path.join(dir, "raw.log"), reportPath: path.join(dir, "acceptance.json"), renderSettings: { loudnessLufs: -14, truePeakDbtp: -1.5 }, meter };
}

describe("strict final encoded audio acceptance", () => {
  it("binds finite measured values, actual targets, tool provenance and stable bytes", async () => {
    const f = fixture();
    const receipt = await gate.acceptFinalAudio(f);
    expect(receipt.passed).toBe(true);
    expect(receipt.output.sha256).toBe(await hashFileSha256(f.filePath));
    expect(receipt.output.sizeBytes).toBe(fs.statSync(f.filePath).size);
    expect(receipt.output.mtimeMs).toBe(fs.statSync(f.filePath).mtimeMs);
    expect(receipt.target).toEqual({ integratedLufs: -14, truePeakDbtp: -1.5, integratedToleranceLu: 0.5, truePeakToleranceDb: 0 });
    expect(receipt.measurement.ffmpegVersion).toBe("ffmpeg version offline-fixture");
    expect(JSON.parse(fs.readFileSync(f.reportPath, "utf8"))).toEqual(receipt);
  });
  it.each([[-14, -1.4], [-13.4, 0.2], [-13.44, 0.15], [-14.51, -2]])("rejects LUFS=%s peak=%s and persists failure", async (i, p) => {
    const f = fixture(i, p);
    await expect(gate.acceptFinalAudio(f)).rejects.toThrow();
    expect(JSON.parse(fs.readFileSync(f.reportPath, "utf8")).passed).toBe(false);
    expect(fs.existsSync(`${f.reportPath}.measurement.json`)).toBe(true);
  });
  it.each([undefined, null, {}, { loudnessLufs: -14 }, { loudnessLufs: NaN, truePeakDbtp: -1.5 }, { loudnessLufs: -14, truePeakDbtp: Infinity }])("rejects missing or nonfinite actual plan targets %j before metering", async (renderSettings) => {
    const f = fixture();
    await expect(gate.acceptFinalAudio({ ...f, renderSettings })).rejects.toThrow();
    expect(f.meter).not.toHaveBeenCalled();
  });
  it.each([NaN, Infinity, -Infinity, undefined])("rejects nonfinite measurement %s even when caller claims pass", async (value) => {
    const f = fixture();
    const meter = async (input: Parameters<typeof measureRenderedMediaLoudness>[0]) => ({ ...await f.meter(input), peakDbfs: value, acceptance: { passed: true } }) as Awaited<ReturnType<typeof measureRenderedMediaLoudness>>;
    await expect(gate.acceptFinalAudio({ ...f, meter })).rejects.toThrow();
  });
  it("does not trust caller acceptance booleans for over-limit values", async () => {
    const f = fixture();
    const meter = async (input: Parameters<typeof measureRenderedMediaLoudness>[0]) => ({ ...await f.meter(input), peakDbfs: 0.2 });
    await expect(gate.acceptFinalAudio({ ...f, meter })).rejects.toThrow();
  });
  it("persists meter exception and propagates failure without retry", async () => {
    const f = fixture();
    const meter = vi.fn(async () => { throw new Error("offline meter failure"); });
    await expect(gate.acceptFinalAudio({ ...f, meter })).rejects.toThrow("offline meter failure");
    expect(meter).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fs.readFileSync(f.reportPath, "utf8")).passed).toBe(false);
  });
  it.each(["missing", "empty", "symlink"])("rejects %s file before metering", async (kind) => {
    const f = fixture();
    if (kind === "missing") f.filePath += ".absent";
    if (kind === "empty") fs.writeFileSync(f.filePath, "");
    if (kind === "symlink") { const link = `${f.filePath}.link`; fs.symlinkSync(f.filePath, link); f.filePath = link; }
    await expect(gate.acceptFinalAudio(f)).rejects.toThrow();
    expect(f.meter).not.toHaveBeenCalled();
  });
  it("rejects changed bytes during metering", async () => {
    const f = fixture();
    const meter = async (input: Parameters<typeof measureRenderedMediaLoudness>[0]) => { const m = await f.meter(input); fs.appendFileSync(f.filePath, "changed"); return m; };
    await expect(gate.acceptFinalAudio({ ...f, meter })).rejects.toThrow("changed");
  });
  it.each(["raw", "acceptance", "measurement"])("rejects a %s evidence hardlink before metering or changing input bytes", async (kind) => {
    const f = fixture();
    const before = fs.readFileSync(f.filePath);
    const destination = kind === "raw" ? f.rawLogPath : kind === "acceptance" ? f.reportPath : `${f.reportPath}.measurement.json`;
    fs.linkSync(f.filePath, destination);
    await expect(gate.acceptFinalAudio(f)).rejects.toThrow("audio-evidence-path-alias");
    expect(f.meter).not.toHaveBeenCalled();
    expect(fs.readFileSync(f.filePath)).toEqual(before);
  });
  it.each(["acceptance", "measurement"])("rejects a %s evidence hardlink to another destination before metering", async (kind) => {
    const f = fixture();
    fs.writeFileSync(f.rawLogPath, "existing evidence");
    const destination = kind === "acceptance" ? f.reportPath : `${f.reportPath}.measurement.json`;
    fs.linkSync(f.rawLogPath, destination);
    await expect(gate.acceptFinalAudio(f)).rejects.toThrow("audio-evidence-path-alias");
    expect(f.meter).not.toHaveBeenCalled();
    expect(fs.readFileSync(f.rawLogPath, "utf8")).toBe("existing evidence");
  });
  it("rejects stale hashes even with unchanged size and mtime", async () => {
    const f = fixture();
    let call = 0;
    await expect(gate.acceptFinalAudio({ ...f, hash: async () => (++call === 1 ? "a" : "b").repeat(64) })).rejects.toThrow("changed");
  });
  it("requires provenance for the same file and actual meter command", async () => {
    const f = fixture();
    const meter = async (input: Parameters<typeof measureRenderedMediaLoudness>[0]) => ({ ...await f.meter(input), inputPath: "/wrong/file.mp4" });
    await expect(gate.acceptFinalAudio({ ...f, meter })).rejects.toThrow();
  });
  it("rejects measurement-only receipts even when their numbers meet the targets", async () => {
    const f = fixture();
    const meter = async (input: Parameters<typeof measureRenderedMediaLoudness>[0]) => ({ ...await f.meter(input), acceptance: undefined });
    await expect(gate.acceptFinalAudio({ ...f, meter })).rejects.toThrow("measurement-only");
  });
  it.each(["integratedLufs", "loudnessRangeLu"] as const)("rejects nonfinite %s", async (field) => {
    const f = fixture();
    const meter = async (input: Parameters<typeof measureRenderedMediaLoudness>[0]) => ({ ...await f.meter(input), [field]: Infinity });
    await expect(gate.acceptFinalAudio({ ...f, meter })).rejects.toThrow("nonfinite");
  });
  it("honors actual nondefault plan targets rather than fixed chapter values", async () => {
    const f = fixture(-16, -3);
    const receipt = await gate.acceptFinalAudio({ ...f, renderSettings: { loudnessLufs: -16, truePeakDbtp: -3 } });
    expect(receipt.target.integratedLufs).toBe(-16);
    expect(receipt.acceptance.truePeakComparisonLimitDbfs).toBe(-3);
  });
});

describe("forward integration ordering (source contract; never import executable entrypoints)", () => {
  it("awaits strict audio acceptance after final probe and before hashes/success evidence", () => {
    const s = fs.readFileSync(new URL("../timeline/run-full-pipeline.ts", import.meta.url), "utf8");
    const probe = s.indexOf('assertRenderedMediaEvidence({ label: "Daojie Full Pipeline"');
    const audio = s.indexOf("await acceptFinalAudio({", probe);
    expect(audio).toBeGreaterThan(probe);
    for (const marker of ["const sha256 = await hashFileSha256(outputPath)", "await buildFullPipelineRunEvidence({", "ok: true,"]) expect(s.indexOf(marker, probe)).toBeGreaterThan(audio);
    expect(s.slice(audio, s.indexOf("const sha256", audio))).toContain("renderSettings: plan.renderSettings");
    expect(s.slice(probe, s.indexOf("const sha256", probe))).not.toContain(".catch(");
  });
  it("awaits source-plan targets before every staging/succeeded/publish operation", () => {
    const s = fs.readFileSync(new URL("../scripts/campaigns/storyboard_1027/publish_chapter_slot.ts", import.meta.url), "utf8");
    const audio = s.indexOf("await acceptFinalAudio({");
    expect(audio).toBeGreaterThan(s.indexOf('fs.readFileSync(SRC_PLAN, "utf8")'));
    expect(s.slice(audio, s.indexOf("// staging", audio))).toContain("filePath: SRC_MP4");
    expect(s.slice(audio, s.indexOf("// staging", audio))).toContain("renderSettings: srcPlan.renderSettings");
    expect(s.slice(audio, s.indexOf("// staging", audio))).not.toContain(".catch(");
    for (const marker of ["fs.mkdirSync(", "fs.copyFileSync(", 'status: "succeeded"', "await publishCurrentSlot("]) expect(s.indexOf(marker)).toBeGreaterThan(audio);
  });
});
