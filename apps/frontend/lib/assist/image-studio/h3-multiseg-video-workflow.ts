// multiseg(一镜到底-分段)API 档组装器(1123 D17 自 h3-shot-video-workflow.ts 拆出;PRD 10-27 §14.1.4)。
// h3-shot-video-workflow.ts 再导出 buildShotH3MultisegApiWorkflow,调用方导入路径不变。
import multisegTemplateJson from "./h3-multiseg-template.json";
import multisegApiTemplateJson from "./h3-multiseg-template.api.json";
import { buildShotH3MultisegPrompt } from "./h3-shot-prompt";
import type { ShotH3ApiWorkflowInput, ShotH3ApiWorkflowResult } from "./h3-shot-video-workflow";
import {
  type ApiGraph,
  type H3WorkflowTemplate,
  assertPlannedTextVerbatimGate,
  getApiNode,
  getNode,
  safeImageId,
  setFirstWidget,
  setNamedWidget,
  shotLabel,
} from "./h3-workflow-shared";

/** multiseg 档位映射(§14.1.4 M5):960×544=模板原厂值,禁擅改比例;不与 i2v-31 的
 *  1344×768 共用——turbo LoRA 名义 768p,960×544 失配属画质问题非正确性问题,实弹判读后候令对齐。 */
const MULTISEG_RESOLUTION_TIERS: Record<"960p", readonly [number, number]> = { "960p": [960, 544] };
/** multiseg 记账界面图完整性锚(App 专用四针;1123 D17 起界面图=画布件全图+App 专用三节点,
 *  生成器 build/scripts/multiseg_ui_template_build.py;1027 的 --preset multiseg 已废)。 */
const MULTISEG_REQUIRED_NODES: Array<[number, string]> = [
  [4, "SaveVideo"],
  [9, "LoadImage"],
  [100, "H3Parameter"],
  [101, "H3AutoContextSampler"],
  [103, "MyShot"],
];
/** 1123 D17(批复口径:排障时打开的图就是实际执行的图):组装时填进 apiGraph 的参数位 → 界面图克隆
 *  的控件位(节点号, API 输入键, widgets_values 下标),逐位回写,两形态一致。
 *  下标=画布件 widgets_values 序(=引擎节点定义的控件序);节点定义或生成器改动时须同步
 *  (测试「两形态逐位一致」逐位钉死)。#100/#9/#103 是界面图与 apiGraph 各自直填,不走本表。 */
const MULTISEG_UI_MIRROR: ReadonlyArray<readonly [string, string, number]> = [
  ["4", "filename_prefix", 0],    // 一采预览存盘
  ["4100", "filename_prefix", 0], // 终档存盘(记账件,MyShot 锚)
  ["3030", "value", 0],           // 二采提示词(与 100 同源)
  ["3031", "length", 3],          // 二采总帧数
  ["1065", "value", 0],           // 修脸四采总开关
];

/** multiseg API 档组装器(§14.1.4):克隆同源 UI 模板(h3-multiseg-template.json,1123 D17 起
 *  =画布件全图+App 专用三节点)→注入(long_prompt/宽高 960×544/首帧名/MyShot 四字段+properties 三键/
 *  激活 9+103)→读值直填 apiGraph,再把 apiGraph 的填参位回写界面图(MULTISEG_UI_MIRROR;
 *  照 buildShotH3ApiWorkflow「一份组装产两形态」范式,两形态逐字一致)。
 *  提示词=buildShotH3MultisegPrompt(分段大文本)+文案逐字自检门(同门同文案);
 *  无 seconds 锚——时长在分段文本标签行内(§4.1 修订:multiseg 适配后有 firstFrame 潜空间锚)。 */
