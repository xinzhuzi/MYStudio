/**
 * 分镜生图换线正典生成器(1116,PRD 11-16-storyboard-canonical-line §4.1-4.2)。
 *
 * 体裁路由(PRD §4.2):有参考镜→i2i 指令体(09-图生图指令写作规范.md;
 * 分镜=无画布造新图形态——参考全=identity source,逐张点名);零参考镜→
 * t2i 主体句体(07-主体句写作宪法.md §二五项序)。骨架=十型手册 §7「分镜剧情图」
 * (assets/studio-manuals/art_skills/daojie_ink_guofeng/art_prompt/art_subject_ten_types.md:269)。
 *
 * 内容序=t2i 五项序(07 宪法 §二:身份段→配器清单句→动作姿势视线→环境场景→
 * 光色叙事落点色锚;PRD §4.2 明文);§7 骨架五槽(场景定场含主色/主角身份段搬运/
 * 剧情动作动词精度/场景物与色锚冷暖对比/视线情绪收束)按内容映射进五项序的
 * ④⑤槽——身份段恒在首位(07 §二「身份在前,跨图一致性权重最高」)。
 *
 * 事实纪律:只装配来源事实(videoDesc/分镜语义/三库场景/身份段槽/阵营色明文),
 * 未知项不猜不写(07 §三起草清单);颜色不编造——色锚唯一落点=阵营色明文行
 * (裁决序最内层,PRD §三「阵营色彩→迁移」)与环境时段事实。
 *
 * 硬纪律断言(§4.2 逐条有源)+ 重叠预检(宪法 §十,daojie_subject_overlap.py
 * 同源算法 TS 移植:子句×型底座 ≥10 字公共子串=重复块)在本模块收口,传输层
 * 送引擎前过门。
 */

import { DAOJIE_SUBJECT_STYLE_WORDS } from "@/lib/studio/daojie-style-word-strip";

/** 身份段来源分级(§4.3 定谳:落点=assets.promptOverrides「分镜剧情图」键)。 */
export type CanonicalIdentityOrigin =
  | "asset-override"
  | "character-library"
  | "absent";

export interface CanonicalIdentityParagraph {
  /** 角色名(可见角色语义名)。 */
  name: string;
  /** 身份段全文(逐字搬运进主体句,禁改写)。 */
  paragraph: string;
  origin: CanonicalIdentityOrigin;
}

/** §4.5 已裁槽位:image_1=主角单姿立绘;image_2=场景(无场景时次角色);image_3=前帧或次角色;道具与超额角色不入图。 */
export interface CanonicalReferenceSlot {
  /** 槽位号(1=image_1…3=image_3;[171] 加速编码只吃 image_1=语义最强主参考位)。 */
  slot: 1 | 2 | 3;
  role: "character" | "scene" | "previous-frame";
  /** 资产名(指令点名用)。 */
  title: string;
  imageUrl: string;
}

export interface CanonicalVisibleCharacter {
  name: string;
  position?: string;
  orientation?: string;
  actionIn?: string;
  actionOut?: string;
}

export interface CanonicalVisibleProp {
  name: string;
  position?: string;
  state?: string;
}

export interface CanonicalSceneFact {
  name: string;
  location?: string;
  time?: string;
  atmosphere?: string;
}

export interface CanonicalSubjectInput {
  /** 画面描述(videoDesc;动作/剧情事实源,动词精度由上游分镜表给)。 */
  description: string;
  /** 多帧镜帧时刻描述(帧规划器产物,如「开场站位:…」);并入动作槽作帧差异事实。 */
  momentNote?: string;
  /** 身份段(有序,主角首位;§7 槽位注「主角身份段必须搬」)。 */
  identities: CanonicalIdentityParagraph[];
  visibleCharacters: CanonicalVisibleCharacter[];
  visibleProps?: CanonicalVisibleProp[];
  scene?: CanonicalSceneFact | null;
  /** 光色叙事事实(continuityState.lighting 原词;禁摄影布光术语由断言把关)。 */
  lighting?: string;
  /** 阵营色明文行(如「(人族·人物)主色赭石+辅色栗褐+点睛藤黄」;明文设定色级,逐字)。 */
  factionColorLines?: string[];
}

