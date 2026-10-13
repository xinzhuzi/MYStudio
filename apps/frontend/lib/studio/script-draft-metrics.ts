/**
 * 剧本确定性自检指标(G20/G25/G26/父 D2/父 I6/I8)。
 * 消费方:useScriptStageActions(审核 prompt 注入,父 I5)与 ScriptTab(只读展示)。
 *
 * 阈值单一真源 = 通用剧本手册条款(父 I6,代码常量注释回指节标题,不锚行号):
 * - 单集参考时长 ±10 秒;各场秒数合计对账同一口径(手册【输出格式规范】「九、时长与视觉预算」节;
 *   v3 已由「八、时长控制」改名合并,「约束」节同指引——锚节标题以抗挪行)
 * - 配音总量(台词+OS)≤ 4 字/秒(240 字/分钟);OS/旁白占比 ≤ 40%
 * - 镜头上限 = ⌊时长秒 ÷ 10⌋(G26 单值:每镜头按 10 秒预算;题材包只收紧不放宽)
 *   (G35 留白:题材包〔script_narrative〕可声明更严镜头预算——道劫/甜宠当前两包均未声明,
 *   代码不预建输入口,待包侧真声明后再接线收紧)
 * - 单句(对白/OS)≤ 20 字@16:9 / ≤ 15 字@9:16(G7)
 * 解析口径(父 D2,取自 out/b-plus-script-ch1*.md 实样结构;四审B M1-M6 深化见各条):
 * - 行分类单源(四审B design §1):每行去 `**` 与首尾空白后经 classifyLine 分为
 *   场头/标题/镜头/语音/SFX/人物/分隔线/空段/内容九类,主循环、续行停扫、场内门控全部
 *   消费它——场头/镜头/语音叶正则只住分类器域,防多处正则各认各的再造双口径
 * - 场头 `{场号} {场景名} {时间}/{光线} ·约{N}秒`(四审B M4):容「## 」前缀与全角连字符
 *   (归一半角);N-M 与裸数字同过尾部锚(词/词 | 时长 token | 「场」字),「3-5 年前」
 *   「1-9 闲笔」类无锚叙述行不生幻影场
 * - 时长 parseSceneSeconds 单源(四审B M3):·约N秒(分隔符容 ·/./•、内部空格任意)/
 *   约 N 秒/Ns(s 大小写均认)/分:秒(全半角冒号);秒数提取、场头尾锚、title 剥除三处同消费。
 *   不识别的时长写法报「场 X 时长写法不识别：<原文片段>」,场头无任何时长 token 才报
 *   「缺·约N秒标注」——两文案分流,缺标注文案指向手册正典格式
 * - 镜头行(G44 双格式):`△` 开头(存量兼容,禁删——用户项目库存量剧本全是 △)或 `镜头N：`
 *   开头(人话格式,手册现行,含转场括注)均计一拍;镜号按场核对(四审B M6,手册
 *   「每场从 1 重新计数」):同场同号重复/1..max 缺号入 flags;中文数字镜头行(「镜头一：」)
 *   为格式漂移,不计台词亦不计拍
 * - 语音行 `名[（括注）][：:]内容`(四审B M2/M5):名组排除中文句读/全半角括号/全角引号、
 *   上限 10 字(超长叙述名=叙述,静默跳过不 flag;保留间隔号 · 与半角 .);OS/VO/V.O. 计 OS,
 *   V.S(带/不带尾点)仅括注以「旁白」起计 OS,其余括注=画外对白计对白;`字幕：` 标签行
 *   不计台词;冒号前空格容错(「甲 ：好。」计对白)
 * - 语音内容在同行;同行为空则逐行累加后续内容行至结构行/空段(四审B M1,手册场景段落
 *   「空行分段」即边界),累加行逐行计入该语音条目并逐行判超长(手册「单句」锚句不锚段);
 *   语音/SFX/镜头/场头等结构行即停——该行留给主循环独立解析,不整行吞并
 * - 在场内状态(F2):命中场头置真,遇任意 # 开头行置假——仅场内计语音与超长句,
 *   首场前梗概与改编追踪区的「名：内容」行不误算为台词;镜头计数口径不变(△/镜头N： 同规)
 * - 场秒对账:存在缺标注场只报逐场缺标注,全部场有秒才对账总时长(10-12 口径)
 * - 逐场对账(F4,手册「九、时长与视觉预算」节):本场镜头数(△/镜头N： 合计)×10 秒 ≤ 本场秒数+10、
 *   本场语音字数 ≤ ⌊本场秒数×4⌋(按 4 字/秒),超即入 flags;缺秒场不判
 * - 三条手册规则(四审B M6,10-14 裁定=警告级 flags,不改接口不拆数组):OS 连续不超 2 段/
 *   场景段落 20-60 秒/纯画面段落最长 15 秒,超出以「警告」前缀入 flags,缺秒场不判秒数带
 * - 场号 N-M 与裸数字混用(同剧本内)→ flag「场号格式不一致」(F6,手册场头要求 {场号})
 * - 超长句按句本体计量:行内「| 环境音/音效」注释列不计入字数(G25)
 * - 画幅真源 = 剧本头部第三行自述(父 I7/I8:只按「已确定要求：」前缀 + `16:9`/`9:16`
 *   子串匹配,不匹配枚举全集;全角冒号归一,同线双画幅取首个出现位置);opts.aspectRatio 仅兜底
 * - 格式漂移 → 指标给 0/null 并入 flags,永不抛错
 */

