const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(`${__dirname}/index.html`,'utf8');
function loader(){
 const idle=[],requests=[],prefetch=[];
 const state={intro:false,hidden:false,fetches:0};
 const context={
  slides:[{}, {}, {}],SLIDE_CHARACTERS:{1:'c1',2:'c2'},DECK:{thumbnails:[]},IMAGE_PREVIEWS:{},
  window:{requestIdleCallback:true},requestIdleCallback:fn=>idle.push(fn),
  navigator:{connection:{}},addEventListener(){},
  document:{get hidden(){return state.hidden},body:{classList:{contains:()=>state.intro}}},
  Image:class {set src(url){prefetch.push(url)}},
  fetch:async()=>{state.fetches++;return {ok:true,json:async()=>['thumb']}},
 };
 vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf('const deckAssets='),source.indexOf('function resize(){'))+'\nthis.assets=deckAssets;',context);
 const img=()=>({dataset:{src:'visible.webp'},classList:{add(){},remove(){}},removeAttribute(){delete this.dataset.src},addEventListener(){},set src(url){requests.push(url)}});
 return {context,state,idle,requests,prefetch,img};
}
test('overview data is deferred until requested and concurrent requests share one fetch',async()=>{
 const {context,state}=loader();assert.equal(state.fetches,0);
 await Promise.all([context.assets.thumbnails(),context.assets.thumbnails()]);
 assert.equal(state.fetches,1);assert.equal(context.DECK.thumbnails[0],'thumb');
});
test('only the latest adjacent slide is prefetched and data saver suppresses it',()=>{
 const {context,idle,prefetch}=loader();
 context.assets.prepare(0);context.assets.prepare(1);idle.splice(0).forEach(fn=>fn());
 assert.deepEqual(prefetch,['assets/chars/c2.webp']);
 context.navigator.connection.saveData=true;context.assets.prepare(0);idle.splice(0).forEach(fn=>fn());
 assert.equal(prefetch.length,1);
});
test('intro defers image hydration and visible images use asynchronous lazy decoding',()=>{
 const {context,state,requests,img}=loader();const image=img();
 const root={querySelectorAll:()=>[image],querySelector:()=>null};
 state.intro=true;context.assets.hydrate(root);assert.equal(requests.length,0);
 state.intro=false;context.assets.hydrate(root);
 assert.deepEqual(requests,['visible.webp']);assert.equal(image.loading,'lazy');assert.equal(image.decoding,'async');
});

test('the tiny preview stays visible until the full image has decoded',async()=>{
 const {context,img}=loader();
 context.IMAGE_PREVIEWS={'visible.webp':{src:'data:image/webp;base64,preview',width:100,height:200}};
 const classes=new Set(),events={},timers=[];let preview;
 const image=img();image.getAttribute=()=>null;
 image.classList={add:name=>classes.add(name),remove:name=>classes.delete(name)};
 image.addEventListener=(name,callback)=>{events[name]=callback};
 image.parentElement={classList:{add(){}},append:node=>{preview=node}};
 const previewClasses=new Set();
 context.document.createElement=()=>({setAttribute(){},classList:{add:name=>previewClasses.add(name)},remove(){this.removed=true}});
 context.setTimeout=fn=>timers.push(fn);
 let decode;image.decode=()=>new Promise(resolve=>decode=resolve);
 context.assets.hydrate({querySelectorAll:()=>[image],querySelector:()=>null});
 assert.equal(preview.src,'data:image/webp;base64,preview');
 assert.equal(image.width,100);assert.equal(image.height,200);
 events.load();assert.equal(classes.has('asset-ready'),false);
 decode();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(classes.has('asset-ready'),true);
 assert.equal(previewClasses.has('preview-retired'),true);
 timers.forEach(fn=>fn());assert.equal(preview.removed,true);
});
