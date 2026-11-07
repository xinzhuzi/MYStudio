/**
 * 标定与权重(1102 骨干③)——把「阈值全靠猜」变成可记账的样本问题。
 *
 * 对标上游两件套:`scripts/constant.py`+`cal_final_score.py`(用人类偏好拟合维度权重)
 * 与 `sampled_videos/`(每个模型一套参照产出)。我们的形态:
 *   - 阈值:同一支信号在本系列的 mean±2σ(与 DOVER 观感基线同一算法,只是泛化到全信号);
 *   - 标定证据:样本数不足 `QC_CALIBRATION_MIN_SAMPLES` 或未打标正负例 ⇒ 相关行恒 unverified;
 *   - 权重:注册表里的**本仓自定初值**(合计恰 100),不是上游那份——
 *     VBench 的权重是在它自己的 946 条 prompt 与几十万人类投票上拟合的,口径不同不可继承。
 *
 * 一句话口径:**没标定的信号只能记账,不能放行**;放行门槛恒为三态板的「零 fail 零缺证」。
 */

import fs from "node:fs";
import path from "node:path";

import { CHAPTER_QC_WEIGHT_TOTAL, dimensionSpec } from "./chapter-qc-registry";
import { QC_CALIBRATION_MIN_RED_CASES, QC_CALIBRATION_MIN_SAMPLES, type ChapterQcCalibrationCaseV1, type ChapterQcCalibrationScoreV1, type ChapterQcDimensionScoreV1, type ChapterQcDimensionSpecV1, type ChapterQcRequirementVerdict, type ChapterQcRequirementV1, type ChapterQcSignalBaselineV1, type ChapterQcSignalId } from "./chapter-qc-types";

export { QC_CALIBRATION_MIN_SAMPLES, QC_CALIBRATION_MIN_RED_CASES };
export type { ChapterQcSignalId };

/** 越限方向:low-bad=越小越坏(低于下界报警),high-bad=越大越坏(高于上界报警)。 */
const SIGNAL_DIRECTION: Record<ChapterQcSignalId, "low-bad" | "high-bad"> = {
  "aesthetic.fused": "low-bad",
  "motion.tiMean": "low-bad",
  "motion.staticFrameRatio": "high-bad",
  "shot.motion.staticFrameRatio": "high-bad",
  "speech.coverageRatio": "low-bad",
  "speech.secondsPerDeclaredShot": "low-bad",
  "visual.blurMean": "high-bad",
  "face.readableRatio": "low-bad",
};

/** σ 过小时的绝对护栏(避免一簇几乎相同的样本把带画得比测量噪声还窄)。 */
const SIGNAL_GUARD: Record<ChapterQcSignalId, number> = {
  "aesthetic.fused": 0.05,
  "motion.tiMean": 1.0,
  "motion.staticFrameRatio": 0.1,
  "shot.motion.staticFrameRatio": 0.1,
  "speech.coverageRatio": 0.1,
  "speech.secondsPerDeclaredShot": 0.5,
  "visual.blurMean": 1.0,
  "face.readableRatio": 0.1,
};

const SIGNAL_LABELS: Record<ChapterQcSignalId, string> = {
  "aesthetic.fused": "DOVER 融合观感分",
  "motion.tiMean": "帧间运动强度 TI 均值",
  "motion.staticFrameRatio": "静止帧占比(全片)",
  "shot.motion.staticFrameRatio": "静止帧占比(本章最差镜)",
  "speech.coverageRatio": "台词镜语音覆盖率",
  "speech.secondsPerDeclaredShot": "台词镜实测语音时长",
  "visual.blurMean": "blurdetect 均值(越大越糊)",
  "face.readableRatio": "检出脸可辨尺寸占比",
};

export function isChapterQcSignalId(value: string): value is ChapterQcSignalId {
  return value in SIGNAL_DIRECTION;
}

export function signalLabel(signalId: ChapterQcSignalId): string {
  return SIGNAL_LABELS[signalId];
}

