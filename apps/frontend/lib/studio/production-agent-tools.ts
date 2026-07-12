import {
  auditDirectorPlanStructure,
  formatDirectorPlanAuditError,
  parseDirectorPlan,
  summarizeDirectorPlanAudit,
  type DirectorPlanAuditSummary,
} from "@/lib/studio/director-plan";
import type { AgentWorkKey, ScriptPlan } from "@/types/studio";

export type ProductionAgentDeploymentKey =
  | "productionAgent:decisionAgent"
  | "productionAgent:supervisionAgent"
  | "productionAgent:deriveAssetsAgent"
  | "productionAgent:generateAssetsAgent"
  | "productionAgent:directorPlanAgent"
  | "productionAgent:storyboardGenAgent"
  | "productionAgent:storyboardPanelAgent"
  | "productionAgent:storyboardTableAgent";

export interface ProductionAgentDeploymentMapping {
  key: ProductionAgentDeploymentKey;
  status: "connected" | "unsupported";
  stage?: AgentWorkKey;
  callSite?: string;
  reason?: string;
}

export const PRODUCTION_AGENT_DEPLOYMENT_MAPPINGS: ProductionAgentDeploymentMapping[] = [
  {
    key: "productionAgent:decisionAgent",
    status: "unsupported",
    reason: "Targeted decision loop is planned under the typed tool registry; no direct production call site yet.",
  },
  {
    key: "productionAgent:supervisionAgent",
    status: "connected",
    stage: "supervisionReport",
    callSite: "production-agent-tools.reviewDirectorPlan",
  },
  {
    key: "productionAgent:deriveAssetsAgent",
    status: "unsupported",
    reason: "Derived asset execution remains a direct store/workflow action until media taskization.",
  },
  {
    key: "productionAgent:generateAssetsAgent",
    status: "unsupported",
    reason: "Asset image generation will be moved into the run kernel during media taskization.",
  },
  {
    key: "productionAgent:directorPlanAgent",
    status: "connected",
    stage: "directorPlan",
    callSite: "useProductionPlanningActions.handleDirectorPlan",
  },
  {
    key: "productionAgent:storyboardGenAgent",
    status: "unsupported",
    reason: "Storyboard image generation is still handled by image workflow actions.",
  },
  {
    key: "productionAgent:storyboardPanelAgent",
    status: "unsupported",
    reason: "Storyboard panel writes are currently derived from parsed storyboard table rows.",
  },
  {
    key: "productionAgent:storyboardTableAgent",
    status: "connected",
    stage: "storyboardTable",
    callSite: "useProductionPlanningActions.handleStoryboardTable",
  },
];

export interface DirectorPlanReviewResult {
  approved: boolean;
  audit: DirectorPlanAuditSummary;
  issues: string[];
  error?: string;
}

export interface DirectorPlanWriteResult {
  approved: boolean;
  workId?: string;
  plan?: ScriptPlan;
  warnings: string[];
  audit: DirectorPlanAuditSummary;
  issues: string[];
  error?: string;
}

export interface ProductionAgentToolRegistry {
  reviewDirectorPlan: (input: { text: string }) => DirectorPlanReviewResult;
  writeDirectorPlan: (input: {
    text: string;
    episodeId: string;
    saveAgentWorkData: (key: AgentWorkKey, data: string, episodeId?: string) => string;
    saveScriptPlan: (plan: ScriptPlan) => void;
  }) => DirectorPlanWriteResult;
}

export function createProductionAgentToolRegistry(): ProductionAgentToolRegistry {
  return {
    reviewDirectorPlan: ({ text }) => reviewDirectorPlan(text),
    writeDirectorPlan: ({ text, episodeId, saveAgentWorkData, saveScriptPlan }) => {
      const review = reviewDirectorPlan(text);
      if (!review.approved) {
        return {
          approved: false,
          warnings: [],
          audit: review.audit,
          issues: review.issues,
          error: review.error,
        };
      }

      const { plan, warnings } = parseDirectorPlan(text, episodeId);
      const workId = saveAgentWorkData("directorPlan", text, episodeId);
      saveScriptPlan(plan);
      return {
        approved: true,
        workId,
        plan,
        warnings,
        audit: review.audit,
        issues: [],
      };
    },
  };
}

function reviewDirectorPlan(text: string): DirectorPlanReviewResult {
  const audit = auditDirectorPlanStructure(text);
  const summary = summarizeDirectorPlanAudit(audit);
  if (!audit.passed) {
    return {
      approved: false,
      audit: summary,
      issues: audit.issues,
      error: formatDirectorPlanAuditError(audit),
    };
  }
  return {
    approved: true,
    audit: summary,
    issues: [],
  };
}
