import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { EditingCommand } from "@/lib/studio/editing/command-core";
import {
  getEditingEffectDefinition,
  getEditingEffectDefinitions,
} from "@/lib/studio/editing/effect-registry";
import type { EditingProjectV1, EditingProposal } from "@/types/editing";

interface EditingProposalPanelProps {
  project: EditingProjectV1;
  onExecuteCommand: (command: EditingCommand) => boolean;
}

const PROPOSAL_EFFECTS = getEditingEffectDefinitions().filter(
  (definition) => definition.category !== "transition",
);

export function EditingProposalPanel(props: EditingProposalPanelProps) {
  const pendingIds = props.project.proposals
    .filter((proposal) => proposal.status === "pending")
    .map((proposal) => proposal.id);
  if (props.project.proposals.length === 0) {
    return <p className="mt-4 text-[11px] leading-5 text-muted-foreground">暂无 AI 剪辑建议</p>;
  }
  return (
    <section aria-label="AI 剪辑建议" className="mt-5 border-t border-white/10 pt-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-100/80">AI 剪辑建议</div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pendingIds.length === 0}
          onClick={() => props.onExecuteCommand({
            type: "proposal.accept",
            proposalIds: pendingIds,
            issuedAt: Date.now(),
          })}
        >
          批量接受 {pendingIds.length}
        </Button>
      </div>
      <div className="mt-3 space-y-3">
        {props.project.proposals.map((proposal) => (
          <ProposalCard
            key={proposal.id}
            project={props.project}
            proposal={proposal}
            onExecuteCommand={props.onExecuteCommand}
          />
        ))}
      </div>
    </section>
  );
}