export function meanSigma(values: readonly number[]): { mean: number; sigma: number } | null {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length < 2) return null;
  const mean = finite.reduce((sum, value) => sum + value, 0) / finite.length;
  const variance = finite.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (finite.length - 1);
  return { mean, sigma: Math.sqrt(variance) };
}

/** 越限界:mean ∓ max(2σ, guard)。low-bad 给下界,high-bad 给上界。 */
export function signalThreshold(baseline: ChapterQcSignalBaselineV1): number | null {
  const direction = isChapterQcSignalId(baseline.signalId) ? SIGNAL_DIRECTION[baseline.signalId] : null;
  if (!direction) return null;
  const guard = isChapterQcSignalId(baseline.signalId) ? SIGNAL_GUARD[baseline.signalId] : 0.05;
  const spread = Math.max(2 * baseline.sigma, guard);
  return direction === "low-bad" ? baseline.mean - spread : baseline.mean + spread;
}

export function isBaselineUsable(
  baseline: ChapterQcSignalBaselineV1 | undefined,
  minSamples = QC_CALIBRATION_MIN_SAMPLES,
): boolean {
  if (!baseline) return false;
  return baseline.sampleCount >= minSamples && Number.isFinite(baseline.mean);
}

export type ChapterQcSignalEvaluation =
  | { status: "uncalibrated"; reason: string }
  | { status: "in"; threshold: number; baseline: ChapterQcSignalBaselineV1 }
  | { status: "out"; threshold: number; baseline: ChapterQcSignalBaselineV1 };

/**
 * 「差几条」的同一口径:画带凭的是别章样本,本系列落库总数只作参照。
 * 两数不同才补一句——否则读者会以为这轮压根没攒样本,那是记账口径错,不是省事。
 * 返回裸的「已攒 n 条」,由各调用点按自己的句子形状包装。
 */
function seriesSampleCount(baseline: ChapterQcSignalBaselineV1 | undefined): number | undefined {
  const series = baseline?.seriesSampleCount;
  if (series === undefined || series === (baseline?.sampleCount ?? 0)) return undefined;
  return series;
}

/** 单条信号对照本系列基线的判定;无可用基线 ⇒ uncalibrated(记账,不冒充通过)。 */
export function evaluateSignalAgainstBaseline(
  signalId: ChapterQcSignalId,
  value: number | undefined,
  baselines: ReadonlyMap<string, ChapterQcSignalBaselineV1>,
  minSamples = QC_CALIBRATION_MIN_SAMPLES,
): ChapterQcSignalEvaluation {
  if (value === undefined || !Number.isFinite(value)) {
    return { status: "uncalibrated", reason: `${SIGNAL_LABELS[signalId]} 未出数` };
  }
  const baseline = baselines.get(signalId);
  if (!isBaselineUsable(baseline, minSamples)) {
    const series = seriesSampleCount(baseline);
    return {
      status: "uncalibrated",
      reason: `${SIGNAL_LABELS[signalId]} 阈值未标定(样本 ${baseline?.sampleCount ?? 0} 条,须 ≥${minSamples} 条才能画带)`
        + (series === undefined ? "" : `;本系列已攒 ${series} 条,含被判的这章`),
    };
  }
  const usable = baseline!;
  const threshold = signalThreshold(usable);
  if (threshold === null) return { status: "uncalibrated", reason: "未知信号,无方向口径" };
  const direction = SIGNAL_DIRECTION[signalId];
  const out = direction === "low-bad" ? value < threshold : value > threshold;
  return { status: out ? "out" : "in", threshold, baseline: usable };
}

/* ---------------- 落盘:样本 + 正负例集 ---------------- */

export interface ChapterQcSignalSampleV1 {
  signalId: ChapterQcSignalId;
  value: number;
  chapterId: string;
  at: number;
}

export interface ChapterQcCalibrationStoreV1 {
  schemaVersion: 1;
  seriesId: string;
  samples: ChapterQcSignalSampleV1[];
  cases: ChapterQcCalibrationCaseV1[];
}