export interface ScriptDraftMetricsScene {
  id: string;
  title: string;
  seconds: number | null;
  beats: number;
  voiceChars: number;
}

export interface ScriptDraftMetrics {
  scenes: ScriptDraftMetricsScene[];
  /** 各场 ·约N秒 合计;存在缺标注场时不对账总时长(只报逐场缺标注),全部有秒才对账 */
  totalSeconds: number;
  /** durationMin × 60 */
  targetSeconds: number;
  beats: number;
  /** ⌊targetSeconds/10⌋(G26) */
  beatLimit: number;
  dialogueChars: number;
  osChars: number;
  /** os/(dialogue+os);无语音时 0 */
  osRatio: number;
  /** durationMin × 240(4 字/秒,手册条款;道劫包 150 字/分属题材豁免,由其手册注入块声明) */
  voiceCharLimit: number;
  overlongLines: { scene: string; text: string; chars: number }[];
  /** 16:9 → 20 字;9:16 → 15 字(G7) */
  lineLimit: number;
  flags: string[];
}

const SCENE_HEADER_RE = /^(\d+(?:[-－–—]\d+)?)\s+(.+)$/;
// 四审B M4①:容 Markdown 前缀「## 1-1 …」(≤3 个 #,更深层仍是标题行)
const SCENE_HEADER_LEAD_RE = /^#{0,3}\s*/;
// 四审B M4②:全角/em/en 连字符归一半角,防「1－1」与「1-1」互不认而误触「场号格式不一致」
const SCENE_ID_HYPHEN_RE = /[－–—]/g;
const ASPECT_HEADER_RE = /^#\s*已确定要求[：:]/;
const STRIP_FOR_COUNT_RE = /[\p{P}\p{S}\s]/gu;

/** 逐场对账阈值(手册「九、时长与视觉预算」节·每场对账条款,父 I6 锚节标题不锚行号):
 *  本场镜头数×10 秒 ≤ 本场秒数+10;本场语音字数 ≤ ⌊本场秒数×4⌋(按 4 字/秒)。 */
const SCENE_BEAT_SECONDS = 10; // 每镜头按 10 秒预算(与全集镜头上限同源;G44 双格式:镜头N： 人话格式为手册现行,△ 为存量兼容)
const SCENE_SECONDS_SLACK = 10; // 本场秒数容差 +10
const SCENE_VOICE_CHARS_PER_SECOND = 4; // 4 字/秒(10-14 裁定①唯一口径;道劫包 150 字/分=题材豁免,见其手册注入块)
// 三条手册规则阈值(四审B M6,同节「时长与视觉预算」:OS 连续不超 2 段/场景段落 20-60 秒/
// 纯画面段落最长 15 秒;10-14 裁定=入自检「警告」级 flags)
const SCENE_SECONDS_RANGE_MIN = 20;
const SCENE_SECONDS_RANGE_MAX = 60;
const PURE_VISUAL_LIMIT_SECONDS = 15;

/** 行内注释列(「| 环境音/音效」等)剥离后按句本体计字数(G25)。 */
function countChars(content: string): number {
  return content.split("|")[0]!.replace(STRIP_FOR_COUNT_RE, "").length;
}

