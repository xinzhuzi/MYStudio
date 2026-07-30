import {
  validateRemotionShotPlan,
  type RemotionShotPlanV1,
} from "@/lib/studio/remotion/shot-plan";

export const REMOTION_SHOT_RENDER_CHANNEL = "remotion-shot-render";
export const REMOTION_SHOT_RENDER_CANCEL_CHANNEL = "remotion-shot-render-cancel";

export interface RemotionShotRenderRequest {
  plan: RemotionShotPlanV1;
}

export async function validateRemotionShotRenderRequest(
  value: unknown,
): Promise<
  | { success: true; value: RemotionShotRenderRequest }
  | { success: false; issues: Array<{ path: string; message: string }> }
> {
  if (!isRecord(value) || Object.keys(value).some((key) => key !== "plan") || !Object.prototype.hasOwnProperty.call(value, "plan")) {
    return { success: false, issues: [{ path: "$", message: "shot render 请求只允许 plan 字段" }] };
  }
  const plan = await validateRemotionShotPlan(value.plan);
  if (!plan.success) {
    return { success: false, issues: plan.issues.map((issue) => ({ path: `plan${issue.path.slice(1)}`, message: issue.message })) };
  }
  return { success: true, value: { plan: plan.value } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
