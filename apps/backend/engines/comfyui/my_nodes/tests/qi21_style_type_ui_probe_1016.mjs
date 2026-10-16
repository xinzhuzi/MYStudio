import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const extensions = [];
const app = { registerExtension: x => extensions.push(x), graph: {setDirtyCanvas() {}} };
const source = fs.readFileSync(path.join(here, '../web/my-qi21-prompt-preview.js'), 'utf8').replace('import { app } from "../../scripts/app.js";', '');
vm.runInNewContext(source, {app, Event: class {}, requestAnimationFrame: x => x(), console});
const ext = extensions.find(x => x.name === 'MY.qi21_bases_text_display');
class Node {
 constructor() {
  this.comfyClass = 'MyQi21美术风格底座';
  this.widgets = ['美术风格', '负向词表'].map(name => ({name, value:'', inputEl:{value:'',style:{},dispatchEvent(){}}}));
  this.size = [560,760]; this.properties = {other: 'preserved'};
 }
 onConfigure(info) { (info.widgets_values || []).slice(0,2).forEach((v,i) => {this.widgets[i].value=v;}); }
 onSerialize(info) {info.widgets_values=this.widgets.map(w=>w.value);}
 onResize() {}
}
await ext.beforeRegisterNodeDef(Node, {name:'MyQi21美术风格底座', input:{optional:{'美术风格':['STRING',{default:'铁线描与矿物罩染。'}], '负向词表':['STRING',{default:'油亮高光'}]}}});
for (const oldValues of [
 ['旧画法','旧背景与顶光','旧透明','旧负向','旧协议'],
 ['旧画法','旧背景与顶光','旧透明','旧负向'],
 ['旧全文含背景','旧负向'],
]) {
 const node = new Node();
 node.onConfigure({widgets_values:oldValues});
 assert.deepEqual(node.widgets.map(w=>w.value), ['铁线描与矿物罩染。','油亮高光']);
 await ext.nodeCreated(node);
 assert.equal(node.widgets.length,2);
 assert.equal(node.widgets[0].inputEl.readOnly,true);
 assert.ok(node.size[1] < 760);
 assert.equal(node.properties.other,'preserved');
 node.onExecuted({output:{merged:{bases_text:['最新纯画法'],bases_text_negative:['最新风格负向']}}});
 assert.deepEqual(node.widgets.map(w=>w.value),['最新纯画法','最新风格负向']);
 const saved={widgets_values_named:{'底色背景件':'旧背景'}};
 node.onSerialize(saved);
 assert.equal(saved.widgets_values_named['美术风格'],'最新纯画法');
 assert.equal(saved.widgets_values_named['负向词表'],'最新风格负向');
 assert.equal(saved.widgets_values_named['底色背景件'],undefined);
 assert.equal(saved.properties.qi21StyleSchema,2);
}
const current = new Node();
current.onConfigure({properties:{qi21StyleSchema:2},widgets_values:['已存纯画法','已存负向']});
assert.deepEqual(current.widgets.map(w=>w.value),['已存纯画法','已存负向']);
console.log('PASS: legacy 5/4/2-value migration, two read-only boxes, merged payload, named serialization and current snapshots');