// ── 行分类器(四审B design §1 单源化)────────────────────────────────
// 场头/镜头/语音叶正则只住此域;主循环、续行停扫、场内门控全部经 classifyLine 消费。

type LineKind =
  | "sceneHeader"
  | "heading"
  | "shot"
  | "voice"
  | "sfx"
  | "cast"
  | "separator"
  | "blank"
  | "text";

// G44 双格式镜头行:`△` 开头(存量兼容,禁删)或 `镜头N：` 开头(人话格式,手册现行)均计
// 一拍;数字后允许转场括注(手册明教「镜头3（叠化）：雪夜闪回」,全/半角括号皆认)。
// 「镜头」前缀+数字序号+冒号才认——纯数字行、无冒号的追踪表/叙述行不误吞。
const SHOT_LINE_RE = /^(?:△|镜头\s*\d+\s*(?:[（(][^）)]*[）)])?\s*[：:])/;
const SHOT_NUMBER_RE = /^镜头\s*(\d+)/; // 四审B M6 镜号核对(△ 行无号,不参与)
const SFX_LINE_RE = /^SFX\s*[（:：]/;
const CAST_LINE_RE = /^人物[：:]/;
// 四审B M5 标签排除:格式漂移/非语音标签行,不计台词亦不给拍数信用(阿拉伯数字镜头行
// 仍走 shot 计拍)。保留 voice 分类(维持既有「语音行形态即停扫」语义),由语音处理跳过。
const VOICE_LABEL_RE = /^(?:字幕|镜头[一二三四五六七八九十百]+)$/;
// 名字类排除集(四审B M2/M5):全/半角括号(防贪婪吞括注如「V.S.（旁白，冷）」整段成名;
// 半角 ( 使「OS(甲)：」漏归 OS)、中文句读与全角引号(叙述行「他…说道：来吧」不误计语音);
// 保留间隔号 ·(「沈·青岚」类名)与半角 .(「V.S.」依赖)。上限 10 字(VOICE_NAME_MAX):
// 超长名=叙述,静默跳过不 flag(现役最长具名「宗门弟子甲」5 字;livefire8 的 15 字
// 叙述名被长度网兜住,句读名被句读网兜住)。
const VOICE_LINE_RE =
  /^([^：:\s（(，,。!！?？、;；…—「」『』“”]{1,10})([（(][^）)]*[）)])?\s*[：:](.*)$/;

/** 四审B M3 时长单源:·约N秒(分隔符容 ·/./•、内部空格任意)/约 N 秒/Ns(s 大小写均认,
 *  后随须为行尾/空白/标点防误吞英文词)/分:秒(全半角冒号)。秒数提取、场头尾锚、
 *  title 剥除三处同消费,防 M3 与 M4 分叉。 */
const SCENE_SECONDS_FORMS: { re: RegExp; toSeconds: (m: RegExpExecArray) => number }[] = [
  { re: /(?:[·.•]\s*)?约\s*(\d+)\s*秒/, toSeconds: (m) => Number(m[1]) },
  { re: /(\d+)\s*s(?=$|[\s·，。、;；!！?？])/i, toSeconds: (m) => Number(m[1]) },
  { re: /(\d+)\s*[：:]\s*(\d+)/, toSeconds: (m) => Number(m[1]) * 60 + Number(m[2]) },
];

function parseSceneSeconds(line: string): { seconds: number; matchedText: string } | null {
  for (const form of SCENE_SECONDS_FORMS) {
    const m = form.re.exec(line);
    if (m) return { seconds: form.toSeconds(m), matchedText: m[0] };
  }
  return null;
}

// 四审B M3 两文案分流:场头含 duration-ish token(判据,design §4)但解析失败 →
// 「时长写法不识别」;无任何 token → 「缺·约N秒标注」(指向手册正典格式,文案不变)。
const DURATIONISH_TOKEN_RE = /(?:约|·|•|\.)\s*\S{0,6}(?:秒|分)|\d+\s*(?:秒|s|分)/i;
const UNPARSED_DURATION_RE = /(?:[·•.]\s*)?(约[^，。；、/\s]{0,10}|[^\s，。；、/]{0,10}[秒分]S?)/i;

function extractUnparsedDuration(line: string): string {
  const m = UNPARSED_DURATION_RE.exec(line);
  return (m?.[1] ?? "").trim().slice(0, 12); // 原文片段 ≤12 字(design §4)
}

