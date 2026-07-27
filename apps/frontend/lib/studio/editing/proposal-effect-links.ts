import type { EditingValidationIssue } from "@/types/editing";

export function validateProposalEffectLinks(
  proposals: unknown[],
  effects: unknown[],
  issues: EditingValidationIssue[],
): void {
  const proposalIds = new Set(
    proposals
      .filter(isRecord)
      .map((proposal) => typeof proposal.id === "string" ? proposal.id : "")
      .filter(Boolean),
  );
  const effectsByProposalId = new Map<string, Record<string, unknown>[]>();
  effects.filter(isRecord).forEach((effect, index) => {
    if (typeof effect.proposalId !== "string" || !effect.proposalId.trim()) return;
    if (!proposalIds.has(effect.proposalId)) {
      issue(issues, "editing.effect.proposal_missing", `$.effects[${index}].proposalId`, "效果关联的建议不存在");
    }
    const linked = effectsByProposalId.get(effect.proposalId) ?? [];
    linked.push(effect);
    effectsByProposalId.set(effect.proposalId, linked);
  });
  proposals.filter(isRecord).forEach((proposal, index) => {
    if (typeof proposal.id !== "string") return;
    const linked = effectsByProposalId.get(proposal.id) ?? [];
    const path = `$.proposals[${index}]`;
    if (proposal.status === "accepted" || proposal.status === "disabled") {
      if (linked.length !== 1) {
        issue(issues, "editing.proposal.effect_link", path, "已接受或禁用建议必须关联唯一效果");
        return;
      }
      const expectedEnabled = proposal.status === "accepted";
      if (linked[0]!.enabled !== expectedEnabled) {
        issue(issues, "editing.proposal.effect_state", path, "建议状态与关联效果启用状态不一致");
      }
    } else if (linked.length > 0) {
      issue(issues, "editing.proposal.effect_state", path, "未接受建议不得预先关联效果");
    }
  });
}

function issue(
  issues: EditingValidationIssue[],
  code: string,
  path: string,
  message: string,
): void {
  issues.push({ code, path, message });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
