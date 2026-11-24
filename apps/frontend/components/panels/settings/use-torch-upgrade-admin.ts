/**
 * 引擎 PyTorch/CUDA 升级域(1124 超线文件拆分:自 McpSettingsTab 原样搬出):
 * 引擎版本探测/三件套对照/升级启动与任务跟随。逻辑零改动。
 * 在跑态守卫读镜像 ref(引擎同步域每渲染回写)=原闭包上一帧值语义。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeEngineUrl } from "@/stores/settings/engine-presets-store";
import { useSshPresetsStore } from "@/stores/settings/ssh-presets-store";
import {
  comfySidecarRequest,
  ComfySidecarHttpError,
  getEngineTorchInfo,
  startEngineTorchUpgrade,
  pollJobUntilTerminal,
  type ComfyRemoteEngineStatus,
  type ComfySshStatus,
  type EngineTorchInfo,
  type SidecarJobReply,
  type TorchUpgradeChannel,
} from "@/lib/comfyui/comfy/comfy-sidecar-bridge";

export function useTorchUpgradeAdmin({
  remoteEngine,
  sshStatus,
  syncRunningMirror,
  torchRunningMirror,
  torchBusyMirror,
}: {
  remoteEngine: ComfyRemoteEngineStatus | null;
  sshStatus: ComfySshStatus | null;
  syncRunningMirror: { current: boolean };
  torchRunningMirror: { current: boolean };
  torchBusyMirror: { current: boolean };
}) {
  // R1 生效判定与生效地址(Torch 恒等式所需;与远程引擎域各自独立求值,同式同值)
  const remoteActive =
    remoteEngine?.source === "settings" && Boolean(remoteEngine.url);
  const activeRemoteUrl = remoteActive
    ? normalizeEngineUrl(remoteEngine?.url ?? "")
    : "";
  const sshActiveFingerprint = useSshPresetsStore((s) => s.activeFingerprint);
  const torchRemoteActive =
    remoteEngine?.source === "settings" && Boolean(remoteEngine.url);
  const torchIdentity = JSON.stringify([
    torchRemoteActive,
    torchRemoteActive ? normalizeEngineUrl(remoteEngine?.url ?? "") : "",
    torchRemoteActive
      ? [
          sshStatus?.connected,
          sshStatus?.host,
          sshStatus?.user,
          sshActiveFingerprint,
        ]
      : null,
  ]);
  const torchIdentityRef = useRef(torchIdentity);
  torchIdentityRef.current = torchIdentity;
  const [torchInfoState, setTorchInfoState] = useState<{
    identity: string;
    info: EngineTorchInfo;
  } | null>(null);
  const [torchInfoError, setTorchInfoError] = useState<string | null>(null);
  const torchInfo =
    torchInfoState?.identity === torchIdentity ? torchInfoState.info : null;
  const [torchTarget, setTorchTarget] = useState("");
  const [torchChannel, setTorchChannel] =
    useState<TorchUpgradeChannel>("cu132");
  const [torchConfirm, setTorchConfirm] = useState(false);
  const [torchConfirmPinned, setTorchConfirmPinned] = useState(false);
  const [torchStates, setTorchStates] = useState<
    Record<
      string,
      {
        running?: boolean;
        job?: SidecarJobReply | null;
        resultOpen?: boolean;
        warning?: string | null;
      }
    >
  >({});
  const torchState = torchStates[torchIdentity];
  const torchRunning = Boolean(torchState?.running);
  const torchJob = torchState?.job ?? null;
  const torchResultOpen = Boolean(torchState?.resultOpen);
  const torchTrackingWarning = torchState?.warning ?? null;
  const updateTorchState = useCallback(
    (
      identity: string,
      patch: {
        running?: boolean;
        job?: SidecarJobReply | null;
        resultOpen?: boolean;
        warning?: string | null;
      },
    ) => {
      setTorchStates((previous) => ({
        ...previous,
        [identity]: { ...previous[identity], ...patch },
      }));
    },
    [],
  );
  const setTorchResultOpen = (resultOpen: boolean) =>
    updateTorchState(torchIdentity, { resultOpen });
  const torchTracking = useRef<Record<string, string | null>>({});
  const torchPendingJob = useRef<Record<string, string | null>>({});
  const torchRetryAfter = useRef<Record<string, number>>({});
  const torchProbeEpoch = useRef(0);
  const torchTargetInitialized = useRef(false);
  const pinnedTorch =
    torchInfo?.pinnedTarget ?? torchInfo?.allowedTargets?.[0] ?? "";
  const pinnedVersion = remoteActive ? `${pinnedTorch}+cu132` : pinnedTorch;
  // 1107 用户令(点前写明会动什么,真升级假升级一眼可辨):三件套「当前→目标」对照;
  // 已达标件 pip 判 already-satisfied 零下载,未达标件才真正安装
  const torchChangeRows = (() => {
    if (!torchInfo || !remoteActive) return null;
    const targetOk = torchInfo.allowedTargets?.includes(torchTarget) ?? false;
    const tv = torchInfo.tvMap?.[torchTarget];
    const ta = torchInfo.taMap?.[torchTarget];
    const rows = [
      {
        pkg: "torch",
        cur: torchInfo.current?.torch ?? null,
        tgt: targetOk ? `${torchTarget}+${torchChannel}` : null,
      },
      {
        pkg: "torchvision",
        cur: torchInfo.current?.torchvision ?? null,
        tgt: targetOk && tv ? `${tv}+${torchChannel}` : null,
      },
      {
        pkg: "torchaudio",
        cur: torchInfo.current?.torchaudio ?? null,
        tgt: targetOk && ta ? `${ta}+${torchChannel}` : null,
      },
    ];
    const actionable = rows.some((r) => r.tgt && r.cur !== r.tgt);
    // 1108 用户令「能取到就先取,取不到再显示其他的」:cur=null=未能读取(降级态,
    // 不渲染「将安装」);"NONE"=确定性未安装(真缺件)
    const unverified = rows.some((r) => r.tgt && r.cur === null);
    return { rows, actionable, unverified };
  })();
  const torchVerified = Boolean(
    torchInfo?.live &&
    torchInfo.current?.torch &&
    (torchInfo.current.source === "system_stats" || torchInfo.hostMatched),
  );
  const torchNeedsUpdate =
    torchVerified && torchInfo?.current?.torch !== pinnedVersion;
  const torchLedgerOnly = Boolean(torchInfo?.current?.torch && !torchInfo.live);
  const torchVersionDisplay =
    torchInfo?.current?.torch ??
    `未知(原因:${torchInfo?.errors?.[0] ?? torchInfoError ?? "尚未获取引擎版本"})`;
  const followTorchJob = useCallback(
    async (jobId: string) => {
      const identity = torchIdentity;
      const mode = torchRemoteActive ? "remote" : "local";
      torchTracking.current[identity] = jobId;
      updateTorchState(identity, {
        running: true,
        warning: null,
        job: {
          status: "running",
          step: "preflight",
          message: "正在跟踪升级任务",
        },
      });
      try {
        const job = await pollJobUntilTerminal(
          jobId,
          5 * 60 * 60 * 1000,
          1500,
          (value) => {
            if (torchTracking.current[identity] === jobId)
              updateTorchState(identity, { job: value });
          },
          3,
          mode,
        );
        if (torchTracking.current[identity] !== jobId) return;
        torchPendingJob.current[identity] = null;
        updateTorchState(identity, { job, warning: null, resultOpen: true });
      } catch {
        if (torchTracking.current[identity] !== jobId) return;
        torchPendingJob.current[identity] = jobId;
        torchRetryAfter.current[identity] = Date.now() + 30_000;
        updateTorchState(identity, {
          warning: "升级跟踪中断，任务可能仍在后台运行，将自动重试跟随",
        });
      } finally {
        if (torchTracking.current[identity] === jobId) {
          torchTracking.current[identity] = null;
          updateTorchState(identity, { running: false });
        }
      }
    },
    [torchIdentity, torchRemoteActive, updateTorchState],
  );
  useEffect(() => {
    setTorchInfoState((previous) =>
      previous?.identity === torchIdentity ? previous : null,
    );
    setTorchInfoError(null);
  }, [torchIdentity]);
  useEffect(() => {
    if (torchRunning || remoteEngine === null) return;
    let active = true;
    let inFlight = false;
    let pending = false;
    const refresh = () => {
      if (inFlight) {
        pending = true;
        return;
      }
      inFlight = true;
      const epoch = torchProbeEpoch.current;
      void getEngineTorchInfo("remote")
        .then((info) => {
          if (
            !active ||
            torchIdentityRef.current !== torchIdentity ||
            epoch !== torchProbeEpoch.current
          )
            return;
          setTorchInfoState({ identity: torchIdentity, info });
          setTorchInfoError(null);
          if (!torchTargetInitialized.current && info.allowedTargets?.length) {
            torchTargetInitialized.current = true;
            setTorchTarget(info.allowedTargets[0]);
          }
          if (
            info.busy &&
            info.jobId &&
            !torchTracking.current[torchIdentity] &&
            Date.now() >= (torchRetryAfter.current[torchIdentity] ?? 0)
          ) {
            void followTorchJob(info.jobId);
          } else if (
            !info.busy &&
            torchPendingJob.current[torchIdentity] &&
            !torchTracking.current[torchIdentity] &&
            Date.now() >= (torchRetryAfter.current[torchIdentity] ?? 0)
          ) {
            const jobId = torchPendingJob.current[torchIdentity]!;
            torchTracking.current[torchIdentity] = jobId;
            void comfySidecarRequest<SidecarJobReply>(
              "GET",
              `/comfy/jobs/${encodeURIComponent(jobId)}?mode=remote`,
              { timeoutMs: 10_000 },
            )
              .then((job) => {
                if (
                  !active ||
                  torchIdentityRef.current !== torchIdentity ||
                  torchTracking.current[torchIdentity] !== jobId
                )
                  return;
                if (job.status === "complete" || job.status === "error") {
                  torchPendingJob.current[torchIdentity] = null;
                  updateTorchState(torchIdentity, {
                    job,
                    warning: null,
                    resultOpen: true,
                  });
                } else {
                  torchRetryAfter.current[torchIdentity] = Date.now() + 30_000;
                }
              })
              .catch((error: unknown) => {
                if (
                  !active ||
                  torchIdentityRef.current !== torchIdentity ||
                  torchTracking.current[torchIdentity] !== jobId
                )
                  return;
                if (
                  error instanceof ComfySidecarHttpError &&
                  error.status === 404
                ) {
                  torchPendingJob.current[torchIdentity] = null;
                  updateTorchState(torchIdentity, {
                    warning: "升级结果已不可取回",
                  });
                } else {
                  torchRetryAfter.current[torchIdentity] = Date.now() + 30_000;
                  updateTorchState(torchIdentity, {
                    warning: "升级结果暂时无法获取，将自动重试",
                  });
                }
              })
              .finally(() => {
                if (torchTracking.current[torchIdentity] === jobId)
                  torchTracking.current[torchIdentity] = null;
              });
          }
        })
        .catch((error: unknown) => {
          if (
            active &&
            torchIdentityRef.current === torchIdentity &&
            epoch === torchProbeEpoch.current
          ) {
            setTorchInfoState(null);
            setTorchInfoError(
              error instanceof Error ? error.message : "获取引擎版本失败",
            );
          }
        })
        .finally(() => {
          inFlight = false;
          if (active && pending) {
            pending = false;
            refresh();
          }
        });
    };
    refresh();
    const timer = window.setInterval(refresh, 10_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [
    remoteEngine,
    remoteActive,
    activeRemoteUrl,
    sshStatus?.connected,
    torchRunning,
    followTorchJob,
    torchIdentity,
    updateTorchState,
  ]);
  const startTorchUpgrade = async () => {
    const target = torchConfirmPinned ? pinnedTorch : torchTarget;
    if (
      !sshStatus?.connected ||
      syncRunningMirror.current ||
      torchRunning ||
      !torchInfo ||
      torchInfo.busy ||
      !torchInfo.allowedTargets?.includes(target)
    )
      return;
    torchProbeEpoch.current += 1;
    torchTracking.current[torchIdentity] = "starting";
    updateTorchState(torchIdentity, {
      running: true,
      job: { status: "running", step: "preflight", message: "正在启动" },
    });
    try {
      const { jobId } = await startEngineTorchUpgrade(
        target,
        torchConfirmPinned ? "cu132" : torchChannel,
        "remote",
      );
      await followTorchJob(jobId);
    } catch (error) {
      updateTorchState(torchIdentity, {
        job: {
          status: "error",
          message:
            error instanceof Error ? error.message : "升级任务状态不可用",
        },
        running: false,
        resultOpen: true,
      });
      torchTracking.current[torchIdentity] = null;
    }
  };

  // 跨域镜像回写(同步守卫读 Torch 在跑态;每渲染一次=原闭包上一帧值语义)
  torchRunningMirror.current = torchRunning;
  torchBusyMirror.current = Boolean(torchInfo?.busy);

  return {
    torchRemoteActive, torchIdentity, torchInfo, torchInfoError,
    torchTarget, setTorchTarget, torchChannel, setTorchChannel,
    torchConfirm, setTorchConfirm, torchConfirmPinned, setTorchConfirmPinned,
    torchRunning, torchJob, torchResultOpen, setTorchResultOpen, torchTrackingWarning,
    pinnedTorch, pinnedVersion, torchChangeRows, torchVerified, torchNeedsUpdate, torchLedgerOnly,
    torchVersionDisplay, startTorchUpgrade, followTorchJob,
  };
}