/** 与报告同根:`<remotionWorkspace>/qc/calibration/{seriesId}.json`(段名同规则防逃逸)。 */
export function chapterQcCalibrationPath(workspaceRoot: string, seriesId: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(seriesId)) throw new Error(`seriesId 含非法字符: ${seriesId}`);
  return path.join(workspaceRoot, "qc", "calibration", `${seriesId}.json`);
}

export function readCalibrationStore(workspaceRoot: string, seriesId: string): ChapterQcCalibrationStoreV1 {
  const empty: ChapterQcCalibrationStoreV1 = { schemaVersion: 1, seriesId, samples: [], cases: [] };
  const filePath = chapterQcCalibrationPath(workspaceRoot, seriesId);
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch {
    return empty;
  }
  let parsed: Partial<ChapterQcCalibrationStoreV1> | undefined;
  try {
    parsed = JSON.parse(raw) as Partial<ChapterQcCalibrationStoreV1>;
  } catch {
    quarantineCalibrationFile(filePath, "解析失败");
    return empty;
  }
  if (parsed.schemaVersion !== 1) {
    quarantineCalibrationFile(filePath, `schemaVersion=${String(parsed.schemaVersion)} 本仓不认`);
    return empty;
  }
  return {
    schemaVersion: 1,
    seriesId,
    samples: Array.isArray(parsed.samples) ? parsed.samples.filter(isSampleShape) : [],
    cases: Array.isArray(parsed.cases) ? parsed.cases.filter(isCaseShape) : [],
  };
}

/**
 * 读不懂的库先留证据再当没有:静默返回空库,紧接着本轮写入就会把攒下来的样本覆盖掉——
 * 「样本攒了 30 章忽然归零」这种事故必须能在盘上找到那份原件。
 */
