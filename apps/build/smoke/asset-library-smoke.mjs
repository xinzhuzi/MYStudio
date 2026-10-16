// Real renderer geometry and query interactions. Called only by isolated smoke.
async function browserProbe(command) {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const visible = node => !!node && node.getBoundingClientRect().width > 20 && node.getBoundingClientRect().height > 10;
  const waitFor = async predicate => {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) { if (predicate()) return true; await sleep(80); }
    return false;
  };
  const click = (selector, text) => {
    const node = Array.from(document.querySelectorAll(selector)).find(n => visible(n) && n.textContent.trim() === text);
    node?.click(); return !!node;
  };
  const library = () => Array.from(document.querySelectorAll('.studio-asset-library')).find(visible);
  const cards = () => Array.from(library()?.querySelectorAll('button[title]') || []);
  const setSearch = async value => {
    const input = library()?.querySelector('input[placeholder="搜索名称"]');
    if (!input) throw new Error('visible asset search missing');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(300);
  };
  const rect = node => { const r = node?.getBoundingClientRect(); return r ? { x:r.x,y:r.y,width:r.width,height:r.height } : null; };
  const geometry = () => {
    const root = document.querySelector('.studio-workspace-assets');
    const group = root?.querySelector('[data-group]');
    const panels = group ? Array.from(group.children).filter(n => n.hasAttribute('data-panel')) : [];
    const separator = group?.querySelector('[role="separator"]');
    return { viewport:{width:innerWidth,height:innerHeight}, group:rect(group), panels:panels.map(rect), separator:rect(separator), orientation:separator?.getAttribute('aria-orientation'), cursor:separator ? getComputedStyle(separator).cursor : null, library:rect(library()) };
  };
  if (command === 'prepare') {
    // The voice check can leave its audio detail open. Close via the real dialog.
    for (let i=0;i<4 && document.querySelector('[role="dialog"]');i++) {
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true})); await sleep(100);
    }
    click('.studio-nav-button','资产');
    await waitFor(() => document.querySelector('.asset-sidebar-item'));
    // Do not require visibility here: this must return geometry for collapsed baselines.
    const role = Array.from(document.querySelectorAll('.asset-sidebar-item')).find(n => n.textContent.trim()==='角色');
    role?.click(); await sleep(400);
    return geometry();
  }
  if (command === 'geometry') return geometry();
  if (command === 'interactions') {
    const results = {};
    const hasCard = name => cards().some(n => n.title===name && visible(n));
    await setSearch('Smoke测试剑修');
    results.search = await waitFor(() => hasCard('Smoke测试剑修') && cards().every(n => n.title.includes('Smoke测试剑修')));
    await setSearch('__smoke_no_such_asset__');
    results.emptySearch = await waitFor(() => cards().length===0 && library()?.textContent.includes('还没有角色素材'));
    await setSearch('Smoke测试剑修');
    results.cachedSearch = await waitFor(() => hasCard('Smoke测试剑修'));
    const refresh = library()?.querySelector('svg.lucide-refresh-cw')?.closest('button');
    refresh?.click(); await sleep(300);
    results.refresh = !!refresh && await waitFor(() => hasCard('Smoke测试剑修'));
    const card = cards().find(n => n.title==='Smoke测试剑修');
    if (card) {
      const r=card.getBoundingClientRect();
      const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
      results.cardHit = hit===card || card.contains(hit);
    }
    // Fixture writes stay in the isolated profile, through existing public IPC.
    const fixtures=[['scene','Smoke测试场景',null],['tool','Smoke测试货币','货币'],['tool','Smoke测试灵草','灵草']];
    for (const [type,name,category] of fixtures) {
      const found=await window.studioAssets.list({type,search:name,limit:1});
      const item=found.items[0] || await window.studioAssets.add({type,name,description:'Isolated smoke fixture'});
      if (!item) throw new Error('asset fixture creation failed: '+name);
      if (category) await window.studioAssets.update({id:item.id,updates:{tags:[category]}});
    }
    click('.asset-sidebar-item','场景');
    results.scene = await waitFor(() => hasCard('Smoke测试场景'));
    const pages=await window.studioAssets.list({type:'scene',search:'Smoke分页',limit:100});
    const names=new Set(pages.items.map(item=>item.name));
    for (let i=0;i<61;i++) {
      const name='Smoke分页'+String(i).padStart(3,'0');
      if (!names.has(name)) await window.studioAssets.add({type:'scene',name,description:'Isolated pagination fixture'});
    }
    await setSearch('Smoke分页');
    const header=()=>library()?.querySelector('.studio-asset-library-header')?.textContent || '';
    results.firstPage=await waitFor(()=>header().includes('60 / 61'));
    const more=Array.from(library()?.querySelectorAll('button') || []).find(n=>n.textContent.trim()==='加载更多');
    more?.scrollIntoView({block:'center'}); await sleep(100); more?.click();
    results.pagination=!!more && await waitFor(()=>header().includes('61 / 61'));
    await setSearch('Smoke测试场景');
    results.searchAfterScroll=await waitFor(()=>hasCard('Smoke测试场景'));
    click('.asset-sidebar-item','道具');
    results.toolCurrency = await waitFor(() => hasCard('Smoke测试货币'));
    click('.studio-asset-library button','灵草');
    results.toolHerb = await waitFor(() => hasCard('Smoke测试灵草') && !hasCard('Smoke测试货币'));
    click('.asset-sidebar-item','配音');
    results.audio = await waitFor(() => hasCard('Smoke青年男声'));
    click('.asset-sidebar-item','角色');
    results.sectionReturn = await waitFor(() => hasCard('Smoke测试剑修'));
    const splitUsable=selector=> {
      const root=document.querySelector(selector);
      const groups=Array.from(root?.querySelectorAll('[data-group]') || []).filter(visible);
      return groups.length>0 && groups.every(group=> {
        const panels=Array.from(group.children).filter(node=>node.hasAttribute('data-panel'));
        return panels.length>=2 && panels.every(node=>node.getBoundingClientRect().width>80);
      });
    };
    click('.studio-nav-button','技能');
    results.skillsSplit=await waitFor(()=>splitUsable('.skills-workspace'));
    click('.studio-nav-button','产物');
    results.artifactSplit=await waitFor(()=> {
      const group=document.querySelector('[data-group] [id="artifact-nav"]')?.parentElement;
      return !!group && Array.from(group.children).filter(node=>node.hasAttribute('data-panel')).every(node=>node.getBoundingClientRect().width>100);
    });
    click('.studio-nav-button','概览'); await sleep(250);
    click('.studio-nav-button','资产'); await sleep(300);
    const role=Array.from(document.querySelectorAll('.asset-sidebar-item')).find(n=>n.textContent.trim()==='角色'); role?.click();
    results.routeReturn = await waitFor(() => hasCard('Smoke测试剑修'));
    return results;
  }
  if (command === 'vertical-css') {
    const real=document.querySelector('.studio-workspace-assets [role="separator"]');
    if (!real) return null;
    const fixture=document.createElement('div');
    fixture.style.cssText='display:flex;flex-direction:column;width:300px;height:300px;position:fixed;left:-10000px;top:0';
    const first=document.createElement('div'),second=document.createElement('div');
    first.style.cssText=second.style.cssText='flex:1;min-height:0';
    const separator=real.cloneNode(true); separator.setAttribute('aria-orientation','horizontal');
    fixture.append(first,separator,second); document.body.append(fixture);
    try { return { separator:rect(separator), panels:[rect(first),rect(second)], cursor:getComputedStyle(separator).cursor }; }
    finally { fixture.remove(); }
  }
  throw new Error('unknown asset probe command');
}

