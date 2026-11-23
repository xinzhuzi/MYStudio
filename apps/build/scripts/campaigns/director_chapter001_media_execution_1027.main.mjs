import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { app, BrowserWindow, session, protocol, ipcMain } from 'electron';
import { registerApiRequestIpcHandlers } from '../../frontend/electron/ipc/ai/api-request-ipc';
import { registerProjectFileIpcHandlers } from '../../frontend/electron/ipc/files/project-file-ipc';
import { registerAssetLibraryIpcHandlers } from '../../frontend/electron/ipc/assets/asset-library-ipc';
import { createImageSourceReader } from '../../frontend/electron/media/image-source';
import { setProjectLocationResolver, resolveProjectScopedFilePath, resolveProjectOrAssetFileUrl, isPathInsideRoot } from '../../frontend/electron/storage/storage-paths';
import { createImageGenRuntimeController } from '../../frontend/electron/rendering/plugins/image_gen/image-gen-runtime-controller';
import { resolveVideoWorkflowRuntimePaths } from '../../frontend/electron/rendering/plugins/video-workflow/video-workflow-runtime';
import { demand, requestBudget, sha, readArtifact, validateFramePermit } from './director_chapter001_media_execution_1027.policy.mjs';

export function boot(folder, config) {
  app.setPath('userData', path.join(folder, 'profile'));
  app.setPath('sessionData', path.join(folder, 'session-data'));
  app.commandLine.appendSwitch('disable-background-networking');
  protocol.registerSchemesAsPrivileged([{ scheme: 'chapter001-execution', privileges: {standard:true,secure:true,supportFetchAPI:true} }]);
  void app.whenReady().then(async () => {
    let win, budget; const readback = []; const evidence = { ok:false, generationExecuted:false, denied:[], counts:{posts:0,requests:0,saves:0} };
    try {
      const memory = session.fromPartition('chapter001-execution-'+crypto.randomUUID(), {cache:false});
      demand(!memory.isPersistent(), 'Memory partition required');
      let input, runtime, bindings, referenceUrls, active = false, expectedSave, plannedFrameIds, selectedStoryboardId;
      const assertSender = event => demand(win && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame, 'Foreign IPC sender');
      if (config.mode === '--generate') {
        const research = path.dirname(folder);
        const accepted = readArtifact(config.accepted, research);
        const frozen = readArtifact(accepted.frozen, research), snapshot = readArtifact(accepted.snapshot, research), job = readArtifact(accepted.job, research);
        const primary = readArtifact(accepted.primaryReview, research);
        bindings = readArtifact(accepted.binding, research); runtime = readArtifact(accepted.runtime, research);
        const permit = readArtifact(accepted.permit, research);
        demand(frozen.schema === 'chapter001-frozen-bridge-v1' && sha(JSON.stringify(snapshot)) === frozen.snapshotSha256 && sha(JSON.stringify(job)) === frozen.jobSha256, 'Frozen snapshot/job mismatch');
        demand(primary.operator === 'root' && primary.passed === true && primary.frozenSha256 === accepted.frozen.sha256 && primary.snapshotSha256 === frozen.snapshotSha256 && primary.jobSha256 === frozen.jobSha256 && primary.baselineSha256 === frozen.baselineSha256, 'Exact root primary review required');
        demand(bindings.operator === 'root' && bindings.passed === true && bindings.frozenSha256 === accepted.frozen.sha256 && bindings.sourceSha256 === snapshot.sourceSha256, 'Root reference/source binding required');
        demand(runtime.operator === 'root' && runtime.healthy === true && runtime.ownershipConfirmed === true && runtime.lifecycle === 'external-no-touch' && runtime.origin === 'http://127.0.0.1:17595', 'Healthy owned external runtime receipt required');
        demand(permit.operator === 'root' && permit.acceptedFrozenSha256 === accepted.frozen.sha256 && permit.bindingSha256 === accepted.binding.sha256 && permit.runtimeSha256 === accepted.runtime.sha256 && Number.isSafeInteger(permit.maxPosts) && permit.maxPosts >= 1 && permit.maxPosts <= 3 && permit.maxSaves === permit.maxPosts && Number.isSafeInteger(permit.maxRequests) && permit.maxRequests === 2 * permit.maxPosts && permit.expiresAt - permit.issuedAt <= 900000 && permit.issuedAt >= runtime.checkedAt && runtime.checkedAt >= permit.issuedAt - 60000, 'Bounded fresh root request permit required');
        const selected = frozen.bridge.envelope.state.storyboards.find(board => board.id === bindings.binding.storyboardId);
        demand(selected?.episodeId === 'chapter-001' && sha(JSON.stringify(selected)) === bindings.binding.storyboardSha256, 'Exact selected shot required');
        plannedFrameIds = validateFramePermit(permit, selected.keyframes);
        selectedStoryboardId = selected.id;
        budget = requestBudget(permit); budget.current();
        demand(fs.realpathSync(snapshot.projectRoot) === snapshot.projectRoot && fs.realpathSync(runtime.assetsRoot) === runtime.assetsRoot && fs.realpathSync(runtime.storageBasePath) === runtime.storageBasePath, 'Canonical real roots required');
        input = { frozen, frozenSha256:accepted.frozen.sha256, projectId:snapshot.projectId, sourceSha256:snapshot.sourceSha256, manifestSha256:snapshot.manifestSha256, binding:bindings.binding, maxPosts:permit.maxPosts, maxSaves:permit.maxSaves };
        const configFile = path.join(resolveVideoWorkflowRuntimePaths(runtime.storageBasePath).pythonRuntimeDir,'profiles','image-gen','config.json');
        // Require an existing token; the real controller must never create one here.
        demand(typeof JSON.parse(fs.readFileSync(configFile,'utf8')).controlToken === 'string' && JSON.parse(fs.readFileSync(configFile,'utf8')).controlToken.length > 0, 'Existing local control token required');
        const assertSourcePins = () => {
          for (const pin of snapshot.sourceFiles) demand(fs.realpathSync(pin.realpath) === pin.realpath && sha(fs.readFileSync(pin.realpath)) === pin.sha256, 'Real source pin changed');
          for (const pin of bindings.referencePins) demand(fs.realpathSync(pin.file) === pin.file && sha(fs.readFileSync(pin.file)) === pin.sha256, 'Real reference pin changed');
        };
        assertSourcePins();
        const configHash = sha(fs.readFileSync(configFile));
        const controller = createImageGenRuntimeController({storageBasePath:runtime.storageBasePath,backendRoot:config.backendRoot});
        setProjectLocationResolver(id => id === input.projectId ? snapshot.projectRoot : undefined);
        referenceUrls = new Set();
        for (const pin of bindings.referencePins) {
          demand(fs.realpathSync(pin.file) === pin.file && sha(fs.readFileSync(pin.file)) === pin.sha256 && resolveProjectOrAssetFileUrl(runtime.storageBasePath,runtime.assetsRoot,pin.url) === pin.file, 'Reference pin mismatch');
          referenceUrls.add(pin.url);
        }
        demand(bindings.continuityAssetVersionsSha256 === sha(JSON.stringify(frozen.bridge.envelope.state.continuityAssetVersions)), 'Continuity version binding mismatch');
        demand(bindings.binding.assetReferences.every(ref => referenceUrls.has(ref.imageUrl) && frozen.bridge.envelope.state.continuityAssetVersions.some(version => version.assetId === ref.assetId && version.referenceImagePaths.includes(ref.imageUrl))), 'Unpinned/unversioned reference');
        const diagnostics = () => undefined; // Never persist headers/body or credentials.
        registerApiRequestIpcHandlers({createOperationId:prefix=>prefix+'-'+crypto.randomUUID(),writeDiagnosticsLog:diagnostics});
        const readImageSource = createImageSourceReader({getDataDir:()=>runtime.storageBasePath,getMediaRoot:()=>path.join(folder,'unused-media'),getAssetsRoot:()=>runtime.assetsRoot,fetchImage:async()=>{throw new Error('Remote image download denied');}});
        registerProjectFileIpcHandlers({getDataDir:()=>runtime.storageBasePath,getAssetsRoot:()=>runtime.assetsRoot,readImageSource,getMimeType:file=>path.extname(file).toLowerCase()==='.jpg'?'image/jpeg':'image/png'});
        registerAssetLibraryIpcHandlers({getStorageBasePath:()=>runtime.storageBasePath,getAssetsRoot:()=>runtime.assetsRoot,getMediaRoot:()=>path.join(folder,'unused-media'),createOperationId:prefix=>prefix+'-'+crypto.randomUUID(),writeDiagnosticsLog:diagnostics,isSourcePathAllowed:()=>false,blessDialogPaths:()=>{throw new Error('No dialogs');}});
        const allowed = new Set(['api-image-request','project-file-save-image','project-file-read-base64','project-file-read-text','assets:read-url-data-url']);
        for (const channel of config.productionChannels) if (!allowed.has(channel)) ipcMain.removeHandler(channel);
        ipcMain.handle('image-gen-runtime-local-token', event => {
          assertSender(event); demand(active,'Inactive'); budget.current();
          demand(sha(fs.readFileSync(configFile)) === configHash,'Runtime config changed');
          return controller.getControlToken();
        });
        ipcMain.handle('chapter001-activate', event => {assertSender(event);budget.current();active=true;});
        ipcMain.handle('chapter001-authorize', (event,{channel,payload}) => {
          assertSender(event); demand(active,'Inactive');budget.current();assertSourcePins();
          if(channel === 'api-image-request') { budget.request(payload); return; }
          if(channel === 'image-gen-runtime-local-token') return;
          if(channel === 'assets:read-url-data-url' || channel === 'project-file-read-base64') { demand(referenceUrls.has(payload) || readback.some(row=>row.path===payload),'Unpinned image read'); return; }
          if(channel === 'project-file-read-text') { demand(payload.projectId === input.projectId && payload.relativePath === bindings.manual.relativePath && payload.raw !== true,'Manual path denied'); const file=resolveProjectScopedFilePath(runtime.storageBasePath,input.projectId,payload.relativePath); demand(sha(fs.readFileSync(file))===bindings.manual.sha256,'Manual hash changed');return; }
          demand(channel === 'project-file-save-image' && payload.projectId === input.projectId && payload.relativePath.startsWith('workflow-images/') && payload.source.startsWith('data:image/'),'Ordinary local save only');
          budget.save();
          const file = resolveProjectScopedFilePath(runtime.storageBasePath,input.projectId,payload.relativePath);
          demand(isPathInsideRoot(snapshot.projectRoot,file) && !fs.existsSync(file),'New canonical destination required');
          // Verify canonical ancestor; ordinary production save remains the actual writer.
          let ancestor=path.dirname(file); while(!fs.existsSync(ancestor)) ancestor=path.dirname(ancestor);
          demand(fs.realpathSync(ancestor)===ancestor,'Symlink destination denied'); expectedSave=file;
        });
        ipcMain.handle('chapter001-saved', (event,result) => {
          assertSender(event); demand(result.success===true && result.filePath===expectedSave && fs.realpathSync(result.filePath)===expectedSave,'Actual save result mismatch');
          const bytes=fs.readFileSync(result.filePath);demand(bytes.length>0 && bytes.length===result.size,'Save readback size mismatch');
          readback.push({path:result.url,file:result.filePath,sha256:sha(bytes),bytes:bytes.length}); expectedSave = undefined;
          budget.saved(); assertSourcePins();
        });
        ipcMain.handle('chapter001-reference-id', (event,id) => {assertSender(event);demand(active,'Inactive');const ref=bindings.binding.assetReferences.find(ref=>ref.assetId===id);demand(ref && referenceUrls.has(ref.imageUrl),'Unknown bound asset ID');return ref.imageUrl;});
        ipcMain.handle('chapter001-readback', event => {assertSender(event);return readback;});
      }
      const networkGuard = (details, callback) => {
        const health = config.mode==='--generate' && details.method==='GET' && details.url==='http://127.0.0.1:17595/health';
        if(health) { try { budget.request({url:details.url,method:'GET'}); } catch { callback({cancel:true});return; } }
        else evidence.denied.push({method:details.method,scheme:new URL(details.url).protocol});
        callback({cancel:!health});
      };
      for(const target of [memory,session.defaultSession]) target.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*','ws://*/*','wss://*/*','file://*/*']},networkGuard);
      memory.protocol.handle('chapter001-execution', () => new Response('<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-eval\'; img-src data: blob:; connect-src http://127.0.0.1:17595/health"><body></body>',{headers:{'content-type':'text/html'}}));
      win=new BrowserWindow({show:false,webPreferences:{session:memory,contextIsolation:true,nodeIntegration:false,sandbox:true,preload:path.join(folder,'preload.cjs')}});
      win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
      await win.loadURL('chapter001-execution://boot/');
      const before=await win.webContents.executeJavaScript('({empty:localStorage.length===0,noFileStorage:!window.fileStorage,noNode:typeof require==="undefined"})');
      demand(Object.values(before).every(Boolean),'Pre-import memory isolation failed');evidence.before=before;
      await win.webContents.executeJavaScript(fs.readFileSync(path.join(folder,'renderer.js'),'utf8'));
      evidence.renderer=await win.webContents.executeJavaScript('Chapter001MediaExecution.bootVerification()');
      if(input) {
        await win.webContents.executeJavaScript('chapter001Control.activate()');
        evidence.generationAttempted=true;
        const media=await win.webContents.executeJavaScript(`Chapter001MediaExecution.generate(${JSON.stringify(input)},()=>chapter001Control.readback())`);
        budget.complete();
        demand(media.frames.length === plannedFrameIds.length && readback.length === plannedFrameIds.length, 'Incomplete actual slot readbacks');
        evidence.frames = media.frames.map((frame, index) => {
          const actual = readback[index];
          demand(frame.storyboardId === selectedStoryboardId && frame.frameId === plannedFrameIds[index] && frame.workflowId && frame.nodeId && ['path','file','sha256','bytes'].every(key => frame[key] === actual[key]), 'Renderer/main original frame readback mismatch');
          return { ...actual, storyboardId:frame.storyboardId, frameId:frame.frameId, workflowId:frame.workflowId, nodeId:frame.nodeId };
        });
        fs.writeFileSync(path.join(folder,'renderer-media.json'),JSON.stringify(media,null,2)+'\n',{flag:'wx'});
        evidence.generationExecuted=true;evidence.counts=budget.counts();
      }
      demand(evidence.denied.length===0,'Unexpected outbound request denied');evidence.ok=true;
    } catch(error) {evidence.error=String(error);}
    finally { evidence.counts=budget?.counts()??evidence.counts; evidence.mainReadbacks=readback; }
    fs.writeFileSync(path.join(folder,'boot.json'),JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});
    win?.destroy(); app.exit(evidence.ok?0:1);
  });
}
