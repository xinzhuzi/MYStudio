// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * Visual Style Presets - 视觉风格预设
 * 
 * 统一的视觉风格定义，所有板块（剧本、角色、场景、AI导演）共用
 * 来源：纳米漫剧流水线 - 风格库
 */

// 风格分类
export type StyleCategory = '3d' | '2d' | 'real' | 'stop_motion';

/**
 * 媒介类型 — 决定 prompt-builder 如何翻译摄影参数
 * - cinematic: 完整物理摄影词汇（真人/写实3D）
 * - animation: 动画运镜适配（2D动画/风格化3D）
 * - stop-motion: 微缩实拍约束（定格动画）
 * - graphic: 仅色彩/情绪/节奏（像素/水彩/简笔画等高度抽象风格）
 */
export type MediaType = 'cinematic' | 'animation' | 'stop-motion' | 'graphic';

export interface StylePreset {
  id: string;
  name: string;
  category: StyleCategory;
  /** 媒介类型 — 控制摄影参数翻译策略 */
  mediaType: MediaType;
  /** 英文提示词 */
  prompt: string;
  /** 负面提示词 */
  negativePrompt: string;
  /** 中文描述 */
  description: string;
  /** 缩略图文件名 */
  thumbnail: string;
}

// ============================================================
// 3D 风格类
// ============================================================

const STYLES_3D: StylePreset[] = [
  {
    id: '3d_xuanhuan',
    name: '3D玄幻',
    category: '3d',
    mediaType: 'cinematic',
    prompt: '(best quality, masterpiece, high detailed:1.2), (Chinese fantasy 3D animation render:1.3), (traditional oriental robes, embroidered fabric, layered mountains, spiritual atmosphere:1.18), (soft volumetric fog, cinematic backlight, glowing aura:1.1), polished PBR cloth, fine metal ornaments, ethereal depth, sharp focus, detailed background, polished composition',
    negativePrompt: '(worst quality, low quality, bad quality:1.4), blurry, fuzzy, distorted, out of focus, malformed body, extra limbs, watermark, signature, text, western fantasy, modern city, neon sci-fi',
    description: '东方玄幻题材的通用3D风格，强调仙气、层次、体积光和华丽服饰。',
    thumbnail: '3d_xuanhuan.png',
  },
  {
    id: '3d_american',
    name: '3D美式',
    category: '3d',
    mediaType: 'animation',
    prompt: '(best quality, masterpiece, high detailed:1.2), (rounded western 3D animation:1.3), (large expressive eyes, friendly proportions, readable silhouette, colorful town background:1.18), (warm key light, soft fill light, cheerful daylight:1.1), smooth stylized material, soft edges, polished character surface, sharp focus, detailed background, polished composition',
    negativePrompt: '(worst quality, low quality, bad quality:1.4), blurry, fuzzy, distorted, out of focus, malformed body, extra limbs, watermark, signature, text, dark gritty realism, horror mood, hard realistic skin',
    description: '美式家庭动画方向的通用3D风格，强调圆润角色、明快色彩和温暖表情。',
    thumbnail: '3d_american.png',
  },
  {
    id: '3d_q_version',
    name: '3DQ版',
    category: '3d',
    mediaType: 'animation',
    prompt: '(best quality, masterpiece, high detailed:1.2), (chibi collectible 3D toy render:1.3), (super deformed body, oversized head, cute face, miniature scene:1.18), (soft studio lighting, gentle rim light, clean shadow:1.1), smooth toy material, rounded surface, tactile miniature detail, sharp focus, detailed background, polished composition',
    negativePrompt: '(worst quality, low quality, bad quality:1.4), blurry, fuzzy, distorted, out of focus, malformed body, extra limbs, watermark, signature, text, realistic adult proportion, rough material, scary mood',
    description: '潮玩感Q版三维风格，强调可爱比例、软光、干净材质和收藏级展示。',
    thumbnail: '3d_q_version.png',
  },
  {
    id: '3d_realistic',
    name: '3D写实',
    category: '3d',
    mediaType: 'cinematic',
    prompt: '(best quality, masterpiece, high detailed:1.2), (photorealistic 3D cinematic render:1.3), (highly detailed texture, realistic skin shader, complex fabric, accurate scale:1.18), (ray-traced lighting, cinematic depth of field, controlled contrast:1.1), micro surface detail, natural imperfections, realistic material response, sharp focus, detailed background, polished composition',
    negativePrompt: '(worst quality, low quality, bad quality:1.4), blurry, fuzzy, distorted, out of focus, malformed body, extra limbs, watermark, signature, text, cartoon, anime, flat illustration, low poly, plastic skin',
    description: '电影级写实3D风格，强调真实材质、光追质感和高精度建模。',
    thumbnail: '3d_realistic.png',
  },
  {
    id: '3d_block',
    name: '3D块面',
    category: '3d',
    mediaType: 'animation',
    prompt: '(best quality, masterpiece, high detailed:1.2), (low poly geometric 3D art:1.3), (faceted shapes, angular silhouette, simple forms, clean environment:1.18), (clear daylight, simple ambient occlusion, readable shadow:1.1), flat shaded polygons, crisp edges, minimal texture, sharp focus, detailed background, polished composition',
    negativePrompt: '(worst quality, low quality, bad quality:1.4), blurry, fuzzy, distorted, out of focus, malformed body, extra limbs, watermark, signature, text, high-poly realism, organic smooth shapes, noisy texture',
    description: '低多边形块面风格，强调几何结构、简洁体块和清晰配色。',
    thumbnail: '3d_block.png',
  },
  {
    id: '3d_voxel',
    name: '3D方块世界',
    category: '3d',
    mediaType: 'animation',
    prompt: '(best quality, masterpiece, high detailed:1.2), (voxel block world 3D art:1.3), (cubic character, blocky trees, grid-based village, isometric readability:1.18), (bright daylight, crisp shadow, cheerful atmosphere:1.1), voxel cubes, pixel-like material, clean toy blocks, sharp focus, detailed background, polished composition',
    negativePrompt: '(worst quality, low quality, bad quality:1.4), blurry, fuzzy, distorted, out of focus, malformed body, extra limbs, watermark, signature, text, round organic forms, smooth realistic texture, blur',
    description: '体素方块世界风格，强调方块结构、像素化体积和玩具感空间。',
    thumbnail: '3d_voxel.png',
  },
  {
    id: '3d_mobile',
    name: '3D手游',
    category: '3d',
    mediaType: 'animation',
    prompt: '(best quality, masterpiece, high detailed:1.2), (stylized mobile game 3D render:1.3), (hero character design, clean fantasy outfit, readable game asset silhouette:1.18), (bright outdoor light, soft ambient light, polished game look:1.1), optimized clean material, stylized cloth and metal, vivid but controlled color, sharp focus, detailed background, polished composition',
    negativePrompt: '(worst quality, low quality, bad quality:1.4), blurry, fuzzy, distorted, out of focus, malformed body, extra limbs, watermark, signature, text, photorealistic noise, rough sketch, pixelated low quality',
    description: '手游级风格化3D，强调清爽材质、可读轮廓和高完成度游戏资产。',
    thumbnail: '3d_mobile.png',
  },
  {
    id: '3d_render_2d',
    name: '3D渲染2D',
    category: '3d',
    mediaType: 'animation',
    prompt: '(best quality, masterpiece, high detailed:1.2), (anime-inspired cel shaded 3D render:1.3), (toon linework, cel shaded body, vibrant fantasy setting, clean anime face:1.18), (bright rim light, soft global illumination, colorful sky light:1.1), toon material, sharp edge highlights, controlled flat shadow, sharp focus, detailed background, polished composition',
    negativePrompt: '(worst quality, low quality, bad quality:1.4), blurry, fuzzy, distorted, out of focus, malformed body, extra limbs, watermark, signature, text, photorealistic skin, heavy realism, rough sketch',
    description: '三渲二通用风格，强调3D体积与2D动画线条、赛璐璐阴影的融合。',
    thumbnail: '3d_render_2d.png',
  },
  {
    id: 'jp_3d_render_2d',
    name: '日式3D渲染2D',
    category: '3d',
    mediaType: 'animation',
    prompt: '(best quality, masterpiece, high detailed:1.2), (Japanese cel shaded 3D action render:1.3), (sharp anime silhouette, dynamic camera angle, bold costume shapes, action pose:1.18), (hard rim light, high contrast stage lighting, motion streaks:1.1), crisp toon shader, clear line accents, stylized material breakups, sharp focus, detailed background, polished composition',
    negativePrompt: '(worst quality, low quality, bad quality:1.4), blurry, fuzzy, distorted, out of focus, malformed body, extra limbs, watermark, signature, text, photorealistic rendering, dull flat color, western cartoon softness',
    description: '日式三渲二通用风格，强调动态姿态、锐利赛璐璐阴影和强镜头张力。',
    thumbnail: 'jp_3d_render_2d.png',
  },
];