export interface CanonicalSubjectSentence {
  /** 五项序单段主体句(建流期 prompt 节点值)。 */
  text: string;
  /** 事实缺口告警(不阻断生成,建流层记 diagnostics)。 */
  warnings: string[];
}

/**
 * 携带文本的半角标点归一(十型 §0.9 全角标点):来源事实(videoDesc/身份段/
 * 语义字段)可能携带半角逗号分号——形态归一非内容改写,内容词逐字保留。
 * <imageN> 令牌与数字比例(如时间码)不含 ASCII 标点,零误伤面。
 */
function normalizeFullwidthPunctuation(text: string): string {
  return text
    .replace(/,/g, "，")
    .replace(/;/g, "；")
    .replace(/:/g, "：")
    .replace(/!/g, "！")
    .replace(/\?/g, "？");
}

/** t2i 五项序主体句(纯函数)。 */
export function buildCanonicalSubjectSentence(input: CanonicalSubjectInput): CanonicalSubjectSentence {
  const warnings: string[] = [];
  const description = normalizeFullwidthPunctuation(input.description.trim());

  // ① 身份段(逐字同源;07 §三「同一角色跨图逐字同源」)。零身份段的泛剧情句
  // =事故源(§7 槽位注:零主角锚+零发型锚=模型自由发挥)——不编造,落告警。
  const identityText = input.identities
    .filter((identity) => identity.paragraph.trim())
    .map((identity) => normalizeFullwidthPunctuation(identity.paragraph.trim()))
    .join("；");
  const named = new Set(input.visibleCharacters.map((character) => character.name.trim()).filter(Boolean));
  const covered = new Set(
    input.identities.filter((identity) => identity.paragraph.trim()).map((identity) => identity.name.trim()),
  );
  for (const name of named) {
    if (!covered.has(name)) warnings.push(`identity-missing:${name}`);
  }
  if (named.size > 0 && input.identities.length === 0) warnings.push("identity-missing:all");

  // ② 配器部件清单句(07 §四;§4.5:道具不入参考图→指令文字承载)。只有
  // 来源事实(名/位置/状态),颜色材质未知不猜(07 §三「未知项不猜不写」)。
  const propText = (input.visibleProps ?? [])
    .filter((prop) => prop.name.trim())
    .map((prop) => [
      normalizeFullwidthPunctuation(prop.name.trim()),
      prop.position?.trim() ? `置于${normalizeFullwidthPunctuation(prop.position.trim())}` : "",
      prop.state?.trim() ? normalizeFullwidthPunctuation(prop.state.trim()) : "",
    ].filter(Boolean).join("，"))
    .join("；");

  // ③ 动作姿势与视线(videoDesc=剧情动作事实,动词精度;描述未点名的可见角色
  // 语义(position/orientation/action)逐人补一句,防丢人)。
  const described = new Set(
    [...named].filter((name) => description.includes(name) || identityText.includes(name)),
  );
  const semanticText = input.visibleCharacters
    .filter((character) => character.name.trim() && !described.has(character.name.trim()))
    .map((character) => [
      normalizeFullwidthPunctuation(character.name.trim()),
      character.position?.trim() ? `位于${normalizeFullwidthPunctuation(character.position.trim())}` : "",
      character.orientation?.trim() ? normalizeFullwidthPunctuation(character.orientation.trim()) : "",
      [character.actionIn?.trim(), character.actionOut?.trim()]
        .filter((fact): fact is string => Boolean(fact))
        .map((fact) => normalizeFullwidthPunctuation(fact))
        .join("至"),
    ].filter(Boolean).join("，"))
    .join("；");
  const actionText = [description, semanticText, input.momentNote?.trim() ? normalizeFullwidthPunctuation(input.momentNote.trim()) : ""]
    .filter(Boolean)
    .join("；");

  // ④ 环境与场景元素(§7 场景定场:地点+天候+氛围)。
  const scene = input.scene;
  const sceneText = scene
    ? [
        normalizeFullwidthPunctuation(scene.name.trim()),
        scene.location?.trim() ? normalizeFullwidthPunctuation(scene.location.trim()) : "",
        scene.time?.trim() ? normalizeFullwidthPunctuation(scene.time.trim()) : "",
        scene.atmosphere?.trim() ? normalizeFullwidthPunctuation(scene.atmosphere.trim()) : "",
      ].filter(Boolean).join("，")
    : "";

  // ⑤ 光色叙事与落点色锚(07 §八:来源事实中的时段/光源/方向/落点可写;
  // 阵营色=明文设定色逐字,PRD §三迁移)。
  const lightText = [
    input.lighting?.trim() ? normalizeFullwidthPunctuation(input.lighting.trim()) : "",
    ...(input.factionColorLines ?? []).map((line) => normalizeFullwidthPunctuation(line.trim())),
  ].filter(Boolean).join("；");

  const text = [
    identityText,
    propText,
    actionText,
    sceneText,
    lightText,
  ]
    .filter(Boolean)
    .map((part) => (part.endsWith("。") ? part.slice(0, -1) : part))
    .join("，") + "。";

  return { text, warnings };
}