function ProposalCard(props: EditingProposalPanelProps & { proposal: EditingProposal }) {
  const { proposal } = props;
  const [effectId, setEffectId] = useState(proposal.effectId);
  const [targetClipId, setTargetClipId] = useState(proposal.targetClipId ?? "");
  const [startSeconds, setStartSeconds] = useState(String(proposal.startUs / 1_000_000));
  const [durationSeconds, setDurationSeconds] = useState(String(proposal.durationUs / 1_000_000));
  const [reason, setReason] = useState(proposal.reason);
  const [params, setParams] = useState<Record<string, string>>(() => stringifyParams(proposal.params));
  const definition = useMemo(() => getEditingEffectDefinition(effectId), [effectId]);

  useEffect(() => {
    setEffectId(proposal.effectId);
    setTargetClipId(proposal.targetClipId ?? "");
    setStartSeconds(String(proposal.startUs / 1_000_000));
    setDurationSeconds(String(proposal.durationUs / 1_000_000));
    setReason(proposal.reason);
    setParams(stringifyParams(proposal.params));
  }, [proposal]);

  const updateEffect = (nextEffectId: EditingProposal["effectId"]) => {
    setEffectId(nextEffectId);
    const nextDefinition = getEditingEffectDefinition(nextEffectId);
    setParams(Object.fromEntries(
      (nextDefinition?.parameters ?? []).map((parameter) => [parameter.name, String(parameter.defaultValue)]),
    ));
  };
  const updateTarget = (clipId: string) => {
    setTargetClipId(clipId);
    const clip = props.project.clips.find((item) => item.id === clipId);
    if (clip && (effectId === "panZoom" || effectId === "speed")) {
      setStartSeconds(String(clip.startUs / 1_000_000));
      setDurationSeconds(String(clip.durationUs / 1_000_000));
    }
  };
  const applyChanges = () => props.onExecuteCommand({
    type: "proposal.modify",
    proposalId: proposal.id,
    patch: {
      effectId,
      targetClipId,
      startUs: secondsToUs(startSeconds),
      durationUs: secondsToUs(durationSeconds),
      params: Object.fromEntries(
        (definition?.parameters ?? []).map((parameter) => [
          parameter.name,
          parameter.kind === "number" ? Number(params[parameter.name]) : params[parameter.name],
        ]),
      ),
      reason,
    },
    issuedAt: Date.now(),
  });

  return (
    <article className="rounded-lg border border-white/10 bg-white/[0.025] p-3" aria-label={`建议 ${proposal.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{proposal.status}</Badge>
        <Badge variant="outline">{definition?.preview ?? "final-only"}</Badge>
        <span className="text-xs font-medium">{proposal.effectId}</span>
        <span className="text-[10px] text-muted-foreground">{Math.round(proposal.confidence * 100)}%</span>
      </div>
      <p className="mt-2 text-[11px] leading-5 text-foreground/80">{proposal.reason}</p>
      <p className="mt-1 break-all text-[10px] leading-4 text-muted-foreground">{formatEvidence(proposal)}</p>

      {proposal.status === "pending" ? (
        <div className="mt-3 space-y-2">
          <label className="block text-[10px] text-muted-foreground">
            效果
            <select
              aria-label={`建议 ${proposal.id} 效果`}
              value={effectId}
              onChange={(event) => updateEffect(event.target.value as EditingProposal["effectId"])}
              className="mt-1 h-8 w-full rounded-md border border-white/10 bg-[#111514] px-2 text-xs text-foreground"
            >
              {PROPOSAL_EFFECTS.map((item) => <option key={item.id} value={item.id}>{item.id} · {item.preview}</option>)}
            </select>
          </label>
          <label className="block text-[10px] text-muted-foreground">
            目标片段
            <select
              aria-label={`建议 ${proposal.id} 目标片段`}
              value={targetClipId}
              onChange={(event) => updateTarget(event.target.value)}
              className="mt-1 h-8 w-full rounded-md border border-white/10 bg-[#111514] px-2 text-xs text-foreground"
            >
              {props.project.clips
                .filter((clip) => {
                  const track = props.project.tracks.find((item) => item.id === clip.trackId);
                  return track?.kind === "video" || track?.kind === "image";
                })
                .map((clip) => <option key={clip.id} value={clip.id}>{clip.name}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <Input aria-label={`建议 ${proposal.id} 开始秒`} value={startSeconds} onChange={(event) => setStartSeconds(event.target.value)} />
            <Input aria-label={`建议 ${proposal.id} 时长秒`} value={durationSeconds} onChange={(event) => setDurationSeconds(event.target.value)} />
          </div>
          {(definition?.parameters ?? []).map((parameter) => (
            <label key={parameter.name} className="block text-[10px] text-muted-foreground">
              {parameter.name}
              <Input
                aria-label={`建议 ${proposal.id} 参数 ${parameter.name}`}
                type={parameter.kind === "number" ? "number" : "text"}
                min={parameter.min}
                max={parameter.max}
                step="any"
                value={params[parameter.name] ?? String(parameter.defaultValue)}
                onChange={(event) => setParams((current) => ({ ...current, [parameter.name]: event.target.value }))}
              />
            </label>
          ))}
          <Input aria-label={`建议 ${proposal.id} 理由`} value={reason} onChange={(event) => setReason(event.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={applyChanges}>应用修改</Button>
            <Button type="button" size="sm" onClick={() => props.onExecuteCommand({ type: "proposal.accept", proposalIds: [proposal.id], issuedAt: Date.now() })}>接受 {proposal.id}</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => props.onExecuteCommand({ type: "proposal.reject", proposalId: proposal.id, issuedAt: Date.now() })}>拒绝 {proposal.id}</Button>
          </div>
        </div>
      ) : proposal.status === "accepted" ? (
        <Button className="mt-3" type="button" variant="outline" size="sm" onClick={() => props.onExecuteCommand({ type: "proposal.disable", proposalId: proposal.id, issuedAt: Date.now() })}>
          禁用 {proposal.id}
        </Button>
      ) : null}
    </article>
  );
}

function stringifyParams(params: EditingProposal["params"]) {
  return Object.fromEntries(Object.entries(params).map(([key, value]) => [key, String(value)]));
}

function formatEvidence(proposal: EditingProposal) {
  const values = Object.entries(proposal.sourceEvidence)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${value}`);
  return values.length > 0 ? values.join(" · ") : "无来源证据";
}

function secondsToUs(value: string) {
  return Math.round(Number(value) * 1_000_000);
}
