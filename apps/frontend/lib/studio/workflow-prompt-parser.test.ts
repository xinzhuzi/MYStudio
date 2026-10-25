import { describe, expect, it } from "vitest";

import {
  WorkflowPromptParseError,
  parseWorkflowPrompt,
} from "./workflow-prompt-parser";

/**
 * 键位锚测试(10-25-asset-prompt-layered-panel B-2,PRD §4.2/§九 漂移防护):
 * - i2i fixture=实盘精简样本(PRD §二 事实①:晏燎_共主期_海报_v1.png tEXt 40 节点,
 *   节点 400 PrimitiveStringMultiline 1439 字指令 + 节点 6:4011
 *   MyQi21PromptAssembly 锁层A全文 209 字——两段原文均逐字取自实盘 tEXt);
 * - t2i fixture=仓库模板真源推断样本(qi21-道劫-t2i.json 画布形 + qwen21-道劫-t2i-api.json
 *   API 形,以 class_type 同源性推断;库内暂无 t2i 型产物,实弹落地后复核);
 * - 漂移锚:预期节点/键缺席必须抛错,禁静默空(PRD §九 模板节点号/键位漂移对策)。
 */

/** 实盘指令终稿(晏燎_共主期_海报_v1.png 节点 400 原文,1439 字,逐字)。 */
const REAL_I2I_INSTRUCTION_1439 =
  "以画中人物为基准，将画面重绘为一张叙事海报：他跨步行走于虚空之中，身体呈四分之三侧面朝向画面右前方，右腿前跨成大弓步，左腿向后绷直蹬展；右手于腰胸前实握主剑剑柄随步伐前送——剑柄紧贴掌心且位于剑的最下端，主剑竖直，全部剑身都在手的上方，剑尖垂直朝上、直抵画面顶部，剑尖所指只有一个方向；左臂随步伐向身后摆动，左手拢入宽袖之中、袖口朝下垂坠，手藏袖内；衣袍与发带随步伐向身后大幅翻卷；下颌微抬，目光望向剑尖所指的天际，神情威严如万剑之主；双腿微分悬停，衣袍与发带向四周猛烈炸开舒展。画中人物的面部五官与眉眼神态保持同一人的身份不变，发型、头颈与体型与画中人物完全一致；黑发以草绳高束成髻，额前与两鬓留松散碎发；身上所穿衣物与画中人物所穿完全同款：宁静的终极形剑袍，灰墨底色洗净铅浊，暗金缘纯粹克制，闭襟面板整体连续，衣身完整；腰侧以半透的透明金色道纹储物法则光轮呈现储物之形，光轮克制内敛，与暗金缘同色系；领、门襟、袖、腰、摆的暗金边阶可读而内敛；多层领口配靛青中衣。锁骨下裂纹旧玉符，左腕红绳结。足蹬墨色内敛布靴。右手所持法则之剑：剑即法则，剑身为扁平双刃对称的笔直长剑，剑首、剑格、剑身与剑尖一线贯通，通体无弧度；剑身表面浮现流动的暗金符文道纹，道纹如液态金流沿剑身向剑尖汇聚，剑尖凝出一团刺目的金白色光核,成为全画最亮的一点；数条清晰可见的暗金光丝自天际天脉垂落，汇入剑柄与人物周身。数十柄半透明的暗金剑影自画面四周循弧线飞来，环绕在他周身与竖直主剑构成的纵轴周围、呈螺旋环带分布，所有剑影均完整独立、剑尖指向主剑剑身，无一柄剑影出现在主剑正上方或正下方的轴线延长位置；剑影轨迹在空中织成暗金剑气光网；主剑剑身覆明亮流光，剑尖凝出金白色光核成为全画最高处的视觉焦点；腰侧半透金色道纹储物光轮清晰在场，周身环绕暗金光尘与符文光粒，灵气特效醒目浓烈。中远景为万道归真的法则天穹：头顶上方天际，鎏金天脉如浩荡光河横贯整个天幕并向四方放射暗金光丝；他周身万剑漩涡环绕，剑影轨迹织成暗金光网；脚下与四野是浩瀚翻涌的金绯色云海，云涛一望无际铺满画面下部；云海之下的极远处仅露出数点石青色的山巅淡影；整个天地被暗金法则光辉浸染，宏伟而超脱。握剑手为五指实握剑柄的稳固握拳，掌心贴直柄，指节清晰可数，手指无张开悬空与错位；剑首、剑柄、剑格、剑刃至剑尖一线贯通，剑身笔直如铸，手臂与衣袖自然避让以保持剑身笔直；右手五指实握剑柄最下端，掌心贴柄、指节清晰可数；主剑整体竖直，剑柄在掌、全部剑身只在手的上方单向延伸至画面顶部，剑柄之下再无剑身；剑身沿中轴笔直、与身体轮廓无穿插，从观者视角剑身遮挡住前侧衣襟的一条纵向轮廓；右手恰好五根手指，五指数量准确、指节清晰分明；左手拢袖藏手不入画；主剑与所有剑影剑身均为完整直线、笔直无弧度。画面光线：天际鎏金天脉放射出浓烈的暖金天光，自上方顺着俯冲方向倾泻而下，剑尖光核与暗金光带成为画面最亮的视觉焦点，人物轮廓被天光镀出明亮金边，山河在光带下呈现矿物本色，明暗对比鲜明。整体色调：鎏金与暗金的天光暖调铺满天际上部，石青石绿的山河冷色占据下方，冷暖对比恢弘饱满；人物灰墨衣袍镶暗金缘，在天光下被镀出明亮金边，色彩层次浓丽而分明。画面构图：竖轴构图海报，主剑的竖直线为画面中轴线，跨步的人物动势沿对角线前行，万剑螺旋环带绕中轴归宗，低角度仰视，剑尖直指天际鎏金天脉，压迫感与恢弘感拉满。人物占画面高度约三分之二，人物为画面视觉焦点，头顶至足底全身完整入画。";

