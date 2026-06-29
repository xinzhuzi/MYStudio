import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appsRoot = resolve(__dirname, "../..");

function readBuildFile(relativePath: string) {
  return readFileSync(resolve(appsRoot, relativePath), "utf8");
}

describe("desktop build scripts", () => {
  it("use the current frontend build paths", () => {
    const source = readBuildFile("build/build-desktop.mjs");

    expect(source).toContain("'frontend', 'config', 'electron-builder.yml'");
    expect(source).toContain("'frontend', 'config', 'electron-vite.config.ts'");
    expect(source).toContain("'frontend', 'assets', 'brand'");
    expect(source).toContain("'frontend', 'scripts', 'generate-icon.mjs'");
    expect(source).not.toContain("src/config");
    expect(source).not.toContain("src/assets");
    expect(source).not.toContain("src/scripts");
  });

  it("does not install Python into backend during setup", () => {
    const setupSh = readBuildFile("build/setup.sh");
    const setupWin = readBuildFile("build/setup-win.ps1");

    for (const source of [setupSh, setupWin]) {
      expect(source).not.toContain("backend/python");
      expect(source).not.toContain("setup_python");
      expect(source).not.toContain("python-build-standalone");
      expect(source).not.toContain("pip install");
    }
  });

  it("routes mac helper through the current build script path", () => {
    const source = readBuildFile("build/build-mac.sh");

    expect(source).toContain("node ./build/build-desktop.mjs --mac");
    expect(source).toContain("HAS_ARCH=0");
    expect(source).toContain("BUILD_ARGS=\"${BUILD_ARGS} --arm64\"");
    expect(source).toContain("Command: node ./build/build-desktop.mjs --mac$BUILD_ARGS");
    expect(source).toContain("--install|--smoke-installed");
    expect(source).toContain("INSTALL_AFTER_BUILD=1");
    expect(source).toContain("node ./build/install-and-smoke.mjs");
    expect(source).not.toContain("ditto");
    expect(source).not.toContain("/Applications/漫影工作室.app");
    expect(source).not.toContain("backup-");
    expect(source).not.toContain(".backup");
    expect(source).not.toContain("cp -R");
    expect(source).not.toContain("mv ");
    expect(source).not.toContain("rsync");
    expect(source).not.toContain("./src/build/build-desktop.mjs");
    expect(source).not.toContain("SCRIPT_DIR/../..");
  });

  it("routes npm mac builds through the managed desktop build script", () => {
    const source = readBuildFile("package.json");

    expect(source).toContain('"build:mac": "sh ./build/build-mac.sh --arm64"');
    expect(source).toContain('"build:mac:install": "sh ./build/build-mac.sh --arm64 --install"');
    expect(source).not.toContain('"build:mac:install": "node ./build/install-and-smoke.mjs"');
    expect(source).not.toContain(
      "electron-builder --config frontend/config/electron-builder.yml --mac --arm64",
    );
  });

  it("exposes a packaged desktop smoke test for white-screen regressions", () => {
    const packageJson = readBuildFile("package.json");
    const smokeScript = readBuildFile("build/smoke-desktop.mjs");

    expect(packageJson).toContain(
      '"smoke:desktop": "node ./build/smoke-desktop.mjs"',
    );
    expect(smokeScript).toContain("dashboard-project-card");
    expect(smokeScript).toContain("项目概览");
    expect(smokeScript).toContain("bodyBg");
    expect(smokeScript).toContain("verifyRoute");
    expect(smokeScript).toContain("verifyOverviewWorkflow");
    expect(smokeScript).toContain("CORE_ROUTE_CHECKS");
    expect(smokeScript).toContain("requiredText");
    expect(smokeScript).toContain("forbiddenText");
    expect(smokeScript).toContain("verifyPythonSettings");
    expect(smokeScript).toContain("missingRequiredText");
    expect(smokeScript).toContain("verifyWorkflowEndToEnd");
    expect(smokeScript).toContain("mystudioWorkflowSmoke");
    expect(smokeScript).toContain("workflowE2E=ok");
    expect(smokeScript).toContain("MYSTUDIO_SMOKE");
    expect(smokeScript).toContain("verifyAssetVoiceFlow");
    expect(smokeScript).toContain("verifyScriptAssetGenerationVoiceFlow");
    const generationVoiceFlowStart = smokeScript.indexOf(
      "async function verifyScriptAssetGenerationVoiceFlow",
    );
    const generationVoiceFlowEnd = smokeScript.indexOf(
      "async function captureScreenshotStats",
    );
    const generationVoiceFlow = smokeScript.slice(
      generationVoiceFlowStart,
      generationVoiceFlowEnd,
    );
    expect(generationVoiceFlow).toContain("clickButtonByText('工作流', true)");
    expect(generationVoiceFlow).toContain("当前工作区：漫影工作流");
    expect(smokeScript).toContain("ASSET_VOICE_FLOW_TIMEOUT_MS");
    expect(smokeScript).toContain('"Runtime.evaluate"');
    expect(smokeScript).toContain("withTimeout(");
    expect(smokeScript).toContain("CDP_CALL_TIMEOUT_MS");
    expect(smokeScript).toContain("Smoke测试剑修");
    expect(smokeScript).toContain("searchAssetLibrary");
    expect(smokeScript).toContain("Smoke青年男声");
    expect(smokeScript).toContain("saveMaterial");
    expect(smokeScript).toContain("自动分配音频");
    expect(smokeScript).toContain("为角色「");
    expect(smokeScript).toContain("资产库音频");
    expect(smokeScript).toContain("searchVoiceAssignDialog");
    expect(smokeScript).toContain("搜索音频名称或文件名");
    expect(smokeScript).toContain("确认分配");
    expect(smokeScript).toContain("已绑定音色音频");
    expect(smokeScript).toContain("克隆音色");
    expect(smokeScript).toContain("closeTopDialog");
    expect(smokeScript).toContain("closedVoiceDialog");
    expect(smokeScript).toContain("openDialogCountBeforeAudio");
    expect(smokeScript).toContain("audio[controls]");
    expect(smokeScript).toContain("loadedmetadata");
    expect(smokeScript).toContain("AUDIO_METADATA_TIMEOUT_MS");
    expect(smokeScript).toContain("scriptAssetGenerationVoiceFlow=ok");
    expect(smokeScript).toContain(
      "script asset generation did not expose role audio assignment",
    );
    expect(smokeScript).toContain("音色");
    expect(smokeScript).toContain("开始制作");
    expect(smokeScript).toContain("进入工作流");
    expect(smokeScript).toContain("查看资产库");
    expect(smokeScript).toContain("剧本生产阶段");
    expect(smokeScript).toContain("剧本资产管理");
    expect(smokeScript).not.toContain("label: '剧本资产提取'");
    expect(smokeScript).not.toContain("label: '剧本资产生成'");
    expect(smokeScript).toContain("分镜视频生成");
    expect(smokeScript).toContain("自动排版");
    expect(smokeScript).toContain("角色/场景/道具");
    expect(smokeScript).toContain("视频工作台");
    expect(smokeScript).toContain("forbiddenText");
    expect(smokeScript).toContain("workflow stage rendered removed content");
    expect(smokeScript).toContain("运行 AI 分镜计划");
    expect(smokeScript).toContain("添加分镜");
    expect(smokeScript).toContain("verifyWorkflowStages");
    expect(smokeScript).toContain("workflow stage missing required content");
    expect(smokeScript).toContain("workflow-node-canvas");
    expect(smokeScript).toContain("react-flow");
    expect(smokeScript).toContain("react-flow__edge");
    expect(smokeScript).toContain("data-flow-node-id");
    expect(smokeScript).toContain("hasTopNodeCanvas");
    expect(smokeScript).toContain("storyboardStage");
    expect(smokeScript).toContain("nodeCardTexts");
    expect(smokeScript).toContain("requiredNodePreviewText");
    expect(smokeScript).toContain("hasNodeFlowDataPreview");
    expect(smokeScript).toContain(
      "workflow node cards did not show Toonflow FlowData previews",
    );
    expect(smokeScript).toContain(
      "storyboard video generation React Flow workflow canvas did not render",
    );
    expect(smokeScript).toContain(
      "workflow node canvas rendered inside 剧本资产管理 instead of 分镜视频生成",
    );
    expect(smokeScript).toContain("Python 运行环境");
    expect(smokeScript).toContain("不随应用启动自动配置");
    expect(smokeScript).toContain("开始配置");
    expect(smokeScript).toContain("安装明细");
    expect(smokeScript).toContain("Python 使用路径");
    expect(smokeScript).toContain("制作流程推进");
    expect(smokeScript).toContain("导演造景");
    expect(smokeScript).toContain("Page.captureScreenshot");
    expect(smokeScript).toContain("screenshot");
    expect(smokeScript).toContain("withTimeout");
    expect(smokeScript).toContain("CDP_CALL_TIMEOUT_MS");
    expect(smokeScript).toContain("socket.close");
    expect(smokeScript).toContain("captureDomVisualStats");
    expect(smokeScript).toContain("captureError");
  });

  it("does not mix static and runtime dynamic imports for shared studio modules", () => {
    const novelActions = readBuildFile(
      "frontend/components/panels/studio/useNovelPipelineActions.ts",
    );
    const scriptAssetActions = readBuildFile(
      "frontend/components/panels/studio/useScriptAssetGenerationActions.ts",
    );
    const assetDialog = readBuildFile(
      "frontend/components/panels/assets/StudioAssetDetailDialog.tsx",
    );
    const assetOrchestrator = readBuildFile(
      "frontend/lib/studio/asset-generation-orchestrator.ts",
    );
    const smokeBridge = readBuildFile("frontend/lib/studio/workflow-smoke-bridge.ts");

    expect(novelActions).not.toContain('await import("@/lib/studio/entity-sync")');
    expect(scriptAssetActions).not.toContain(
      'await import("@/lib/studio/asset-generation-orchestrator")',
    );
    expect(assetDialog).not.toContain('await import("@/stores/props-library-store")');
    expect(assetDialog).not.toContain(
      'await import("@/lib/studio/asset-generation-orchestrator")',
    );
    expect(assetOrchestrator).not.toContain('await import("@/lib/ai/prompt-polisher")');
    expect(smokeBridge).not.toContain('await import("@/lib/studio/workflow-readiness")');
  });

  it("keeps the packaged workflow smoke aligned with script asset generation", () => {
    const smokeScript = readBuildFile("build/smoke-desktop.mjs");
    const assetsStart = smokeScript.indexOf("id: 'assets'");
    const assetsEnd = smokeScript.indexOf("id: 'storyboard'");
    const generationStart = smokeScript.indexOf("id: 'generation'");
    const storyboardStart = smokeScript.indexOf("id: 'storyboard'");
    const storyboardEnd = smokeScript.indexOf("id: 'workbench'");
    const assetsStage = smokeScript.slice(assetsStart, assetsEnd);
    const storyboardStage = smokeScript.slice(storyboardStart, storyboardEnd);

    expect(assetsStart).toBeGreaterThan(-1);
    expect(assetsEnd).toBeGreaterThan(assetsStart);
    expect(generationStart).toBe(-1);
    expect(storyboardStart).toBeGreaterThan(-1);
    expect(storyboardEnd).toBeGreaterThan(storyboardStart);
    expect(assetsStage).toContain("还没有剧本：请先在「剧本生产阶段」生成各章剧本");
    expect(assetsStage).toContain("承接本阶段已提取的角色、场景、道具");
    expect(assetsStage).toContain("全部润色提示词");
    expect(assetsStage).toContain("生成图片");
    expect(assetsStage).toContain("落地衍生资产");
    expect(assetsStage).toContain("音频样本");
    expect(assetsStage).not.toContain("requiredText: ['剧本资产提取'");
    expect(assetsStage).not.toContain("requiredText: ['剧本资产生成'");
    expect(assetsStage).toContain("'角色/场景/道具'");
    expect(storyboardStage).toContain("自动排版");
    expect(storyboardStage).not.toContain("requiredText: ['分镜视频生成'");
    expect(assetsStage).toContain("forbiddenText");
    expect(assetsStage).toContain("运行导演计划");
    expect(assetsStage).toContain("锁定剧集圣经");
    expect(assetsStage).not.toContain("创建缺失资产");
  });

  it("exposes a no-backup installed app smoke flow", () => {
    const packageJson = readBuildFile("package.json");
    const installSmokeScript = readBuildFile("build/install-and-smoke.mjs");

    expect(packageJson).toContain(
      '"smoke:installed": "node ./build/install-and-smoke.mjs"',
    );
    expect(installSmokeScript).toContain("/Applications/漫影工作室.app");
    expect(installSmokeScript).toContain("stopInstalledAppIfRunning");
    expect(installSmokeScript).toContain("tell application id \"com.manju2026.manying-studio\" to quit");
    expect(installSmokeScript).toContain("pkill");
    expect(installSmokeScript).toContain("漫影工作室");
    expect(installSmokeScript).toContain("ditto");
    expect(installSmokeScript).toContain("app.asar");
    expect(installSmokeScript).toContain("createHash");
    expect(installSmokeScript).toContain("forbidden backup app copies");
    expect(installSmokeScript).toMatch(/漫影工作室\\\.app/);
    expect(installSmokeScript).not.toContain("name.includes('backup-*')");
    expect(installSmokeScript).toContain(
      "mkdtempSync(resolve(tmpdir(), 'mystudio-installed-smoke-'))",
    );
    expect(installSmokeScript).toContain("MYSTUDIO_SMOKE_APP_BIN");
    expect(installSmokeScript).toContain("MYSTUDIO_SMOKE_USER_DATA_DIR");
    expect(installSmokeScript).toContain("npm run smoke:desktop");
    expect(installSmokeScript).not.toMatch(
      /spawnSync\(['\"](?:mv|cp|rsync)['\"]/,
    );
    expect(installSmokeScript).not.toMatch(
      /['\"](?:mv|cp|rsync)['\"],\s*\[[^\]]*backup/,
    );
    expect(installSmokeScript).not.toContain("mv /Applications/漫影工作室.app");
    expect(installSmokeScript).not.toContain(
      "cp -R /Applications/漫影工作室.app",
    );
  });

  it("exposes an automated Daojie chapter 001 video output flow", () => {
    const packageJson = readBuildFile("package.json");
    const videoScript = readBuildFile(
      "build/automate-daojie-chapter001-video.mjs",
    );
    const generatorScript = readFileSync(
      resolve(appsRoot, "..", "Library", "build_daojie_chapter001_workflow.py"),
      "utf8",
    );

    expect(packageJson).toContain(
      '"video:daojie:chapter001": "node ./build/automate-daojie-chapter001-video.mjs"',
    );
    expect(videoScript).toContain("Library");
    expect(videoScript).toContain("build_daojie_chapter001_workflow.py");
    expect(videoScript).toContain("daojie-chapter001-video-report.json");
    expect(videoScript).toContain("ffprobe");
    expect(videoScript).toContain("storyboardsWithAssetLinks");
    expect(videoScript).toContain("分镜资产链接不完整");
    expect(videoScript).toContain("分镜未关联塑角/造景/道具资产");
    expect(videoScript).toContain("MIN_DAOJIE_STORYBOARDS");
    expect(videoScript).toContain("道劫第一章分镜过少");
    expect(videoScript).toContain("framesWithRealAssetImages");
    expect(videoScript).toContain("assetImagePaths");
    expect(videoScript).toContain("voiceReferenceAudioPath");
    expect(videoScript).toContain("未绑定资产库音色参考");
    expect(videoScript).toContain("speakerVoiceMap");
    expect(videoScript).toContain("角色音色映射不足");
    expect(videoScript).toContain("dialogueCoverageRatio");
    expect(videoScript).toContain("台词覆盖率过低");
    expect(videoScript).toContain("speakerAudioStats");
    expect(videoScript).toContain("角色音频统计缺失");
    expect(videoScript).toContain("ttsMode");
    expect(videoScript).toContain("ttsBackend");
    expect(videoScript).toContain("ttsMocked");
    expect(videoScript).toContain("voiceEmotionProfile");
    expect(videoScript).toContain("MANYING_REQUIRE_REAL_TTS: '1'");
    expect(videoScript).toContain("MYSTUDIO_ALLOW_TTS_FALLBACK");
    expect(videoScript).toContain("不能使用系统朗读 fallback 作为最终音频");
    expect(videoScript).toContain("silent-visual-preview");
    expect(videoScript).toContain("不能使用静音视觉预览作为最终音频");
    expect(videoScript).toContain("分镜真实资产图片不完整");
    expect(videoScript).toContain("视频没有使用任何真实资产图片");
    expect(videoScript).toContain("真实资产图片不存在");
    expect(videoScript).toContain("真实资产图片为空");
    expect(videoScript).toContain("frameSize");
    expect(videoScript).toContain("分镜画面尺寸错误");
    expect(videoScript).toContain("最终视频缺少 video stream");
    expect(videoScript).toContain("最终视频缺少 audio stream");
    expect(videoScript).toContain("audio duration");
    expect(videoScript).toContain("finalAudioMeanVolumeDb");
    expect(videoScript).toContain("最终视频音量过低");
    expect(videoScript).toContain("speakerAudioSamples");
    expect(videoScript).toContain("角色音频样本缺失");
    expect(generatorScript).toContain("MIN_SHOT_DURATION = 5.0");
    expect(generatorScript).toContain("MAX_SHOT_DURATION = 5.4");
    expect(generatorScript).toContain("MYSTUDIO_DAOJIE_REUSE_AUDIO_DIR");
    expect(generatorScript).toContain("reused-local-tts-audio");
    expect(generatorScript).toContain("alimiter=limit=0.98");
    expect(generatorScript).toContain("aresample=48000");
    expect(generatorScript).toContain('"-ac", "2"');
    expect(generatorScript).toContain("motion_filter_for");
    expect(generatorScript).toContain("crop=w=1920:h=1080");
    expect(generatorScript).not.toContain("zoompan");
    expect(generatorScript).toContain("silent-visual-preview");
    expect(generatorScript).toContain("spoken_text_for");
    expect(generatorScript).toContain("spoken_text_for(speaker, text)");
    expect(generatorScript).toContain("resolve_voice_profile_for_speaker");
    expect(generatorScript).toContain("ROLE_VOICE_PREFERENCES");
    expect(generatorScript).toContain("dialogueCoverageRatio");
    expect(generatorScript).toContain("speakerVoiceMap");
    expect(generatorScript).toContain("speakerAudioStats");
    expect(generatorScript).toContain("speakerAudioSamples");
    expect(generatorScript).toContain("finalAudioMeanVolumeDb");
    expect(generatorScript).toContain("compose_frame_image_assets");
    expect(generatorScript).toContain("create_direct_tts_audio");
    expect(generatorScript).toContain("synthesize_to_wav");
    expect(generatorScript).toContain("本地端口绑定被当前环境阻止");
  });

  it("generates icons from the current frontend assets directory", () => {
    const source = readBuildFile("frontend/scripts/generate-icon.mjs");

    expect(source).toContain("'..'");
    expect(source).toContain("'assets', 'brand'");
    expect(source).toContain("frontend/assets/brand/manying-studio-logo.png");
    expect(source).not.toContain("'src', 'assets', 'brand'");
  });
});