// ============================================================
// 2D 动画类
// ============================================================

const STYLES_2D: StylePreset[] = [
  {
    id: '2d_animation',
    name: '2D动画',
    category: '2d',
    mediaType: 'animation',
    prompt: '(best quality, masterpiece, high detailed:1.2), (clean 2D anime animation style:1.3), (clean lineart, flat color, expressive eyes, balanced character design:1.18), (soft animation lighting, clear cel shadow, readable composition:1.1), smooth digital paint, crisp outline, controlled detail density, clean composition, readable silhouette, high detail, finished illustration',
    negativePrompt: '(worst quality, low quality:1.4), blurry, messy lineart, bad anatomy, 3D render, photorealistic, CGI, watermark, signature, text, 3D render, photorealistic, messy sketch',
    description: '标准二次元动画风格，强调清晰线稿、平涂上色和可复用角色设计。',
    thumbnail: '2d_animation.png',
  },
  {
    id: '2d_movie',
    name: '2D电影',
    category: '2d',
    mediaType: 'animation',
    prompt: '(best quality, masterpiece, high detailed:1.2), (high budget 2D animated movie still:1.3), (detailed background, emotional sky, cinematic character framing, atmospheric depth:1.18), (dramatic sunset light, layered clouds, soft glow:1.1), painterly background, clean character line, film-like composition, clean composition, readable silhouette, high detail, finished illustration',
    negativePrompt: '(worst quality, low quality:1.4), blurry, messy lineart, bad anatomy, 3D render, photorealistic, CGI, watermark, signature, text, simple flat cartoon, low resolution, dull color',
    description: '动画电影级通用风格，强调细致背景、情绪光影和大银幕构图。',
    thumbnail: '2d_movie.png',
  },
  {
    id: '2d_fantasy',
    name: '2D奇幻动画',
    category: '2d',
    mediaType: 'animation',
    prompt: '(best quality, masterpiece, high detailed:1.2), (fantasy 2D anime illustration:1.3), (magical city, glowing symbols, ornate robes, dreamy atmosphere:1.18), (mystic particle glow, moonlit rim light, magical haze:1.1), clean lineart, luminous color, layered fantasy detail, clean composition, readable silhouette, high detail, finished illustration',
    negativePrompt: '(worst quality, low quality:1.4), blurry, messy lineart, bad anatomy, 3D render, photorealistic, CGI, watermark, signature, text, modern daily setting, sci-fi machinery, gritty realism',
    description: '奇幻二次元动画风格，强调魔法氛围、异世界层次和华丽服化。',
    thumbnail: '2d_fantasy.png',
  },
  {
    id: '2d_retro',
    name: '2D复古动画',
    category: '2d',
    mediaType: 'animation',
    prompt: '(best quality, masterpiece, high detailed:1.2), (1990s hand-drawn cel animation:1.3), (retro character design, matte painted background, nostalgic framing:1.18), (soft analog glow, mild film grain, warm evening light:1.1), cel paint texture, slight VHS softness, hand-painted backdrop, clean composition, readable silhouette, high detail, finished illustration',
    negativePrompt: '(worst quality, low quality:1.4), blurry, messy lineart, bad anatomy, 3D render, photorealistic, CGI, watermark, signature, text, modern glossy digital art, 3D render, hyper sharp HDR',
    description: '90年代复古动画通用风格，强调赛璐璐胶片感、柔和颗粒和怀旧色调。',
    thumbnail: '2d_retro.png',
  },
  {
    id: '2d_american',
    name: '2D美式动画',
    category: '2d',
    mediaType: 'animation',
    prompt: '(best quality, masterpiece, high detailed:1.2), (western 2D cartoon animation:1.3), (bold outline, exaggerated expression, energetic pose, graphic background:1.18), (bright studio color, clean flat light, playful contrast:1.1), solid color fills, thick contour, simplified forms, clean composition, readable silhouette, high detail, finished illustration',
    negativePrompt: '(worst quality, low quality:1.4), blurry, messy lineart, bad anatomy, 3D render, photorealistic, CGI, watermark, signature, text, delicate anime line, realistic shading, 3D render',
    description: '美式卡通动画风格，强调粗线条、夸张表情和高识别度色块。',
    thumbnail: '2d_american.png',
  },
  {
    id: '2d_ghibli',
    name: '2D自然手绘动画',
    category: '2d',
    mediaType: 'animation',
    prompt: '(best quality, masterpiece, high detailed:1.2), (hand-painted nature 2D animation:1.3), (gentle character, lush countryside, peaceful daily life, charming background:1.18), (soft daylight, diffused cloud light, calm atmosphere:1.1), watercolor-like background, warm hand-drawn line, organic texture, clean composition, readable silhouette, high detail, finished illustration',
    negativePrompt: '(worst quality, low quality:1.4), blurry, messy lineart, bad anatomy, 3D render, photorealistic, CGI, watermark, signature, text, sharp digital neon, 3D CGI, horror darkness',
    description: '自然系手绘动画通用风格，强调温柔人物、乡野背景和水彩般空气感。',
    thumbnail: '2d_ghibli.png',
  },
  {
    id: '2d_retro_girl',
    name: '2D复古少女',
    category: '2d',
    mediaType: 'animation',
    prompt: '(best quality, masterpiece, high detailed:1.2), (retro shoujo manga illustration:1.3), (sparkling eyes, delicate hair, floral background, dreamy romance:1.18), (pastel glow, soft highlight, gentle vignette:1.1), thin elegant line, screentone texture, soft color wash, clean composition, readable silhouette, high detail, finished illustration',
    negativePrompt: '(worst quality, low quality:1.4), blurry, messy lineart, bad anatomy, 3D render, photorealistic, CGI, watermark, signature, text, dark horror, muscular shonen style, 3D realism',
    description: '复古少女漫画风格，强调大眼、花饰、柔和粉彩和浪漫情绪。',
    thumbnail: '2d_retro_girl.png',
  },
  {
    id: '2d_korean',
    name: '2D韩式动画',
    category: '2d',
    mediaType: 'animation',
    prompt: '(best quality, masterpiece, high detailed:1.2), (premium webtoon style illustration:1.3), (sharp handsome features, modern fashion, clean urban lighting, polished emotion:1.18), (soft rim light, clear digital highlight, romantic atmosphere:1.1), smooth digital coloring, clean contour, glossy eye detail, clean composition, readable silhouette, high detail, finished illustration',
    negativePrompt: '(worst quality, low quality:1.4), blurry, messy lineart, bad anatomy, 3D render, photorealistic, CGI, watermark, signature, text, rough sketch, retro heavy grain, 3D realism',
    description: '韩式条漫通用风格，强调精致脸型、现代服饰和清爽数码上色。',
    thumbnail: '2d_korean.png',
  },
  {
    id: '2d_shonen',
    name: '2D热血动画',
    category: '2d',
    mediaType: 'animation',
    prompt: '(best quality, masterpiece, high detailed:1.2), (dynamic shonen action anime:1.3), (impact pose, speed lines, intense expression, powerful silhouette:1.18), (strong contrast light, dramatic action shadow, burst effect:1.1), bold cel shading, sharp line weight, energetic detail, clean composition, readable silhouette, high detail, finished illustration',
    negativePrompt: '(worst quality, low quality:1.4), blurry, messy lineart, bad anatomy, 3D render, photorealistic, CGI, watermark, signature, text, static calm pose, soft shoujo mood, pastel quiet scene',
    description: '热血少年动画风格，强调动作冲击、速度线、高对比阴影和力量感。',
    thumbnail: '2d_shonen.png',
  },
  {
    id: '2d_akira',
    name: '2D热血圆线漫画',
    category: '2d',
    mediaType: 'animation',
    prompt: '(best quality, masterpiece, high detailed:1.2), (classic round-line shonen manga:1.3), (rounded expressive face, athletic body, clear action pose, iconic simple costume:1.18), (bright outdoor light, high readability, clean shadow:1.1), solid ink line, simple color blocks, crisp anatomy detail, clean composition, readable silhouette, high detail, finished illustration',
    negativePrompt: '(worst quality, low quality:1.4), blurry, messy lineart, bad anatomy, 3D render, photorealistic, CGI, watermark, signature, text, soft modern moe face, photorealistic 3D, weak anatomy',
    description: '经典热血圆线漫画风格，强调饱满五官、清晰肌肉与明快动作。',
    thumbnail: '2d_akira.png',
  },
  {
    id: '2d_doraemon',
    name: '2D圆润儿童动画',
    category: '2d',
    mediaType: 'animation',
    prompt: '(best quality, masterpiece, high detailed:1.2), (rounded child-friendly 2D animation:1.3), (simple round character design, friendly face, clean prop shapes, playful room:1.18), (bright even light, cheerful color, soft shadow:1.1), clean outline, simple flat color, low detail density, clean composition, readable silhouette, high detail, finished illustration',
    negativePrompt: '(worst quality, low quality:1.4), blurry, messy lineart, bad anatomy, 3D render, photorealistic, CGI, watermark, signature, text, complex realistic detail, dark gloomy horror, sharp angular face',
    description: '圆润儿童向动画风格，强调简单线条、童趣比例和明亮纯色。',
    thumbnail: '2d_doraemon.png',
  },
  {
    id: '2d_fujimoto',
    name: '2D电影感松散漫画',
    category: '2d',
    mediaType: 'animation',
    prompt: '(best quality, masterpiece, high detailed:1.2), (loose cinematic manga drawing:1.3), (sketchy linework, casual pose, realistic emotional beat, movie-like composition:1.18), (natural side light, muted contrast, grounded atmosphere:1.1), rough ink texture, visible hand-drawn marks, restrained color, clean composition, readable silhouette, high detail, finished illustration',
    negativePrompt: '(worst quality, low quality:1.4), blurry, messy lineart, bad anatomy, 3D render, photorealistic, CGI, watermark, signature, text, over-polished digital gloss, standard cute anime, 3D render',
    description: '电影感松散漫画风格，强调手绘粗粝、生活化构图和原始情绪。',
    thumbnail: '2d_fujimoto.png',
  },
  {
    id: '2d_mob',
    name: '2D都市灵能漫画',
    category: '2d',
    mediaType: 'animation',
    prompt: '(best quality, masterpiece, high detailed:1.2), (psychedelic urban supernatural manga:1.3), (warped perspective, psychic aura, city background, expressive simple face:1.18), (color shock glow, distorted light, high energy contrast:1.1), loose comic line, abstract energy pattern, bold color field, clean composition, readable silhouette, high detail, finished illustration',
    negativePrompt: '(worst quality, low quality:1.4), blurry, messy lineart, bad anatomy, 3D render, photorealistic, CGI, watermark, signature, text, calm neutral colors, photorealistic body, polished beauty anime',
    description: '都市超能力漫画风格，强调变形透视、迷幻色和紧张能量感。',
    thumbnail: '2d_mob.png',
  },
  {
    id: '2d_jojo',
    name: '2D高对比姿态漫画',
    category: '2d',
    mediaType: 'animation',
    prompt: '(best quality, masterpiece, high detailed:1.2), (high-contrast pose-driven manga:1.3), (dramatic pose, angular face, muscular silhouette, ornate costume:1.18), (harsh side light, deep shadow, theatrical contrast:1.1), heavy hatching, bold contour, sculptural linework, clean composition, readable silhouette, high detail, finished illustration',
    negativePrompt: '(worst quality, low quality:1.4), blurry, messy lineart, bad anatomy, 3D render, photorealistic, CGI, watermark, signature, text, soft cute moe, minimalist flat style, weak pose',
    description: '高对比姿态漫画风格，强调夸张造型、硬朗阴影和舞台化动作。',
    thumbnail: '2d_jojo.png',
  },
  {
    id: '2d_detective',
    name: '2D日式侦探',
    category: '2d',
    mediaType: 'animation',
    prompt: '(best quality, masterpiece, high detailed:1.2), (Japanese detective anime style:1.3), (sharp facial features, mystery mood, school and city setting, clue-focused framing:1.18), (cool evening light, dramatic interior shadow, suspense tone:1.1), clean cel line, restrained color, classic animation finish, clean composition, readable silhouette, high detail, finished illustration',
    negativePrompt: '(worst quality, low quality:1.4), blurry, messy lineart, bad anatomy, 3D render, photorealistic, CGI, watermark, signature, text, fantasy magic excess, modern glossy 3D, cute chibi',
    description: '日式侦探动画通用风格，强调悬疑氛围、清晰人物和90年代动画质感。',
    thumbnail: '2d_detective.png',
  },
  {
    id: '2d_slamdunk',
    name: '2D运动写实漫画',
    category: '2d',
    mediaType: 'animation',
    prompt: '(best quality, masterpiece, high detailed:1.2), (realistic sports manga animation:1.3), (athletic body proportion, sweat detail, court atmosphere, intense eye focus:1.18), (gymnasium top light, hard rim light, action freeze frame:1.1), inked muscle line, textured shading, energetic motion, clean composition, readable silhouette, high detail, finished illustration',
    negativePrompt: '(worst quality, low quality:1.4), blurry, messy lineart, bad anatomy, 3D render, photorealistic, CGI, watermark, signature, text, chibi cute body, fantasy robe, weak anatomy',
    description: '运动写实漫画风格，强调真实比例、汗水、肌肉张力和比赛现场感。',
    thumbnail: '2d_slamdunk.png',
  },
  {
    id: '2d_astroboy',
    name: '2D经典圆线漫画',
    category: '2d',
    mediaType: 'animation',
    prompt: '(best quality, masterpiece, high detailed:1.2), (classic round-line retro manga:1.3), (large expressive eyes, rounded face, simple futuristic prop, iconic silhouette:1.18), (clean flat light, vintage print tone, bright clarity:1.1), smooth black line, simple shading, old comic texture, clean composition, readable silhouette, high detail, finished illustration',
    negativePrompt: '(worst quality, low quality:1.4), blurry, messy lineart, bad anatomy, 3D render, photorealistic, CGI, watermark, signature, text, modern hyper-detailed anime, sharp realistic rendering, 3D',
    description: '经典圆线科幻漫画风格，强调圆润结构、大眼和复古未来感。',
    thumbnail: '2d_astroboy.png',
  },
  {
    id: '2d_deathnote',
    name: '2D暗黑悬疑漫画',
    category: '2d',
    mediaType: 'animation',
    prompt: '(best quality, masterpiece, high detailed:1.2), (dark psychological manga illustration:1.3), (sharp face, serious gaze, gothic mood, mystery composition:1.18), (low key light, strong cast shadow, cold highlight:1.1), intricate hatching, thin sharp line, desaturated color, clean composition, readable silhouette, high detail, finished illustration',
    negativePrompt: '(worst quality, low quality:1.4), blurry, messy lineart, bad anatomy, 3D render, photorealistic, CGI, watermark, signature, text, cute happy palette, chibi, bright comedy lighting',
    description: '暗黑悬疑漫画风格，强调锐利五官、交叉排线和阴郁情绪。',
    thumbnail: '2d_deathnote.png',
  },
  {
    id: '2d_thick_line',
    name: '2D粗线条',
    category: '2d',
    mediaType: 'animation',
    prompt: '(best quality, masterpiece, high detailed:1.2), (bold thick-line street illustration:1.3), (chunky outline, graphic pose, urban art energy, simplified shape:1.18), (flat bright light, high contrast color block, poster-like clarity:1.1), thick ink contour, halftone texture, vibrant fill, clean composition, readable silhouette, high detail, finished illustration',
    negativePrompt: '(worst quality, low quality:1.4), blurry, messy lineart, bad anatomy, 3D render, photorealistic, CGI, watermark, signature, text, thin delicate line, realistic painting, muted faded color',
    description: '粗线条街头插画风格，强调厚轮廓、强对比和涂鸦式活力。',
    thumbnail: '2d_thick_line.png',
  },
  {
    id: '2d_rubberhose',
    name: '2D橡皮管动画',
    category: '2d',
    mediaType: 'animation',
    prompt: '(best quality, masterpiece, high detailed:1.2), (1930s rubber hose cartoon:1.3), (bouncy limbs, pie-cut eyes, vintage mascot character, simple stage:1.18), (old film light, vignette, soft grain:1.1), inked black line, limited palette, analog film texture, clean composition, readable silhouette, high detail, finished illustration',
    negativePrompt: '(worst quality, low quality:1.4), blurry, messy lineart, bad anatomy, 3D render, photorealistic, CGI, watermark, signature, text, modern anime, realistic 3D, stiff motion',
    description: '复古橡皮管动画风格，强调摆动肢体、派眼和黑白胶片质感。',
    thumbnail: '2d_rubberhose.png',
  },
  {
    id: '2d_q_version',
    name: '2DQ版',
    category: '2d',
    mediaType: 'animation',
    prompt: '(best quality, masterpiece, high detailed:1.2), (kawaii chibi 2D illustration:1.3), (super deformed body, cute face, tiny hands, adorable costume:1.18), (soft pastel light, gentle highlight, clean background:1.1), rounded line, simple cel shadow, candy color, clean composition, readable silhouette, high detail, finished illustration',
    negativePrompt: '(worst quality, low quality:1.4), blurry, messy lineart, bad anatomy, 3D render, photorealistic, CGI, watermark, signature, text, realistic adult proportion, horror mood, harsh dark lighting',
    description: 'Q版可爱2D风格，强调大头小身、柔和粉彩和简单阴影。',
    thumbnail: '2d_q_version.png',
  },
  {
    id: '2d_pixel',
    name: '2D像素',
    category: '2d',
    mediaType: 'graphic',
    prompt: '(best quality, masterpiece, high detailed:1.2), (clean pixel art style:1.3), (16-bit sprite look, tile-based environment, readable silhouette, retro game asset:1.18), (simple light direction, crisp pixel shadow, no blur:1.1), hard pixel edges, dithering, limited palette, clean composition, readable silhouette, high detail, finished illustration',
    negativePrompt: '(worst quality, low quality:1.4), blurry, messy lineart, bad anatomy, 3D render, photorealistic, CGI, watermark, signature, text, anti-aliased smooth line, vector art, 3D realism, blur',
    description: '像素艺术风格，强调格点清晰、有限色板和复古游戏资产感。',
    thumbnail: '2d_pixel.png',
  },
  {
    id: '2d_gongbi',
    name: '2D工笔风',
    category: '2d',
    mediaType: 'graphic',
    prompt: '(best quality, masterpiece, high detailed:1.2), (Chinese gongbi painting illustration:1.3), (meticulous brushwork, elegant figure, refined ornament, ink wash background:1.18), (soft paper light, delicate highlight, calm atmosphere:1.1), rice paper grain, fine mineral pigment, precise linework, clean composition, readable silhouette, high detail, finished illustration',
    negativePrompt: '(worst quality, low quality:1.4), blurry, messy lineart, bad anatomy, 3D render, photorealistic, CGI, watermark, signature, text, western oil painting, neon color, rough sketch, 3D realism',
    description: '工笔国画风格，强调细密线描、传统色和雅致留白。',
    thumbnail: '2d_gongbi.png',
  },
  {
    id: '2d_stick',
    name: '2D简笔画',
    category: '2d',
    mediaType: 'graphic',
    prompt: '(best quality, masterpiece, high detailed:1.2), (minimalist stick figure doodle:1.3), (simple stick figure, sketchbook charm, clean blank space, cute expression:1.18), (flat paper light, no complex shadow, minimal contrast:1.1), hand-drawn pencil line, plain white background, sparse detail, clean composition, readable silhouette, high detail, finished illustration',
    negativePrompt: '(worst quality, low quality:1.4), blurry, messy lineart, bad anatomy, 3D render, photorealistic, CGI, watermark, signature, text, complex realistic detail, filled color, 3D shading',
    description: '极简简笔画风格，强调白底、手绘线条和低复杂度表达。',
    thumbnail: '2d_stick.png',
  },
  {
    id: '2d_watercolor',
    name: '2D水彩',
    category: '2d',
    mediaType: 'graphic',
    prompt: '(best quality, masterpiece, high detailed:1.2), (watercolor illustration style:1.3), (soft edge landscape, translucent color wash, dreamy character, paper texture:1.18), (diffused daylight, gentle bloom, low contrast:1.1), wet-on-wet pigment, visible paper grain, feathered edge, clean composition, readable silhouette, high detail, finished illustration',
    negativePrompt: '(worst quality, low quality:1.4), blurry, messy lineart, bad anatomy, 3D render, photorealistic, CGI, watermark, signature, text, hard digital flat color, vector edge, 3D realism',
    description: '水彩插画风格，强调湿画法、柔边、纸纹和梦幻色彩。',
    thumbnail: '2d_watercolor.png',
  },
  {
    id: '2d_simple_line',
    name: '2D简单线条',
    category: '2d',
    mediaType: 'graphic',
    prompt: '(best quality, masterpiece, high detailed:1.2), (minimal clean line art:1.3), (continuous line drawing, elegant figure, simple object, blank composition:1.18), (plain even light, no heavy shadow, graphic clarity:1.1), thin black line, vector-like edge, minimal fill, clean composition, readable silhouette, high detail, finished illustration',
    negativePrompt: '(worst quality, low quality:1.4), blurry, messy lineart, bad anatomy, 3D render, photorealistic, CGI, watermark, signature, text, messy sketch, dense background, 3D shading, realism',
    description: '极简线稿风格，强调连续线、白底和优雅留白。',
    thumbnail: '2d_simple_line.png',
  },
  {
    id: '2d_comic',
    name: '2D美式漫画',
    category: '2d',
    mediaType: 'animation',
    prompt: '(best quality, masterpiece, high detailed:1.2), (American comic book illustration:1.3), (heroic pose, bold ink, dynamic panel composition, halftone texture:1.18), (dramatic colored light, sharp contrast, poster energy:1.1), heavy ink, hatching, comic print dots, clean composition, readable silhouette, high detail, finished illustration',
    negativePrompt: '(worst quality, low quality:1.4), blurry, messy lineart, bad anatomy, 3D render, photorealistic, CGI, watermark, signature, text, manga chibi, watercolor softness, photorealistic 3D',
    description: '美式漫画通用风格，强调半调网点、强动作和墨线张力。',
    thumbnail: '2d_comic.png',
  },
  {
    id: '2d_shoujo',
    name: '2D少女漫画',
    category: '2d',
    mediaType: 'animation',
    prompt: '(best quality, masterpiece, high detailed:1.2), (classic shoujo manga illustration:1.3), (delicate eyes, flowing hair, floral frame, emotional expression:1.18), (soft sparkle light, romantic vignette, gentle contrast:1.1), thin line, screentone texture, pearl highlight, clean composition, readable silhouette, high detail, finished illustration',
    negativePrompt: '(worst quality, low quality:1.4), blurry, messy lineart, bad anatomy, 3D render, photorealistic, CGI, watermark, signature, text, thick shonen line, horror darkness, 3D realism',
    description: '少女漫画通用风格，强调纤细线条、花饰背景和情绪凝视。',
    thumbnail: '2d_shoujo.png',
  },
  {
    id: '2d_horror',
    name: '2D诡异惊悚',
    category: '2d',
    mediaType: 'animation',
    prompt: '(best quality, masterpiece, high detailed:1.2), (eerie psychological horror manga:1.3), (distorted perspective, unsettling pattern, tense face, nightmare atmosphere:1.18), (low key light, stark black shadow, claustrophobic framing:1.1), heavy black ink, spiral motifs, scratchy hatching, clean composition, readable silhouette, high detail, finished illustration',
    negativePrompt: '(worst quality, low quality:1.4), blurry, messy lineart, bad anatomy, 3D render, photorealistic, CGI, watermark, signature, text, cute happy mood, bright pastel, soft comedy lighting, graphic gore',
    description: '黑白惊悚漫画风格，强调怪诞氛围、重墨线和心理压迫。',
    thumbnail: '2d_horror.png',
  },
];

