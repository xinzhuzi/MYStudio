import path from "node:path";
import { measureRenderedMediaLoudness } from "./render-smoke-evidence";

export async function runLoudnessMeasurementCli(
  args = process.argv.slice(2),
): Promise<void> {
  const [inputPath, reportPath, rawLogPath] = args;
  if (!inputPath || !reportPath || args.length > 3) {
    throw new Error(
      "用法: npm run remotion:measure:loudness -- <input.mp4> <report.json> [raw.log]",
    );
  }
  const resolvedReportPath = path.resolve(reportPath);
  const report = await measureRenderedMediaLoudness({
    filePath: path.resolve(inputPath),
    reportPath: resolvedReportPath,
    rawLogPath: path.resolve(
      rawLogPath || path.join(path.dirname(resolvedReportPath), "loudness-measurement.log"),
    ),
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.env.MYSTUDIO_REMOTION_LOUDNESS_RUNNER === "1") {
  runLoudnessMeasurementCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