export function buildShotH3MultisegApiWorkflow(input: ShotH3ApiWorkflowInput): ShotH3ApiWorkflowResult {
  const tier = input.resolutionTier ?? "960p";
  if (tier !== "960p") {
    throw new Error("my-h3-multiseg 暂只支持 960p 档(960×544 模板原厂比例;480p 属画质对齐议题候令,非档位裁剪)");
  }
  const template = JSON.parse(JSON.stringify(multisegTemplateJson)) as H3WorkflowTemplate;
  for (const [id, type] of MULTISEG_REQUIRED_NODES) {
    const node = template.nodes.find((item) => item.id === id);
    if (!node || node.type !== type) throw new Error(`h3-multiseg-template drift: node ${id} must be ${type}`);
  }
  const policy = input.policy ?? "ambient";
  const shot = input.shot;
  const description = shot.videoDesc.trim() || shot.prompt.trim();
  const durationSec = shot.durationTarget ?? shot.duration;
  const prompt = buildShotH3MultisegPrompt({
    videoDesc: description,
    durationTarget: durationSec,
    lines: shot.lines,
    sound: shot.sound,
    policy,
    voiceMood: input.voiceMood,
    fps: 24, // 模板 100.fps 出厂值,组装恒与模板一致
  });
  assertPlannedTextVerbatimGate(shot, policy, prompt.longPrompt);
  const label = shotLabel(shot.index);
  const imageName = input.imageName ?? `my-shot-h3-${safeImageId(shot.id)}.jpg`;
  const prefix = `video/漫影/${input.chapterId}/${shot.id}/${policy}`;

  // 注入 UI 克隆:首帧/分段提示词/宽高原厂档/MyShot 四字段+properties 三键/激活双旁路节点
  // (存盘前缀等其余参数位由文末 MULTISEG_UI_MIRROR 自 apiGraph 回写,不在 UI 侧另填一份)
  const firstFrame = getNode(template, 9, "LoadImage");
  const parameter = getNode(template, 100, "H3Parameter");
  const anchor = getNode(template, 103, "MyShot");
  const [width, height] = MULTISEG_RESOLUTION_TIERS["960p"];
  setFirstWidget(firstFrame, imageName);
  setNamedWidget(firstFrame, "image", imageName);
  firstFrame.mode = 0; // 适配模板出厂旁路(防占位污染收件箱),组装时激活(i2v 节点 9 同构)
  if (!Array.isArray(parameter.widgets_values) || parameter.widgets_values.length < 19) {
    throw new Error("h3-multiseg-template drift: node 100 widgets_values missing");
  }
  parameter.widgets_values[0] = prompt.longPrompt;
  parameter.widgets_values[6] = width;
  parameter.widgets_values[7] = height;
  anchor.widgets_values = [shot.id, label, description, "图✓"];
  anchor.properties = { ...(anchor.properties ?? {}), myPreview: imageName, myOriginProjectId: input.originProjectId ?? "", myOriginEpisodeId: input.chapterId };
  anchor.mode = 0;

  // 读值直填 apiGraph(锚=object_info 实锚:100.long_prompt/100.width/100.height/4/9/103)
  const apiGraph = JSON.parse(JSON.stringify(multisegApiTemplateJson)) as ApiGraph;
  const parameterApi = getApiNode(apiGraph, "100", "H3Parameter");
  parameterApi.inputs.long_prompt = prompt.longPrompt;
  parameterApi.inputs.width = width;
  parameterApi.inputs.height = height;
  getApiNode(apiGraph, "4", "SaveVideo").inputs.filename_prefix = `${prefix}-p1`;  // D3:一采预览降级 -p1(对齐三采 2061 口径)
  // D3 已批复(1123):4100=终档=记账件(103 MyShot 锚,前缀含镜号可按镜回收);注入须在
  // faceRefine 分支之前——_修脸 后缀追加在已注入的前缀上(非模板公共目录值)
  // 1123 R1/D18-A:4100 第 5 段必须是纯 policy(MyShot my_shot.py 按段校验、
  // h3-shot-landing 按 policy==="full" 判 h3-baked),禁加 -p-final 等任何后缀
  getApiNode(apiGraph, "4100", "SaveVideo").inputs.filename_prefix = prefix;
  getApiNode(apiGraph, "9", "LoadImage").inputs.image = imageName;
  const myShot = getApiNode(apiGraph, "103", "MyShot");
  myShot.inputs = { ...myShot.inputs, shot_id: shot.id, label, description, media_status: "图✓" };

  // 1123 正典(用户裁定:一采→二采→三采恒走,修脸四采按需):二采簇随车注入——
  // 3030 提示词与 100 同源(禁模板演示句滞留);3031.length=总帧数(画布无帧数图出口,手动纪律的 App 路兜底);
  // 5012.length 已于 D4 改为模板连线 [5011,6](frame_count 实测帧数),组装器覆写已删,禁回写数字断线
  getApiNode(apiGraph, "3030", "PrimitiveStringMultiline").inputs.value = prompt.longPrompt;
  if (input.faceRefine) {
    // 1123 用户令:修脸开=1065 拨开 + 终档文件名加「_修脸」后缀(仅此,不搞其他)
    getApiNode(apiGraph, "1065", "PrimitiveBoolean").inputs.value = true;
    const finalSaver = getApiNode(apiGraph, "4100", "SaveVideo");
    finalSaver.inputs.filename_prefix = `${finalSaver.inputs.filename_prefix}_修脸`;  // D18-A:追加在纯 prefix 上(=…/{policy}_修脸;my_shot.py 剥离后得干净 policy+faceRefined)
  }
  const totalFrames = prompt.segments.reduce((sum, segment) => sum + segment.frames, 0);
  getApiNode(apiGraph, "3031", "MiniMaxH3ReferenceToVideo").inputs.length = totalFrames;

  // 1123 D17:apiGraph 已定稿(含 _修脸 后缀与 1065 开关),回写界面图克隆——台账打开的图=实际执行的图
  for (const [id, key, index] of MULTISEG_UI_MIRROR) {
    const node = template.nodes.find((item) => item.id === Number(id));
    if (!node || !Array.isArray(node.widgets_values) || index >= node.widgets_values.length) {
      throw new Error(`h3-multiseg-template drift: node ${id} widgets_values[${index}] missing`);
    }
    node.widgets_values[index] = apiGraph[id]?.inputs[key];
  }

  const images = input.firstFrameB64 ? [{ key: "9.image", name: imageName, b64: input.firstFrameB64 }] : [];
  return {
    apiGraph,
    // 1123 D17①:界面图=画布件 一镜到底-分段.json 原样 + App 专用三节点(#9 首帧/#103 收件箱锚/#800
    // 人脸参考视觉编码器),与 apiGraph 同源(生成器 build/scripts/multiseg_ui_template_build.py);
    // 比执行图多出画布件自有的两处中间档存盘 #3071/#4003 与说明卡 #9999
    uiWorkflow: template as unknown as Record<string, unknown>,
    images,
    report: {
      shot: shot.index,
      seconds: prompt.totalSeconds,
      frames: prompt.segments.reduce((sum, segment) => sum + segment.frames, 0),
      policy,
    },
  };
}
