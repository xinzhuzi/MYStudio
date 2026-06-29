export type AssetMatchingLocalItem = {
  name: string;
  aliases?: string[];
  desc?: string;
};

export type AssetMatchingCenterItem = {
  name: string;
  desc: string;
};

/** 规范化名字：去空白、标点，统一比较 */
export const normalizeAssetText = (s: string) =>
  s.replace(/[\s\u3000·•\-—\-\(\)（）\[\]【】]/g, "").toLowerCase();

/** 检查提取名是否匹配资产库名（精确 or 规范化 or 包含） */
export const nameMatches = (
  extractedName: string,
  libName: string,
  aliases: string[] = [],
): boolean => {
  const en = normalizeAssetText(extractedName);
  const ln = normalizeAssetText(libName);
  if (en === ln) return true;
  if (en.includes(ln) || ln.includes(en)) return true;
  for (const alias of aliases) {
    const an = normalizeAssetText(alias);
    if (an === ln || an.includes(ln) || ln.includes(an)) return true;
  }
  return false;
};

/** 描述关键词相似匹配：提取 note 中的关键词在资产库描述中出现 >= threshold 个则认为匹配 */
export const descMatches = (
  note: string | undefined,
  libDesc: string,
  threshold = 2,
): boolean => {
  if (!note || !libDesc) return false;
  const keywords = note
    .split(/[,，、\s;；。！？!?·]+/)
    .filter((w) => w.length >= 2);
  if (keywords.length === 0) return false;
  const normLib = normalizeAssetText(libDesc);
  let hits = 0;
  for (const kw of keywords) {
    if (normLib.includes(normalizeAssetText(kw))) hits++;
    if (hits >= threshold) return true;
  }
  return false;
};

/** 判断是否为不记名NPC（泛称角色，如"孩童甲""丫头""老苦力"） */
export const isGenericNPC = (name: string): boolean => {
  // 以甲/乙/丙/丁/戊/己结尾
  if (/[甲乙丙丁戊己]$/.test(name)) return true;
  const genericKws = [
    "孩童",
    "丫头",
    "丫鬟",
    "苦力",
    "杂役",
    "小厮",
    "路人",
    "村民",
    "仆人",
    "仆从",
    "侍女",
    "侍者",
    "守卫",
    "卫兵",
    "弟子",
    "门人",
    "长老",
    "执事",
    "掌柜",
  ];
  return genericKws.some((kw) => name.includes(kw));
};

export const assetRecordMatches = ({
  name,
  note,
  localItems,
  centerItems,
  fallbackGeneric,
}: {
  name: string;
  note?: string;
  localItems: AssetMatchingLocalItem[];
  centerItems: AssetMatchingCenterItem[];
  fallbackGeneric?: boolean;
}): boolean => {
  if (localItems.some((it) => nameMatches(name, it.name, it.aliases ?? [])))
    return true;
  if (centerItems.some((it) => nameMatches(name, it.name))) return true;
  if (note) {
    const allDescs = [
      ...localItems.map((it) => it.desc ?? "").filter(Boolean),
      ...centerItems.map((it) => it.desc).filter(Boolean),
    ];
    if (allDescs.some((d) => descMatches(note, d))) return true;
  }
  if (fallbackGeneric && isGenericNPC(name)) {
    const genericNames = ["全体NPC", "NPC", "通用NPC", "群众", "路人"];
    return centerItems.some((it) =>
      genericNames.some((gn) =>
        normalizeAssetText(it.name).includes(normalizeAssetText(gn)),
      ),
    );
  }
  return false;
};
