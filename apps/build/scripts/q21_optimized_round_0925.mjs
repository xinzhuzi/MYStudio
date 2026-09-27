#!/usr/bin/env node
/**
 * 0925 优化配置出图军令轮驱动——摘噪后真源,九型主档+三参考臂,新文件夹直交用户终审。
 *
 * 用法:node apps/build/scripts/q21_optimized_round_0925.mjs dry   # 干跑:构造12臂+真源逐字节断言,不碰引擎
 *      node apps/build/scripts/q21_optimized_round_0925.mjs queue # 实排:串行12拍→png+txt 落新文件夹
 *
 * 优化配置(0925 军令授权落盘,已落真源三处互锁):
 *   ③层否定式禁令三句下架(05 库常量A + 工作流 [40:110] + 生成器提取链 denoise_q21);
 *   好评配方=产线默认档:[30]加速开关关(KSampler 40步+MODEL直连,无 6步LoRA)
 *   + seed=0 + [141]PE关 + 文本经 [24]→[40:150](九型底座热读)→[40:110](常量A) 直写装配。
 *
 * 臂表(12 拍;基图=/tmp/q21-ablation-0925/api-{person,scene}.json 换摘噪常量A):
 *   主档九型  九型全 PE 开路(0926 裁定1·军令「必须经过PE优化」:多彩默认=PE 开路制,
 *            直写=按图选配——TYPES 单型 pe:false 即回直写臂,名后缀自动 _Normal直写)
 *            · 40步 Normal · seed=0 · [30]=false/[141]=true(PE 种子=「水墨国风修仙:」+该型主体句)
 *   参考·人物_Fast6    人物型 · 30=true(6步+viggle LoRA 联动,strength 0.8)·直写(对照臂,不随九型默认)
 *   参考·场景_Fast6    场景型 · 同上
 *   参考·场景_PE反噪C1_Fast6  场景型 · 141=true · 140.prompt=反噪前缀+场景主体句(pp1.5/seed42 现值)
 *
 * 0925 复拍轮增量(三案修法):
 *   人脸构图锚:6-高清人脸 subject 换探针验证句(§6 新真源,③层全身锁取景拉力→强构图锚);
 *   多彩②层:九型 base_text 经 bases.json 重提取自动携带多彩句(本脚本真源现读,零第三份常量);
 *   LoRA strength 0.8:[31] 一律注入 0.8(对齐三件工作流新真源;探针 flatMAD 2.52→1.75,-31%,
 *     GLM 判细腻无结构缺陷水墨保持);
 *   8步方案复盘标注:flatMAD 2.60 无收益+超荐档(v0.2.1 荐 6 步),**弃**——如实留痕,不复活;
 *   复拍验收=HSV 三指标(border mean_sat≥0.15/可辨彩≥25%/色相桶≥3)+GLM 亲验多彩背景+
 *     Fast 臂=GLM 可见噪点判定(2.0 阈不适用 Fast 档,0926 裁定「快但粗一档」,见 05 库§六;
 *     flatMAD 仍记账不作闸);逐型单变量对照用 ARMS 过滤(如 ARMS="2-场景,6-高清人脸")。
 *
 * 真源驱动:常量A/九型 base_text/主体句 每次运行从仓库现读(05库↔工作流↔bases.json 三处互锁,
 * 本脚本不再自带第三份常量);直写臂 [27] 装配全文 === 主体句\nbase_text\n常量A 逐字节断言。
 *
 * 0927 多视图+尺寸标注轮(军令①②):多视图型(旧名三视图)拆三视图臂 5-多视图_正/_侧/_背
 *   (一视图一张,同 seed 同身份锚跨张六同,base=多视图热读 3:4 Portrait 4.2MP);道具臂带尺寸标注串
 *   (军令②:市制/公制双标+引线版式,②层=C2-4 图纸尺寸标注式热读);验收=分张 GLM 判同一人+部件清单
 *   逐项在场、尺寸标注 GLM 读回文字与槽值逐字比对。
 * 0927d 透明翻案轮(用户三令最高:「透明必须由提示词声明产出(一段式原生 alpha),不许代码抠图——
 *   上轮两段式(PE+rembg)方向让位错误,退役为备选;上轮『必须经PE』与透明的冲突以本令为准(提示词
 *   透明优先,PE 能保则保)」):多视图三臂改一段式挂臂([40:144]=true 官方公式路+[40:143] 直塞纯英文
 *   公式短文(官方头尾逐字+共享英文身份句+逐张视图短语),三层中文装配/常量A/PE 全部不进采样,引擎直出
 *   RGBA 透明 PNG;PE 豁免如实记(探针定谳 probe-0927d:臂①三层装配 0% 真透明/臂②现接线 40:162 接直写链
 *   PE 根本进不了公式路/臂②′改接线 PE 长文 3.2% 边缘局部透明——生效文背景描述密度定生死,纯英文短公式文
 *   90.34%(C 臂复测口径,PIL alpha0=84.02%)唯一达标;与「必须经PE」军令冲突以翻案令为准,PE 此型保不住,
 *   其余八型 PE 开路制不动);rembg 两段式代码退役为备选(REMBG_TWO_STAGE=1 才启用,注释保留);
 *   ②层背景意志句随主路退役(原生透明档:背景句整体缺席,由 RGBA 官方公式承担;canon_lib+05库+
 *   qi21_bases.json 已同步)。
 * 产物纪律:~/Downloads/q21-optimized-0925/ 只写 <臂名>.png + <臂名>.txt,禁其他文件;
 *          日志/中间件全在 /tmp/q21-optimized-0925/。
 */
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";

