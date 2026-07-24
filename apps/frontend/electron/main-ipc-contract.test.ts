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
save-file-dialog
save-image
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
studio-merge-episode
studio-probe-media-evidence
studio-render-track-candidate
studio-save-material
studio-skill-create-text
studio-skill-delete-text
studio-skill-list
studio-skill-read-text
studio-skill-restore-text
studio-skill-write-text
studio-timeline-render
studio-timeline-render-cancel
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

function listTypeScriptFiles(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) return listTypeScriptFiles(fullPath);
    return entry.name.endsWith(".ts") && !entry.name.includes(".test.") ? [fullPath] : [];
  });
}

const electronRoot = path.dirname(fileURLToPath(import.meta.url));

describe("Electron IPC contract", () => {
  it("registers the established channel list exactly once", () => {
    const channels = listTypeScriptFiles(electronRoot).flatMap((filePath) => {
      const source = fs.readFileSync(filePath, "utf8");
      return [...source.matchAll(/ipcMain\.handle\(['"]([^'"]+)['"]/g)].map((match) => match[1]);
    });

    expect(channels).toHaveLength(new Set(channels).size);
    expect([...channels].sort()).toEqual(EXPECTED_CHANNELS);
  });

  it("keeps every preload invoke mapped to a registered channel", () => {
    const handlerChannels = listTypeScriptFiles(electronRoot).flatMap((filePath) => {
      const source = fs.readFileSync(filePath, "utf8");
      return [...source.matchAll(/ipcMain\.handle\(['"]([^'"]+)['"]/g)].map((match) => match[1]);
    });
    const preloadSource = fs.readFileSync(path.join(electronRoot, "preload.ts"), "utf8");
    const invokeChannels = [...preloadSource.matchAll(/ipcRenderer\.invoke\(['"]([^'"]+)['"]/g)].map((match) => match[1]);
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
