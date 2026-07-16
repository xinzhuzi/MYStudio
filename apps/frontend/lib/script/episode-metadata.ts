export function extractTimelineInfo(outline: string, characterBios: string): {
  era: string;
  timelineSetting?: string;
  storyStartYear?: number;
  storyEndYear?: number;
} {
  const fullText = `${outline}\n${characterBios}`;
  
  // 1. 提取具体年份（如"2002年"、"1990-2020年"、"2022年夏天"）
  const yearPatterns = [
    // 年份范围：1990-2020年、1990年到2020年
    /(\d{4})\s*[-至到~]\s*(\d{4})\s*年?/,
    // 单独年份 + 季节/时间：2002年夏天、2022年初
    /(\d{4})年[\u4e00-\u9fa5]{0,4}/,
    // 单独年份：2002年
    /(\d{4})年/,
  ];
  
  let storyStartYear: number | undefined;
  let storyEndYear: number | undefined;
  let timelineSetting: string | undefined;
  
  // 尝试匹配年份范围
  const rangeMatch = fullText.match(/(\d{4})\s*[-至到~]\s*(\d{4})\s*年?/);
  if (rangeMatch) {
    storyStartYear = parseInt(rangeMatch[1]);
    storyEndYear = parseInt(rangeMatch[2]);
    timelineSetting = `${storyStartYear}年 - ${storyEndYear}年`;
  } else {
    // 尝试匹配单独年份
    const singleYearMatch = fullText.match(/(\d{4})年([\u4e00-\u9fa5]{0,6})/);
    if (singleYearMatch) {
      storyStartYear = parseInt(singleYearMatch[1]);
      const season = singleYearMatch[2] || '';
      timelineSetting = season ? `${storyStartYear}年${season}` : `${storyStartYear}年`;
    }
  }
  
  // 2. 提取时代背景（如"现代"、"民国"、"唐朝"）
  const eraPatterns = [
    /(现代|当代|近代|民国|清末|清朝|明朝|宋朝|唐朝|汉朝|三国|战国|春秋|古代|远古|未来)/,
    /(二十世纪|二十一世纪|20世纪|21世纪|\d{2}年代)/,
  ];
  
  let era = '现代'; // 默认现代
  for (const pattern of eraPatterns) {
    const eraMatch = fullText.match(pattern);
    if (eraMatch) {
      era = eraMatch[1];
      break;
    }
  }
  
  // 3. 根据年份推断时代
  if (storyStartYear) {
    if (storyStartYear >= 2000) {
      era = '现代';
    } else if (storyStartYear >= 1949) {
      era = '现代（新中国）';
    } else if (storyStartYear >= 1912) {
      era = '民国';
    } else if (storyStartYear >= 1840) {
      era = '清末/近代';
    }
  }
  
  // 4. 无显式年代关键词且无年份时，通过古风术语推断
  // 仅当 era 仍为默认值 '现代' 且没有年份佐证时才推断
  if (era === '现代' && !storyStartYear) {
    // 古代官职/封建制度术语（高置信度）
    const ancientInstitutionTerms = /城主|王爷|太守|县令|丞相|太子|皇帝|太后|嫔妃|将领|部将|大将军|郡守|侯爵|藩王/;
    // 武侠/古风术语（中置信度，需多个命中）
    const ancientCultureTerms = /武功|内力|真气|剑法|刀法|门派|武林|江湖|侠客|大侠|掌门|弟子|轻功|暗器/;
    // 古代场景术语
    const ancientSettingTerms = /城楼|客栈|驿馆|城门|官府|衙门|兵营|镖局|酒肆|茶楼|府邸|宫殿/;
    
    if (ancientInstitutionTerms.test(fullText)) {
      era = '古代';
    } else {
      // 文化术语 + 场景术语同时出现 → 高置信度古代
      const hasCulture = ancientCultureTerms.test(fullText);
      const hasSetting = ancientSettingTerms.test(fullText);
      if (hasCulture && hasSetting) {
        era = '古代';
      } else if (hasCulture) {
        // 仅有武侠术语，可能是现代武侠，标记为古风
        era = '古代（推断）';
      }
    }
  }
  
  return {
    era,
    timelineSetting,
    storyStartYear,
    storyEndYear,
  };
}

/**
 * 从大纲和人物小传中检测剧本类型（genre）
 * 通用检测，不硬编码具体类型名，而是通过关键词模式匹配
 */