const REPO = process.env.REPO_ROOT || "/Users/zhengbingjin/Project/Github/MYStudio";
const ENGINE = process.env.ENGINE_URL || "http://127.0.0.1:17000"; // 0927 现驻 17000(单引擎纪律:不启停,直用现驻;换驻地走 ENGINE_URL env)
const TMP = "/tmp/q21-optimized-0925";
const OUT_DIR = `${process.env.HOME}/Downloads/q21-optimized-0925`;
const LOG = `${TMP}/queue-log.jsonl`;
// 0927 多视图轮·透明底两段式第二段【0927d 退役为备选:REMBG_TWO_STAGE=1 才启用;主路=一段式
// 官方公式直塞,引擎直出 RGBA】:引擎 venv rembg(u2netp 起步,发丝/飘带不达标升
// isnet-general-use/alpha-matting——模型下载落 $HOME/.u2net 非引擎家;勘案 E 臂实证
// rembg 对水墨人物+画背景实抠四角全透/躯干 99.9% alpha>250,退役备选仍是最强透明产线留证);
// 引擎家零写(venv 只读调用)——备选复活须先②层重挂抠图档背景句(库级操作,见 05库§六 0927d 条)
const ENGINE_VENV_PY = `${process.env.HOME}/Library/Application Support/漫影工作室/comfyui/venv/bin/python`;

// 0926 裁定4(换 seed 重拍):SEED 环境变量缺省 0(首拍恒 0);非 0 时臂名后缀 _seedN(入文件名)
const SEED = parseInt(process.env.SEED || "0", 10);

const WF_PATH = `${REPO}/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json`;
const BASES_PATH = `${REPO}/apps/backend/engines/comfyui/my_nodes/nodes/qi21_bases.json`;
const LIB_PATH = `${REPO}/docs/prompts/Qwen-Image-2.1/05-道劫规范提示词库.md`;

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const md5 = (s) => createHash("md5").update(s, "utf8").digest("hex").slice(0, 8);