/** 裸数字场号的紧凑尾部锚:行末须是「{词}/{词}」(两词各 ≤6 字、无标点无空格)或 ·约N秒,
 *  且其后无正文——「3 年后/开春，河雾照旧。」这类叙述行不吞(10-12 复审收口径),留作续行内容。 */
const BARE_SCENE_END_RE = /(?:\s[^/\s，。！？；、：]{1,6}\/[^/\s，。！？；、：]{1,6}|\s*·约\d+秒)\s*$/;

/** 场头尾部锚(四审B M4③:N-M 与裸数字同过锚):词/词 | 时长 token(容错形态,经
 *  parseSceneSeconds)|「场」字锚(如「1-2 场 夜/内」)——「3-5 年前」「1-9 闲笔」类
 *  无锚叙述行不生幻影场。 */
function hasSceneTailAnchor(line: string): boolean {
  if (parseSceneSeconds(line) !== null) return true;
  if (DURATIONISH_TOKEN_RE.test(line)) return true; // 时长意图 token(含不识别写法,如「·约一分钟」)亦可锚
  if (/\s场(?:\s|$)/.test(line)) return true;
  return BARE_SCENE_END_RE.test(line);
}

interface SceneHeaderMatch {
  id: string; // 连字符已归一半角(F6 混用判定与展示同一形态)
  range: boolean;
  base: string; // 剥「#{0,3} 」前缀后的行(title 推导基座)
}

/** 场头识别(四审B M4):容「## 」前缀、全角连字符归一、N-M 与裸数字同过尾部锚。 */
function matchSceneHeader(line: string): SceneHeaderMatch | null {
  const base = line.replace(SCENE_HEADER_LEAD_RE, "");
  const m = SCENE_HEADER_RE.exec(base);
  if (!m) return null;
  if (!hasSceneTailAnchor(base)) return null;
  const id = m[1]!.replace(SCENE_ID_HYPHEN_RE, "-");
  return { id, range: id.includes("-"), base };
}

/** 行分类单源(四审B design §1):结构行(停扫/边界)=sceneHeader|heading|shot|voice|sfx|cast|
 *  separator;blank=空段边界(M1,手册场景段落「空行分段」);text=内容。 */
function classifyLine(line: string): LineKind {
  if (line === "") return "blank";
  if (matchSceneHeader(line) !== null) return "sceneHeader";
  if (line.startsWith("#")) return "heading";
  if (SHOT_LINE_RE.test(line)) return "shot";
  if (SFX_LINE_RE.test(line)) return "sfx";
  if (CAST_LINE_RE.test(line)) return "cast";
  if (line === "---") return "separator";
  if (VOICE_LINE_RE.test(line)) return "voice";
  return "text";
}

/** 续行停扫:候选行非纯内容行(结构行/空段)即停——该行留给主循环独立解析,不整行吞并。 */
function stopsContinuation(line: string): boolean {
  return classifyLine(line) !== "text";
}

/** 画幅真源=头部「已确定要求：」自述行(父 I7/I8);opts 兜底,再缺省 16:9。
 *  四审B M6:全角冒号归一后匹配;同线双画幅取首个出现位置(「横屏16:9（非9:16）」→16:9,
 *  旧「9:16 子串优先」即缺陷本身)。 */
function resolveAspectRatio(lines: string[], fallback?: string): "16:9" | "9:16" {
  for (const raw of lines) {
    if (!ASPECT_HEADER_RE.test(raw)) continue;
    const normalized = raw.replaceAll("：", ":");
    const at9 = normalized.indexOf("9:16");
    const at16 = normalized.indexOf("16:9");
    if (at16 !== -1 && (at9 === -1 || at16 < at9)) return "16:9";
    if (at9 !== -1) return "9:16";
    break;
  }
  return fallback?.includes("9:16") ? "9:16" : "16:9";
}