/** 实盘锁层A全文(同 tEXt 节点 6:4011,209 字底座全文,逐字)。 */
const REAL_I2I_LOCK_A_209 =
  "美术风格底座：国风二维动漫手绘插画。造型概括鲜明，轮廓与内部结构以白描式线条塑形，线条细稳连贯、轻重富有节奏，转折利落且保留手绘笔性；平整分层的清晰色面与简洁明暗色块塑形，辅以工笔分染与薄层罩染，色面边界清楚。采用丰富多彩、明快协调的中国传统设色，主色统领、辅色呼应、点睛色突出，饱和度与对比度层级分明；材质统一于线描设色语言。数字绘画表面洁净平整，线条与设色层次清晰，细节疏密有序；保留彩色连环画的凝练造型与绘画感。";

/** 底座负向词表(t2i 模板 6:4032 真源,节选同源同文)。 */
const T2I_STYLE_BASE_NEGATIVE_TABLE =
  "模糊，网文封面画风，古风偶像海报，光面现代 CG 特写，摄影写实，厚涂遮蔽结构，厚数字颜料块，喷枪明暗法，照片级体积明暗，厚涂风景，柔光晕染，软3D体积塑形，油亮高光，油黑渐变，古画直接搬进游戏，商业人物复制，泥糊死黑块，黑白滤镜化，满幅泼墨，霓虹色，荧光色，灰暗陈旧，褪色发黄，旧绢黄褐，做旧质感，AI 伪影，泥糊噪点，过锐光晕，纸面纹理，机械勾边，矢量感，过量墨迹笔触，灰化混色，密集皴擦";

/**
 * i2i 实盘精简样本:保留实盘 tEXt 的关键链路节点(40 节点裁到 9 节点,键形逐字),
 * 节点号/class_type/inputs 键均与实盘一致。
 */
const i2iSampleFixture = {
  "10": { class_type: "LoadImage", inputs: { image: "qwen21-i2i-18677482aa604c8ca6ac70a3742b90c2.png" } },
  "171": {
    class_type: "TextEncodeQwenImage21",
    inputs: {
      prompt: ["6:153", 0],
      negative_prompt: ["6:153", 1],
      resolution: 0,
      clip: ["2", 0],
      "images.image_1": ["16", 0],
      vae: ["3", 0],
    },
  },
  "400": { class_type: "PrimitiveStringMultiline", inputs: { value: REAL_I2I_INSTRUCTION_1439 } },
  "6:153": {
    class_type: "MyQi21FinalOutput",
    inputs: { 透明模式: ["6:180", 0], 正向提示词: ["6:4011", 0], 负向提示词: ["6:4011", 1] },
  },
  "6:4010": { class_type: "MyQi21DaojieBase", inputs: { base: "人物海报", 透明覆盖: false } },
  "6:4011": {
    class_type: "MyQi21PromptAssembly",
    inputs: {
      BASE: ["6:4010", 0],
      BASE负面: ["6:4010", 3],
      主体句: ["6:4014", 0],
      主体句负面: "",
      锁层A全文: REAL_I2I_LOCK_A_209,
      组装用途: "道劫美术风格转换",
    },
  },
  "7:7014": { class_type: "PrimitiveInt", inputs: { value: 1317923666 } },
  "7:7017": { class_type: "RandomNoise", inputs: { noise_seed: ["7:7014", 0] } },
  "503:7402": { class_type: "PrimitiveInt", inputs: { value: 0 } },
};