// ── 真源现读 ─────────────────────────────────────────────────────
function readSources() {
  // ① 工作流 [40:110] 常量A(子图 definitions.subgraphs 内 id=110)
  const wf = JSON.parse(readFileSync(WF_PATH, "utf8"));
  const sgNodes = wf.definitions?.subgraphs?.[0]?.nodes || [];
  const n110 = sgNodes.find((n) => n.id === 110);
  if (!n110) throw new Error("工作流子图内找不到 [40:110] 常量A 节点");
  const constA = n110.widgets_values[0];
  if (constA.includes("揉皱纸纹")) throw new Error("常量A 仍含禁令句『揉皱纸纹』——真源未摘噪,中止");
  // ② 05 库常量A 围栏(互锁对拍)
  const lib = readFileSync(LIB_PATH, "utf8");
  const m = lib.match(/\*\*常量 A·基础[^`]*```text\n([\s\S]*?)\n```/);
  if (!m || m[1] !== constA) throw new Error("05 库常量A ≠ 工作流常量A——三处互锁破裂,中止");
  // ③ bases.json 九型 base_text(=MyQi21DaojieBase 热读内容;引擎家与仓库一致已核)
  const bases = JSON.parse(readFileSync(BASES_PATH, "utf8"));
  const byName = Object.fromEntries(bases.map((e) => [e.zh, e]));
  return { constA, bases, byName };
}

// ── 九型主体句(逐字=道劫_九型主体句示例 §1-§9 现行真源;人物/三视图为武器修版,
//    分镜=0925 修复轮主角分镜重写:§5 主角身份段原样搬运+玄色/墨青/朱红色相锚;
//    0926 五修轮:§4 美宣+发锚/§6 人脸四段锚/§8 表情差分重组,三处同步真源;
//    0926 色相锚轮:§1/§3/§5/§6/§8/§9 六句加背景/光源/点缀色相锚(机制=①层色相
//    锚密度决定多彩增益,PE seed42 同句同改写文),§9 兼概念再平衡(褪青蓝/压沉/
//    暖金朱红双色/受控中等饱和),四处逐字互锁=示例库/canon_lib SUBJECTS/05库/本表;
//    0927 饱和锚+反稀释轮(5/6/8/9 四型重做):A 四型同=句尾预置正向色彩总结句
//    「全图多色相并陈，暖调中等饱和」(占 PE 自加 cool/desaturated 总结句的落点位);
//    B §5 背景淡彩升饱和锚(青绿近景+赭石山道+旧金夕光,对标 §3 过关配方);
//    C §6 光源锚升饱和(暖金顶光铺满+暖赭光影+青灰远山一角);D §8 灰底升青灰底色
//    +暖金光自左上+朱红缨点缀(逐格一致并入衣色锁句式);E §9 粒尘辉光聚于殿群与
//    灵光带+山间平涂区保持干净平滑(治 flatMAD 2.55,多彩并陈句保留);身份锚/发锚/
//    部件清单/衣色锁逐字不动,四处逐字互锁同上;
//    0927 二轮(一轮重拍取证→6/8/9 最小修正,5 号三关全过 0.3185/7分4色相/5.69 冻结):
//    6 号 flatMAD 1.48→3.67=一轮新锚纹理代价(山形轮廓+cloud-like textures 云雾+
//    amber rays 满幅光洗入平涂区)→「暖金顶光的光晕只落在发际与肩线」+「青灰远山
//    剪影淡入薄雾」两处形态收窄(「无云纹」按 N7 零否定式丢弃);8 号 GLM 1/4 发素净
//    +flat 3.47=青灰底天花板重现(GLM 判统一淡灰调,haze/brush 抬残差)→背景弃灰底
//    改 5 号同款实物饱和锚「赭石色山壁九格同」;9 号 borderSAT 0.5251 破 0.44 上限=
//    反稀释句起效过度(句尾「暖调」盖中段「受控」,夜空推成 deep navy-blue)→句尾回调
//    「全色相并陈，受控中等饱和」与中段一致;色相锚/衣色锁/粒尘聚拢句全不动,四处
//    逐字互锁同上;
//    0927 构图底座轮(军令「构图方式固化为几款定式写进底座」):§3 道具/§5 三视图主体句
//    重写为通用模板——视图/构图语言全部上收②层构图底座(三视图挂 C1-2 特写+三向四格式,
//    道具挂 C2-1 三向平视+细节特写四格式;挂载句随 qi21_bases.json 热读,本脚本 base 现读
//    自动携带),主体句只留身份四件套+配器部件清单+特写格放大点+底色色彩锚(5 号三关全过
//    冻结配方逐字保留);六格款退役,验收改恰 4 格;四处逐字互锁同上──
// 0926 裁定1(PE 开路制,军令「必须经过PE优化」):九型臂默认 pe=true(PE 开路·40步·
// PE 种子句=前缀+该型主体句);直写臂=按图选配(把该型 pe 改 false 即回直写,名后缀
// 自动 _Normal直写)。证据=0925 直写批拍多彩三层全改仍 borderSAT 0.099<0.15 阈,PE 版
// 色锚句 0.138-0.442。画布层默认同翻 true(0926 裁定1 含画布本体:三生成器
// [141]/[15] 开关默认 true=PE 开路,关=直写按图选配;本表九型臂 pe:true 与画布默认一致)。
const TYPES = [
  { idx: 1, name: "人物", kind: "person", sig: "她立于山门石阶最上一级", pe: true,
    subject: "一位筑基后期的年轻女修，青玉色道袍束月白腰带，长发半束只簪一支素银簪，眉目沉静中带一点锋芒；她立于山门石阶最上一级，腰侧石青剑绦悬一柄长剑，乌木剑鞘、白玉剑格、剑柄缠灰银丝、鞘口垂暗红剑穗，剑身完整收在鞘中，右手轻按剑柄，视线越过阶下青灰云海望向远处，旧金色晨光自左侧斜照，衣袂被山风微微掀起。" },
  { idx: 2, name: "场景", kind: "scene", sig: "九根断裂的石柱围成半圆", pe: true,
    subject: "暮春时节的黄昏，废弃的上古祭坛深藏在群山环抱的谷底，九根断裂的石柱围成半圆，坛心一泓浅潭映出残阳；谷口白雾正缓缓漫入，远山三重叠影渐次淡去。" },
  { idx: 3, name: "道具", kind: "scene", sig: "一柄传承千年的青铜剑", pe: true,
    subject: "一柄传承千年的青铜剑，剑身暗金底色上盘绕细密云雷纹，剑格铸成兽首衔环，剑柄缠深红丝绳，穗尾垂一枚带裂纹的灵玉；上引线旁以端正的墨色小字注“全长110厘米（三尺三寸）”，靠剑格一端的引线旁注“刃长88厘米（二尺六寸）”，柄端引线旁注“柄长22厘米（七寸）”，字迹清晰可辨。" },
  { idx: 4, name: "美宣", kind: "scene", sig: "雷劫降临的至暗时刻", pe: true,
    subject: "雷劫降临的至暗时刻，白衣剑修独立孤峰之巅，长发高束马尾，束发紧实，腰束石青丝绦、暗红剑穗，周身剑气化作金色光罩，九道紫雷自翻墨般的劫云中劈落，他在最后一瞬反身拔剑迎击，衣袍与剑穗在罡风中猎猎狂舞；远景群山在雷光明灭中沉浮。" },
  // 0927d 透明翻案:多视图型 pe:false=PE 豁免(与「必须经PE」军令冲突以三令翻案为准——提示词透明
  // 优先,PE 此型保不住:臂②现接线 PE 进不了公式路+臂②′改接线 PE 长文钉实底双证;探针定谳
  // probe-0927d);该型唯一交付路=一段式透明(rgbaForm 直塞,见 splitViews 分支),名后缀 _一段式透明
  { idx: 5, name: "多视图", kind: "person", sig: "青年刀修", pe: false, splitViews: true,
    subject: "青年刀修玄色劲装束袖束腰，长发高束马尾，腰侧黑革刀带悬一柄短刀，黑鲨皮鞘、黄铜刀格、缠灰绳刀柄，刀身完整收在鞘中；画面为正面全身像，人物正身正对观者站立。" },
  { idx: 6, name: "高清人脸", kind: "scene", sig: "几缕碎发垂在颊边", pe: true,
    subject: "一位筑基后期的年轻女修面容特写：眉目沉静中带一点锋芒，长发半束只簪一支素银簪，几缕碎发垂在颊边；画面为正脸面朝摄像机的特写照——人物直视镜头，五官完整正对观者、左右对称呈现，视线落进镜头；头顶至肩线构图，双肩水平入画，画面下缘止于肩线，头部占画面大半；肩线以上，不见腰部以下，神情沉静，暖金顶光的光晕只落在发际与肩线，面部呈暖赭光影，背景一角青灰远山剪影淡入薄雾，全图多色相并陈，暖调中等饱和。" },
  { idx: 7, name: "分镜剧情图", kind: "scene", sig: "青年刀修玄色劲装束袖束腰", pe: true,
    subject: "山雨欲来的渡口，青年刀修玄色劲装束袖束腰，长发高束马尾，腰侧黑革刀带悬一柄短刀，黑鲨皮鞘、黄铜刀格、缠灰绳刀柄，刀身完整收在鞘中，第一次背起行囊离乡；老船工收篙回望，江天压满墨青雨云，渡口一盏朱红灯笼是画面唯一的暖色，两人的目光都投向江雾深处若隐若现的仙山轮廓。" },
  { idx: 8, name: "表情差分", kind: "scene", sig: "九宫格表情差分", pe: true,
    subject: "青年刀修玄色劲装束袖束腰，长发高束马尾，腰侧黑革刀带悬一柄短刀，黑鲨皮鞘、黄铜刀格、缠灰绳刀柄，刀身完整收在鞘中；同一位青年刀修的九宫格表情差分，玄色劲装束袖束腰、黑革刀带、长发高束马尾九格逐格一致，九格仅面部表情不同，服饰发型姿态完全一致，背景九格同为赭石色山壁、光源九格同为暖金光自左上，朱红缨九格同缀于画面一角；九格情绪与五官状态——沉静：双目平和微垂、眉舒展、唇线平直；含笑：眼角弯起、嘴角上扬轻抿、眉梢微挑；怒：剑眉倒竖、怒目圆睁、牙关紧咬嘴角下压；哀：眉梢下垂呈八字、眼睑低垂含泪光、嘴角下弯；惧：眉毛高挑向眉心收拢、双眼圆睁、唇微张发颤；凌厉：双眼眯起、眉峰锐利下压、嘴角紧抿；惊讶：眉毛高高挑起、双眼睁大、唇微张成小圆；害羞：双颊染红晕、眼帘低垂、嘴角含羞轻抿；决然：目光坚定直视、眉宇紧锁、嘴角平直；各格头部角度与光源方向保持一致，全图多色相并陈，暖调中等饱和。" },
  { idx: 9, name: "概念气氛图", kind: "scene", sig: "灵潮涨落之夜", pe: true,
    subject: "千年一次的灵潮涨落之夜，悬浮的碎裂古殿群沐浴在夜色与灵光中，殿瓦飞檐敷压沉一档的青蓝色、檐角悬旧金铃铎，万千萤火状灵尘随气流缓缓升腾，暖金与朱红双色的灵光染亮殿群四周的夜雾，粒尘辉光聚于殿群与灵光带，山间平涂区保持干净平滑，全图多色相并陈、受控中等饱和；画面九成留给静谧的夜与雾，只余殿群一角与一株横生孤松的剪影，全色相并陈，受控中等饱和。" },
];

// C1 反噪种子句(逐字=上轮 C1_SEED:反噪前缀+场景型主体句)
const C1_SEED = "水墨国风修仙,画面干净平滑,墨与色落在浅净平涂色场上,而非纸面纹理:" + TYPES[1].subject;

// PE 种子前缀(0926 终效轮对齐:反噪前缀逐字=三生成器 PE_SEED_PROMPT 头=工作流 [140] 默认头=
// 05 库 §六「PE 种子句=风格前缀+主体句」;禁裸「水墨国风修仙:」前缀直发——九拍 PE 文的
// 纹理语全部溯源到裸前缀,生成器明令「驱动脚本与人工发拍同守此纪律」;裸前缀 PE 图两代
// (1-人物_PE开路 0926a/5、7 号上轮)已留证 reject-0926a 与留用盘)
const PE_SEED_PREFIX = "水墨国风修仙,画面干净平滑,墨与色落在浅净平涂色场上,而非纸面纹理:";

// ── 0927 多视图轮·分张产线(军令①:一视图一张+背景透明只要人物+提示词必须经 PE)─────
// 身份段(逐字=示例库 §5 现行真源=第一章节主角身份段原样搬运纪律(09-25 立);
// 跨张六同之①:三视图臂共用逐字同源身份段)
const MV_IDENTITY = "青年刀修玄色劲装束袖束腰，长发高束马尾，腰侧黑革刀带悬一柄短刀，黑鲨皮鞘、黄铜刀格、缠灰绳刀柄，刀身完整收在鞘中";
// 视图句字典(逐字=示例库 §5;逐张换、单变量)
const MV_VIEWS = {
  "正": "画面为正面全身像，人物正身正对观者站立",
  "侧": "画面为正九十度纯侧面全身像，纯侧面轮廓完整呈现",
  "背": "画面为背面全身像，人物背对观者站立",
};
// 背景意志句·抠图档【0927d 退役为 rembg 备选档留档:主路(一段式官方公式)不再引用;②层挂载句
// 已随 0927d 翻案切原生透明档=背景句整体缺席(canon_lib/05库/qi21_bases.json 已同步);
// 启用两段式备选(REMBG_TWO_STAGE=1)时须先重挂②层抠图档句(库级操作)再并入种子句】
const BG_WILL_CUTOUT = "纯浅净一色背景，无环境物象";

// ── 0927d 透明翻案·一段式原生 alpha 主路(用户三令最高:「透明必须由提示词声明产出(一段式
//    原生 alpha),不许代码抠图」;探针定谳 probe-0927d:唯一达标形态=C 臂式纯英文公式短文直塞
//    (90.34% 真透明,C 臂本机复测口径;引擎产物 PIL 实测 alpha0=84.02% 四角全 0),叠三层中文
//    装配=0%(臂①②层背景意志句+常量A 压过官方头尾)、PE 长文=3.2%(臂②′改接线)——生效文背景
//    描述密度定生死,故英文主体句也零背景词;PE 豁免如实记:与「必须经PE」军令冲突以翻案令为准
//    (提示词透明优先,PE 此型保不住);rembg 两段式退役为备选(REMBG_TWO_STAGE=1)──
// 官方公式头尾(逐字=仓库三件工作流真源 [40:160]/[40:161])
const RGBA_HEAD_EN = "This is an RGBA format image with transparency.";
const RGBA_TAIL_EN = "The image has an alpha channel and a transparent background.";
// 共享英文身份句(C 臂同构(引擎 history 00698722 实读逐字结构):身份+马尾+玄色劲装+腰间短刀+
// 站姿+画风,零背景词零地面词——背景描述密度铁律;跨张六同之③'=三臂共享此句逐字同)
const MV_BODY_SHARED_EN =
  "A single young Chinese knife master standing full-body figure, hair in a high ponytail, " +
  "fitted black martial outfit, a short knife in a black sheath hanging at his waist, " +
  "arms relaxed at his sides, ink-wash illustration style, clean thin outlines";
// 视图短语字典(逐张换、单变量)
const MV_VIEWS_EN = {
  "正": "front view, body facing the viewer straight-on",
  "侧": "exact 90-degree side profile view",
  "背": "back view, body facing away from the viewer",
};
// 公式直塞文=[40:143].prompt 字面量(断开 [40:163] 拼接链,采样文即此全文,引擎直出 RGBA)
const mvFormulaText = (vkey) =>
  `${RGBA_HEAD_EN} ${MV_BODY_SHARED_EN}, ${MV_VIEWS_EN[vkey]}. ${RGBA_TAIL_EN}`;

// ── 臂构造 ──────────────────────────────────────────────────────
function loadBase(kind) {
  const p = `/tmp/q21-ablation-0925/api-${kind === "person" ? "person" : "scene"}.json`;
  const d = JSON.parse(readFileSync(p, "utf8"));
  return d;
}
function makeArm(src, { name, kind, base, subject, fast = false, peOn = false, seedPrompt = null, cutout = false, rgbaForm = null }) {
  const d = loadBase(kind);
  d["40:110"].inputs.string = src.constA;    // 旧基图常量A(带禁令)→ 摘噪版真源注入
  d["7"].inputs.seed = SEED;                 // 首拍 seed=0(军令);0926 裁定4:不过关换 seed 重拍(SEED env,非 0 时入臂名)
  d["31"].inputs.strength_model = 0.8;       // 0925 探针最优:基图旧值 1.0→0.8(=三件工作流新真源)
  d["30"].inputs.value = fast;               // [30] 一拨:关=40步MODEL直连 / 开=6步+viggle LoRA(0.8)
  d["40:150"].inputs.base = base;            // 九选一底座(BASE+WIDTH/HEIGHT 随型热读直出)
  d["24"].inputs.value = subject;            // ①层主体句槽(透明臂下=图内留档,不进采样——143 直塞绕开装配链)
  d["9"].inputs.filename_prefix = `optimized-0925/${name}`;
  if (rgbaForm) {
    // 0927d 一段式原生 alpha:官方公式路开+143 直塞纯英文公式短文(断开 163 拼接链,采样文即
    // 直塞文全文)+PE 豁免([141]=false)——引擎直出 RGBA 透明 PNG,零代码抠图(三令翻案主路)
    d["40:144"].inputs.switch = true;        // RGBA 透明开关开(false=普通/true=官方公式路)
    d["40:143"].inputs.prompt = rgbaForm;    // 直塞字面量(基图原接 ["40:163",0] 拼接链就此绕开)
    d["40:160"].inputs.string = RGBA_HEAD_EN; // 基图旧措辞→真源逐字(留档一致;直塞路不进采样)
    d["40:161"].inputs.string = RGBA_TAIL_EN;
    d["141"].inputs.switch = false;          // PE 豁免(军令冲突如实记,翻案令:提示词透明优先)
  } else if (peOn) {
    d["141"].inputs.switch = true;           // PE 开路
    d["140"].inputs.prompt = seedPrompt;     // pp=1.5/seed42 等维持引擎现值(图内字面)
  } else {
    d["141"].inputs.switch = false;          // 直写装配
  }
  return { name, kind, base, subject, fast, peOn, seedPrompt, cutout, rgbaForm, graph: d };
}

function buildArms(src) {
  const arms = [];
  for (const t of TYPES) {
    // 0926 裁定1(PE 开路制):九型默认全 PE 开路——直写批拍多彩三层全改仍 borderSAT 0.099
    // < 0.15 阈(0925 复拍单变量验证:5多视图/7分镜 mean_sat 0.0488/0.0807 vs 0924 参照
    // 0.1488/0.1607,文本逐字=新真源),PE 版色锚句 0.138-0.442,证直写路径回色必须 PE
    // 改写器色锚增益;直写档坏图两代留证 reject-0925b。直写=按图选配(该型 pe:false)。
    if (t.splitViews) {
      // 0927d 透明翻案·一段式原生 alpha:一视图一张=引擎直出 RGBA 透明 PNG([40:144]=true 官方
      // 公式路+[40:143] 直塞纯英文公式短文+PE 豁免;三层中文装配/常量A 不进采样,零代码抠图——
      // 三令「透明必须由提示词声明产出」;两段式 rembg 退役为备选,仅 REMBG_TWO_STAGE=1 才走且须
      // 先重挂②层抠图档句)。跨张六同:①身份段逐字同源(英文公式文共享 MV_BODY_SHARED_EN 逐字同)
      // ②同 seed ③同公式文结构(官方头+共享身份句+逐张视图短语+官方尾,只换视图短语单变量)
      // ④同②层款(base=多视图热读 3:4 Portrait 4.2MP)⑤同画幅分辨率⑥同 LoRA/步数档(40步)。
      for (const vkey of Object.keys(MV_VIEWS)) {
        const subject = `${MV_IDENTITY}；${MV_VIEWS[vkey]}。`;
        arms.push(makeArm(src, {
          name: `${t.idx}-${t.name}_${vkey}_一段式透明${SEED ? `_seed${SEED}` : ""}`,
          kind: t.kind, base: t.name, subject, fast: false, peOn: false,
          rgbaForm: mvFormulaText(vkey),
          cutout: process.env.REMBG_TWO_STAGE === "1",
        }));
      }
      continue;
    }
    arms.push(makeArm(src, {
      name: `${t.idx}-${t.name}_${t.pe ? "PE开路" : "Normal直写"}${SEED ? `_seed${SEED}` : ""}`, kind: t.kind, base: t.name,
      subject: t.subject, fast: false, peOn: !!t.pe,
      seedPrompt: t.pe ? PE_SEED_PREFIX + t.subject : null,
    }));
  }
  arms.push(makeArm(src, { name: `参考-人物_Fast6加速`, kind: "person", base: "人物", subject: TYPES[0].subject, fast: true }));
  arms.push(makeArm(src, { name: `参考-场景_Fast6加速`, kind: "scene", base: "场景", subject: TYPES[1].subject, fast: true }));
  arms.push(makeArm(src, { name: `参考-场景_PE反噪C1_Fast6`, kind: "scene", base: "场景", subject: TYPES[1].subject, fast: true, peOn: true, seedPrompt: C1_SEED }));
  // 复拍臂过滤(0925 修复轮加):ARMS="5-多视图_正,3-道具" 只跑名前缀命中臂;缺省=全 14 臂
  // (0927 多视图轮:5 号拆三视图臂 5-多视图_正/_侧/_背,臂名含视图字)
  const only = (process.env.ARMS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return only.length ? arms.filter((a) => only.some((p) => a.name.startsWith(p))) : arms;
}

// ── 干跑断言(不碰引擎)─────────────────────────────────────────
function dryCheck(arms, src) {
  let fail = 0;
  const check = (cond, msg) => { if (!cond) { fail++; console.error("  ✗ " + msg); } };
  console.log(`常量A(摘噪版) ${src.constA.length} 字符 md5=${md5(src.constA)} | 九型 base_text 就绪 ${Object.keys(src.byName).length} 型`);
  // 0927d 透明翻案互锁:②层背景句随一段式主路退役(原生透明档=背景句整体缺席,由 RGBA 官方公式
  // 承担;旧抠图档句只在 rembg 备选档留档)——base_text 不得再含抠图档句
  check(src.byName["多视图"] && !src.byName["多视图"].base_text.includes(BG_WILL_CUTOUT),
    "多视图②层仍含抠图档背景意志句——C1-4 应已对齐原生透明档(背景句缺席),先重跑 canon_lib+qi21_bases_extract");
  check(`${MV_IDENTITY}；${MV_VIEWS["正"]}。` === TYPES[4].subject,
    "多视图例一 ≠ 身份段+正视图句拼装(四处互锁:示例库§5/SUBJECTS/05库/TYPES)");
  for (const [vk, vs] of Object.entries(MV_VIEWS))
    check(TYPES[4].subject.includes(vs) || vk !== "正", `视图句[${vk}] 未落位`);
  for (const a of arms) {
    const expected = a.subject + "\n" + src.byName[a.base].base_text + "\n" + src.constA;
    const got = a.graph["24"].inputs.value + "\n" + src.byName[a.base].base_text + "\n" + a.graph["40:110"].inputs.string;
    const constInjected = a.graph["40:110"].inputs.string === src.constA;
    check(constInjected, `${a.name}: 基图常量A 未换摘噪版`);
    check(!a.graph["40:110"].inputs.string.includes("揉皱纸纹"), `${a.name}: 常量A 残留禁令句`);
    if (!a.peOn) check(a.graph["141"].inputs.switch === false, `${a.name}: [141] 应为直写(false)`);
    else check(a.graph["141"].inputs.switch === true && a.graph["140"].inputs.prompt === a.seedPrompt, `${a.name}: PE 臂种子句不符`);
    if (a.rgbaForm) {
      // 0927d 一段式透明臂互锁:官方公式路开+143 直塞文逐字+头尾句真源逐字+PE 豁免
      check(a.graph["40:144"].inputs.switch === true, `${a.name}: [40:144] 应为 true(RGBA 官方公式路)`);
      check(a.graph["40:143"].inputs.prompt === a.rgbaForm, `${a.name}: [40:143] 直塞文不符`);
      check(a.graph["40:160"].inputs.string === RGBA_HEAD_EN && a.graph["40:161"].inputs.string === RGBA_TAIL_EN,
        `${a.name}: [40:160]/[40:161] 应为仓库真源逐字`);
      check(a.graph["141"].inputs.switch === false, `${a.name}: 一段式透明主路 PE 应豁免([141]=false)`);
      console.log(`✓ ${a.name} | 一段式透明:直塞文 ${a.rgbaForm.length}字 md5=${md5(a.rgbaForm)}(PE 豁免·装配/常量A 不进采样·rembg 备选)`);
    }
    check(a.graph["7"].inputs.seed === SEED, `${a.name}: seed 应为 ${SEED}`);
    check(a.graph["31"].inputs.strength_model === 0.8, `${a.name}: [31] LoRA strength 应为 0.8(0925 探针新真源)`);
    check(a.graph["30"].inputs.value === a.fast, `${a.name}: [30] 开关态不符`);
    check(a.graph["40:150"].inputs.base === a.base, `${a.name}: base 不符`);
    if (!a.peOn) console.log(`✓ ${a.name} | steps=${a.fast ? 6 : 40}(${a.fast ? "LoRA" : "MODEL直连"}) 装配全文=${expected.length}字 md5=${md5(got)} 预期逐字一致=${got === expected}`);
  }
  console.log(fail ? `干跑 ${fail} 项红` : `干跑全绿(${arms.length} 臂构造+真源断言)`);
  return fail === 0;
}

// ── 引擎直排(queue)────────────────────────────────────────────
async function postPrompt(arm) {
  const cid = randomUUID();
  const r = await fetch(`${ENGINE}/prompt`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: arm.graph, client_id: cid }),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.prompt_id) throw new Error(`排队失败 ${arm.name}: ${JSON.stringify(j).slice(0, 300)}`);
  return j.prompt_id;
}
async function waitHistory(pid, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const h = await (await fetch(`${ENGINE}/history/${pid}`)).json();
      const e = h[pid];
      if (e) {
        const st = e.status?.status_str || "";
        if (st === "error") return { error: `execution_error: ${JSON.stringify(e.status?.messages || []).slice(0, 1200)}` };
        const imgs = [];
        for (const o of Object.values(e.outputs || {})) if (o.images) imgs.push(...o.images);
        let text27 = null;
        const t = e.outputs?.["27"]?.text;
        if (Array.isArray(t) && t.length) text27 = String(t[t.length - 1]);
        if (imgs.length) return { imgs, text27, status: st, secs: Math.round((Date.now() - t0) / 1000) };
        if (st === "success" && !imgs.length) {
          const msgs = JSON.stringify(e.status?.messages || []);
          const vErr = /Failed to validate prompt[^\]]*/.exec(msgs);
          return { error: `success 无图:${vErr ? vErr[0].slice(0, 300) : msgs.slice(0, 300)}` };
        }
      }
    } catch { /* transient */ }
    await sleep(4000);
  }
  return { error: `history 超时 ${timeoutMs / 1000}s` };
}
async function fetchView(img) {
  const q = `filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || "")}&type=${encodeURIComponent(img.type || "output")}`;
  const r = await fetch(`${ENGINE}/view?${q}`);
  if (!r.ok) throw new Error(`/view ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}
