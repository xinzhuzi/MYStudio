"use client";

// 0924 C1 专项(§7):safeStorage 密钥保险箱状态横幅——四档 A1/A2/B/C。
// 状态源是 lib/storage/secure-local-storage 的模块单例(不进 store state、
// 不进 partialize,防状态自身被持久化);useSyncExternalStore 订阅变化。
// 一切路径不抛错不崩:横幅只是提示,不阻断页面其余功能。

import { useState, useSyncExternalStore } from "react";
import { AlertTriangle, KeyRound, RefreshCw, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  discardFailedVault,
  getSecureVaultStatus,
  resetSecureVaultStatus,
  subscribeSecureVaultStatus,
} from "@/lib/storage/secure-local-storage";

interface SecureVaultBannerProps {
  /** 密钥保险箱对应的存储键(与 store persist 的 name 一致)。 */
  storageKey: string;
  /** A2「重试」出口:复位状态后重跑水合(传 store.persist.rehydrate)。 */
  onRetry?: () => Promise<unknown> | unknown;
  /** 状态对象里带 storageKey,渲染文案用哪个键名给用户看。 */
  subjectLabel: string;
}

/**
 * 四档横幅(out/c1-plan-0924.md §7):
 * A1 decrypt-failed——换机/重装/密文损坏:主按钮「清除无效密文并重新填写」+ 二次确认;
 * A2 read-timeout——可能只是系统繁忙:无破坏性按钮,只有「重试」;
 * B  unavailable——本机安全存储不可用但密文完好:红字次按钮「以明文重新开始(丢弃已加密数据)」+ 二次确认;
 * C  plaintext-degraded——明文降级读写:纯提示,不阻断使用。
 */
export function SecureVaultBanner({ storageKey, onRetry, subjectLabel }: SecureVaultBannerProps) {
  const status = useSyncExternalStore(
    subscribeSecureVaultStatus,
    () => getSecureVaultStatus(storageKey),
  );
  const [confirming, setConfirming] = useState<null | "discard-cipher">(null);
  const [retrying, setRetrying] = useState(false);

  if (status.mode === "ok") return null;

  if (status.mode === "plaintext-degraded") {
    return (
      <div
        role="status"
        className="flex items-start gap-3 rounded-xl border border-border bg-muted/45 p-4"
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
        <p className="text-xs leading-5 text-muted-foreground">
          本机系统安全存储（safeStorage）不可用，{subjectLabel}将以明文保存在本地。
        </p>
      </div>
    );
  }

  const cause = status.cause;

  const handleRetry = async () => {
    setRetrying(true);
    try {
      resetSecureVaultStatus(storageKey);
      await onRetry?.();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4 lg:flex-row lg:items-center lg:justify-between"
    >
      <div className="flex min-w-0 items-start gap-3">
        <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
        <div className="min-w-0">
          {cause === "read-timeout" ? (
            <>
              <h4 className="text-sm font-medium text-foreground">{subjectLabel}读取超时</h4>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                系统可能正繁忙。重启应用将自动重试读取；你的密钥数据未受影响。
                在恢复读取之前，此页新填写的{subjectLabel}不会被保存。
              </p>
            </>
          ) : cause === "unavailable" ? (
            <>
              <h4 className="text-sm font-medium text-foreground">
                本机系统安全存储不可用，已加密保存的{subjectLabel}暂时无法读取
              </h4>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                你的密钥数据仍然完好，在支持安全存储的环境（如 macOS 钥匙串）下重新打开即可恢复。
                也可以选择在本机以明文重新开始——这将<b>丢弃</b>已加密的数据。
                在恢复之前，此页新填写的{subjectLabel}不会被保存。
              </p>
            </>
          ) : (
            <>
              <h4 className="text-sm font-medium text-foreground">
                无法读取已加密保存的{subjectLabel}
              </h4>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                通常因重装系统或更换电脑导致。已加密的数据无法在本机解开，但不会影响其他设置。
                在恢复之前，此页新填写的{subjectLabel}不会被保存。
              </p>
            </>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 self-start lg:self-center">
        {cause === "read-timeout" && (
          <Button variant="outline" size="sm" disabled={retrying} onClick={() => void handleRetry()}>
            <RefreshCw className={cn("mr-1 h-4 w-4", retrying && "animate-spin")} aria-hidden />
            重试
          </Button>
        )}
        {cause === "decrypt-failed" && (
          <Button variant="default" size="sm" onClick={() => setConfirming("discard-cipher")}>
            <Trash2 className="mr-1 h-4 w-4" aria-hidden />
            清除无效密文并重新填写
          </Button>
        )}
        {cause === "unavailable" && (
          <Button
            variant="outline"
            size="sm"
            className="text-destructive border-destructive/40 hover:bg-destructive/10"
            onClick={() => setConfirming("discard-cipher")}
          >
            在本机以明文重新开始（丢弃已加密数据）
          </Button>
        )}
      </div>

      <AlertDialog open={confirming === "discard-cipher"} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认清除已加密的{subjectLabel}？</AlertDialogTitle>
            <AlertDialogDescription>
              将删除本机无法解密的密钥数据，此操作不可撤销。清除后需要重新填写各服务的 API 密钥。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                setConfirming(null);
                discardFailedVault(storageKey);
              }}
            >
              确认清除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
