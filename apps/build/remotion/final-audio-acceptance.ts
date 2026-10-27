import fs from "node:fs";
import path from "node:path";
import {
  buildLoudnessMeasurementArgs,
  evaluateLoudnessMeasurement,
  hashFileSha256,
  LOUDNESS_MEASUREMENT_FILTER,
  measureRenderedMediaLoudness,
} from "./render-smoke-evidence";

/** Read-only final AAC measurement, never normalization. Failure must stop promotion. */
export async function acceptFinalAudio(input: {
  filePath: string;
  renderSettings: unknown;
  rawLogPath: string;
  reportPath: string;
  meter?: typeof measureRenderedMediaLoudness;
  hash?: typeof hashFileSha256;
}) {
  const filePath = path.resolve(input.filePath);
  const reportPath = path.resolve(input.reportPath);
  const rawLogPath = path.resolve(input.rawLogPath);
  const measurementReportPath = `${reportPath}.measurement.json`;
  // Evidence destinations cannot alias the source or one another.
  const destinations = [rawLogPath, reportPath, measurementReportPath];
  if (new Set([filePath, ...destinations]).size !== 4) throw new Error("audio-evidence-path-collision");
  const existingFiles = fs.existsSync(filePath) ? [fs.lstatSync(filePath)] : [];
  for (const destination of destinations) {
    if (!fs.existsSync(destination)) continue;
    const stat = fs.lstatSync(destination);
    if (stat.isSymbolicLink() || fs.realpathSync(destination) === filePath
      || existingFiles.some((existing) => existing.dev === stat.dev && existing.ino === stat.ino)) {
      throw new Error("audio-evidence-path-alias");
    }
    existingFiles.push(stat);
  }
  const hash = input.hash ?? hashFileSha256;
  const snapshot = async () => {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || fs.realpathSync(filePath) !== filePath) {
      throw new Error("final-audio-input-must-be-nonempty-regular-file-without-symlink");
    }
    const sha256 = await hash(filePath);
    const after = fs.lstatSync(filePath);
    if (stat.size !== after.size || stat.mtimeMs !== after.mtimeMs || stat.ctimeMs !== after.ctimeMs
      || stat.ino !== after.ino || stat.dev !== after.dev || after.isSymbolicLink()) {
      throw new Error("final-audio-file-changed-during-hash");
    }
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error("final-audio-invalid-sha256");
    return { path: filePath, sha256, sizeBytes: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, ino: stat.ino, dev: stat.dev };
  };
  const persist = (receipt: unknown) => {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  };
  let output: Awaited<ReturnType<typeof snapshot>> | undefined;
  let target: { integratedLufs: number; truePeakDbtp: number; integratedToleranceLu: number; truePeakToleranceDb: number } | undefined;
  try {
    const settings = input.renderSettings;
    if (!settings || typeof settings !== "object" || !("loudnessLufs" in settings) || !("truePeakDbtp" in settings)
      || typeof settings.loudnessLufs !== "number" || !Number.isFinite(settings.loudnessLufs)
      || typeof settings.truePeakDbtp !== "number" || !Number.isFinite(settings.truePeakDbtp)) {
      throw new Error("final-audio-explicit-finite-plan-targets-required");
    }
    target = { integratedLufs: settings.loudnessLufs, truePeakDbtp: settings.truePeakDbtp, integratedToleranceLu: 0.5, truePeakToleranceDb: 0 };
    output = await snapshot();
    const measurement = await (input.meter ?? measureRenderedMediaLoudness)({
      filePath, rawLogPath, reportPath: measurementReportPath, target,
    });
    const after = await snapshot();
    if (JSON.stringify(output) !== JSON.stringify(after)) throw new Error("final-audio-file-changed-during-meter");
    if (!measurement.acceptance) throw new Error("final-audio-measurement-only-receipt-rejected");
    if (![measurement.integratedLufs, measurement.peakDbfs, measurement.loudnessRangeLu].every(Number.isFinite)) {
      throw new Error("final-audio-nonfinite-measurement");
    }
    if (measurement.inputPath !== filePath || measurement.rawLogPath !== rawLogPath || measurement.reportPath !== measurementReportPath
      || measurement.filter !== LOUDNESS_MEASUREMENT_FILTER || measurement.peakType !== "true-peak" || measurement.peakUnit !== "dBFS"
      || !measurement.ffmpegVersion?.trim() || measurement.command?.executable !== "ffmpeg"
      || JSON.stringify(measurement.command.args) !== JSON.stringify(buildLoudnessMeasurementArgs(filePath))) {
      throw new Error("final-audio-meter-provenance-mismatch");
    }
    // Recompute from numbers and actual plan targets; supplied booleans cannot grant acceptance.
    const acceptance = evaluateLoudnessMeasurement(measurement, target);
    if (!acceptance.passed) throw new Error("final-audio-target-acceptance-failed");
    const receipt = { schemaVersion: 1, generatedAt: new Date().toISOString(), passed: true, output, target, measurement, acceptance };
    persist(receipt);
    return receipt;
  } catch (error) {
    // Keep the meter's raw/report failure evidence intact and add the file/target binding.
    persist({ schemaVersion: 1, generatedAt: new Date().toISOString(), passed: false, output, target, rawLogPath, measurementReportPath, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