// ============================================================
// 真人风格类
// ============================================================

const STYLES_REAL: StylePreset[] = [
  {
    id: 'real_movie',
    name: '真人电影',
    category: 'real',
    mediaType: 'cinematic',
    prompt: '(best quality, masterpiece, high detailed:1.2), (live-action cinematic movie still:1.3), (real actor presence, natural costume, film set atmosphere, grounded composition:1.18), (35mm film light, dramatic key light, color graded frame:1.1), film grain, real skin pores, optical lens texture, real lens optics, natural skin texture, cinematic framing, high detail',
    negativePrompt: '(worst quality, low quality:1.4), 3D render, CGI, anime, illustration, cartoon, plastic skin, over-smoothed face, bad anatomy, watermark, signature, text, 3D render, CGI, anime, illustration, artificial plastic face',
    description: '真人电影剧照风格，强调真实摄影、电影调色和镜头景深。',
    thumbnail: 'real_movie.png',
  },
  {
    id: 'real_costume',
    name: '真人古装',
    category: 'real',
    mediaType: 'cinematic',
    prompt: '(best quality, masterpiece, high detailed:1.2), (live-action Chinese period drama still:1.3), (period costume, embroidered fabric, ancient interior, elegant posture:1.18), (soft lantern light, daylight through lattice, cinematic haze:1.1), real silk folds, hair ornament detail, natural skin texture, real lens optics, natural skin texture, cinematic framing, high detail',
    negativePrompt: '(worst quality, low quality:1.4), 3D render, CGI, anime, illustration, cartoon, plastic skin, over-smoothed face, bad anatomy, watermark, signature, text, modern clothes, glasses, watch, 3D render, anime',
    description: '真人古装剧风格，强调汉服质感、古代空间和影视级摄影。',
    thumbnail: 'real_costume.png',
  },
  {
    id: 'real_hk_retro',
    name: '真人复古港片',
    category: 'real',
    mediaType: 'cinematic',
    prompt: '(best quality, masterpiece, high detailed:1.2), (1990s Hong Kong-inspired live-action cinema:1.3), (rainy street, neon shop light, moody actor gaze, urban night:1.18), (neon side light, motion blur, high contrast practical lighting:1.1), film grain, wet pavement reflection, vintage lens softness, real lens optics, natural skin texture, cinematic framing, high detail',
    negativePrompt: '(worst quality, low quality:1.4), 3D render, CGI, anime, illustration, cartoon, plastic skin, over-smoothed face, bad anatomy, watermark, signature, text, sterile modern digital look, anime, 3D render, clean daylight',
    description: '复古港风真人电影风格，强调霓虹、胶片颗粒和都市夜色。',
    thumbnail: 'real_hk_retro.png',
  },
  {
    id: 'real_wuxia',
    name: '真人复古武侠',
    category: 'real',
    mediaType: 'cinematic',
    prompt: '(best quality, masterpiece, high detailed:1.2), (vintage live-action wuxia cinema:1.3), (martial arts stance, old inn, forest duel, practical costume:1.18), (hard side light, dusty backlight, retro film contrast:1.1), film grain, worn fabric, real weapon surface, real lens optics, natural skin texture, cinematic framing, high detail',
    negativePrompt: '(worst quality, low quality:1.4), 3D render, CGI, anime, illustration, cartoon, plastic skin, over-smoothed face, bad anatomy, watermark, signature, text, modern clothing, sci-fi tech, CGI magic excess, anime',
    description: '复古武侠真人电影风格，强调实景打斗、布景年代感和江湖气。',
    thumbnail: 'real_wuxia.png',
  },
  {
    id: 'real_bloom',
    name: '真实光晕',
    category: 'real',
    mediaType: 'cinematic',
    prompt: '(best quality, masterpiece, high detailed:1.2), (dreamy backlit live-action photography:1.3), (real person, glowing rim light, soft focus portrait, airy environment:1.18), (strong bloom, lens flare, warm backlight, shallow depth of field:1.1), film softness, skin texture retained, optical glow, real lens optics, natural skin texture, cinematic framing, high detail',
    negativePrompt: '(worst quality, low quality:1.4), 3D render, CGI, anime, illustration, cartoon, plastic skin, over-smoothed face, bad anatomy, watermark, signature, text, harsh contrast, dark gritty mood, anime, 3D render',
    description: '柔光逆光真人摄影风格，强调梦幻高光、真实皮肤和轻柔景深。',
    thumbnail: 'real_bloom.png',
  },
];