export function analyzeScriptDraft(
  text: string,
  opts: { durationMin?: number; aspectRatio?: string } = {},
): ScriptDraftMetrics {
  const durationMin = opts.durationMin && opts.durationMin > 0 ? opts.durationMin : 3;
  const targetSeconds = Math.round(durationMin * 60);
  const beatLimit = Math.floor(targetSeconds / 10);
  const voiceCharLimit = Math.round(durationMin * 240);
  const lines = (text ?? "").split(/\r?\n/);
  const cleaned = lines.map((line) => line.replaceAll("**", "").trim());
  const aspect = resolveAspectRatio(cleaned, opts.aspectRatio);
  const lineLimit = aspect === "9:16" ? 15 : 20;

  const scenes: ScriptDraftMetricsScene[] = [];
  const flags: string[] = [];
  const overlongLines: { scene: string; text: string; chars: number }[] = [];
  let beats = 0;
  let dialogueChars = 0;
  let osChars = 0;
  let current: ScriptDraftMetricsScene | null = null;
  // 在场内状态(F2):命中场头置真;遇任意 # 开头行置假——仅场内计语音与超长句
  let inScene = false;
  // 场号形态(F6):N-M 与裸数字混用即 flag(id 已归一半角,M4②)
  let hasRangeSceneId = false;
  let hasBareSceneId = false;
  // 四审B M6 镜号按场核对(手册:每场从 1 重新计数)
  const shotNumsByScene = new Map<ScriptDraftMetricsScene, number[]>();
  // 四审B M6 警告级规则游标(场内):①无对白间隔的 OS 连段 ③连续无语音拍数
  let osRun = 0;
  let silentBeats = 0;

  // 场收尾:结算警告级规则①③游标(规则②在逐场对账循环内判)
  const endScene = () => {
    if (current) {
      if (osRun > 2) {
        flags.push(`「警告」场 ${current.id} OS 连续 ${osRun} 段（手册：不连续超过 2 段）`);
      }
      if (silentBeats * SCENE_BEAT_SECONDS > PURE_VISUAL_LIMIT_SECONDS) {
        flags.push(
          `「警告」场 ${current.id} 纯视觉段 ${silentBeats} 拍≈${silentBeats * SCENE_BEAT_SECONDS}s 超过 ${PURE_VISUAL_LIMIT_SECONDS} 秒`,
        );
      }
    }
    osRun = 0;
    silentBeats = 0;
  };

  for (let i = 0; i < cleaned.length; i++) {
    const line = cleaned[i]!;
    const kind = classifyLine(line);

    if (kind === "sceneHeader") {
      endScene();
      inScene = true;
      const header = matchSceneHeader(line)!;
      if (header.range) hasRangeSceneId = true;
      else hasBareSceneId = true;
      const parsed = parseSceneSeconds(header.base);
      let title = header.base;
      if (parsed) title = title.replace(parsed.matchedText, " ");
      current = {
        id: header.id,
        title: title.slice(header.id.length).trim(),
        seconds: parsed?.seconds ?? null,
        beats: 0,
        voiceChars: 0,
      };
      if (!parsed) {
        flags.push(
          DURATIONISH_TOKEN_RE.test(header.base)
            ? `场 ${header.id} 时长写法不识别：${extractUnparsedDuration(header.base)}`
            : `场 ${header.id} 缺·约N秒标注`,
        );
      }
      scenes.push(current);
      continue;
    }

    if (kind === "heading") {
      endScene();
      inScene = false; // Markdown 标题行(## 剧情梗概 / ## 改编追踪 等)即出场
      continue;
    }

    // G44 双格式镜头行:△(存量兼容)与 镜头N：(人话格式,含转场括注形态)均计一拍;
    // 须在语音判定之前 continue——否则「镜头1：内容」会按 VOICE_LINE_RE 误计为「镜头1」的台词。
    // 与语音行同受 F2 在场内门控:场外(梗概/改编追踪区)镜头行不计——人话前缀是普通
    // 中文词组,场外暴露面大于专用符号 △
    if (kind === "shot") {
      if (inScene) {
        beats++;
        if (current) current.beats++;
        silentBeats++;
        const shotNum = SHOT_NUMBER_RE.exec(line);
        if (shotNum && current) {
          const nums = shotNumsByScene.get(current) ?? [];
          nums.push(Number(shotNum[1]));
          shotNumsByScene.set(current, nums);
        }
      }
      continue;
    }

    if (kind !== "voice") continue; // sfx/cast/separator/blank/text:不入账、不破游标外的状态

    if (!inScene) continue; // 场外「名：内容」行(梗概/改编追踪区)不计语音与超长句(F2)
    const voiceMatch = VOICE_LINE_RE.exec(line);
    if (!voiceMatch) continue;
    const name = voiceMatch[1]!;
    if (name === "人物") continue; // 人物表行不计对白(父 D2;带空格变体兜底)
    if (name === "SFX") continue; // SFX 音效配方行非语音(手册 §三 音效意图;语音=台词+OS,G20)
    if (VOICE_LABEL_RE.test(name)) continue; // 四审B M5:字幕/镜头一： 标签排除,不计台词不计拍

    const parenthetical = voiceMatch[2]?.slice(1, -1) ?? "";
    // 四审B M5 OS 归类扩:OS(括注任意)∪ VO/V.O.(画外音与 OS 同义)→OS;
    // V.S(带/不带尾点)仅括注以「旁白」起→OS,其余括注=画外对白计对白(手册双形态原样保持)
    const isOS =
      name === "OS" ||
      name === "VO" ||
      name === "V.O." ||
      ((name === "V.S" || name === "V.S.") && parenthetical.startsWith("旁白"));

    // 单行入账:计字数、归 OS/对白与场语音、逐行判超长(G25 注释列剥离;四审B M1 逐行判)
    const pushVoice = (raw: string) => {
      const chars = countChars(raw);
      if (isOS) osChars += chars;
      else dialogueChars += chars;
      if (current) current.voiceChars += chars;
      if (chars > lineLimit) {
        overlongLines.push({ scene: current?.id ?? "—", text: raw.split("|")[0]!.trim(), chars });
      }
    };

    const inlineContent = voiceMatch[3]?.trim() ?? "";
    if (inlineContent) {
      pushVoice(inlineContent);
    } else {
      // 冒号后换行形态(四审B M1):逐行累加至结构行/空段(手册「空行分段」即边界),
      // 累加行逐行计入该语音条目并逐行判超长;语音/SFX/镜头/场头等结构行即停——
      // 该行留给主循环独立解析,不整行吞并
      let last = i;
      for (let j = i + 1; j < cleaned.length; j++) {
        const next = cleaned[j]!;
        if (stopsContinuation(next)) break;
        pushVoice(next);
        last = j;
      }
      i = last;
    }

    // 警告级规则①③游标:对白打断 OS 连段;一切语音打断纯视觉段(打断处结算,场收尾兜底)
    if (isOS) {
      osRun++;
    } else {
      if (current && osRun > 2) {
        flags.push(`「警告」场 ${current.id} OS 连续 ${osRun} 段（手册：不连续超过 2 段）`);
      }
      osRun = 0;
    }
    if (current && silentBeats * SCENE_BEAT_SECONDS > PURE_VISUAL_LIMIT_SECONDS) {
      flags.push(
        `「警告」场 ${current.id} 纯视觉段 ${silentBeats} 拍≈${silentBeats * SCENE_BEAT_SECONDS}s 超过 ${PURE_VISUAL_LIMIT_SECONDS} 秒`,
      );
    }
    silentBeats = 0;
  }
  endScene();

  // 四审B M6 镜号核对(手册「每场从 1 重新计数」):同场同号重复/1..max 缺号
  for (const s of scenes) {
    const nums = shotNumsByScene.get(s) ?? [];
    const counts = new Map<number, number>();
    for (const n of nums) counts.set(n, (counts.get(n) ?? 0) + 1);
    for (const [n, c] of counts) {
      if (c > 1) flags.push(`场 ${s.id} 镜号 ${n} 重复`);
    }
    const max = nums.reduce((acc, n) => Math.max(acc, n), 0);
    for (let n = 1; n <= max; n++) {
      if (!counts.has(n)) flags.push(`场 ${s.id} 镜号跳号：缺 ${n}`);
    }
  }

  const totalSeconds = scenes.reduce((sum, s) => sum + (s.seconds ?? 0), 0);
  // 逐场对账(F4,手册「九、时长与视觉预算」节):秒数已知的场逐项核对,缺秒场不判
  for (const s of scenes) {
    if (s.seconds === null) continue;
    // 警告级规则②(四审B M6):场秒超出场景段落 20-60s(缺秒场不判,与逐场对账同守卫)
    if (s.seconds < SCENE_SECONDS_RANGE_MIN || s.seconds > SCENE_SECONDS_RANGE_MAX) {
      flags.push(`「警告」场 ${s.id} 秒数 ${s.seconds}s 超出场景段落 20-60s`);
    }
    if (s.beats * SCENE_BEAT_SECONDS > s.seconds + SCENE_SECONDS_SLACK) {
      flags.push(
        `场 ${s.id} 镜头 ${s.beats} 个×10s 超本场 ${s.seconds}s+${SCENE_SECONDS_SLACK}`,
      );
    }
    const sceneVoiceLimit = Math.floor(s.seconds * SCENE_VOICE_CHARS_PER_SECOND);
    if (s.voiceChars > sceneVoiceLimit) {
      flags.push(`场 ${s.id} 语音 ${s.voiceChars} 字超本场上限 ${sceneVoiceLimit}`);
    }
  }
  // 场号格式漂移(F6):同剧本内 N-M 与裸数字混用
  if (hasRangeSceneId && hasBareSceneId) {
    flags.push("场号格式不一致(N-M 与裸数字混用)");
  }
  if (scenes.length === 0) {
    flags.push("未识别到场次段落（格式漂移，场秒/镜头对账不可用）");
  } else if (scenes.every((s) => s.seconds !== null)) {
    // 对账口径(10-12):存在缺标注场只报逐场缺标注,全部有秒才对账总时长(旧「部分有秒即对账」废止)
    if (Math.abs(totalSeconds - targetSeconds) > 10) {
      flags.push(`场秒合计 ${totalSeconds}s，偏离目标 ${targetSeconds}s 超过 ±10s`);
    }
  }
  if (beats > beatLimit) {
    flags.push(`镜头 ${beats} 个超上限 ${beatLimit}（每镜头按 10 秒预算）`);
  }
  const voiceChars = dialogueChars + osChars;
  if (voiceChars > voiceCharLimit) {
    flags.push(`语音字数 ${voiceChars} 超上限 ${voiceCharLimit}（4 字/秒）`);
  }
  const osRatio = voiceChars > 0 ? osChars / voiceChars : 0;
  if (osRatio > 0.4) {
    flags.push(`OS 占比 ${(osRatio * 100).toFixed(1)}% 超上限 40%`);
  }
  if (overlongLines.length > 0) {
    flags.push(`超长句 ${overlongLines.length} 条（单句上限 ${lineLimit} 字@${aspect}）`);
  }

  return {
    scenes,
    totalSeconds,
    targetSeconds,
    beats,
    beatLimit,
    dialogueChars,
    osChars,
    osRatio,
    voiceCharLimit,
    overlongLines,
    lineLimit,
    // 返回前去重:同 id 场重复缺标注等会产生重复 flag(React key 重复与重复报告双治)
    flags: [...new Set(flags)],
  };
}

