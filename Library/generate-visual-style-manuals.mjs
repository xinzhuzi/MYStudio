import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const visualStylesPath = path.join(repoRoot, "src/lib/constants/visual-styles.ts");
const sourceArtRoot = path.join(repoRoot, "src/assets/studio-manuals/art_skills");
const thumbnailRoot = path.join(repoRoot, "src/assets/style-thumbnails");
const localArtRoot = path.join(
  process.env.HOME ?? "",
  "Library/Application Support/漫影工作室/skills/art_skills",
);

const STYLE_DEFS = {
  "3d_xuanhuan": def("3D玄幻", "东方玄幻题材的通用3D风格，强调仙气、层次、体积光和华丽服饰。", "Chinese fantasy 3D animation render", "traditional oriental robes, embroidered fabric, layered mountains, spiritual atmosphere", "soft volumetric fog, cinematic backlight, glowing aura", "polished PBR cloth, fine metal ornaments, ethereal depth", "misty jade, cloud white, warm gold", "western fantasy, modern city, neon sci-fi"),
  "3d_american": def("3D美式", "美式家庭动画方向的通用3D风格，强调圆润角色、明快色彩和温暖表情。", "rounded western 3D animation", "large expressive eyes, friendly proportions, readable silhouette, colorful town background", "warm key light, soft fill light, cheerful daylight", "smooth stylized material, soft edges, polished character surface", "sunny amber, sky blue, soft coral", "dark gritty realism, horror mood, hard realistic skin"),
  "3d_q_version": def("3DQ版", "潮玩感Q版三维风格，强调可爱比例、软光、干净材质和收藏级展示。", "chibi collectible 3D toy render", "super deformed body, oversized head, cute face, miniature scene", "soft studio lighting, gentle rim light, clean shadow", "smooth toy material, rounded surface, tactile miniature detail", "cream beige, pastel green, warm peach", "realistic adult proportion, rough material, scary mood"),
  "3d_realistic": def("3D写实", "电影级写实3D风格，强调真实材质、光追质感和高精度建模。", "photorealistic 3D cinematic render", "highly detailed texture, realistic skin shader, complex fabric, accurate scale", "ray-traced lighting, cinematic depth of field, controlled contrast", "micro surface detail, natural imperfections, realistic material response", "neutral film grade, slate grey, warm highlight", "cartoon, anime, flat illustration, low poly, plastic skin"),
  "3d_block": def("3D块面", "低多边形块面风格，强调几何结构、简洁体块和清晰配色。", "low poly geometric 3D art", "faceted shapes, angular silhouette, simple forms, clean environment", "clear daylight, simple ambient occlusion, readable shadow", "flat shaded polygons, crisp edges, minimal texture", "fresh green, sky blue, sandstone orange", "high-poly realism, organic smooth shapes, noisy texture"),
  "3d_voxel": def("3D方块世界", "体素方块世界风格，强调方块结构、像素化体积和玩具感空间。", "voxel block world 3D art", "cubic character, blocky trees, grid-based village, isometric readability", "bright daylight, crisp shadow, cheerful atmosphere", "voxel cubes, pixel-like material, clean toy blocks", "grass green, clear blue, flower red", "round organic forms, smooth realistic texture, blur"),
  "3d_mobile": def("3D手游", "手游级风格化3D，强调清爽材质、可读轮廓和高完成度游戏资产。", "stylized mobile game 3D render", "hero character design, clean fantasy outfit, readable game asset silhouette", "bright outdoor light, soft ambient light, polished game look", "optimized clean material, stylized cloth and metal, vivid but controlled color", "blue sky, fresh green, heroic gold", "photorealistic noise, rough sketch, pixelated low quality"),
  "3d_render_2d": def("3D渲染2D", "三渲二通用风格，强调3D体积与2D动画线条、赛璐璐阴影的融合。", "anime-inspired cel shaded 3D render", "toon linework, cel shaded body, vibrant fantasy setting, clean anime face", "bright rim light, soft global illumination, colorful sky light", "toon material, sharp edge highlights, controlled flat shadow", "cyan sky, warm orange, clean white", "photorealistic skin, heavy realism, rough sketch"),
  "jp_3d_render_2d": def("日式3D渲染2D", "日式三渲二通用风格，强调动态姿态、锐利赛璐璐阴影和强镜头张力。", "Japanese cel shaded 3D action render", "sharp anime silhouette, dynamic camera angle, bold costume shapes, action pose", "hard rim light, high contrast stage lighting, motion streaks", "crisp toon shader, clear line accents, stylized material breakups", "electric blue, black, orange accent", "photorealistic rendering, dull flat color, western cartoon softness"),
  "2d_animation": def("2D动画", "标准二次元动画风格，强调清晰线稿、平涂上色和可复用角色设计。", "clean 2D anime animation style", "clean lineart, flat color, expressive eyes, balanced character design", "soft animation lighting, clear cel shadow, readable composition", "smooth digital paint, crisp outline, controlled detail density", "sky blue, warm skin tone, vivid accent", "3D render, photorealistic, messy sketch"),
  "2d_movie": def("2D电影", "动画电影级通用风格，强调细致背景、情绪光影和大银幕构图。", "high budget 2D animated movie still", "detailed background, emotional sky, cinematic character framing, atmospheric depth", "dramatic sunset light, layered clouds, soft glow", "painterly background, clean character line, film-like composition", "golden sunset, deep blue, soft cloud white", "simple flat cartoon, low resolution, dull color"),
  "2d_fantasy": def("2D奇幻动画", "奇幻二次元动画风格，强调魔法氛围、异世界层次和华丽服化。", "fantasy 2D anime illustration", "magical city, glowing symbols, ornate robes, dreamy atmosphere", "mystic particle glow, moonlit rim light, magical haze", "clean lineart, luminous color, layered fantasy detail", "violet, sapphire, starlight gold", "modern daily setting, sci-fi machinery, gritty realism"),
  "2d_retro": def("2D复古动画", "90年代复古动画通用风格，强调赛璐璐胶片感、柔和颗粒和怀旧色调。", "1990s hand-drawn cel animation", "retro character design, matte painted background, nostalgic framing", "soft analog glow, mild film grain, warm evening light", "cel paint texture, slight VHS softness, hand-painted backdrop", "dusty pink, warm orange, old blue", "modern glossy digital art, 3D render, hyper sharp HDR"),
  "2d_american": def("2D美式动画", "美式卡通动画风格，强调粗线条、夸张表情和高识别度色块。", "western 2D cartoon animation", "bold outline, exaggerated expression, energetic pose, graphic background", "bright studio color, clean flat light, playful contrast", "solid color fills, thick contour, simplified forms", "orange, turquoise, purple accent", "delicate anime line, realistic shading, 3D render"),
  "2d_ghibli": def("2D自然手绘动画", "自然系手绘动画通用风格，强调温柔人物、乡野背景和水彩般空气感。", "hand-painted nature 2D animation", "gentle character, lush countryside, peaceful daily life, charming background", "soft daylight, diffused cloud light, calm atmosphere", "watercolor-like background, warm hand-drawn line, organic texture", "moss green, cream white, soft sky blue", "sharp digital neon, 3D CGI, horror darkness"),
  "2d_retro_girl": def("2D复古少女", "复古少女漫画风格，强调大眼、花饰、柔和粉彩和浪漫情绪。", "retro shoujo manga illustration", "sparkling eyes, delicate hair, floral background, dreamy romance", "pastel glow, soft highlight, gentle vignette", "thin elegant line, screentone texture, soft color wash", "rose pink, lavender, pearl white", "dark horror, muscular shonen style, 3D realism"),
  "2d_korean": def("2D韩式动画", "韩式条漫通用风格，强调精致脸型、现代服饰和清爽数码上色。", "premium webtoon style illustration", "sharp handsome features, modern fashion, clean urban lighting, polished emotion", "soft rim light, clear digital highlight, romantic atmosphere", "smooth digital coloring, clean contour, glossy eye detail", "cool grey, cream white, rose accent", "rough sketch, retro heavy grain, 3D realism"),
  "2d_shonen": def("2D热血动画", "热血少年动画风格，强调动作冲击、速度线、高对比阴影和力量感。", "dynamic shonen action anime", "impact pose, speed lines, intense expression, powerful silhouette", "strong contrast light, dramatic action shadow, burst effect", "bold cel shading, sharp line weight, energetic detail", "red, black, bright yellow", "static calm pose, soft shoujo mood, pastel quiet scene"),
  "2d_akira": def("2D热血圆线漫画", "经典热血圆线漫画风格，强调饱满五官、清晰肌肉与明快动作。", "classic round-line shonen manga", "rounded expressive face, athletic body, clear action pose, iconic simple costume", "bright outdoor light, high readability, clean shadow", "solid ink line, simple color blocks, crisp anatomy detail", "orange, blue, cream white", "soft modern moe face, photorealistic 3D, weak anatomy"),
  "2d_doraemon": def("2D圆润儿童动画", "圆润儿童向动画风格，强调简单线条、童趣比例和明亮纯色。", "rounded child-friendly 2D animation", "simple round character design, friendly face, clean prop shapes, playful room", "bright even light, cheerful color, soft shadow", "clean outline, simple flat color, low detail density", "primary blue, warm yellow, clean white", "complex realistic detail, dark gloomy horror, sharp angular face"),
  "2d_fujimoto": def("2D电影感松散漫画", "电影感松散漫画风格，强调手绘粗粝、生活化构图和原始情绪。", "loose cinematic manga drawing", "sketchy linework, casual pose, realistic emotional beat, movie-like composition", "natural side light, muted contrast, grounded atmosphere", "rough ink texture, visible hand-drawn marks, restrained color", "muted grey, warm brown, faded blue", "over-polished digital gloss, standard cute anime, 3D render"),
  "2d_mob": def("2D都市灵能漫画", "都市超能力漫画风格，强调变形透视、迷幻色和紧张能量感。", "psychedelic urban supernatural manga", "warped perspective, psychic aura, city background, expressive simple face", "color shock glow, distorted light, high energy contrast", "loose comic line, abstract energy pattern, bold color field", "magenta, cyan, acid green", "calm neutral colors, photorealistic body, polished beauty anime"),
  "2d_jojo": def("2D高对比姿态漫画", "高对比姿态漫画风格，强调夸张造型、硬朗阴影和舞台化动作。", "high-contrast pose-driven manga", "dramatic pose, angular face, muscular silhouette, ornate costume", "harsh side light, deep shadow, theatrical contrast", "heavy hatching, bold contour, sculptural linework", "purple, black, gold accent", "soft cute moe, minimalist flat style, weak pose"),
  "2d_detective": def("2D日式侦探", "日式侦探动画通用风格，强调悬疑氛围、清晰人物和90年代动画质感。", "Japanese detective anime style", "sharp facial features, mystery mood, school and city setting, clue-focused framing", "cool evening light, dramatic interior shadow, suspense tone", "clean cel line, restrained color, classic animation finish", "navy, beige, warm lamp light", "fantasy magic excess, modern glossy 3D, cute chibi"),
  "2d_slamdunk": def("2D运动写实漫画", "运动写实漫画风格，强调真实比例、汗水、肌肉张力和比赛现场感。", "realistic sports manga animation", "athletic body proportion, sweat detail, court atmosphere, intense eye focus", "gymnasium top light, hard rim light, action freeze frame", "inked muscle line, textured shading, energetic motion", "court orange, white, deep red", "chibi cute body, fantasy robe, weak anatomy"),
  "2d_astroboy": def("2D经典圆线漫画", "经典圆线科幻漫画风格，强调圆润结构、大眼和复古未来感。", "classic round-line retro manga", "large expressive eyes, rounded face, simple futuristic prop, iconic silhouette", "clean flat light, vintage print tone, bright clarity", "smooth black line, simple shading, old comic texture", "black, white, sky blue", "modern hyper-detailed anime, sharp realistic rendering, 3D"),
  "2d_deathnote": def("2D暗黑悬疑漫画", "暗黑悬疑漫画风格，强调锐利五官、交叉排线和阴郁情绪。", "dark psychological manga illustration", "sharp face, serious gaze, gothic mood, mystery composition", "low key light, strong cast shadow, cold highlight", "intricate hatching, thin sharp line, desaturated color", "black, grey, cold blue", "cute happy palette, chibi, bright comedy lighting"),
  "2d_thick_line": def("2D粗线条", "粗线条街头插画风格，强调厚轮廓、强对比和涂鸦式活力。", "bold thick-line street illustration", "chunky outline, graphic pose, urban art energy, simplified shape", "flat bright light, high contrast color block, poster-like clarity", "thick ink contour, halftone texture, vibrant fill", "orange, teal, black", "thin delicate line, realistic painting, muted faded color"),
  "2d_rubberhose": def("2D橡皮管动画", "复古橡皮管动画风格，强调摆动肢体、派眼和黑白胶片质感。", "1930s rubber hose cartoon", "bouncy limbs, pie-cut eyes, vintage mascot character, simple stage", "old film light, vignette, soft grain", "inked black line, limited palette, analog film texture", "black, cream, warm grey", "modern anime, realistic 3D, stiff motion"),
  "2d_q_version": def("2DQ版", "Q版可爱2D风格，强调大头小身、柔和粉彩和简单阴影。", "kawaii chibi 2D illustration", "super deformed body, cute face, tiny hands, adorable costume", "soft pastel light, gentle highlight, clean background", "rounded line, simple cel shadow, candy color", "pastel pink, mint, cream", "realistic adult proportion, horror mood, harsh dark lighting"),
  "2d_pixel": def("2D像素", "像素艺术风格，强调格点清晰、有限色板和复古游戏资产感。", "clean pixel art style", "16-bit sprite look, tile-based environment, readable silhouette, retro game asset", "simple light direction, crisp pixel shadow, no blur", "hard pixel edges, dithering, limited palette", "retro green, blue, magenta", "anti-aliased smooth line, vector art, 3D realism, blur"),
  "2d_gongbi": def("2D工笔风", "工笔国画风格，强调细密线描、传统色和雅致留白。", "Chinese gongbi painting illustration", "meticulous brushwork, elegant figure, refined ornament, ink wash background", "soft paper light, delicate highlight, calm atmosphere", "rice paper grain, fine mineral pigment, precise linework", "ink black, jade green, mineral red", "western oil painting, neon color, rough sketch, 3D realism"),
  "2d_stick": def("2D简笔画", "极简简笔画风格，强调白底、手绘线条和低复杂度表达。", "minimalist stick figure doodle", "simple stick figure, sketchbook charm, clean blank space, cute expression", "flat paper light, no complex shadow, minimal contrast", "hand-drawn pencil line, plain white background, sparse detail", "black line, white, tiny color accent", "complex realistic detail, filled color, 3D shading"),
  "2d_watercolor": def("2D水彩", "水彩插画风格，强调湿画法、柔边、纸纹和梦幻色彩。", "watercolor illustration style", "soft edge landscape, translucent color wash, dreamy character, paper texture", "diffused daylight, gentle bloom, low contrast", "wet-on-wet pigment, visible paper grain, feathered edge", "sky blue, rose, pale yellow", "hard digital flat color, vector edge, 3D realism"),
  "2d_simple_line": def("2D简单线条", "极简线稿风格，强调连续线、白底和优雅留白。", "minimal clean line art", "continuous line drawing, elegant figure, simple object, blank composition", "plain even light, no heavy shadow, graphic clarity", "thin black line, vector-like edge, minimal fill", "black, white, single accent color", "messy sketch, dense background, 3D shading, realism"),
  "2d_comic": def("2D美式漫画", "美式漫画通用风格，强调半调网点、强动作和墨线张力。", "American comic book illustration", "heroic pose, bold ink, dynamic panel composition, halftone texture", "dramatic colored light, sharp contrast, poster energy", "heavy ink, hatching, comic print dots", "red, blue, black", "manga chibi, watercolor softness, photorealistic 3D"),
  "2d_shoujo": def("2D少女漫画", "少女漫画通用风格，强调纤细线条、花饰背景和情绪凝视。", "classic shoujo manga illustration", "delicate eyes, flowing hair, floral frame, emotional expression", "soft sparkle light, romantic vignette, gentle contrast", "thin line, screentone texture, pearl highlight", "pink, lavender, cream", "thick shonen line, horror darkness, 3D realism"),
  "2d_horror": def("2D诡异惊悚", "黑白惊悚漫画风格，强调怪诞氛围、重墨线和心理压迫。", "eerie psychological horror manga", "distorted perspective, unsettling pattern, tense face, nightmare atmosphere", "low key light, stark black shadow, claustrophobic framing", "heavy black ink, spiral motifs, scratchy hatching", "black, bone white, sickly grey", "cute happy mood, bright pastel, soft comedy lighting, graphic gore"),
  "real_movie": def("真人电影", "真人电影剧照风格，强调真实摄影、电影调色和镜头景深。", "live-action cinematic movie still", "real actor presence, natural costume, film set atmosphere, grounded composition", "35mm film light, dramatic key light, color graded frame", "film grain, real skin pores, optical lens texture", "teal orange, neutral skin, dark shadow", "3D render, CGI, anime, illustration, artificial plastic face"),
  "real_costume": def("真人古装", "真人古装剧风格，强调汉服质感、古代空间和影视级摄影。", "live-action Chinese period drama still", "period costume, embroidered fabric, ancient interior, elegant posture", "soft lantern light, daylight through lattice, cinematic haze", "real silk folds, hair ornament detail, natural skin texture", "ivory, red lacquer, warm gold", "modern clothes, glasses, watch, 3D render, anime"),
  "real_hk_retro": def("真人复古港片", "复古港风真人电影风格，强调霓虹、胶片颗粒和都市夜色。", "1990s Hong Kong-inspired live-action cinema", "rainy street, neon shop light, moody actor gaze, urban night", "neon side light, motion blur, high contrast practical lighting", "film grain, wet pavement reflection, vintage lens softness", "red neon, green tint, deep shadow", "sterile modern digital look, anime, 3D render, clean daylight"),
  "real_wuxia": def("真人复古武侠", "复古武侠真人电影风格，强调实景打斗、布景年代感和江湖气。", "vintage live-action wuxia cinema", "martial arts stance, old inn, forest duel, practical costume", "hard side light, dusty backlight, retro film contrast", "film grain, worn fabric, real weapon surface", "earth brown, faded red, cool night blue", "modern clothing, sci-fi tech, CGI magic excess, anime"),
  "real_bloom": def("真实光晕", "柔光逆光真人摄影风格，强调梦幻高光、真实皮肤和轻柔景深。", "dreamy backlit live-action photography", "real person, glowing rim light, soft focus portrait, airy environment", "strong bloom, lens flare, warm backlight, shallow depth of field", "film softness, skin texture retained, optical glow", "cream, pale gold, soft blue", "harsh contrast, dark gritty mood, anime, 3D render"),
  "stop_motion": def("定格动画", "通用定格动画风格，强调手工模型、逐帧运动和微缩摄影质感。", "handmade stop-motion animation", "miniature character, crafted props, frame-by-frame motion, small studio set", "soft tabletop studio light, macro depth of field, gentle shadow", "tactile handmade material, visible craft marks, tiny set texture", "warm craft color, muted green, wood brown", "fluid CGI animation, 2D anime, smooth digital texture"),
  "figure_stop_motion": def("手办定格动画", "手办摄影式定格风格，强调PVC玩具体积、微距景深和模型关节。", "action figure stop-motion photography", "toy figure body, articulated pose, miniature prop, display diorama", "macro studio light, rim light on plastic surface, shallow depth", "PVC material, molded seams, toy-scale detail", "plastic blue, warm desk light, neutral grey", "human skin realism, 2D drawing, life-size body"),
  "clay_stop_motion": def("粘土定格动画", "粘土定格风格，强调橡皮泥质感、手工压痕和温暖小场景。", "clay stop-motion animation", "plasticine character, handmade miniature set, rounded clay expression", "warm softbox light, tabletop shadow, gentle depth of field", "visible fingerprints, soft clay dents, handmade imperfection", "clay orange, mint, cream", "glossy plastic, smooth CGI, realistic human skin"),
  "lego_stop_motion": def("积木定格动画", "积木定格风格，强调塑料砖块、拼搭世界和玩具摄影感。", "brick toy stop-motion animation", "block figure, construction bricks, modular toy town, snapped-together props", "macro toy light, crisp shadow, colorful plastic reflection", "hard plastic brick surface, molded studs, clean toy edges", "primary red, blue, yellow", "soft clay, melted curved shapes, realistic human body"),
  "felt_stop_motion": def("毛绒定格动画", "毛绒定格风格，强调羊毛毡纤维、柔软触感和手工温度。", "needle-felt stop-motion animation", "wool character, fuzzy miniature prop, handmade craft environment", "warm diffuse light, soft fabric shadow, cozy atmosphere", "visible wool fibers, felt texture, stitched handmade detail", "warm beige, wool brown, pastel accent", "hard plastic, shiny metal, 2D anime, photorealistic human"),
};

