// @vitest-environment jsdom
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