/** 指标文本化:首行=父 I5 标题;审核 prompt 注入与 UI 共用同一输出。 */
export function formatScriptDraftMetrics(m: ScriptDraftMetrics): string {
  const voiceChars = m.dialogueChars + m.osChars;
  const osPct = voiceChars > 0 ? `${(m.osRatio * 100).toFixed(1)}%` : "0%";
  const sceneSummary =
    m.scenes
      .map((s) => `${s.id} ${s.seconds === null ? "缺·约" : `${s.seconds}s`}·镜${s.beats}·语音${s.voiceChars}`)
      .join("；") || "未识别到场次";
  const missingSeconds = m.scenes.filter((s) => s.seconds === null).length;
  const lines = [
    "## 自检指标（代码计算，以此为准）",
    missingSeconds > 0
      ? `- 场秒对账：${missingSeconds} 个场缺·约N秒标注，总时长不对账（缺标注场不计入合计，先补齐标注）`
      : `- 场秒合计：${m.totalSeconds}s（目标 ${m.targetSeconds}s，允许 ±10s）`,
    `- 视觉预算：镜头 ${m.beats} 个（上限 ${m.beatLimit}，每镜头按 10 秒预算）`,
    `- 语音字数：对白 ${m.dialogueChars} + OS ${m.osChars} = ${voiceChars} 字（上限 ${m.voiceCharLimit}；OS 占比 ${osPct}，上限 40%）`,
    `- 单句长度：上限 ${m.lineLimit} 字，超长 ${m.overlongLines.length} 条`,
    `- 场次：${sceneSummary}`,
    `- 自检结论：${m.flags.length ? m.flags.join("；") : "自检通过"}`,
  ];
  return lines.join("\n");
}