// ─── §4.5 槽位映射(已裁) ───

export interface CanonicalSlotMappingInput {
  /** 角色(continuityOrder 升序=主角在前;单姿立绘已由资产解析层优先)。 */
  characters: Array<{ title: string; imageUrl: string }>;
  scenes: Array<{ title: string; imageUrl: string }>;
  props: Array<{ title: string; imageUrl: string }>;
  /** 多帧续帧链上一帧成图(gen(k-1)→gen(k));恒槽 3 候补。 */
  previousFrameImageUrl?: string;
}

export interface CanonicalSlotMapping {
  /** 有序槽位(1..N,N≤3;空=t2i 路)。 */
  slots: CanonicalReferenceSlot[];
  /** 不入图参考与原因(§4.5:道具与超额角色不入图)。 */
  dropped: Array<{ title: string; reason: string }>;
}

/** §4.5 槽位映射(纯函数;1116 三裁①按推荐案)。 */
export function mapCanonicalReferenceSlots(input: CanonicalSlotMappingInput): CanonicalSlotMapping {
  const slots: CanonicalReferenceSlot[] = [];
  const dropped: CanonicalSlotMapping["dropped"] = [];
  const characters = [...input.characters];
  const scenes = [...input.scenes];
  // 槽序=占槽优先序:主角立绘→场景→前帧/次角色;前位缺席时后位依序上补
  // (物理槽 image_1/2/3 恒连续占用,<imageN> 标签与槽号一一对应)。
  const nextSlot = (): 1 | 2 | 3 => (slots.length + 1) as 1 | 2 | 3;

  // image_1=主角单姿立绘(身份最高权重+[171] 主参考位);无角色时场景顶 image_1。
  if (characters.length) {
    const lead = characters.shift()!;
    slots.push({ slot: nextSlot(), role: "character", title: lead.title, imageUrl: lead.imageUrl });
  } else if (scenes.length) {
    const lead = scenes.shift()!;
    slots.push({ slot: nextSlot(), role: "scene", title: lead.title, imageUrl: lead.imageUrl });
  }
  // 无角色无场景=纯道具镜:道具不入图(§4.5),走 t2i 指令文字承载。
  if (slots.length === 0) {
    return {
      slots: [],
      dropped: [
        ...input.props.map((prop) => ({ title: prop.title, reason: "prop-not-transported" })),
      ],
    };
  }
  // image_2=场景图;无场景时次角色。
  if (scenes.length) {
    const scene = scenes.shift()!;
    slots.push({ slot: nextSlot(), role: "scene", title: scene.title, imageUrl: scene.imageUrl });
  } else if (characters.length) {
    const next = characters.shift()!;
    slots.push({ slot: nextSlot(), role: "character", title: next.title, imageUrl: next.imageUrl });
  }
  // image_3=前帧图(多帧续帧)或次角色。
  if (input.previousFrameImageUrl) {
    slots.push({ slot: nextSlot(), role: "previous-frame", title: "上一帧画面", imageUrl: input.previousFrameImageUrl });
  } else if (characters.length) {
    const next = characters.shift()!;
    slots.push({ slot: nextSlot(), role: "character", title: next.title, imageUrl: next.imageUrl });
  }
  dropped.push(
    ...input.props.map((prop) => ({ title: prop.title, reason: "prop-not-transported" })),
    ...characters.map((character) => ({ title: character.title, reason: "character-overflow" })),
    ...scenes.map((scene) => ({ title: scene.title, reason: "scene-overflow" })),
  );
  return { slots, dropped };
}

