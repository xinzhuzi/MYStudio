import type {
  EditingValidationResult,
  TimelineRenderCancelResult,
  TimelineRendererEvidence,
  TimelineRenderPlan,
  TimelineRenderProgress,
  TimelineRenderResult,
} from "@/types/editing";
import { validateTimelineRenderPlan } from "@/lib/studio/editing/validation";
import {
  validateTimelineRenderRequestEnvelope,
  type TimelineRenderRequest,
} from "../contracts/timeline-renderer";
import {
  createTimelineRendererRegistry,
  type TimelineRendererAdapter,
} from "./renderer-registry";
import { routeTimelineRenderer } from "./renderer-router";

export interface TimelineRenderHost {
  render: (request: unknown) => Promise<TimelineRenderResult>;
  cancel: (jobId: string) => TimelineRenderCancelResult;
}

export interface TimelineRenderHostOptions {
  adapters: readonly TimelineRendererAdapter[];
  emitProgress: (progress: TimelineRenderProgress) => void;
  validatePlan?: (
    value: unknown,
  ) => EditingValidationResult<TimelineRenderPlan>;
}

export function createTimelineRenderHost(
  options: TimelineRenderHostOptions,
): TimelineRenderHost {
  const registry = createTimelineRendererRegistry(options.adapters);
  const activeRendererByJobId = new Map<string, TimelineRendererAdapter>();
  const validatePlan = options.validatePlan ?? validateTimelineRenderPlan;

  return {
    async render(requestValue) {
      const fallbackJobId = readRequestJobId(requestValue);
      const requestValidation = validateTimelineRenderRequestEnvelope(requestValue);
      if (!requestValidation.success) {
        return fail(
          fallbackJobId,
          formatIssues(requestValidation.issues),
          options.emitProgress,
        );
      }

      const planValidation = validatePlan(requestValidation.value.plan);
      if (!planValidation.success) {
        return fail(
          fallbackJobId,
          formatIssues(planValidation.issues),
          options.emitProgress,
        );
      }

      const request: TimelineRenderRequest<TimelineRenderPlan> = {
        ...requestValidation.value,
        plan: planValidation.value,
      };
      const route = routeTimelineRenderer(request);
      if (!route.success) {
        return fail(request.plan.jobId, route.message, options.emitProgress);
      }
      const adapter = registry.get(route.decision.actual);
      if (!adapter) {
        return fail(
          request.plan.jobId,
          `时间线渲染器未注册: ${route.decision.actual}`,
          options.emitProgress,
        );
      }
      if (activeRendererByJobId.has(request.plan.jobId)) {
        return fail(
          request.plan.jobId,
          `渲染任务正在运行: ${request.plan.jobId}`,
          options.emitProgress,
        );
      }

      activeRendererByJobId.set(request.plan.jobId, adapter);
      try {
        const renderer: TimelineRendererEvidence = {
          requested: route.decision.requested,
          actual: route.decision.actual,
          fallback: route.decision.fallback,
        };
        return await adapter.render(request.plan, { renderer });
      } finally {
        activeRendererByJobId.delete(request.plan.jobId);
      }
    },

    cancel(jobId) {
      const normalized = typeof jobId === "string" ? jobId.trim() : "";
      if (!normalized) {
        return {
          success: false,
          jobId: "unknown",
          canceled: false,
          error: "渲染任务 ID 不能为空",
        };
      }
      const adapter = activeRendererByJobId.get(normalized);
      if (!adapter) {
        return {
          success: false,
          jobId: normalized,
          canceled: false,
          error: `未找到运行中的渲染任务: ${normalized}`,
        };
      }
      return adapter.cancel(normalized);
    },
  };
}

function fail(
  jobId: string,
  error: string,
  emitProgress: (progress: TimelineRenderProgress) => void,
): TimelineRenderResult {
  emitProgress({ jobId, stage: "failed", ratio: 0, message: error });
  return { success: false, jobId, canceled: false, error };
}

function formatIssues(
  issues: ReadonlyArray<{ path: string; message: string }>,
): string {
  return issues.map((item) => `${item.path}: ${item.message}`).join("; ");
}

function readRequestJobId(value: unknown): string {
  if (!value || typeof value !== "object") return "unknown";
  const plan = (value as { plan?: unknown }).plan;
  if (!plan || typeof plan !== "object") return "unknown";
  const jobId = (plan as { jobId?: unknown }).jobId;
  return typeof jobId === "string" && jobId.trim() ? jobId.trim() : "unknown";
}