// ============================================================
// 定格动画类
// ============================================================

const STYLES_STOP_MOTION: StylePreset[] = [
  {
    id: 'stop_motion',
    name: '定格动画',
    category: 'stop_motion',
    mediaType: 'stop-motion',
    prompt: '(best quality, masterpiece, high detailed:1.2), (handmade stop-motion animation:1.3), (miniature character, crafted props, frame-by-frame motion, small studio set:1.18), (soft tabletop studio light, macro depth of field, gentle shadow:1.1), tactile handmade material, visible craft marks, tiny set texture, macro photography, tactile detail, frame-by-frame charm, high detail',
    negativePrompt: '(worst quality, low quality:1.4), fluid CGI animation, 2D anime, photorealistic human scale, smooth digital texture, bad anatomy, watermark, signature, text, fluid CGI animation, 2D anime, smooth digital texture',
    description: '通用定格动画风格，强调手工模型、逐帧运动和微缩摄影质感。',
    thumbnail: 'stop_motion.png',
  },
  {
    id: 'figure_stop_motion',
    name: '手办定格动画',
    category: 'stop_motion',
    mediaType: 'stop-motion',
    prompt: '(best quality, masterpiece, high detailed:1.2), (action figure stop-motion photography:1.3), (toy figure body, articulated pose, miniature prop, display diorama:1.18), (macro studio light, rim light on plastic surface, shallow depth:1.1), PVC material, molded seams, toy-scale detail, macro photography, tactile detail, frame-by-frame charm, high detail',
    negativePrompt: '(worst quality, low quality:1.4), fluid CGI animation, 2D anime, photorealistic human scale, smooth digital texture, bad anatomy, watermark, signature, text, human skin realism, 2D drawing, life-size body',
    description: '手办摄影式定格风格，强调PVC玩具体积、微距景深和模型关节。',
    thumbnail: 'figure_stop_motion.png',
  },
  {
    id: 'clay_stop_motion',
    name: '粘土定格动画',
    category: 'stop_motion',
    mediaType: 'stop-motion',
    prompt: '(best quality, masterpiece, high detailed:1.2), (clay stop-motion animation:1.3), (plasticine character, handmade miniature set, rounded clay expression:1.18), (warm softbox light, tabletop shadow, gentle depth of field:1.1), visible fingerprints, soft clay dents, handmade imperfection, macro photography, tactile detail, frame-by-frame charm, high detail',
    negativePrompt: '(worst quality, low quality:1.4), fluid CGI animation, 2D anime, photorealistic human scale, smooth digital texture, bad anatomy, watermark, signature, text, glossy plastic, smooth CGI, realistic human skin',
    description: '粘土定格风格，强调橡皮泥质感、手工压痕和温暖小场景。',
    thumbnail: 'clay_stop_motion.png',
  },
  {
    id: 'lego_stop_motion',
    name: '积木定格动画',
    category: 'stop_motion',
    mediaType: 'stop-motion',
    prompt: '(best quality, masterpiece, high detailed:1.2), (brick toy stop-motion animation:1.3), (block figure, construction bricks, modular toy town, snapped-together props:1.18), (macro toy light, crisp shadow, colorful plastic reflection:1.1), hard plastic brick surface, molded studs, clean toy edges, macro photography, tactile detail, frame-by-frame charm, high detail',
    negativePrompt: '(worst quality, low quality:1.4), fluid CGI animation, 2D anime, photorealistic human scale, smooth digital texture, bad anatomy, watermark, signature, text, soft clay, melted curved shapes, realistic human body',
    description: '积木定格风格，强调塑料砖块、拼搭世界和玩具摄影感。',
    thumbnail: 'lego_stop_motion.png',
  },
  {
    id: 'felt_stop_motion',
    name: '毛绒定格动画',
    category: 'stop_motion',
    mediaType: 'stop-motion',
    prompt: '(best quality, masterpiece, high detailed:1.2), (needle-felt stop-motion animation:1.3), (wool character, fuzzy miniature prop, handmade craft environment:1.18), (warm diffuse light, soft fabric shadow, cozy atmosphere:1.1), visible wool fibers, felt texture, stitched handmade detail, macro photography, tactile detail, frame-by-frame charm, high detail',
    negativePrompt: '(worst quality, low quality:1.4), fluid CGI animation, 2D anime, photorealistic human scale, smooth digital texture, bad anatomy, watermark, signature, text, hard plastic, shiny metal, 2D anime, photorealistic human',
    description: '毛绒定格风格，强调羊毛毡纤维、柔软触感和手工温度。',
    thumbnail: 'felt_stop_motion.png',
  },
];

