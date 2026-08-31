import { WorkflowSmokeStageEvidence } from "./workflow-smoke-shared";

/**
 * smoke 桥跨模块状态单例——stepwiseEvidence 证据数组(reset 清空/步骤写入/巡检读取三方共享)。
 */
export const stepwiseEvidence: WorkflowSmokeStageEvidence[] = [];