function def(name, description, anchor, details, lighting, texture, palette, avoid) {
  return { name, description, anchor, details, lighting, texture, palette, avoid };
}

const CATEGORY_RULES = {
  "3d": {
    medium: "3D 渲染",
    positiveSuffix: "sharp focus, detailed background, polished composition",
    negativeBase: "(worst quality, low quality, bad quality:1.4), blurry, fuzzy, distorted, out of focus, malformed body, extra limbs, watermark, signature, text",
    characterMedium: "3D 角色设定图",
    sceneMedium: "3D 场景概念图",
    propMedium: "3D 道具设定图",
  },
  "2d": {
    medium: "2D 动画 / 插画",
    positiveSuffix: "clean composition, readable silhouette, high detail, finished illustration",
    negativeBase: "(worst quality, low quality:1.4), blurry, messy lineart, bad anatomy, 3D render, photorealistic, CGI, watermark, signature, text",
    characterMedium: "2D 角色设定图",
    sceneMedium: "2D 场景概念图",
    propMedium: "2D 道具设定图",
  },
  "real": {
    medium: "真人摄影",
    positiveSuffix: "real lens optics, natural skin texture, cinematic framing, high detail",
    negativeBase: "(worst quality, low quality:1.4), 3D render, CGI, anime, illustration, cartoon, plastic skin, over-smoothed face, bad anatomy, watermark, signature, text",
    characterMedium: "真人人物参考摄影",
    sceneMedium: "真人场景摄影",
    propMedium: "真人静物摄影",
  },
  "stop_motion": {
    medium: "定格动画",
    positiveSuffix: "macro photography, tactile detail, frame-by-frame charm, high detail",
    negativeBase: "(worst quality, low quality:1.4), fluid CGI animation, 2D anime, photorealistic human scale, smooth digital texture, bad anatomy, watermark, signature, text",
    characterMedium: "定格角色设定图",
    sceneMedium: "定格场景设定图",
    propMedium: "定格道具设定图",
  },
};

