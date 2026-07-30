// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const EXPECTED_CHANNELS = `
api-image-request
api-model-test
api-text-completion
api-text-completion-stream
app-devtools-open
app-open-path
app-updater-check
app-updater-get-current-version
app-updater-open-link
assets:add
assets:add-image
assets:batch-match
assets:delete
assets:get
assets:get-by-name
assets:import-from-toonflow
assets:list
assets:remove-image
assets:rename-image
assets:replace-image
assets:select-image-file
assets:select-image-files
assets:update
delete-image
diagnostics-log-clear
diagnostics-log-export-bundle
diagnostics-log-get-info
diagnostics-log-open-folder
diagnostics-log-query
diagnostics-log-write
file-storage-exists
file-storage-get
file-storage-list
file-storage-list-dirs
file-storage-remove
file-storage-remove-dir
file-storage-rename
file-storage-set
get-absolute-path
get-image-path
image-host-upload
move-image
project-file-get-absolute-path
project-file-read-base64
project-file-remove-text
project-file-save-image
project-file-write-binary
project-file-write-text
read-image-base64
remotion-preview-create
remotion-preview-release
remotion-runtime-download
remotion-runtime-status
remotion-studio-ensure-session
save-file-dialog
save-image
self-media:cancel-task
self-media:configure-provider
self-media:create-task
self-media:list-accounts
self-media:list-providers
self-media:list-tasks
self-media:poll-task
self-media:start-login
storage-clear-cache
storage-export-data
storage-export-media-data
storage-export-project-data
storage-get-cache-size
storage-get-paths
storage-import-data
storage-import-media-data
storage-import-project-data
storage-link-data
storage-link-media-data
storage-link-project-data
storage-move-data
storage-move-media-data
storage-move-project-data
storage-select-directory
storage-update-config
storage-validate-data-dir
storage-validate-project-dir
studio-list-assets
studio-probe-media-evidence
studio-save-material
studio-skill-create-text
studio-skill-delete-text
studio-skill-list
studio-skill-read-text
studio-skill-restore-text
studio-skill-write-text
studio-visual-manual-create
studio-visual-manual-duplicate
studio-visual-manual-list
studio-visual-manual-read
studio-visual-manual-write
studio-visual-manual-write-images
tts-reference-audio-resolve
tts-runtime-get-config
tts-runtime-request
tts-runtime-request-bytes
tts-runtime-request-formdata
tts-runtime-set-config
tts-runtime-set-model-cache-dir
tts-runtime-setup
tts-runtime-start
tts-runtime-status
tts-runtime-stop
`.trim().split("\n");

const NAMED_IPC_CHANNELS = {
  REMOTION_PREVIEW_CREATE_CHANNEL: "remotion-preview-create",
  REMOTION_PREVIEW_RELEASE_CHANNEL: "remotion-preview-release",
  REMOTION_RUNTIME_DOWNLOAD_CHANNEL: "remotion-runtime-download",
  REMOTION_RUNTIME_STATUS_CHANNEL: "remotion-runtime-status",
  REMOTION_STUDIO_ENSURE_SESSION_CHANNEL: "remotion-studio-ensure-session",
  "SELF_MEDIA_IPC.cancelTask": "self-media:cancel-task",
  "SELF_MEDIA_IPC.configureProvider": "self-media:configure-provider",
  "SELF_MEDIA_IPC.createTask": "self-media:create-task",
  "SELF_MEDIA_IPC.listAccounts": "self-media:list-accounts",
  "SELF_MEDIA_IPC.listTasks": "self-media:list-tasks",
  "SELF_MEDIA_IPC.listProviders": "self-media:list-providers",
  "SELF_MEDIA_IPC.pollTask": "self-media:poll-task",
  "SELF_MEDIA_IPC.startLogin": "self-media:start-login",
} as const;

function listTypeScriptFiles(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(root, entry.name);
    // The AiToEarn snapshot is an isolated source lane. Its upstream modules
    // may contain their own ipcMain handlers, but they are not registered by
    // MYStudio and must not expand the app-owned IPC contract.
    if (entry.isDirectory() && path.resolve(fullPath) === AITOEARN_VENDOR_ROOT) return [];
    if (entry.isDirectory()) return listTypeScriptFiles(fullPath);
    return entry.name.endsWith(".ts") && !entry.name.includes(".test.") ? [fullPath] : [];
  });
}

function listIpcCallChannels(
  source: string,
  call: "ipcMain.handle" | "ipcRenderer.invoke",
): string[] {
  const escapedCall = call.replace(".", "\\.");
  const literalPattern = new RegExp(`${escapedCall}\\(['\"]([^'\"]+)['\"]`, "g");
  const literalChannels = [...source.matchAll(literalPattern)].map((match) => match[1]);
  const namedChannels = Object.entries(NAMED_IPC_CHANNELS)
    .filter(([name]) => source.includes(`${call}(${name}`))
    .map(([, channel]) => channel);
  return [...literalChannels, ...namedChannels];
}

const electronRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AITOEARN_VENDOR_ROOT = path.resolve(electronRoot, "aitoearn", "vendor");

describe("Electron IPC contract", () => {
  it("registers the established channel list exactly once", () => {
    const channels = listTypeScriptFiles(electronRoot).flatMap((filePath) => {
      const source = fs.readFileSync(filePath, "utf8");
      return listIpcCallChannels(source, "ipcMain.handle");
    });

    expect(channels).toHaveLength(new Set(channels).size);
    expect([...channels].sort()).toEqual(EXPECTED_CHANNELS);
  });

  it("keeps every preload invoke mapped to a registered channel", () => {
    const handlerChannels = listTypeScriptFiles(electronRoot).flatMap((filePath) => {
      const source = fs.readFileSync(filePath, "utf8");
      return listIpcCallChannels(source, "ipcMain.handle");
    });
    const preloadSource = fs.readFileSync(path.join(electronRoot, "preload", "preload.ts"), "utf8");
    const invokeChannels = listIpcCallChannels(preloadSource, "ipcRenderer.invoke");
    const handlerOnlyChannels = [...new Set(handlerChannels)]
      .filter((channel) => !new Set(invokeChannels).has(channel))
      .sort();

    expect(invokeChannels).toHaveLength(new Set(invokeChannels).size);
    expect(invokeChannels.every((channel) => EXPECTED_CHANNELS.includes(channel))).toBe(true);
    expect(handlerOnlyChannels).toEqual([
      "storage-export-media-data",
      "storage-export-project-data",
      "storage-import-media-data",
      "storage-import-project-data",
      "storage-link-media-data",
      "storage-link-project-data",
      "storage-move-media-data",
      "storage-move-project-data",
      "storage-validate-project-dir",
      "studio-list-assets",
    ]);
  });
});