// ─── i2i 指令(09 篇;分镜=无画布造新图) ───

const CANONICAL_ROLE_LABEL: Record<CanonicalReferenceSlot["role"], string> = {
  character: "身份来源",
  scene: "场景来源",
  "previous-frame": "上一帧画面来源",
};

export interface CanonicalTransportInstruction {
  genre: "t2i" | "i2i";
  /** 单段成文终稿(送 [400] 位)。 */
  prompt: string;
  slots: CanonicalReferenceSlot[];
}

/**
 * 传输期体裁装配(纯函数):零参考→t2i 主体句直通;有参考→09 篇指令体
 * (分镜场景生成=no canvas:全部图均身份源逐张点名,禁压缩成「两张图里的人物」)。
 * 硬约束=操作段与保真段两段在场(09 §四段序两式裁定);身份不变量指图不描字
 * (09 四条结构铁律②——身份段不重描,由 <imageN> 携带)。
 */
export function buildCanonicalTransportInstruction(input: {
  subject: CanonicalSubjectInput;
  slots: CanonicalReferenceSlot[];
}): CanonicalTransportInstruction {
  const subject = buildCanonicalSubjectSentence(input.subject);
  const slots = input.slots;
  if (slots.length === 0) {
    return { genre: "t2i", prompt: subject.text, slots: [] };
  }
  // 变化项=主体句去身份段(指图不描字):动作+配器+环境+光色。
  const variationBody = buildCanonicalSubjectSentence({ ...input.subject, identities: [] }).text;

  // 引用形态(09 §二引用规范=第一道工序):N≥2 恒 <imageN> 标签逐张点名;
  // N=1 自然指称,禁标签。
  const nameSlot = (slot: CanonicalReferenceSlot): string => {
    const label = CANONICAL_ROLE_LABEL[slot.role];
    const title = normalizeFullwidthPunctuation(slot.title.trim());
    return slots.length >= 2
      ? `<image${slot.slot}>为${title}的${label}`
      : `参考图中的${title}为${label}`;
  };

  // 操作段(动词领头)+变化项。
  const operation = `绘制一张全新的单格剧情画面：${slots.map(nameSlot).join("，")}；${variationBody}`;

  // 保真段(「在此基础上，完整保留…」逐类指图;09 §四③;前帧=画面连续性承接)。
  const fidelity = slots
    .map((slot) => {
      const title = normalizeFullwidthPunctuation(slot.title.trim());
      if (slot.role === "character") {
        return slots.length >= 2
          ? `完整保留<image${slot.slot}>中${title}的面部身份，发型与服装配饰`
          : `完整保留参考图中${title}的面部身份，发型与服装配饰`;
      }
      if (slot.role === "scene") {
        return slots.length >= 2
          ? `完整保留<image${slot.slot}>中${title}的环境结构与陈设`
          : `完整保留参考图中${title}的环境结构与陈设`;
      }
      return slots.length >= 2
        ? `完整承接<image${slot.slot}>的画面连续性，人物形象与光色氛围延续上一帧`
        : `完整承接参考图的画面连续性，人物形象与光色氛围延续上一帧`;
    })
    .join("，");

  // 收束句(肯定式枚举收尾;防 Leakage——参考图仅取点名要素,全新构图呈现)。
  const closing = "各参考图仅取上述点名要素，画面以全新构图呈现";
  const prompt = [operation, `在此基础上，${fidelity}`, closing].join("；") + "。";
  return { genre: "i2i", prompt, slots };
}

// ─── 硬纪律断言(§4.2) ───

export interface CanonicalDisciplineViolation {
  rule: string;
  detail: string;
}