const MODULES = [
  ["README.md", buildReadme],
  ["prefix.md", buildPrefix],
  ["art_prompt/art_character.md", buildCharacter],
  ["art_prompt/art_character_derivative.md", buildCharacterDerivative],
  ["art_prompt/art_prop.md", buildProp],
  ["art_prompt/art_prop_derivative.md", buildPropDerivative],
  ["art_prompt/art_scene.md", buildScene],
  ["art_prompt/art_scene_derivative.md", buildSceneDerivative],
  ["art_prompt/art_storyboard_video.md", buildStoryboardVideo],
  ["driector_skills/director_storyboard.md", buildDirectorStoryboard],
  ["driector_skills/director_planning_style.md", buildDirectorPlanning],
  ["driector_skills/director_storyboard_table_style.md", buildDirectorTable],
];

main();

function main() {
  const source = fs.readFileSync(visualStylesPath, "utf8");
  const presets = parsePresets(source);
  const missing = Object.keys(STYLE_DEFS).filter((id) => !presets.has(id));
  if (missing.length > 0) throw new Error(`visual-styles.ts missing presets: ${missing.join(", ")}`);
  const extra = [...presets.keys()].filter((id) => !STYLE_DEFS[id]);
  if (extra.length > 0) throw new Error(`STYLE_DEFS missing presets: ${extra.join(", ")}`);

  const nextSource = updateVisualStyles(source, presets);
  fs.writeFileSync(visualStylesPath, nextSource, "utf8");

  for (const [id, preset] of presets) {
    const style = enrichStyle(id, preset);
    writeStyleManual(sourceArtRoot, style, true);
    if (fs.existsSync(path.dirname(localArtRoot))) {
      writeStyleManual(localArtRoot, style, true);
    }
  }

  console.log(JSON.stringify({
    presets: presets.size,
    generatedSourceRoot: sourceArtRoot,
    generatedLocalRoot: fs.existsSync(path.dirname(localArtRoot)) ? localArtRoot : null,
  }, null, 2));
}

