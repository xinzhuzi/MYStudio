from pathlib import Path
import json
root=Path.cwd()
base=root/'apps/build/scripts/project-gap-audit-1017'
base.mkdir(exist_ok=False)
meta={'probeDir':str(base),'note':'Isolated regression probes: passing assertions document current defects; no production changes.'}
(base/'README.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2))
q=root/'apps/frontend/electron/rendering/plugins/remotion/queue'
s=(q/'remotion-render-queue.test.ts').read_text().split('describe("RemotionRenderQueue",')[0]
s=s.replace('from "./remotion-render-queue"',f'from "{q}/remotion-render-queue"')
s+='''
describe("audit: queue failure reproduction", () => {
  it("parallel commits reuse seq and journal-only recovery loses one job", async () => {
    const events: RemotionQueueEventV1[]=[];
    const inputs=await Promise.all([makeInput(0),makeInput(1)]);
    const persistence={load:async()=>({snapshot:undefined,events}),append:async(e:RemotionQueueEventV1)=>{events.push(e);await Promise.resolve();},writeSnapshot:async()=>{}};
    const executor={render:async()=>({success:false as const,jobId:"unused",canceled:false,error:"unused"}),cancel:(jobId:string)=>({success:false,jobId,canceled:false,error:"not running"})};
    const queue=new RemotionRenderQueue({persistence,executor});
    await queue.init();
    await Promise.all(inputs.map(input=>(queue as any).commit(input)));
    expect(events.map(e=>e.seq)).toEqual([1,1]);
    const restored=new RemotionRenderQueue({persistence,executor});
    await restored.init();
    expect(restored.getJobs({projectId:"project-a"})).toHaveLength(1);
    console.log("AUDIT queue-sequence",JSON.stringify({seq:events.map(e=>e.seq),before:2,after:restored.getJobs({projectId:"project-a"}).length}));
  });
  it("blocked jobs cannot be canceled when no executor owns them", async () => {
    const input=await makeInput();
    input.job={...input.job,status:"blocked",error:{code:"gate",message:"gate",stage:"S4"}};
    const persistence=new MemoryPersistence();
    persistence.snapshot={schemaVersion:1,lastSeq:0,jobs:[input],updatedAt:1};
    let calls=0;
    const queue=new RemotionRenderQueue({persistence,executor:{render:async()=>({success:false,jobId:input.job.jobId,canceled:false,error:"unused"}),cancel:jobId=>{calls++;return {success:false,jobId,canceled:false,error:"not running"};}}});
    await queue.init();
    expect(queue.cancel(input.job.jobId).success).toBe(false);
    expect(calls).toBe(1);
    expect(queue.getJob(input.job.jobId)?.status).toBe("blocked");
  });
});
'''
(base/'queue.test.ts').write_text(s)
p=root/'apps/frontend/lib/storage'
s=(p/'project-storage.test.ts').read_text().split('describe("createProjectScopedStorage",')[0]
s=s.replace('"./indexed-db-storage"',f'"{p}/indexed-db-storage"').replace('"./project-storage"',f'"{p}/project-storage"')
s+='''
const split=(state:TestState,pid:string)=>({projectData:{...state,items:state.items.filter(i=>i.projectId===pid)},sharedData:{...state,items:state.items.filter(i=>!i.projectId)}});
const merge=(a:TestState|null,b:TestState|null)=>({items:[...(b?.items??[]),...(a?.items??[])]});
const make=()=>createSplitStorage<TestState>("characters",split,merge,"shareCharacters");
const seed=(key:string,items:TestItem[])=>storageMocks.values.set(key,JSON.stringify({state:{items},version:1}));
describe("audit: split storage data loss reproduction",()=>{
 it("saving while sharing is disabled clears existing shared resources",async()=>{
  storageMocks.resourceSharing.shareCharacters=false;
  seed("_p/p1/characters",[{id:"own",projectId:"p1"}]);seed("_shared/characters",[{id:"shared"}]);
  const storage=make(); const loaded=await storage.getItem("library");
  await storage.setItem("library",loaded!);
  expect(JSON.parse(storageMocks.values.get("_shared/characters")!).state.items).toEqual([]);
 });
 it("removing the last other-project item leaves its disk file unchanged",async()=>{
  seed("_p/p1/characters",[]);seed("_p/p2/characters",[{id:"last",projectId:"p2"}]);
  const storage=make();const loaded=JSON.parse((await storage.getItem("library"))!);
  expect(loaded.state.items).toHaveLength(1);
  loaded.state.items=[];await storage.setItem("library",JSON.stringify(loaded));
  const reloaded=JSON.parse((await storage.getItem("library"))!);
  expect(reloaded.state.items.map((i:TestItem)=>i.id)).toEqual(["last"]);
 });
});
'''
(base/'split-storage.test.ts').write_text(s)
s='''// @vitest-environment jsdom
import {it,expect,vi,afterEach} from "vitest";
import {fileStorage} from "@/lib/storage/indexed-db-storage";
afterEach(()=>vi.unstubAllGlobals());
it("audit: failed disk write resolves and migration removes sole browser copy",async()=>{
 const payload=JSON.stringify({state:{characters:[{id:"only-copy"}]}});
 localStorage.setItem("audit-migrate",payload);
 const failed=vi.fn(async()=>false);
 vi.stubGlobal("window",{fileStorage:{getItem:async()=>null,setItem:failed}});
 await expect(fileStorage.setItem("audit-save",payload)).resolves.toBeUndefined();
 expect(await fileStorage.getItem("audit-migrate")).toBe(payload);
 expect(localStorage.getItem("audit-migrate")).toBeNull();
 expect(failed).toHaveBeenCalledTimes(2);
});
'''
(base/'write-ack.test.ts').write_text(s)
print(base)