/** t2i 模板推断样本(qi21-道劫-t2i 真源键形:400 正向/404 负向/4015 主编码/6:4032 底座)。 */
const t2iSampleFixture = {
  "400": { class_type: "PrimitiveStringMultiline", inputs: { value: "一位筑基后期的年轻女修，青玉色道袍束月白腰带，立于山门石阶之上。" } },
  "404": { class_type: "PrimitiveStringMultiline", inputs: { value: "" } },
  "4015": {
    class_type: "TextEncodeQwenImage21",
    inputs: { prompt: ["6:4014", 0], negative_prompt: "", resolution: 1024, clip: ["2", 0] },
  },
  "6:4013": {
    class_type: "MyQi21ApiPE",
    inputs: {
      "美术风格底座-正向": ["6:4032", 0],
      "美术风格底座-负向": ["6:4032", 1],
      正向提示词: ["400", 0],
      负向提示词: ["404", 0],
    },
  },
  "6:4014": {
    class_type: "MyQi21FinalOutput",
    inputs: { 透明模式: ["6:4013", 2], 正向提示词: ["6:4013", 0], 负向提示词: ["6:4013", 1] },
  },
  "6:4032": {
    class_type: "MyQi21美术风格底座",
    inputs: { 美术风格: "美术风格底座：国风二维动漫手绘插画。", 负向词表: T2I_STYLE_BASE_NEGATIVE_TABLE },
  },
  "7:7014": { class_type: "PrimitiveInt", inputs: { value: 425196033 } },
};

describe("parseWorkflowPrompt · i2i 实盘键位", () => {
  it("实盘精简样本:指令终稿/锁层注入/seed/路线全链解构(事实①逐字段)", () => {
    const result = parseWorkflowPrompt(JSON.stringify(i2iSampleFixture));

    expect(result.routeHint).toBe("i2i");
    expect(result.finalText).toBe(REAL_I2I_INSTRUCTION_1439);
    expect(result.finalText.length).toBe(1439);
    expect(result.layers).toEqual([{ name: "锁层A全文", text: REAL_I2I_LOCK_A_209 }]);
    expect(result.layers[0].text.length).toBe(209);
    // 实盘:negative_prompt 是链接→装配主体句负面=""→如实空串(禁拼装)
    expect(result.negative).toBe("");
    // 7:7014 主采样 seed 优先于 503:7402 超分 seed
    expect(result.seed).toBe(1317923666);
  });

  it("仓库 API 模板包装形({schemaVersion,graph})可直入(graph 成员解包)", () => {
    const wrapped = JSON.stringify({ schemaVersion: 1, name: "qwen21_道劫_i2i_api", graph: i2iSampleFixture });
    const result = parseWorkflowPrompt(wrapped);
    expect(result.routeHint).toBe("i2i");
    expect(result.finalText.length).toBe(1439);
  });

  it("多层锁键齐取并按键序排列(锁层A/锁层B)", () => {
    const graph = {
      ...i2iSampleFixture,
      "6:4011": {
        class_type: "MyQi21PromptAssembly",
        inputs: {
          ...i2iSampleFixture["6:4011"].inputs,
          锁层B全文: "第二注入层全文。",
        },
      },
    };
    const result = parseWorkflowPrompt(JSON.stringify(graph));
    expect(result.layers.map((layer) => layer.name)).toEqual(["锁层A全文", "锁层B全文"]);
  });
});

describe("parseWorkflowPrompt · t2i 模板推断键位", () => {
  it("模板推断样本:主体句/负面词表/seed/t2i 路线(无 LoadImage)", () => {
    const result = parseWorkflowPrompt(JSON.stringify(t2iSampleFixture));

    expect(result.routeHint).toBe("t2i");
    expect(result.finalText).toBe(t2iSampleFixture["400"].inputs.value);
    // 编码器内联 negative_prompt="" 与 404 空 → 底座负向词表为首个非空可读负面
    expect(result.negative).toBe(T2I_STYLE_BASE_NEGATIVE_TABLE);
    expect(result.layers).toEqual([]);
    expect(result.seed).toBe(425196033);
  });

  it("编码器内联非空 negative_prompt 优先于底座词表", () => {
    const graph = {
      ...t2iSampleFixture,
      "4015": { ...t2iSampleFixture["4015"], inputs: { ...t2iSampleFixture["4015"].inputs, negative_prompt: "低质量" } },
    };
    expect(parseWorkflowPrompt(JSON.stringify(graph)).negative).toBe("低质量");
  });

  it("4016 负向编码节点形态(画布真源钉)在场时 prompt 槽内联串优先", () => {
    const graph = {
      ...t2iSampleFixture,
      "4016": {
        class_type: "TextEncodeQwenImage21",
        inputs: { prompt: "负向编码终稿全文", negative_prompt: "", resolution: 1024, clip: ["2", 0] },
      },
    };
    expect(parseWorkflowPrompt(JSON.stringify(graph)).negative).toBe("负向编码终稿全文");
  });
});