/** 写实族词(十型 §0.3「写实词与程式词禁」;门禁画风词表之外的同族补充)。 */
const REALISM_WORDS = ["照片级", "写实", "胶片感", "镜头感", "photorealistic"] as const;
/** 摄影布光术语(07 §八 D7;禁色温值/打光/体积光/景深虚化)。 */
const PHOTO_LIGHTING_WORDS = ["色温", "打光", "体积光", "景深", "虚化"] as const;
/** 手部姿势 L4/L5 禁(十型 §0.3 手部防崩纪律②姿势分级;「剑指向」动作短语
 * 非手势义,取手势短语形态防误杀)。 */
const HAND_BANNED_WORDS = ["剑指手势", "比出剑指", "十指张开", "托举细物", "双手十指"] as const;
/** 画幅/分辨率词(09 格式七规③:比例/分辨率禁入正文)。 */
const ASPECT_PATTERN = /(?:16[:：]9|9[:：]16|3[:：]4|4[:：]3|1[:：]1|2048|1152|1024|分辨率|宽高比|画幅比例)/;
/** 否定式(09 格式七规⑤肯定式;钦定【文字要求】块豁免)。 */
const NEGATION_PATTERN = /禁止|不要|不得|不许|避免|不能|没有|不含|不会/;
/** 两可句(十型 §0.3 直陈与确定式;「A或B」掷硬币式禁——取连接词形态,
 * 单字「或」的动词/副词用法(或许/或已)不误杀,更深判定归引擎门)。 */
const AMBIGUOUS_PATTERN = /(?:或者|或是|还是)/;
/** 画面内中文文字触发词(07 §二A;涉画面文字展示须顶部逐字携带官方块)。 */
const IN_FRAME_TEXT_PATTERN = /招牌|匾额|题字|字幕|刻字|标签文字/;
/** 官方【文字要求】块(07 §二A 官方逐字,禁改写)。 */
export const CANONICAL_TEXT_REQUIREMENT_BLOCK =
  "【文字要求】画面中所有文字必须是以上明确指定的中文，逐字准确、清晰可读、无错字无乱码；不要生成任何未指定的多余文字。";

/**
 * 体裁纪律断言(纯函数;建流/传输双点位同源调用)。逐条源:§4.2 生成器硬纪律
 * +09 格式七规+07 宪法 §二A/§七A/§八+十型 §0.3。钦定【文字要求】块原文豁免
 * 否定式/两可句检查(十型 §0.3「钦定块豁免」)。
 */
export function lintCanonicalPrompt(
  prompt: string,
  genre: "t2i" | "i2i",
  referenceCount: number,
): CanonicalDisciplineViolation[] {
  const violations: CanonicalDisciplineViolation[] = [];
  const block = CANONICAL_TEXT_REQUIREMENT_BLOCK;
  const exempt = prompt.includes(block) ? prompt.replace(block, "") : prompt;

  // 单段成文无换行(09 格式七规①;主体句同款单段)。
  if (/\r|\n/.test(prompt)) violations.push({ rule: "single-paragraph", detail: "含换行" });

  for (const word of [...DAOJIE_SUBJECT_STYLE_WORDS, ...REALISM_WORDS]) {
    if (prompt.includes(word)) violations.push({ rule: "style-word", detail: word });
  }
  for (const word of PHOTO_LIGHTING_WORDS) {
    if (prompt.includes(word)) violations.push({ rule: "photography-lighting", detail: word });
  }
  for (const word of HAND_BANNED_WORDS) {
    if (prompt.includes(word)) violations.push({ rule: "hand-pose-l4-l5", detail: word });
  }
  const aspectMatch = ASPECT_PATTERN.exec(prompt);
  if (aspectMatch) violations.push({ rule: "aspect-or-resolution", detail: aspectMatch[0] });
  const negationMatch = NEGATION_PATTERN.exec(exempt);
  if (negationMatch) violations.push({ rule: "negation", detail: negationMatch[0] });
  const ambiguousMatch = AMBIGUOUS_PATTERN.exec(exempt);
  if (ambiguousMatch) violations.push({ rule: "ambiguous-choice", detail: ambiguousMatch[0] });

  // 画面内中文文字铁律(07 §二A):触发词在场而块缺席=违规。
  if (IN_FRAME_TEXT_PATTERN.test(prompt) && !prompt.startsWith(block)) {
    violations.push({ rule: "text-requirement-block", detail: "涉画面文字而未带官方块" });
  }

  // 引用契约(09 §二引用规范②③):i2i N≥2 逐槽 <imageN> 标签点名,禁自然指称;
  // N=1 自然指称,禁标签;t2i 零标签。
  if (genre === "i2i" && referenceCount >= 2) {
    for (let slot = 1; slot <= referenceCount; slot += 1) {
      if (!prompt.includes(`<image${slot}>`)) {
        violations.push({ rule: "image-tag-contract", detail: `缺 <image${slot}> 标签` });
      }
    }
    if (/图[123]|第[一二三]张/.test(prompt.replace(/<image\d+>/g, ""))) {
      violations.push({ rule: "image-tag-contract", detail: "N≥2 禁「图1/第一张」自然指称" });
    }
  }
  if ((genre === "i2i" && referenceCount === 1) || genre === "t2i") {
    if (/<image\d+>/.test(prompt)) {
      violations.push({ rule: "image-tag-contract", detail: "单图/零参考禁 <imageN> 标签" });
    }
  }

  // 全角标点(十型 §0.9;<imageN> 令牌豁免)。
  const withoutTags = prompt.replace(/<image\d+>/g, "");
  if (/[,.!?;:]/.test(withoutTags)) {
    violations.push({ rule: "fullwidth-punctuation", detail: "含半角标点" });
  }
  return violations;
}