export function detectGenre(outline: string, characterBios: string): string {
  const fullText = `${outline}\n${characterBios}`;
  
  // 类型关键词映射（按优先级排列）
  const genrePatterns: Array<{ keywords: RegExp; genre: string }> = [
    { keywords: /武侠|江湖|门派|武功|剑|刀法|内力|武林/, genre: '武侠' },
    { keywords: /仙侠|修仙|灵气|渡劫|飞升|法宝|灵根/, genre: '仙侠' },
    { keywords: /玄幻|魔法|异世界|龙族|精灵|魔族/, genre: '玄幻' },
    { keywords: /科幻|太空|星际|机器人|AI|外星|未来世界/, genre: '科幻' },
    { keywords: /悬疑|谋杀|侦探|推理|凶手|案件|警察/, genre: '悬疑' },
    { keywords: /恐怖|鬼|灵异|诅咒|闹鬼/, genre: '恐怖' },
    { keywords: /商战|创业|公司|股权|融资|上市|商业帝国|企业/, genre: '商战' },
    { keywords: /宫斗|后宫|嫔妃|皇上|太后|选秀/, genre: '宫斗' },
    { keywords: /宅斗|嫡女|庶出|大宅门|内宅/, genre: '宅斗' },
    { keywords: /谍战|特工|间谍|密码|潜伏|情报/, genre: '谍战' },
    { keywords: /军旅|军队|战场|部队|军营|战争/, genre: '军旅' },
    { keywords: /刑侦|刑警|破案|嫌疑人|法医/, genre: '刑侦' },
    { keywords: /医疗|医院|手术|医生|患者|急诊/, genre: '医疗' },
    { keywords: /律政|律师|法庭|辩护|诉讼/, genre: '律政' },
    { keywords: /校园|大学|高中|同学|学校|老师/, genre: '校园' },
    { keywords: /爱情|恋爱|暗恋|表白|甜蜜|分手/, genre: '爱情' },
    { keywords: /家庭|父母|兄弟|姐妹|亲情|家族/, genre: '家庭' },
    { keywords: /喜剧|搞笑|幽默|滑稽/, genre: '喜剧' },
    { keywords: /历史|朝廷|天子|大臣|变法|改革/, genre: '历史' },
    { keywords: /农村|乡村|种地|脱贫|振兴/, genre: '乡村' },
  ];
  
  for (const { keywords, genre } of genrePatterns) {
    if (keywords.test(fullText)) {
      return genre;
    }
  }
  
  return ''; // 未检测到则留空，不硬编码默认值
}

/**
 * 从大纲中提取世界观/风格设定
 */
export function extractWorldSetting(outline: string, characterBios: string): string {
  const fullText = `${outline}\n${characterBios}`;
  
  // 匹配常见世界观描述模式
  const patterns = [
    /(?:世界观|世界设定|背景设定)[：:] *([^\n]{10,200})/,
    /(?:故事发生在|故事背景[：:是]) *([^\n]{10,200})/,
    /(?:设定[：:]) *([^\n]{10,200})/,
  ];
  
  for (const pattern of patterns) {
    const match = fullText.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }
  
  return ''; // 无世界观描述则留空
}

/**
 * 从大纲中提取主题关键词
 */
export function extractThemes(outline: string, characterBios: string): string[] {
  const fullText = `${outline}\n${characterBios}`;
  const themes: string[] = [];
  
  // 主题关键词库（通用，覆盖各类剧本）
  const themePatterns: Array<{ keywords: RegExp; theme: string }> = [
    { keywords: /奋斗|拼搏|逆袭|成长/, theme: '奋斗' },
    { keywords: /复仇|报仇|雪恨/, theme: '复仇' },
    { keywords: /爱情|爱恋|真爱|恋爱/, theme: '爱情' },
    { keywords: /亲情|家庭|家人/, theme: '亲情' },
    { keywords: /友情|兄弟|义气|忠诚/, theme: '友情' },
    { keywords: /权力|争斗|权谋|阴谋/, theme: '权谋' },
    { keywords: /正义|公平|法治|真相/, theme: '正义' },
    { keywords: /自由|解放|独立/, theme: '自由' },
    { keywords: /救赎|原谅|和解|忏悔/, theme: '救赎' },
    { keywords: /背叛|出卖|信任/, theme: '背叛与信任' },
    { keywords: /命运|宿命|天命/, theme: '命运' },
    { keywords: /战争|和平|反战/, theme: '战争与和平' },
    { keywords: /传承|继承|使命/, theme: '传承' },
    { keywords: /生死|生命|死亡|牺牲/, theme: '生死' },
  ];
  
  for (const { keywords, theme } of themePatterns) {
    if (keywords.test(fullText) && !themes.includes(theme)) {
      themes.push(theme);
    }
  }
  
  return themes.slice(0, 5); // 最多返回5个主题
}