// ============================================================
// 导出
// ============================================================

/** 所有风格预设 */
export const VISUAL_STYLE_PRESETS: readonly StylePreset[] = [
  ...STYLES_3D,
  ...STYLES_2D,
  ...STYLES_REAL,
  ...STYLES_STOP_MOTION,
] as const;

// ============================================================
// 自定义风格查找回调（用户数据，存储在 localStorage）
// 通过回调避免常量文件直接依赖 zustand store
// ============================================================
let _customStyleLookup: ((id: string) => StylePreset | undefined) | null = null;

/**
 * 注册自定义风格查找函数（由 custom-style-store 调用）
 * 自定义风格是用户个人资产，不包含在内置预设中
 */
export function registerCustomStyleLookup(fn: (id: string) => StylePreset | undefined) {
  _customStyleLookup = fn;
}

/** 内部：先查内置，再查自定义 */
function _findStyle(styleId: string): StylePreset | undefined {
  return VISUAL_STYLE_PRESETS.find(s => s.id === styleId)
    || _customStyleLookup?.(styleId);
}

/** 分类信息 */
export const STYLE_CATEGORIES: { id: StyleCategory; name: string; styles: readonly StylePreset[] }[] = [
  { id: '3d', name: '3D风格', styles: STYLES_3D },
  { id: '2d', name: '2D动画', styles: STYLES_2D },
  { id: 'real', name: '真人风格', styles: STYLES_REAL },
  { id: 'stop_motion', name: '定格动画', styles: STYLES_STOP_MOTION },
];