// ─── 重叠预检(宪法 §十;daojie_subject_overlap.py 同源) ───

/** 分镜剧情图型底座真源(qi21_bases.json#types[zh=分镜剧情图].positive_text)。 */
const basesModules = import.meta.glob(
  "../../assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json",
  { eager: true, import: "default" },
) as Record<string, { types?: Array<{ zh?: string; positive_text?: string }> }>;

const basesDoc = Object.values(basesModules)[0];
const STORYBOARD_BASE_POSITIVE: string =
  basesDoc?.types?.find((entry) => entry.zh === "分镜剧情图")?.positive_text ?? "";

/** 型底座正向全文(真源缺失时空串=预检降级不拦,测试锚钉)。 */
export function getStoryboardBaseSubjectText(): string {
  return STORYBOARD_BASE_POSITIVE;
}

export interface CanonicalOverlapBlock {
  clause: string;
  block: string;
  size: number;
}

/** 最长公共子串长度(DP;子句×底座规模=百字级,构建期一次性成本可忽略)。 */
function longestCommonSubstringLength(clause: string, base: string): { size: number; start: number } {
  let bestSize = 0;
  let bestStart = 0;
  let previous = new Array<number>(base.length + 1).fill(0);
  for (let i = 1; i <= clause.length; i += 1) {
    const current = new Array<number>(base.length + 1).fill(0);
    const char = clause[i - 1]!;
    for (let j = 1; j <= base.length; j += 1) {
      if (char === base[j - 1]) {
        current[j] = (previous[j - 1] ?? 0) + 1;
        if (current[j] > bestSize) {
          bestSize = current[j];
          bestStart = i - current[j];
        }
      }
    }
    previous = current;
  }
  return { size: bestSize, start: bestStart };
}

/**
 * 主体句×型底座重叠块(算法=apps/build/scripts/daojie_subject_overlap.py
 * `overlaps()` 同源:按 [;。] 分子句,子句≥10 字与底座全文最长公共子串 ≥10
 * =重复块,发放前须去重或明示接受)。
 */
export function findSubjectOverlapBlocks(subject: string, base: string): CanonicalOverlapBlock[] {
  if (!base) return [];
  const found: CanonicalOverlapBlock[] = [];
  for (const rawClause of subject.split(/[;。]/)) {
    const clause = rawClause.trim();
    if (clause.length < 10) continue;
    const { size, start } = longestCommonSubstringLength(clause, base);
    if (size >= 10) {
      found.push({ clause: clause.slice(0, 24), block: clause.slice(start, start + size), size });
    }
  }
  return found;
}
