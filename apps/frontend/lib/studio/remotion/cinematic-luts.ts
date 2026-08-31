// 成片调色 LUT 闭集——TS 权威单一事实源（Trellis 08-18-haldclut-grade）。
//
// 背景与许可（2026-08-18 核查）：交接文档建议源 cedeber/hald-clut 为 GPL-3.0 且
// 内含 Apple/Pixelmator 专有条款、G'MIC 系为 CECILL——均不过 D4 门槛。本集改为
// 程序化烘焙（apps/build/scripts/generate-luts.py，仓库自有代码），零许可风险；
// 命名 film-* 为胶片风灵感（非型号仿真）。许可清单：frontend/assets/luts/LICENSES.md。
//
// 架构口径：grade 为 chapter 合成层效果（plan.effects effectId="grade"，经
// renderer-router → build-composition-props 投影 → clip.grade → GLGradeMedia）。
// Python 侧不建镜像（grade 不经 EDL/video-use，建镜像=孤儿死代码——cinematic_grades.py
// 前车之鉴）；闭集由 composition-props-validation fail-closed 守护。
// LUT 文件经 media bridge 以 URL 进 props（lutSrc），打包走 extraResources。

export interface CinematicLutDefn {
  readonly lutId: string;
  readonly file: string;
  readonly description: string;
  /**
   * 冷暖温感(08-28 两套色彩系统衔接,确定性人工标注——禁 NLP 猜词):
   * cool 13 / warm 14 / neutral 5,逐卡标注见下方清单;film-* legacy 不标
   * (undefined 视作 neutral),用于钉死 chapterGrade 与生图阵营配色的反向压色提示。
   */
  readonly temperature?: "warm" | "cool" | "neutral";
}