/** 根据 ID 获取风格（内置 + 自定义） */
export function getStyleById(styleId: string): StylePreset | undefined {
  return _findStyle(styleId);
}

/** 获取风格的提示词（styleId 为空时返回空字符串，表示不施加风格） */
export function getStylePrompt(styleId: string | null | undefined): string {
  if (!styleId) return '';
  const style = _findStyle(styleId);
  return style?.prompt || '';
}

/** 获取风格的负面提示词 */
export function getStyleNegativePrompt(styleId: string | null | undefined): string {
  if (!styleId) return '';
  const style = _findStyle(styleId);
  return style?.negativePrompt || '';
}

/** 获取风格名称 */
export function getStyleName(styleId: string): string {
  const style = _findStyle(styleId);
  return style?.name || styleId;
}

/** 获取风格缩略图路径 */
export function getStyleThumbnail(styleId: string): string {
  const style = _findStyle(styleId);
  return style?.thumbnail || VISUAL_STYLE_PRESETS[0].thumbnail;
}

/** 
 * 兼容旧版：获取风格 tokens（拆分成数组）
 * @deprecated 建议直接使用 getStylePrompt
 */
export function getStyleTokens(styleId: string): string[] {
  const prompt = getStylePrompt(styleId);
  // 简单拆分主要关键词（去除权重标记）
  return prompt
    .replace(/\([^)]*:[0-9.]+\)/g, (match) => match.replace(/:[0-9.]+\)/, ')'))
    .split(',')
    .map(s => s.trim().replace(/^\(|\)$/g, ''))
    .filter(s => s.length > 0)
    .slice(0, 8);
}