function parsePresets(source) {
  const presets = new Map();
  const objectPattern = /\{\s*id:\s*'([^']+)'[\s\S]*?thumbnail:\s*'([^']+)',\s*\}/g;
  for (const match of source.matchAll(objectPattern)) {
    const block = match[0];
    const id = match[1];
    presets.set(id, {
      id,
      block,
      category: readField(block, "category"),
      mediaType: readField(block, "mediaType"),
      thumbnail: match[2],
    });
  }
  return presets;
}

function readField(block, key) {
  const match = block.match(new RegExp(`${key}:\\s*'([^']+)'`));
  if (!match) throw new Error(`Missing ${key} in ${block.slice(0, 80)}`);
  return match[1];
}

function updateVisualStyles(source, presets) {
  let next = source;
  for (const [id, preset] of presets) {
    const style = enrichStyle(id, preset);
    let block = preset.block;
    block = replaceTsField(block, "name", style.name);
    block = replaceTsField(block, "prompt", style.prompt);
    block = replaceTsField(block, "negativePrompt", style.negativePrompt);
    block = replaceTsField(block, "description", style.description);
    next = next.replace(preset.block, block);
  }
  return next;
}

function replaceTsField(block, key, value) {
  return block.replace(new RegExp(`${key}:\\s*'(?:\\\\.|[^'])*',`), `${key}: ${tsString(value)},`);
}