// 选卡集分层(08-19 用户裁定:AI 面向的选卡集=32 张全中国风 cn-*);
// film-* 8 张为 legacy——闭集保留(存量分镜 grade 数据仍在用,fail-closed 不炸),
// 但不再进 AI 选卡指南(LUT_GUIDE 只取 cn-*)。
// temperature 逐卡标注(08-28,按 description 人工复核):
// cool 13=yuebai/daiqing/yuanshandai/yaqing/zhuqing/tianshuibi/qingmei/laolv/
//          luoqing/tianqing/doulu/dailan/mushanzi
// warm 14=qiuxiang/xiangse/tenghuang/zhusha/yanzhi/huanglu/zheshi/chenxiang/
//          boshi/shiliu/tuoyan/yingcao/songhua/zitan
// neutral 5=shuimo/xuanzhi/jiangzi/ouhe/shiyangjin(紫/黑白灰/多彩不计冷暖)
export const CINEMATIC_LUTS: readonly CinematicLutDefn[] = [
  { lutId: "film-teal-orange", file: "film-teal-orange.png", description: "经典电影橙青对比（暗部青、亮部暖橙）" },
  { lutId: "film-fuji-cool", file: "film-fuji-cool.png", description: "富士冷调（青蓝阴影、柔和高光）" },
  { lutId: "film-kodak-warm", file: "film-kodak-warm.png", description: "柯达暖调（琥珀高光、暖褐阴影）" },
  { lutId: "film-bleach-bypass", file: "film-bleach-bypass.png", description: "漂白旁路（低饱和高对比）" },
  { lutId: "film-sepia-ink", file: "film-sepia-ink.png", description: "旧纸墨棕（宣纸陈色，道劫向）" },
  { lutId: "film-cyan-mist", file: "film-cyan-mist.png", description: "青雾（低对比冷雾感）" },
  { lutId: "film-mute-sage", file: "film-mute-sage.png", description: "灰绿低饱和（水墨淡彩向）" },
  { lutId: "film-noir-contrast", file: "film-noir-contrast.png", description: "黑白高对比" },
  { lutId: "cn-yuebai", file: "cn-yuebai.png", description: "月白:清冷月光色,微蓝近白——孤寂月下/仙侠夜景/诀别清辉,情绪清冷纯净", temperature: "cool" },
  { lutId: "cn-daiqing", file: "cn-daiqing.png", description: "黛青:深青带黑的沉静色——庭院文戏/忧郁沉思/雨夜,情绪内敛克制", temperature: "cool" },
  { lutId: "cn-yuanshandai", file: "cn-yuanshandai.png", description: "远山黛:雾霭青灰,层次退淡——山水远景/苍茫大势/前路未卜,情绪辽远怅惘", temperature: "cool" },
  { lutId: "cn-yaqing", file: "cn-yaqing.png", description: "鸦青:深郁冷暗的鸦羽色——夜行/阴谋暗流/压抑对峙,情绪沉郁警觉", temperature: "cool" },
  { lutId: "cn-zhuqing", file: "cn-zhuqing.png", description: "竹青:清雅竹叶青绿——竹林打斗/春夏生机/闲适清谈,情绪轻快疏朗", temperature: "cool" },
  { lutId: "cn-tianshuibi", file: "cn-tianshuibi.png", description: "天水碧:雨后浅碧如水——晨光初照/少女轻盈/新芽初绽,情绪明净希望", temperature: "cool" },
  { lutId: "cn-qingmei", file: "cn-qingmei.png", description: "青梅:微酸的青黄果子色——初夏悸动/青春萌动/酸涩初恋,情绪青涩微甜", temperature: "cool" },
  { lutId: "cn-qiuxiang", file: "cn-qiuxiang.png", description: "秋香:秋叶黄绿相间——秋日庭园/迟暮温情/收获时节,情绪温厚感怀", temperature: "warm" },
  { lutId: "cn-xiangse", file: "cn-xiangse.png", description: "缃色:浅黄帛书之色——古籍书香/师徒传道/温暖回忆,情绪质朴安然", temperature: "warm" },
  { lutId: "cn-tenghuang", file: "cn-tenghuang.png", description: "藤黄:明亮的中国画黄——盛夏骄阳/炽热争夺/金光法阵,情绪浓烈灼热", temperature: "warm" },
  { lutId: "cn-zhusha", file: "cn-zhusha.png", description: "朱砂:正红矿石色,热烈而不俗——宗门大典/拜堂喜庆/血性觉醒,情绪庄重炽盛", temperature: "warm" },
  { lutId: "cn-yanzhi", file: "cn-yanzhi.png", description: "胭脂:红蓝花妆色——红妆旖旎/情愫暗生/镜前梳妆,情绪妩媚柔艳", temperature: "warm" },
  { lutId: "cn-jiangzi", file: "cn-jiangzi.png", description: "绛紫:华贵深沉之紫——权贵殿堂/神秘仪式/暮年威仪,情绪威严莫测", temperature: "neutral" },
  { lutId: "cn-ouhe", file: "cn-ouhe.png", description: "藕荷:淡紫粉灰如荷花根——温柔梦境/淡淡愁绪/闺中私语,情绪轻柔怅然", temperature: "neutral" },
  { lutId: "cn-mushanzi", file: "cn-mushanzi.png", description: "暮山紫:暮霭映山的紫蓝——黄昏离别/苍茫远望/尘埃落定,情绪苍茫不舍", temperature: "cool" },
  { lutId: "cn-shiyangjin", file: "cn-shiyangjin.png", description: "十样锦:织锦彩缎的饱和典雅——繁华市井/盛会游街/锦绣华服,情绪热闹富丽", temperature: "neutral" },
  { lutId: "cn-huanglu", file: "cn-huanglu.png", description: "黄栌:深秋红叶赭黄——深秋萧瑟/孤雁南飞/叶落归根,情绪苍凉中带暖", temperature: "warm" },
  { lutId: "cn-zheshi", file: "cn-zheshi.png", description: "赭石:土赭沉稳如岩——古道西风/岩壁洞府/苍劲老者,情绪坚忍厚重", temperature: "warm" },
  { lutId: "cn-laolv", file: "cn-laolv.png", description: "苍绿:老树深苔的沉绿——古刹钟声/密林深处/岁月静守,情绪幽深宁谧", temperature: "cool" },
  { lutId: "cn-chenxiang", file: "cn-chenxiang.png", description: "沉香:乌金暗褐之色——古物陈酿/内敛奢华/故人重逢,情绪深沉绵长", temperature: "warm" },
  { lutId: "cn-shuimo", file: "cn-shuimo.png", description: "水墨:近黑白而保微彩的写意——水墨回忆/超然物外/画中世界,情绪空灵超脱", temperature: "neutral" },
  { lutId: "cn-xuanzhi", file: "cn-xuanzhi.png", description: "宣纸:泛白宣纸底色,画面淡化——梦境留白/仙气缥缈/回忆滤镜,情绪飘逸清淡", temperature: "neutral" },
  { lutId: "cn-boshi", file: "cn-boshi.png", description: "薄柿:淡熟的柿子橙——夕照温情/人间烟火/久别问候,情绪柔和慰藉", temperature: "warm" },
  { lutId: "cn-luoqing", file: "cn-luoqing.png", description: "螺青:深蓝近墨的海螺色——深夜庙堂/海上孤舟/沉郁决断,情绪庄重孤绝", temperature: "cool" },
  { lutId: "cn-tianqing", file: "cn-tianqing.png", description: "天青:汝窑雨过天青,淡青泛蓝灰——雨霁初晴/禅意空镜/久候终至,情绪澄澈安宁", temperature: "cool" },
  { lutId: "cn-doulu", file: "cn-doulu.png", description: "豆绿:青豆浅绿,朴素无华——田园劳作/粗布日常/市井烟火,情绪平实温润", temperature: "cool" },
  { lutId: "cn-shiliu", file: "cn-shiliu.png", description: "石榴红:浓烈的石榴花红——怒放情愫/高潮爆发/红衣烈焰,情绪炽烈张扬", temperature: "warm" },
  { lutId: "cn-songhua", file: "cn-songhua.png", description: "松花:松花粉的嫩黄绿——春晨新绿/少年意气/初入江湖,情绪清新稚嫩", temperature: "warm" },
  { lutId: "cn-dailan", file: "cn-dailan.png", description: "黛蓝:黛石之蓝,深靛沉稳——深院夜读/临帖抚琴/沉静笃定,情绪安定深隽", temperature: "cool" },
  { lutId: "cn-ziitan", file: "cn-ziitan.png", description: "紫檀:紫檀木深褐紫——古木法器/岁月包浆/长辈威仪,情绪沉穆持重", temperature: "warm" },
  { lutId: "cn-tuoyan", file: "cn-tuoyan.png", description: "酡颜:醉后双颊的酡红——酒酣耳热/失态真言/暧昧升温,情绪醺然微醺", temperature: "warm" },
  { lutId: "cn-yingcao", file: "cn-yingcao.png", description: "樱草:樱草嫩黄,明媚娇柔——暖春少女/娇憨嬉闹/闺中春色,情绪明快娇嫩", temperature: "warm" },
  // ── 中国风传统色卡(08-19 扩集 24 张,总 32;生成源=generate-luts.py 参数表) ──
  // 描述=情绪+场景,是 AI 选卡(shot-fx-ai LUT_GUIDE)的参考语义。
];

export const CINEMATIC_LUT_IDS: readonly string[] = CINEMATIC_LUTS.map((l) => l.lutId);

export function isCinematicLutId(lutId: string): boolean {
  return CINEMATIC_LUT_IDS.includes(lutId);
}

export function getCinematicLut(lutId: string): CinematicLutDefn | undefined {
  return CINEMATIC_LUTS.find((l) => l.lutId === lutId);
}