const pngMagic = (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const pngDim = (b) => ({ w: b.readUInt32BE(16), h: b.readUInt32BE(20) });

async function runArm(arm, src, timeoutMs) {
  const steps = arm.fast ? 6 : 40;
  log(`── 排队 ${arm.name} (${steps}步·${arm.fast ? "LoRA" : "MODEL直连"}·${arm.rgbaForm ? "一段式透明·PE豁免" : arm.peOn ? "PE开路" : "直写装配"}·base=${arm.base})`);
  const t0 = Date.now();
  const pid = await postPrompt(arm);
  const res = await waitHistory(pid, timeoutMs);
  const rec = { name: arm.name, pid, steps, base: arm.base, pe: arm.peOn, wallSec: Math.round((Date.now() - t0) / 1000) };
  if (res.error) {
    rec.ok = false; rec.error = res.error;
    log(`✗ ${arm.name}: ${res.error.slice(0, 260)}`);
    appendFileSync(LOG, JSON.stringify(rec) + "\n");
    return rec;
  }
  const saveImg = res.imgs.find((i) => (i.type || "output") === "output" && /\.png$/i.test(i.filename)) || res.imgs[0];
  const buf = await fetchView(saveImg);
  const ok = pngMagic(buf) && buf.length > 50_000;
  const dim = pngDim(buf);
  writeFileSync(join(OUT_DIR, `${arm.name}.png`), buf); // 0927d 一段式:png 本体即引擎直出 RGBA(零代码抠图)
  const effText = res.text27 || "(未捕获)";
  // 对账:直写臂 [27] 装配全文 === 主体句\nbase_text\n常量A(逐字节);一段式透明臂的 [27] 显示的是
  // 被旁路的装配文(非采样文),txt 改记 [40:143] 直塞文=真生效文
  let textVerdict;
  if (arm.rgbaForm) {
    const outText = `0927d 一段式透明([40:144]=true·[40:143] 直塞纯英文公式短文·PE 豁免·三层中文装配/常量A 不进采样)\n生效文:\n${arm.rgbaForm}\n(参考:被旁路的 [27] 显示装配文 ${effText.length}字 md5=${md5(effText)})`;
    writeFileSync(join(OUT_DIR, `${arm.name}.txt`), outText);
    textVerdict = { kind: "rgba-direct", len: arm.rgbaForm.length, md5: md5(arm.rgbaForm), bypass27Md5: md5(effText) };
  } else {
    writeFileSync(join(OUT_DIR, `${arm.name}.txt`), effText);
    if (arm.peOn) {
      textVerdict = { kind: "pe-out", len: effText.length, md5: md5(effText), cnHead: effText.slice(0, 40) };
    } else {
      const expected = arm.subject + "\n" + src.byName[arm.base].base_text + "\n" + src.constA;
      textVerdict = { kind: "direct", len: effText.length, md5: md5(effText), expectMd5: md5(expected), equal: effText === expected };
    }
  }
  rec.ok = ok; rec.bytes = buf.length; rec.dim = dim; rec.engineFile = saveImg.filename;
  rec.text = textVerdict; rec.status = res.status;
  if (ok && arm.cutout) {
    // 0927d 退役备选:rembg 两段式第二段(仅 REMBG_TWO_STAGE=1 启用且须先重挂②层抠图档句;
    // 主路=一段式官方公式引擎直出 RGBA,零代码抠图——三令翻案;四角全透/躯干 99.9% 实证留档)
    try {
      const r = rembgCutout(join(OUT_DIR, `${arm.name}.png`), join(OUT_DIR, `${arm.name}_透明.png`));
      rec.cutout = r; log(`✓ ${arm.name} rembg 两段式: ${r.cornerAlpha === 0 ? "四角全透✓" : `四角 alpha=${r.cornerAlpha}⚠`} | 不透明${r.opaquePct.toFixed(1)}% 半透明${r.semiPct.toFixed(1)}% → ${arm.name}_透明.png`);
    } catch (e) { rec.cutout = { error: String(e.message || e) }; log(`✗ ${arm.name} rembg 失败: ${e.message}`); }
  }
  log(`✓ ${arm.name} ${(buf.length / 1024 / 1024).toFixed(1)}MB ${dim.w}×${dim.h} ${res.secs}s 生效文本${textVerdict.len}字${textVerdict.equal === false ? " ⚠逐字比对不符" : ""}`);
  appendFileSync(LOG, JSON.stringify(rec) + "\n");
  return rec;
}

// ── rembg 两段式(0927 多视图轮):引擎 venv 只读调用,u2netp 模型已缓存 $HOME/.u2net ──
const REBG_PY = [
  "import sys, json",
  "from rembg import remove, new_session",
  "from PIL import Image",
  "ses = new_session('u2netp')",
  "im = Image.open(sys.argv[1]).convert('RGBA')",
  "out = remove(im, session=ses)",
  "out.save(sys.argv[2])",
  "a = out.getchannel('A')",
  "px = list(a.getdata()); n = len(px)",
  "corners = [out.getpixel((0,0))[3], out.getpixel((out.width-1,0))[3], out.getpixel((0,out.height-1))[3], out.getpixel((out.width-1,out.height-1))[3]]",
  "print(json.dumps({'cornerAlpha': min(corners), 'opaquePct': 100.0*sum(1 for v in px if v>250)/n, 'semiPct': 100.0*sum(1 for v in px if 0<v<=250)/n}))",
].join("\n");
import { spawnSync } from "node:child_process";
function rembgCutout(inPng, outPng) {
  const r = spawnSync(ENGINE_VENV_PY, ["-c", REBG_PY, inPng, outPng], { encoding: "utf8", timeout: 300_000 });
  if (r.status !== 0) throw new Error(`venv rembg 退出 ${r.status}: ${String(r.stderr).slice(0, 200)}`);
  return JSON.parse(r.stdout.trim().split("\n").pop());
}

async function main() {
  const mode = process.argv[2] || "dry";
  mkdirSync(TMP, { recursive: true });
  const src = readSources();
  const arms = buildArms(src);
  if (mode === "dry") { process.exit(dryCheck(arms, src) ? 0 : 1); }

  mkdirSync(OUT_DIR, { recursive: true });
  const alive = await (await fetch(`${ENGINE}/system_stats`, { signal: AbortSignal.timeout(8000) })).json();
  log("引擎就绪:", alive.system?.comfyui_version, "| 单引擎纪律:本轮不启停引擎,直用 17000 现驻进程");

  const T_SLOW = 2400_000, T_FAST = 900_000, T_PE = 1200_000, T_PE_SLOW = 3000_000;
  const results = [];
  for (const a of arms) {
    const to = a.peOn ? (a.fast ? T_PE : T_PE_SLOW) : (a.fast ? T_FAST : T_SLOW);
    results.push(await runArm(a, src, to));
  }
  const bad = results.filter((r) => !r.ok).map((r) => r.name);
  log(`════ 完成:${results.length} 拍,失败 ${bad.length}${bad.length ? ":" + bad.join(",") : ""} ════`);
  process.exit(bad.length ? 1 : 0);
}
main().catch((e) => { console.error("驱动失败:", e.message); process.exit(1); });