function tsString(value) {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function enrichStyle(id, preset) {
  const base = STYLE_DEFS[id];
  const rules = CATEGORY_RULES[preset.category];
  if (!rules) throw new Error(`Missing category rules for ${preset.category}`);
  const prompt = [
    "(best quality, masterpiece, high detailed:1.2)",
    `(${base.anchor}:1.3)`,
    `(${base.details}:1.18)`,
    `(${base.lighting}:1.1)`,
    base.texture,
    rules.positiveSuffix,
  ].join(", ");
  const negativePrompt = [rules.negativeBase, base.avoid].filter(Boolean).join(", ");
  return {
    ...preset,
    ...base,
    rules,
    prompt,
    negativePrompt,
  };
}

function writeStyleManual(root, style, overwrite) {
  const dir = path.join(root, style.id);
  fs.mkdirSync(dir, { recursive: true });
  for (const [relativePath, builder] of MODULES) {
    const filePath = path.join(dir, relativePath);
    if (!overwrite && fs.existsSync(filePath)) continue;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, builder(style), "utf8");
  }
  copyThumbnail(style, dir, overwrite);
}

function copyThumbnail(style, dir, overwrite) {
  const sourcePath = path.join(thumbnailRoot, style.thumbnail);
  if (!fs.existsSync(sourcePath)) return;
  const ext = path.extname(style.thumbnail) || ".png";
  const target = path.join(dir, "images", `1${ext}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (!overwrite && fs.existsSync(target)) return;
  fs.copyFileSync(sourcePath, target);
}

function buildFrontMatter(name, description, metaData) {
  return `---\nname: ${name}\ndescription: ${description}\nmetaData: ${metaData}\n---\n\n`;
}

function buildReadme(style) {
  return `# ${style.name} 通用风格说明\n\n${style.description}\n\n## 风格边界\n\n- **媒介类型**：${style.rules.medium}\n- **核心风格**：${style.anchor}\n- **视觉要点**：${style.details}\n- **光影方案**：${style.lighting}\n- **质感锚点**：${style.texture}\n- **色彩基线**：${style.palette}\n\n## 适用范围\n\n- 角色基础形象、角色衍生服化、场景、场景衍生、道具、分镜和视频提示词。\n- 可作为项目默认视觉风格，也可复制到“我的风格”后继续细化。\n- 适合做统一美术基线，不绑定任何具体作品、作者或厂牌。\n\n## 严禁内容\n\n- 直接照搬具体作品、作者、厂牌或版权角色的名称与固定造型。\n- 偏离“${style.rules.medium}”媒介边界的错媒介输出。\n- ${style.avoid}。\n- 低质量、模糊、裁切、文字水印、结构错误、身份漂移。\n\n## 风格体验\n\n在本风格下，画面应优先呈现“${style.anchor}”的整体气质，通过“${style.details}”建立识别度，再用“${style.lighting}”控制情绪和镜头完成度。\n`;
}

function buildPrefix(style) {
  return `# 全局美学基础 · ${style.name}\n\n---\n必须严格、完整遵循下方全部风格约束与全局规则，并严格按提示词模板格式生成提示词；仅输出提示词正文，不得附加任何解释、说明、注释、标题或其他额外文本。\n\n## 一、风格基因\n\n| 维度 | 定义 |\n|---|---|\n| 一级风格 | ${style.name} |\n| 媒介类型 | ${style.rules.medium} |\n| 核心锚点 | ${style.anchor} |\n| 视觉要点 | ${style.details} |\n| 情绪基调 | ${style.description} |\n| 质感锚词 | ${style.texture} |\n\n## 二、全局色彩与光影\n\n| 项目 | 约束 |\n|---|---|\n| 色彩基线 | ${style.palette} |\n| 主光方案 | ${style.lighting} |\n| 画面层次 | 主体清晰、前中后景可读、焦点明确 |\n| 质量锚定 | ${style.prompt} |\n| 反向规避 | ${style.negativePrompt} |\n\n## 三、必守规则\n\n| 编号 | 规则 |\n|---|---|\n| R1 | 必须声明“${style.name}”和“${style.anchor}”作为风格锚点 |\n| R2 | 必须保持“${style.rules.medium}”媒介边界，不混入错媒介词 |\n| R3 | 必须包含“${style.details}”中至少 2 个视觉识别点 |\n| R4 | 必须说明光源或光影方向：${style.lighting} |\n| R5 | 必须把质量锚点与主体内容融合，不输出解释性说明 |\n\n## 四、严禁项\n\n| 编号 | 严禁内容 |\n|---|---|\n| X1 | 直接写入具体作品、作者、厂牌或版权角色名称 |\n| X2 | ${style.avoid} |\n| X3 | 低质量、模糊、变形、裁切、文字、水印、签名 |\n| X4 | 人物身份漂移、服装不一致、手部结构错误、场景空间混乱 |\n`;
}

function buildCharacter(style) {
  return `${buildFrontMatter("art_character", `${style.name} · 角色基础形象生成`, "art_skills")}# 人物基础形象生成 · ${style.name}\n\n## 一、基础原则\n\n- 生成 ${style.rules.characterMedium}，用于角色首次定型。\n- 必须保持“${style.anchor}”和“${style.rules.medium}”媒介边界。\n- 人物需具备清晰身份、年龄、性别、五官、体态、发型、基础服装和气质标签。\n\n## 二、提示词模板\n\n{性别}角色四视图设定图，${style.name}，${style.anchor}，${style.details}，\ncharacter design sheet, character turnaround,\n{五官特征}，{整体气质}，{年龄段}，{身份职业}，\n{身高描述}，{头身比}，{体型描述}，{体态描述}，\n{发色发型}，{基础服装}，{服装材质与色彩}，\n同一画面左至右并排：人像特写+正视图+侧视图+后视图，\n人像特写从头顶到锁骨完整展示，全身立像从头顶到脚底完整展示，\n${style.lighting}，${style.texture}，${style.palette}，\n${style.prompt}，\n图中不要有任何文字\n\n## 三、提示词质量增强\n\n### 正向质量锚点\n\n${style.prompt}\n角色类提示词必须保留身份、年龄、性别、五官、身高、头身比、体态、服装、发型和四视图一致性。\n\n### 反向规避提示词\n\n${style.negativePrompt}, bad anatomy, deformed face, asymmetrical eyes, extra limbs, missing limbs, fused fingers, cropped head, cropped feet, inconsistent identity, inconsistent clothing.\n\n## 四、必守 / 严禁\n\n| 类型 | 规则 |\n|---|---|\n| 必守 | 四视图同一人物，面容/体型/发型/服装/光影完全一致 |\n| 必守 | 全身从头到脚完整入画，特写从头顶到锁骨完整入画 |\n| 严禁 | 直接套用具体作品角色造型或版权角色名称 |\n| 严禁 | ${style.avoid} |\n`;
}

function buildCharacterDerivative(style) {
  return `${buildFrontMatter("art_character_derivative", `${style.name} · 角色衍生服化`, "art_skills")}# 人物衍生生成 · ${style.name}\n\n## 一、基础原则\n\n- 以角色基础形象为底图，只叠加服装、妆造、配饰、状态和局部风格强化。\n- 不改变底模面容、身高、头身比、体态和核心身份。\n\n## 二、提示词模板\n\n以角色基础形象图为底图，img2img 叠加服化妆造，\n${style.name}，${style.anchor}，保持基础形象面容不变，保持同一人物身份，\n{妆容/面部状态}，{发型变化}，{服饰款式}，{配饰与材质}，\n${style.details}，${style.lighting}，${style.texture}，\n四视图一致性，保持自然站立，背景简洁，\n${style.prompt}，图中不要有任何文字\n\n## 三、提示词质量增强\n\n### 正向质量锚点\n\n${style.prompt}\n人物衍生提示词必须保持底模面容、体态、发型识别点不变，只叠加服化妆造与局部风格升级。\n\n### 反向规避提示词\n\n${style.negativePrompt}, face drift, identity changed, different person, pose changed, added unrelated scene, inconsistent costume between views, cropped body.\n\n## 四、约束规则\n\n| 类型 | 规则 |\n|---|---|\n| 必守 | 叠加后仍是同一人物，不改变底模身份 |\n| 必守 | 衍生内容只改变服化妆造、状态和局部风格强度 |\n| 严禁 | 把人物改成其他作品、其他画风或其他媒介 |\n| 严禁 | ${style.avoid} |\n`;
}

function buildProp(style) {
  return `${buildFrontMatter("art_prop", `${style.name} · 道具图像生成`, "art_skills")}# 道具图像生成 · ${style.name}\n\n## 一、基础原则\n\n- 生成 ${style.rules.propMedium}，用于独立道具资产入库。\n- 道具必须独立陈列，不出现人物、手部或佩戴状态。\n\n## 二、提示词模板\n\n${style.name}道具设定图，${style.anchor}，${style.details}，\n{道具类型}，{材质描述}，{工艺/纹样}，{使用痕迹或状态}，\n纯道具静物展示，道具独立陈列，无人持有，无人佩戴，\n同一画面四宫格：正面图+侧面图+背面图+细节特写，\n${style.lighting}，${style.texture}，${style.palette}，\n${style.prompt}，\n画面无字幕、无水印、无标题叠字，画面中不能出现任何人物、手部、手指、肢体\n\n## 三、提示词质量增强\n\n### 正向质量锚点\n\n${style.prompt}\n道具类提示词必须明确类型、材质、工艺、磨损痕迹、陈列方式和多角度/细节特写。\n\n### 反向规避提示词\n\n${style.negativePrompt}, hands, fingers, human body, worn by character, held by character, floating without support, unclear silhouette, wrong material, text, watermark.\n\n## 四、约束规则\n\n| 类型 | 规则 |\n|---|---|\n| 必守 | 道具轮廓清晰，材质和工艺可读 |\n| 必守 | 四宫格布局或按调用方要求输出单张静物图 |\n| 严禁 | 出现人物、手部、佩戴、握持、使用中动作 |\n| 严禁 | ${style.avoid} |\n`;
}

function buildPropDerivative(style) {
  return `${buildFrontMatter("art_prop_derivative", `${style.name} · 道具衍生生成`, "art_skills")}# 道具衍生生成 · ${style.name}\n\n## 一、基础原则\n\n- 以道具基础图为底图，保持轮廓、核心材质和识别纹样。\n- 只改变状态、年代感、光效、局部纹理或展示角度。\n\n## 二、提示词模板\n\n以道具基础图为底图，保持道具核心轮廓与材质不变，\n${style.name}，${style.anchor}，{衍生状态}，{局部纹理升级}，{光效或年代感变化}，\n独立静物陈列，无人物无手部，${style.lighting}，${style.texture}，\n${style.prompt}，画面无字幕、无水印、无标题叠字\n\n## 三、提示词质量增强\n\n### 正向质量锚点\n\n${style.prompt}\n道具衍生提示词必须保持原道具轮廓、核心材质和识别纹样不变，只做状态、光效、局部纹理或视角升级。\n\n### 反向规避提示词\n\n${style.negativePrompt}, changed prop type, wrong silhouette, added hand, added character, worn or held, lost core pattern, excessive glow hiding shape, text, watermark.\n\n## 四、约束规则\n\n| 类型 | 规则 |\n|---|---|\n| 必守 | 原道具身份必须清晰可识别 |\n| 必守 | 衍生强度不应遮挡轮廓和材质 |\n| 严禁 | 更换为其他道具类型或加入人物互动 |\n| 严禁 | ${style.avoid} |\n`;
}

function buildScene(style) {
  return `${buildFrontMatter("art_scene", `${style.name} · 场景图生成`, "art_skills")}# 场景图生成 · ${style.name}\n\n## 一、基础原则\n\n- 生成 ${style.rules.sceneMedium}，用于场景资产与分镜背景。\n- 场景默认不出现人物，除非调用方明确要求。\n- 必须体现前景、中景、后景和光源逻辑。\n\n## 二、提示词模板\n\n${style.name}场景主视图概念图，${style.anchor}，${style.details}，\n{室内/室外}，{场景类型}，{时代/地域/题材线索}，{季节+时间}，\n前景：{元素}，中景：{元素}，后景：{元素}，\n${style.palette}，${style.lighting}，${style.texture}，\n空间纵深清晰，材质细节可读，单画面构图，画面中无任何人物，\n${style.prompt}，图中不要有任何文字\n\n## 三、提示词质量增强\n\n### 正向质量锚点\n\n${style.prompt}\n场景类提示词必须强化前景/中景/后景、空间纵深、主光源方向、材质痕迹和情绪色调。\n\n### 反向规避提示词\n\n${style.negativePrompt}, no depth, flat lighting, empty white background, people, human silhouette, cropped architecture, inconsistent season, text, watermark.\n\n## 四、约束规则\n\n| 类型 | 规则 |\n|---|---|\n| 必守 | 必须有空间层次与明确光源 |\n| 必守 | 色彩和材质应服务于“${style.name}”风格 |\n| 严禁 | 场景图中随机出现人物、人影或人体轮廓 |\n| 严禁 | ${style.avoid} |\n`;
}

function buildSceneDerivative(style) {
  return `${buildFrontMatter("art_scene_derivative", `${style.name} · 场景衍生生成`, "art_skills")}# 场景衍生生成 · ${style.name}\n\n## 一、基础原则\n\n- 保持原场景地标、空间结构、材质年代感和风格边界。\n- 只改变时段、天候、景别、镜头角度或局部氛围。\n\n## 二、提示词模板\n\n以场景基础图为底图，保持原场景空间结构和识别地标不变，\n${style.name}，${style.anchor}，{时段/天候/景别变化}，{氛围强化}，\n${style.lighting}，${style.texture}，${style.palette}，\n前中后景层次保留，单画面构图，画面中无任何人物，\n${style.prompt}，图中不要有任何文字\n\n## 三、提示词质量增强\n\n### 正向质量锚点\n\n${style.prompt}\n场景衍生提示词必须保持原场景地标、空间结构、材质年代感不变，只改变时段、天候、景别或镜头角度。\n\n### 反向规避提示词\n\n${style.negativePrompt}, changed location, lost landmark, added people, random architecture, inconsistent perspective, flat lighting, overclean material, text, watermark.\n\n## 四、约束规则\n\n| 类型 | 规则 |\n|---|---|\n| 必守 | 原场景身份必须可识别 |\n| 必守 | 衍生变化必须围绕时段、天气、镜头和氛围展开 |\n| 严禁 | 换场景、换世界观、加入无关人物 |\n| 严禁 | ${style.avoid} |\n`;
}

function buildStoryboardVideo(style) {
  return `${buildFrontMatter("art_storyboard_video", `${style.name} · 视频提示词约束`, "art_skills")}# 视频提示词 · ${style.name}\n\n生成视频提示词时，必须注入以下视觉风格标签：\n\n| 模式 | 风格标签 |\n|---|---|\n| 通用多参模式（英文） | \`${style.anchor}, ${style.details}, ${style.lighting}, ${style.texture}, ${style.rules.positiveSuffix}\` |\n| 通用首尾帧模式（英文） | \`${style.anchor}, stable first frame and last frame, temporal continuity, ${style.lighting}, ${style.texture}\` |\n| 中文模式 | \`${style.name}，${style.details}，${style.lighting}，${style.texture}，画面连续，主体稳定\` |\n\n## 视频特有约束\n\n| 编号 | 规则 |\n|---|---|\n| V1 | 保持主体身份、服装、场景和光影连续 |\n| V2 | 镜头运动服务叙事，不为了炫技改变风格 |\n| V3 | 动作需有起承转合，避免瞬间变形和身份漂移 |\n| V4 | 首尾帧构图保持稳定，过渡自然 |\n| V5 | 负向规避：${style.negativePrompt}, flicker, jitter, morphing face, identity drift, warped hands, broken motion, sudden scene jump |\n`;
}

function buildDirectorStoryboard(style) {
  return `${buildFrontMatter("director_storyboard", `${style.name} · 导演分镜提示词技法`, "director_skills")}# 分镜提示词 · ${style.name}\n\n## 固定风格锚定词\n\n${style.name}，${style.anchor}，${style.details}，${style.lighting}，${style.texture}\n\n## 情绪到画面词映射\n\n| 情绪 | 面容/主体 | 光影 | 镜头建议 |\n|---|---|---|---|\n| 温柔 | 目光柔和、动作克制 | ${style.lighting} 的柔化版本 | 中近景，缓慢推近 |\n| 紧张 | 表情收紧、主体轮廓明确 | 对比增强、暗部加深 | 低角度或侧逆光 |\n| 释然 | 姿态放松、背景打开 | 主光回暖、空气感增强 | 远景到中景过渡 |\n| 爆发 | 动作明确、重心前压 | 强轮廓光、动势线强化 | 动态构图但不破坏识别 |\n\n## 画质锁定词\n\n${style.prompt}\n\n## 负向词模板\n\n${style.negativePrompt}, subtitles, captions, watermark, title overlay, UI text\n\n## 禁止项\n\n- 直接照搬具体作品、作者、厂牌或版权角色。\n- ${style.avoid}。\n- 让镜头语言破坏“${style.rules.medium}”的媒介边界。\n`;
}

function buildDirectorPlanning(style) {
  return `${buildFrontMatter("director_planning_style", `${style.name} · 导演规划技法`, "director_skills")}# 导演规划 · ${style.name}\n\n## 一、色调体系\n\n- **色彩基线**：${style.palette}。\n- **情绪绑定**：温柔段落降低对比，冲突段落强化明暗，高潮段落提高主体边缘光。\n- **禁用色域**：${style.avoid}。\n\n## 二、光影方案\n\n- **主光方案**：${style.lighting}。\n- **层次原则**：主体、背景和道具要有明确层次，不允许画面糊成一片。\n- **媒介边界**：全片保持 ${style.rules.medium}，不混入错媒介词。\n\n## 三、质感方向\n\n- **质感锚点**：${style.texture}。\n- **提示词基线**：${style.prompt}。\n- **反向规避**：${style.negativePrompt}。\n\n## 四、段落规划\n\n| 段落类型 | 视觉策略 |\n|---|---|\n| 开场 | 用代表性场景建立 ${style.name} 的风格基线 |\n| 人物登场 | 强化主体轮廓、服饰/材质和面部识别点 |\n| 冲突段落 | 增强构图张力和光影对比，但不破坏身份连续 |\n| 收束段落 | 减少复杂元素，回到清晰、稳定、可延续的视觉基线 |\n`;
}

function buildDirectorTable(style) {
  return `${buildFrontMatter("director_storyboard_table_style", `${style.name} · 分镜表技法`, "director_skills")}# 分镜表设计 · ${style.name}\n\n## 一、分镜表定位\n\n分镜表负责把剧本转为镜头语言，本文件限定 ${style.name} 在镜头、光影、材质和连续性上的写法。\n\n## 二、镜头字段规则\n\n| 字段 | 写法 |\n|---|---|\n| 画面描述 | 必须含主体、动作、空间、光影和 ${style.name} 风格锚点 |\n| 风格提示词 | ${style.anchor}; ${style.details}; ${style.texture} |\n| 光影 | ${style.lighting} |\n| 负向规避 | ${style.negativePrompt} |\n| 连续性 | 人物身份、服装、场景结构、道具位置必须跨镜头一致 |\n\n## 三、运镜建议\n\n- 角色镜头优先保持主体清楚，避免镜头运动遮挡身份识别点。\n- 场景镜头优先体现前中后景，给后续视频生成留出空间。\n- 动作镜头要写清起点、过程、落点，避免模型自行补出不相关动作。\n\n## 四、硬禁忌\n\n- 不写具体作品、作者、厂牌或版权角色名称。\n- 不把 ${style.name} 混成其他媒介。\n- 不输出水印、字幕、标题叠字、UI 元素。\n`;
}