function geometryFailures(state, label) {
  const failures=[];
  if (!state?.group || state.panels.length!==2) return [label+': split group missing'];
  if (state.panels[0].width<100 || state.panels[1].width<350 || state.panels.some(p=>p.height<150)) failures.push(label+': asset panels collapsed');
  if (!state.separator || state.separator.width<4 || state.separator.width>16 || state.separator.height<150 || state.orientation!=='vertical' || state.cursor!=='col-resize') failures.push(label+': horizontal split separator invalid');
  const share=state.panels[0].width/(state.panels[0].width+state.panels[1].width);
  if (share<0.115 || share>0.255) failures.push(label+': sidebar percentage constraint violated');
  return failures;
}

export async function verifyAssetLibraryLayout(evaluate, send) {
  const probe = command => evaluate(`(${browserProbe.toString()})(${JSON.stringify(command)})`, `asset geometry ${command}`, 60_000);
  const initial=await probe('prepare');
  const failures=geometryFailures(initial,'initial');
  if (failures.length) return {ok:false,failures,initial};
  const interactions=await probe('interactions');
  for (const [name,ok] of Object.entries(interactions)) if (!ok) failures.push('asset interaction failed: '+name);
  const returned=await probe('geometry'); failures.push(...geometryFailures(returned,'route return'));
  // Inspect orientation CSS before dragging: the library uses a document-wide
  // !important cursor during separator interactions.
  const vertical=await probe('vertical-css');
  if (!vertical || vertical.separator.height<4 || vertical.separator.height>16 || vertical.separator.width<290 || vertical.cursor!=='row-resize' || vertical.panels.some(p=>p.height<100)) failures.push('vertical separator CSS geometry invalid');
  const separator=returned.separator;
  const x=separator.x+separator.width/2,y=separator.y+separator.height/2;
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',buttons:1,clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:x+45,y,button:'left',buttons:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:x+45,y,button:'left',clickCount:1});
  await evaluate('new Promise(resolve => setTimeout(resolve,150))','asset drag settle');
  const dragged=await probe('geometry'); failures.push(...geometryFailures(dragged,'drag'));
  if (Math.abs(dragged.panels[0].width-returned.panels[0].width)<5) failures.push('asset separator drag did not change panel width');
  let resized;
  try {
    await send('Emulation.setDeviceMetricsOverride',{width:1200,height:850,deviceScaleFactor:1,mobile:false});
    // Allow ResizeObserver and panel registration to settle.
    await evaluate('new Promise(resolve => setTimeout(resolve,250))','asset resize settle');
    resized=await probe('geometry'); failures.push(...geometryFailures(resized,'resize'));
  } finally { await send('Emulation.clearDeviceMetricsOverride'); }
  // Leave the real handle before subsequent smoke flows.
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1});
  await evaluate('new Promise(resolve => setTimeout(resolve,100))','asset cursor settle');
  return {ok:failures.length===0,failures,initial,returned,dragged,resized,vertical,interactions};
}