describe("parseWorkflowPrompt · 漂移锚(预期节点/键缺席必抛,禁静默空)", () => {
  it("PrimitiveStringMultiline 缺席 → 抛(指令/主体终稿锚)", () => {
    const graph = Object.fromEntries(Object.entries(i2iSampleFixture).filter(([id]) => id !== "400"));
    expect(() => parseWorkflowPrompt(JSON.stringify(graph))).toThrow(WorkflowPromptParseError);
    expect(() => parseWorkflowPrompt(JSON.stringify(graph))).toThrow(/PrimitiveStringMultiline/);
  });

  it("i2i 路 MyQi21PromptAssembly 缺席 → 抛(实盘已验键位)", () => {
    const graph = Object.fromEntries(Object.entries(i2iSampleFixture).filter(([id]) => id !== "6:4011"));
    expect(() => parseWorkflowPrompt(JSON.stringify(graph))).toThrow(/MyQi21PromptAssembly/);
  });

  it("i2i 路装配在场但锁层键被改名 → 抛(键名漂移即红)", () => {
    const graph = {
      ...i2iSampleFixture,
      "6:4011": {
        class_type: "MyQi21PromptAssembly",
        inputs: {
          BASE: ["6:4010", 0],
          BASE负面: ["6:4010", 3],
          主体句: ["6:4014", 0],
          主体句负面: "",
          固定层A全文: REAL_I2I_LOCK_A_209,
        },
      },
    };
    expect(() => parseWorkflowPrompt(JSON.stringify(graph))).toThrow(/锁层/);
  });

  it("t2i 路 TextEncodeQwenImage21 缺席 → 抛(模板已验键位)", () => {
    const graph = Object.fromEntries(Object.entries(t2iSampleFixture).filter(([id]) => id !== "4015"));
    expect(() => parseWorkflowPrompt(JSON.stringify(graph))).toThrow(/TextEncodeQwenImage21/);
  });

  it("PrimitiveStringMultiline 多于一个且无 400 号可消歧 → 抛", () => {
    const graph: Record<string, unknown> = {
      ...i2iSampleFixture,
      "501": { class_type: "PrimitiveStringMultiline", inputs: { value: "另一段文本" } },
      "502": { class_type: "PrimitiveStringMultiline", inputs: { value: "第三段文本" } },
    };
    delete graph["400"];
    expect(() => parseWorkflowPrompt(JSON.stringify(graph))).toThrow(/消歧/);
  });

  it("非 JSON 输入 → 抛", () => {
    expect(() => parseWorkflowPrompt("not-json{")).toThrow(WorkflowPromptParseError);
  });

  it("画布形工作流(nodes 数组,无 class_type)→ 抛错形而非静默空", () => {
    const canvasForm = JSON.stringify({
      id: "qi21-道劫-t2i",
      nodes: [{ id: 400, type: "PrimitiveStringMultiline", widgets_values: [""] }],
      links: [],
    });
    expect(() => parseWorkflowPrompt(canvasForm)).toThrow(/API 形/);
  });

  it("空对象 → 抛", () => {
    expect(() => parseWorkflowPrompt("{}")).toThrow(WorkflowPromptParseError);
  });
});

describe("parseWorkflowPrompt · seed 兜底域", () => {
  it("无 7:7014 时取首个 PrimitiveInt;PrimitiveInt 全缺席回 null 不抛", () => {
    const withoutPinned = {
      ...i2iSampleFixture,
      "6:4011": i2iSampleFixture["6:4011"],
    };
    delete (withoutPinned as Record<string, unknown>)["7:7014"];
    const firstInt = parseWorkflowPrompt(JSON.stringify(withoutPinned));
    // 7:7014 移除后,PrimitiveInt 仅剩 503:7402=0(链接 noise_seed 不算内联)
    expect(firstInt.seed).toBe(0);

    const graph = Object.fromEntries(Object.entries(withoutPinned).filter(([id]) => id !== "503:7402"));
    const noSeed = parseWorkflowPrompt(JSON.stringify(graph));
    expect(noSeed.seed).toBeNull();
  });
});
