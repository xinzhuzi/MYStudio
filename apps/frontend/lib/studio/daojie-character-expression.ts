import type { DaojieGenerationStage } from "./daojie-generation-audit";

/** Fiction-specific human-writing guidance; callers gate on real-source Daojie adaptation. */
export function daojieCharacterExpressionGuidance(stage: DaojieGenerationStage): string {
  const instruction = stage === "script"
    ? "逐场从给定原文中辨认角色眼下要达到什么具体目的、阻碍来自哪里、行动造成什么结果；原文没有明说时标为未明，不替人物补动机。对白须写清对谁说、想让对方做什么或隐瞒什么，但人物原话逐字保留，不为强化目的改词；把原文已有的行动、触发对白及反应按先后写入剧本，并保留用户要求的声音。"
    : stage === "planning"
      ? "每场写清人物目标、阻碍与结果，以及对白对象和话语目的；目的只从原文与给定剧本可支持的信息中归纳，未明处保持未明。说明关键行动如何改变关系、信息或风险，并指出原文已有的可见反应与声音方向；镜头意图写关键画面组的叙事目的，不指定镜号、逐句落镜或新增动作，也不改写对白。"
      : "把行动、触发它的台词和可见反应按原文顺序落到镜头；画面说明角色当下在做什么、回应谁或什么、反应发生在何时。景别与运镜服务于该行动和关系变化，不增动作、不改数量次序；不改写剧本原话，用户要求保留的声音不得转成无台词。";
  return [
    "## 人物目标、对白目的与可见反应",
    instruction,
    "沿用当前阶段输出协议，不新增分析栏目。人物表达方法服从本章原文、角色当时知情与揭示顺序；不套用散文标点禁令，不据此删除原文或取消有据旁白/OS，不改变生产195秒门。",
  ].join("\n");
}