function quarantineCalibrationFile(filePath: string, reason: string): void {
  const stamped = `${filePath}.坏档-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  try {
    // 整份搬走(不删、不改写):攒了几十章的样本不能被一次解析失败无声吃掉。
    fs.renameSync(filePath, stamped);
    process.emitWarning(`标定库 ${reason},原件已存为 ${stamped};本轮按空库记账`);
  } catch {
    // 搬不动时,本轮报告已经走「标定库读写异常」的缺证路径,不在此处再抛。
  }
}

function isSampleShape(value: unknown): value is ChapterQcSignalSampleV1 {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.chapterId === "string"
    && typeof entry.at === "number"
    && typeof entry.signalId === "string"
    && isChapterQcSignalId(entry.signalId)
    && typeof entry.value === "number"
    && Number.isFinite(entry.value);
}

/**
 * 人只答「有没有」,机器那半边(`verdict`)必须成对在库里:
 * 只有 label 没有 verdict 的条目算不出召回,留着只会让 `caseCount` 虚高——
 * 这种半截条目按「本仓不认」过滤,不当金标用。
 */
function isCaseShape(value: unknown): value is ChapterQcCalibrationCaseV1 {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.caseId === "string"
    && typeof entry.videoSha256 === "string"
    && typeof entry.requirementId === "string"
    && (entry.label === "green" || entry.label === "red")
    && (entry.verdict === "pass" || entry.verdict === "fail" || entry.verdict === "unverified")
    && typeof entry.at === "number"
    && Number.isFinite(entry.at)
    && typeof entry.note === "string";
}

/** 同一支片子同一行只留最新一次打标:caseId 由内容哈希派生,不靠调用方发号。 */
export function calibrationCaseId(videoSha256: string, requirementId: string): string {
  return `${videoSha256}:${requirementId}`;
}

/**
 * 打标写入(upsert)。同 `caseId` 覆盖而不是追加:
 * 门改了、人重新看了一遍同一片子,要的是「现在这门对不对」,不是历史堆。
 * 历史不丢——报告与库都有 `.prev.json` 退回件,且 git 侧另有账。
 */
export function upsertCalibrationCase(
  store: ChapterQcCalibrationStoreV1,
  entry: ChapterQcCalibrationCaseV1,
  keep = 500,
): ChapterQcCalibrationStoreV1 {
  const cases = store.cases.filter((existing) => existing.caseId !== entry.caseId);
  cases.push(entry);
  return { ...store, cases: cases.sort((left, right) => left.at - right.at).slice(-keep) };
}

/** 追加样本(同 chapter+signal 覆盖旧值;每支信号只留最近 200 条,防文件无界长)。 */
export function appendCalibrationSamples(
  store: ChapterQcCalibrationStoreV1,
  samples: readonly ChapterQcSignalSampleV1[],
  keep = 200,
): ChapterQcCalibrationStoreV1 {
  if (samples.length === 0) return store;
  const merged = [...store.samples];
  for (const sample of samples) {
    const index = merged.findIndex(
      (existing) => existing.signalId === sample.signalId && existing.chapterId === sample.chapterId,
    );
    if (index >= 0) merged.splice(index, 1);
    merged.push(sample);
  }
  const trimmed = new Map<ChapterQcSignalId, ChapterQcSignalSampleV1[]>();
  for (const sample of merged) {
    const bucket = trimmed.get(sample.signalId) ?? [];
    bucket.push(sample);
    trimmed.set(sample.signalId, bucket);
  }
  return {
    ...store,
    samples: [...trimmed.values()].flatMap((bucket) =>
      bucket.sort((left, right) => left.at - right.at).slice(-keep),
    ),
  };
}

let tmpSeq = 0;

/**
 * 落盘:先落进唯一名的临时件再 rename(原子替换)。
 * 临时件名带 pid+序号,是为了两个进程同时写同一系列时不共用一个 `.tmp` 互相截胡;
 * 覆盖前把旧库搬一份 `.prev.json`,写坏一次还能退回上一版。
 */
export function writeCalibrationStore(workspaceRoot: string, store: ChapterQcCalibrationStoreV1): void {
  const filePath = chapterQcCalibrationPath(workspaceRoot, store.seriesId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (fs.existsSync(filePath)) {
    try {
      fs.copyFileSync(filePath, `${filePath}.prev.json`);
    } catch {
      // 退回件写不成不阻塞本轮:主库马上要被原子替换,内容仍是这一轮的实测。
    }
  }
  const tmpPath = `${filePath}.${process.pid}.${(tmpSeq += 1)}.tmp`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2), "utf-8");
    fs.renameSync(tmpPath, filePath);
  } catch (error) {
    try {
      fs.rmSync(tmpPath, { force: true });
    } catch {
      /* 临时件都删不动就算了,调用方按缺证处理 */
    }
    throw error;
  }
}

/**
 * 样本 → 逐信号基线表(供编排器与判定共用)。
 *
 * `excludeChapterId`:画带时把**本章自己的样本剔出去**。不剔的话,判定用的带里含着被判的那一个点,
 * 而 n≤5 时任何成员离均值都不到 2σ(极值上限 `(n-1)/√n < 2`)——那样第一支攒够样本的章
 * 天然永远判不出越限,带成了摆设。剔掉本章后被判的值是样本外的点,2σ 才有意义,
 * 代价是要用「别的章」攒够 `QC_CALIBRATION_MIN_SAMPLES` 条才能画带。
 *
 * 两个数分开记:`sampleCount` 是画带凭的别章样本数(判定门槛只看它),
 * `seriesSampleCount` 是本系列落库的总数(含本章)。只有本章样本的信号也出一条,
 * 否则「差几条」会报成 0 条,让人以为这轮压根没攒——那是记账口径错,不是省事。
 */
export function deriveSignalBaselines(
  store: ChapterQcCalibrationStoreV1,
  excludeChapterId?: string,
): ChapterQcSignalBaselineV1[] {
  const buckets = new Map<ChapterQcSignalId, { all: ChapterQcSignalSampleV1[]; others: ChapterQcSignalSampleV1[] }>();
  for (const sample of store.samples) {
    const bucket = buckets.get(sample.signalId) ?? { all: [], others: [] };
    bucket.all.push(sample);
    if (sample.chapterId !== excludeChapterId) bucket.others.push(sample);
    buckets.set(sample.signalId, bucket);
  }
  const out: ChapterQcSignalBaselineV1[] = [];
  for (const [signalId, bucket] of buckets) {
    // 带画在别章上;别章一条没有时退回用本系列全样本算个"参照均值",但 sampleCount=0 ⇒ 判定仍走未标定。
    const drawingSet = bucket.others.length > 0 ? bucket.others : bucket.all;
    const values = drawingSet.map((sample) => sample.value);
    // 单样本画不出带,但仍要记账:板上「差几条才够标定」得有真数,不能报 0 条。
    const stats = meanSigma(values) ?? (values.length === 1 ? { mean: values[0]!, sigma: 0 } : null);
    if (!stats) continue;
    out.push({
      signalId,
      seriesId: store.seriesId,
      mean: Number(stats.mean.toFixed(6)),
      sigma: Number(stats.sigma.toFixed(6)),
      sampleCount: excludeChapterId ? bucket.others.length : bucket.all.length,
      seriesSampleCount: bucket.all.length,
      updatedAt: Math.max(...bucket.all.map((sample) => sample.at)),
    });
  }
  return out;
}

/* ---------------- 正负例集打分:标定集的真实用途 ---------------- */

// 类型真源在 chapter-qc-types.ts(报告要快照它,类型层不能反向依赖本件)。
export type { ChapterQcCalibrationScoreV1 };

/**
 * 用打标正负例集给每道门算「抓得住吗」。
 * 这是上游 sampled_videos 的产线等价物:没有它,任何「阈值」都只是拍脑袋,
 * 相关行就必须在板上写明未标定。
 */
export function scoreCalibrationSet(
  cases: readonly ChapterQcCalibrationCaseV1[],
  verdictByCase: (item: ChapterQcCalibrationCaseV1) => ChapterQcRequirementV1["verdict"] | undefined,
): ChapterQcCalibrationScoreV1[] {
  const acc = new Map<string, ChapterQcCalibrationScoreV1>();
  for (const item of cases) {
    const row = acc.get(item.requirementId) ?? {
      requirementId: item.requirementId,
      greenTotal: 0,
      greenPassed: 0,
      redTotal: 0,
      redCaught: 0,
    };
    const verdict = verdictByCase(item);
    if (item.label === "green") {
      row.greenTotal += 1;
      if (verdict === "pass") row.greenPassed += 1;
    } else {
      row.redTotal += 1;
      if (verdict === "fail") row.redCaught += 1;
    }
    acc.set(item.requirementId, row);
  }
  return [...acc.values()];
}

/* ---------------- 标定兜底(注册表级) ---------------- */

/**
 * 骨干③的结构性兜底:注册表声明「本行要标定」,那本系列没有可用基线就不许 pass。
 *
 * 各 assessor 自己也查基线(为的是写明「具体缺哪一条证据」),这里兜的是另一类事故:
 * 新加一行忘了查标定,注册即静默变绿。`fail` 不兜——绝对码越限是真问题,
 * 拿「没标定」把它压回缺证等于藏病。
 */
export function calibrationBlocker(
  spec: ChapterQcDimensionSpecV1,
  verdict: ChapterQcRequirementVerdict,
  baselines: ReadonlyMap<string, ChapterQcSignalBaselineV1>,
): string | undefined {
  if (!spec.requiresCalibration || verdict !== "pass") return undefined;
  const signals = spec.calibrationSignals ?? [];
  if (signals.length === 0) {
    return "本行声明需标定却没绑信号(注册表缺 calibrationSignals):判不出就是判不出,不许 pass";
  }
  const minSamples = spec.minCalibrationSamples ?? QC_CALIBRATION_MIN_SAMPLES;
  const thin = signals.filter((signalId) => !isBaselineUsable(baselines.get(signalId), minSamples));
  if (thin.length === 0) return undefined;
  return `${thin
    .map((signalId) => {
      const baseline = baselines.get(signalId);
      const series = seriesSampleCount(baseline);
      return `${signalLabel(signalId)} 样本 ${baseline?.sampleCount ?? 0}/${minSamples} 条`
        + (series === undefined ? "" : `(本系列已攒 ${series} 条,含本章)`);
    })
    .join("、")}:阈值还没有本系列实测撑,pass 不给`;
}

/* ---------------- 召回门禁(金标集级兜底) ---------------- */

/**
 * 金标集给这行的「抓得住吗」一个数,这里决定这个数字能不能压掉一条 pass。
 *
 * 只压 `pass`,而且只在**负例全放过**时压:`fail` 是人已经看见门报警了(账要在 note 里给读者看,
 * 但改判等于藏病);抓回过一条负例的门不是摆设,拿「还漏了几条」把它压回缺证会让整块板子
 * 在没有标定量的时候自我否决——那是拿缺证当惩罚,不是当证据。
 * 负例不足 `minRedCases` 条时同样只记账:一两条可能是打标人记错、或那片子里的问题本不归这行管。
 */
export function caseRecallBlocker(
  verdict: ChapterQcRequirementVerdict,
  score: ChapterQcCalibrationScoreV1 | undefined,
  minRedCases = QC_CALIBRATION_MIN_RED_CASES,
): { blocker?: string; note?: string } {
  if (!score) return {};
  const red = `负例 ${score.redCaught}/${score.redTotal} 条抓到`;
  const green = score.greenTotal > 0 ? `、正例 ${score.greenPassed}/${score.greenTotal} 条放行` : "";
  const book = `打标金标:${red}${green}`;
  if (verdict !== "pass" || score.redTotal === 0 || score.redCaught > 0) return { note: book };
  if (score.redTotal < minRedCases) return { note: `${book}(负例不足 ${minRedCases} 条,还不够判这门是摆设)` };
  return { blocker: `${book}:已知有问题的片子这门一条没抓到,这门是摆设,pass 不给` };
}

/* ---------------- 加权维度分 ---------------- */
/**
 * 按注册表权重给三态板算 0~100 分:pass 计分,unverified/fail 都不计分
 * (「查不出来」不给分也不倒扣——缺证的代价是不放行,不是负分)。
 *
 * 分母恒为注册表满分,不是「本轮送进来的那几行的权重和」:只报两行且都过,
 * 板子不能显示满分——注册表里其余各行对本章而言是「没证据」,不是「没这项」。
 * 旧报告行数少于现行注册表时分数自然低,这是想要的行为(注册表自检另见 `missingSpecIds`)。
 */
export function scoreDimensionBoard(
  requirements: readonly ChapterQcRequirementV1[],
): ChapterQcDimensionScoreV1 {
  let weightPassed = 0;
  const deducted: ChapterQcDimensionScoreV1["deducted"] = [];
  for (const requirement of requirements) {
    const spec = dimensionSpec(requirement.requirementId);
    const weight = spec?.weight ?? 0;
    if (requirement.verdict === "pass") weightPassed += weight;
    else deducted.push({
      requirementId: requirement.requirementId,
      weight,
      reason: requirement.verdict === "fail" ? "fail" : "unverified",
    });
  }
  const reference = CHAPTER_QC_WEIGHT_TOTAL;
  return {
    score: reference > 0 ? Number(((weightPassed / reference) * 100).toFixed(1)) : 0,
    weightTotal: CHAPTER_QC_WEIGHT_TOTAL,
    weightPassed,
    deducted: deducted.sort((left, right) => right.weight - left.weight),
  };
}

/** 注册表自检用:每行是否恰有一条 spec。 */
export function missingSpecIds(requirements: readonly ChapterQcRequirementV1[]): string[] {
  return requirements
    .map((requirement) => requirement.requirementId)
    .filter((requirementId) => !dimensionSpec(requirementId));
}