/**
 * 根据分类获取风格列表
 * @param categoryId 分类 ID（支持旧版 'animation'/'realistic' 和新版）
 */
export function getStylesByCategory(categoryId: string): StylePreset[] {
  // 兼容旧版分类名称
  const categoryMap: Record<string, StyleCategory[]> = {
    'animation': ['3d', '2d', 'stop_motion'],
    'realistic': ['real'],
    '3d': ['3d'],
    '2d': ['2d'],
    'real': ['real'],
    'stop_motion': ['stop_motion'],
  };
  
  const targetCategories = categoryMap[categoryId] || [categoryId as StyleCategory];
  return VISUAL_STYLE_PRESETS.filter(s => targetCategories.includes(s.category));
}

/**
 * 获取风格描述
 * @param styleId 风格 ID
 */
export function getStyleDescription(styleId: string): string {
  const style = _findStyle(styleId);
  return style?.description || style?.name || styleId;
}

/**
 * 根据风格 ID 获取媒介类型
 * @returns 匹配的 MediaType，未找到时默认返回 'cinematic'（直通，最安全默认值）
 */
export function getMediaType(styleId: string | null | undefined): MediaType {
  if (!styleId) return 'cinematic';
  const style = _findStyle(styleId);
  return style?.mediaType ?? 'cinematic';
}

/** 媒介类型中文标签 */
export const MEDIA_TYPE_LABELS: Record<MediaType, string> = {
  'cinematic': '电影摄影',
  'animation': '动画运镜',
  'stop-motion': '定格微缩',
  'graphic': '图形色彩',
};

/** 风格 ID 类型 */
export type VisualStyleId = typeof VISUAL_STYLE_PRESETS[number]['id'] | "";

/** 默认风格 ID：空字符串表示新项目不预设视觉风格 */
export const DEFAULT_STYLE_ID: VisualStyleId = "";
