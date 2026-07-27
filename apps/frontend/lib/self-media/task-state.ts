import type { SelfMediaTask, SelfMediaTaskError, SelfMediaTaskStatus } from "@/types/self-media";

export type SelfMediaTaskAction =
  | { type: "schedule"; scheduledAt: string }
  | { type: "start"; providerTaskId?: string }
  | { type: "progress"; progress: number }
  | { type: "succeed"; resultUrl?: string }
  | { type: "fail"; error: SelfMediaTaskError }
  | { type: "partial"; error?: SelfMediaTaskError }
  | { type: "audit" }
  | { type: "cancel" }
  | { type: "expire-login" };

const TRANSITIONS: Record<SelfMediaTaskStatus, readonly SelfMediaTaskStatus[]> = {
  draft: ["scheduled", "running", "canceled"],
  scheduled: ["running", "canceled", "expired-login", "failure"],
  running: ["success", "failure", "partial", "audit", "canceled", "expired-login"],
  success: [],
  failure: [],
  partial: [],
  audit: [],
  canceled: [],
  "expired-login": [],
};

function transition(task: SelfMediaTask, nextStatus: SelfMediaTaskStatus): SelfMediaTask {
  if (!TRANSITIONS[task.status].includes(nextStatus)) {
    throw new Error(`Invalid self-media task transition: ${task.status} -> ${nextStatus}`);
  }
  return { ...task, status: nextStatus, updatedAt: new Date().toISOString() };
}

export function reduceSelfMediaTask(task: SelfMediaTask, action: SelfMediaTaskAction): SelfMediaTask {
  switch (action.type) {
    case "schedule":
      return { ...transition(task, "scheduled"), scheduledAt: action.scheduledAt };
    case "start":
      return { ...transition(task, "running"), providerTaskId: action.providerTaskId };
    case "progress":
      if (task.status !== "running") throw new Error(`Progress requires running task, got ${task.status}`);
      return { ...task, progress: Math.max(0, Math.min(100, action.progress)), updatedAt: new Date().toISOString() };
    case "succeed":
      return { ...transition(task, "success"), progress: 100, resultUrl: action.resultUrl };
    case "fail":
      return { ...transition(task, "failure"), error: action.error };
    case "partial":
      return { ...transition(task, "partial"), error: action.error };
    case "audit":
      return transition(task, "audit");
    case "cancel":
      return transition(task, "canceled");
    case "expire-login":
      return transition(task, "expired-login");
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}

export function canRetrySelfMediaTask(task: SelfMediaTask): boolean {
  return task.status === "failure" || task.status === "expired-login";
}
