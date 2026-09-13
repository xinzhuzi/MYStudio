# Self-media / AiToEarn integration boundary

MYStudio keeps the self-media feature as a native Electron domain. The renderer uses the normalized contracts in `apps/frontend/types/self-media.ts`, the project-scoped Zustand store, and the narrow `window.selfMedia` preload bridge. Provider code is selected by the main-process registry in `apps/frontend/electron/aitoearn/provider-registry.ts` and never imported by the renderer.

`apps/frontend/electron/aitoearn/` is the sole AiToEarn main-process integration root and the unique upstream upgrade boundary. It contains the read-only vendor snapshot, compatibility shims, local account vault, task runtime, and `aitoearn-local` adapter. The renderer-facing `self-media` contracts, components, store, persisted user-data directory, and IPC channel names remain separate domain contracts.

## Current migration slice

- The read-only AiToEarn snapshot is pinned under `apps/frontend/electron/aitoearn/vendor/aitoearn-core/` with its MIT notice and source manifest. The vendor files are not edited in place.
- `aitoearn-local` is an explicit adapter seam. `AitoearnLocalPlatformBridge` preserves the four imported Electron modules (`xiaohongshu`, `douyin`, `shipinhao`, `Kwai`) and composes the MYStudio-owned 14-platform registry in `providers/aitoearn-local/platforms/`. Each platform has an independent package entry and manifest. The other ten packages own MYStudio main-process OAuth/API transports derived from the reviewed upstream HTTP contracts; they do not copy the AiToEarn decorator container, Web UI or TypeORM database. The adapter reports `enabled: true` only when a bridge is supplied; each official platform is separately enabled only when its application configuration is complete. Production wiring constructs the bridge with the user-data path, allowed asset roots (`getDataDir()`, `getMediaRoot()`) and configured official transports.
- The product ships only the Electron-local `aitoearn-local` provider. There is no remote provider or API-key configuration path; an unavailable local bridge remains disabled instead of claiming support.
- Main-process tasks are normalized per selected account, persisted to the user-data self-media task journal, and rehydrated on startup. Renderer state contains only non-secret account summaries and project-scoped drafts/tasks/history.
- Bare imports that the snapshot expects from the AiToEarn application are redirected to named shims in `providers/aitoearn-local/compatibility/` through `sharedAlias` in `apps/frontend/config/electron-vite.config.ts`. `sharp` is shimmed as well: the vendor only calls `sharp(buffer).metadata()` to read width/height (`vendor/aitoearn-core/electron/plat/utils/index.ts:38`), and bundling the real native module made the packaged app fail at startup with `Could not load the "sharp" module`. The shim reuses the pure-JS `image-size` reader, so the main bundle ships no `.node` binary.

## Platform capability matrix

| 平台 | 视频发布 | 图文发布 | 定时 | 取消 |
|---|---|---|---|---|
| 小红书 `xhs` | ✅ `publishVideoWorkApi` | ✅ `publishImageWorkApi`（`xiaohongshu/index.ts:812`） | MYStudio 侧 | ❌ |
| 抖音 `douyin` | ✅ `publishVideoWorkApi` | ✅ `publishImageWorkApi`（`douyin/index.ts:664`） | MYStudio 侧 | ❌ |
| 视频号 `wxSph` | ✅ `publishVideoWorkApi` | ❌ 上游未提供图文接口 | MYStudio 侧 | ❌ |
| 快手 `KWAI` | ✅ `pubVideo` | ❌ 上游未提供图文接口 | MYStudio 侧 | ❌ |
| B站 `bilibili` | ✅ 官方 API transport（必填 `tid`） | ❌ | MYStudio 侧 | ❌ |
| 微信公众号 `wxGzh` | ❌ | ✅ 素材→草稿→发布 | MYStudio 侧 | ❌ |
| TikTok `tiktok` | ✅ 官方 upload/publish | ✅ 公网 HTTPS 图片 | MYStudio 侧 | ✅ |
| YouTube `youtube` | ✅ 官方分片上传 | ❌ | MYStudio 侧 | ✅ |
| Facebook `facebook` | ✅ 官方页面视频 | ✅ 公网 HTTPS 图片 | MYStudio 侧 | ✅ |
| Instagram `instagram` | ✅ 官方 container（公网 HTTPS 媒体） | ✅ 公网 HTTPS 媒体 | MYStudio 侧 | ❌ |
| Threads `threads` | ✅ 官方 container（公网 HTTPS 媒体） | ✅ 公网 HTTPS 媒体 | MYStudio 侧 | ❌ |
| X（Twitter）`twitter` | ✅ 官方媒体上传/发布 | ✅ | MYStudio 侧 | ✅ |
| Pinterest `pinterest` | ✅ 官方媒体上传（必填 `boardId`） | ✅（必填 `boardId`） | MYStudio 侧 | ✅ |
| LinkedIn `linkedin` | ✅ 官方素材上传/发布 | ✅ | MYStudio 侧 | ✅ |

`apps/frontend/lib/self-media/capabilities.ts` is the renderer-safe source for the exact 14 platform IDs and currently executable capabilities. `apps/frontend/electron/aitoearn/providers/aitoearn-local/platforms/platform-manifest.ts` owns main-process auth/routing metadata. The native panel shows all 14 platform entries but never shows provider/adapter status; an entry without a configured production transport cannot log in or become a selectable account-backed publish target. The renderer never receives OAuth secrets or raw platform responses. A package without an injected transport throws `transport-unavailable` and cannot create a false successful publish. 定时发布由 MYStudio 的 task runtime 持有任务直到 `scheduledAt`；现有四个平台的取消仍 fail-closed。

