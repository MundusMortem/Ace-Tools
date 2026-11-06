import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

function element() {
 return {value:'',hidden:true,disabled:false,open:false,events:{},children:[],
  classList:{toggle(){}},setAttribute(){},focus(){this.focused=true;},
  append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=nodes;},
  addEventListener(type,fn){this.events[type]=fn;},querySelector(){return element();},
  showModal(){this.open=true;},close(){this.open=false;this.events.close?.();}};
}
function harness(verified=true) {
 const fields=new Map();const get=id=>{if(!fields.has(id))fields.set(id,element());return fields.get(id);};
 const selected=new Map();const header=element();let dialog;
 const document={hidden:false,querySelector:()=>header,getElementById:get,
  createElement(tag){const node=element();node.tag=tag;if(tag==='dialog'){dialog=node;node.querySelector=selector=>{if(!selected.has(selector))selected.set(selector,element());return selected.get(selector);};}return node;},
  body:element(),addEventListener(){},createTextNode:text=>({textContent:text})};
 const context={document,window:{addEventListener(){}},URL,AbortController,AbortSignal,
  CameraScanner:class {stop(){} async start(){}},scanImage(){},
  fetch:async()=>({ok:true,json:async()=>({found:true,title:'Verified item',barcode:'043156961306',item_number:{merchant:'Ace Hardware',number:'57997',url:'https://www.acehardware.com/p/57997',verified}})})};
 const scanner=readFileSync(new URL('../dist/scanner/app.mjs',import.meta.url),'utf8').replace(/^import .*;\n/,'').replaceAll('export ','');
 runInNewContext('(function(){'+scanner+';globalThis.scanner={openScanner,setAceSkuHandler,lookup};})();',context);
 context.openScanner=context.scanner.openScanner;context.setAceSkuHandler=context.scanner.setAceSkuHandler;
 const orders=readFileSync(new URL('../dist/special-orders/orders.mjs',import.meta.url),'utf8').replace(/^import .*;\n/,'');
 runInNewContext('(function(){'+orders+'})();',context);
 return {context,get,header,dialog,selected};
}
for(const source of ['form','header']) test(source+' scanner imports a verified SKU and title into Special Orders',async()=>{
 const h=harness();h.get('order-description').value='';
 if(source==='form')h.get('order-scan').events.click();else h.header.children[0].events.click();
 await h.context.scanner.lookup('043156961306');
 assert.equal(h.get('order-sku').value,'57997');assert.equal(h.get('order-description').value,'Verified item');assert.equal(h.dialog.open,false);
 assert.equal(h.get('order-scan-status').textContent,'Ace SKU 57997 loaded.');
});
test('catalog matches remain selectable and preserve existing notes',async()=>{
 const h=harness(false);h.get('order-description').value='Customer notes';h.get('order-scan').events.click();
 await h.context.scanner.lookup('043156961306');assert.equal(h.get('order-sku').value,'');
 const product=h.selected.get('.scan-results').children[0];
 product.children.find(node=>node.textContent==='Use Ace SKU 57997').events.click();
 assert.equal(h.get('order-sku').value,'57997');assert.equal(h.get('order-description').value,'Customer notes');
});
