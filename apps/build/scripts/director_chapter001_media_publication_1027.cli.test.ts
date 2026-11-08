/** Opt-in text freeze only. All outputs are exclusive task evidence writes. */
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { it } from 'vitest';
import { chapter001Sha256 as sha, type Chapter001Snapshot, type Chapter001ApplyJob } from './director_chapter001_bridge_1026.test';
import { freezeChapter001Bridge1027, replayChapter001Bridge1027 } from './director_chapter001_media_publication_1027.test';
import { preflightChapter001Offline1027, offlineBaselineHash1027 } from './director_chapter001_offline_apply_1027.test';
const task=path.resolve(import.meta.dirname,'../../../.trellis/tasks/10-25-daojie-director-rule-conflict-validation');
function demand(value:unknown,message:string):asserts value {if(!value) throw new Error(message);}

function taskArtifact(file:string,output=false):string {
  const resolved=output?path.join(realpathSync(path.dirname(file)),path.basename(file)):realpathSync(file);
  demand(resolved.startsWith(path.join(task,'research')+path.sep),'artifact outside task research');
  if(output) demand(path.basename(resolved).startsWith('chapter001-media-publication-'),'freeze output evidence prefix mismatch');
  return resolved;
}
const freezeInput=process.env.DIRECTOR_CHAPTER001_MEDIA_PUBLICATION_1027_INPUT;
const freezeOutput=process.env.DIRECTOR_CHAPTER001_MEDIA_PUBLICATION_1027_OUTPUT;
it.skipIf(!freezeInput||!freezeOutput)('freeze accepted text bridge with an exact production entropy transcript (task evidence only)',async()=>{
  demand(process.env.DIRECTOR_CHAPTER001_MEDIA_PUBLICATION_1027==='FREEZE_TEXT_BRIDGE','explicit read-only freeze mode required');
  demand(!process.env.DIRECTOR_CHAPTER001_APPLY_INPUT && !process.env.DIRECTOR_CHAPTER001_PERSIST_INPUT && !process.env.DIRECTOR_CHAPTER001_OFFLINE_APPLY_1027_INPUT,'disable imported CLIs');
  const input=JSON.parse(readFileSync(taskArtifact(freezeInput!),'utf8')) as {snapshotFile:string;job:Chapter001ApplyJob};
  const snapshot=JSON.parse(readFileSync(taskArtifact(input.snapshotFile),'utf8')) as Chapter001Snapshot;
  const rehearsal=await preflightChapter001Offline1027(snapshot,input.job);
  demand(rehearsal.safeToApply && rehearsal.manifestLast,'unsafe frozen baseline');
  const current=()=>{
    for(const row of snapshot.sourceFiles) demand(realpathSync(row.realpath)===row.realpath && sha(readFileSync(row.realpath,'utf8'))===row.sha256,'live source drift during freeze');
    return snapshot;
  };
  const frozen=await freezeChapter001Bridge1027(snapshot,input.job,offlineBaselineHash1027(rehearsal.baselineHashes),current);
  await replayChapter001Bridge1027(snapshot,input.job,frozen,current);
  writeFileSync(taskArtifact(freezeOutput!,true),JSON.stringify(frozen,null,2)+'\n',{flag:'wx'});
});