## Official platform application configuration

The ten official transports are created in `createOfficialPlatformTransports()` and injected by Electron main. Configuration is main-process-only and is never returned through preload. A platform is absent from `availablePlatforms` until its required values are complete.

| Platform | Environment prefix | Required values |
|---|---|---|
| TikTok | `MYSTUDIO_SELF_MEDIA_TIKTOK` | `CLIENT_ID`, `CLIENT_SECRET`, `REDIRECT_URI` |
| YouTube | `MYSTUDIO_SELF_MEDIA_YOUTUBE` | `CLIENT_ID`, `CLIENT_SECRET`, `REDIRECT_URI` |
| B站 | `MYSTUDIO_SELF_MEDIA_BILIBILI` | `CLIENT_ID`, `CLIENT_SECRET`, `REDIRECT_URI` |
| X（Twitter） | `MYSTUDIO_SELF_MEDIA_TWITTER` | `CLIENT_ID`, `REDIRECT_URI`; `CLIENT_SECRET` is optional for a public PKCE client and enables confidential-client Basic authentication when present |
| 微信公众号 | `MYSTUDIO_SELF_MEDIA_WECHAT_OFFICIAL` | `CLIENT_ID`, `CLIENT_SECRET`; `REDIRECT_URI` defaults to `http://127.0.0.1/self-media/wechat-official` |
| Facebook | `MYSTUDIO_SELF_MEDIA_FACEBOOK` | `CLIENT_ID`, `CLIENT_SECRET`, `REDIRECT_URI` |
| Instagram | `MYSTUDIO_SELF_MEDIA_INSTAGRAM` | `CLIENT_ID`, `CLIENT_SECRET`, `REDIRECT_URI` |
| Threads | `MYSTUDIO_SELF_MEDIA_THREADS` | `CLIENT_ID`, `CLIENT_SECRET`, `REDIRECT_URI` |
| Pinterest | `MYSTUDIO_SELF_MEDIA_PINTEREST` | `CLIENT_ID`, `CLIENT_SECRET`, `REDIRECT_URI` |
| LinkedIn | `MYSTUDIO_SELF_MEDIA_LINKEDIN` | `CLIENT_ID`, `CLIENT_SECRET`, `REDIRECT_URI` |

Append `_SCOPES` to a prefix to override the reviewed default scopes with a whitespace- or comma-separated list. Redirect URIs must be HTTPS, except loopback `http://127.0.0.1` or `http://localhost`. OAuth tokens are encrypted with Electron `safeStorage`; unavailable encryption, malformed credentials and expired tokens fail closed. These environment values are deployment/application credentials, not a renderer-side API-key settings feature.

B站发布前必须在平台选项填写正数分区 ID `tid`；Pinterest 视频和图文均必须填写目标画板 `boardId`。所有远程媒体只接受 HTTPS。TikTok 图文、Facebook 图片、Instagram 和 Threads 由平台主动拉取媒体，因此必须提供平台可访问的公网 HTTPS URL；不能把本地绝对路径当成这些平台的可拉取 URL。

Current automated evidence uses injected `fetch`, mocked OAuth callbacks and encrypted-vault fixtures. It verifies request projection, login/account routing, publish, poll, cancel and fail-closed behavior without external network calls. It does **not** prove platform app review, a real user authorization, quota availability or a live public post; each platform still requires a separately authorized live acceptance run before production certification.

Local task polling and cancellation are version-guarded. A poll, scheduled publish or cancel result may update the journal only while the same `attemptId` is still current, the task is non-terminal and the transition is legal. Terminal tasks reject later poll/cancel actions, and a late provider response cannot overwrite `canceled` or another terminal result.

## Upgrade rule

Run `node ./build/scripts/sync-aitoearn-core.mjs check` and `dry-run` before replacing the vendor snapshot. The write set must stay inside the vendor lane; adapter, contract, UI, storage, and IPC changes require an explicit compatibility review. Provider/package failures never fall back to another provider or report a false publish success.

Apply is explicitly reviewed: pass `--approve --reviewed-ref <pinned commit>`. It stages every imported file, validates hashes, then atomically swaps the vendor directory. The complete prior directory is retained as `aitoearn-core.previous/` together with `aitoearn-source.previous.json`. Removed upstream entries are reported as `stale`; no broad deletion is performed. A tampered or stale current snapshot, copy error, or validation error aborts before replacement; the current snapshot remains active. If a post-swap failure is detected, restore by renaming `aitoearn-core.previous/` back to `aitoearn-core/` and reinstalling the previous manifest.

Run `npm run smoke:aitoearn-upgrade` for the deterministic no-publish matrix (accounts, video, image-text, scheduling/polling, partial failure, credential redaction, and provider incompatibility). The report is fixture-only evidence: `publishAttempted=false`, `network=false`, fail-closed incompatibility, and no secret persistence. This does not prove a live account publish.

The migrated scope intentionally excludes AiToEarn Web, the browser extension store, OpenClaw, finance/trending/interaction automation, and the original TypeORM application modules.
