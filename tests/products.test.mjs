import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {productBarcode, expandUPCE, retailerProduct, retailerItemNumber, findProduct, productLookup, safeProductURL, directRetailerURL} from '../worker/products.mjs';
import worker from '../worker/index.js';
import {testDatabase} from './helpers/database.mjs';
const barcode='045242271061';
const now=Date.parse('2026-11-04T00:00:00Z');
const product={upc:barcode,ean:'0'+barcode,title:'Milwaukee Hole Saw',model:'49-56-0002',brand:'Milwaukee',offers:[]};
const response=body=>new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});
function listing(domain,price=10,extra={}) {return {merchant:domain,domain,price,link:'https://'+domain+'/product',currency:'USD',condition:'New',updated_t:now/1000,...extra};}
function page(product) {return '<html><script type="application/ld+json">'+JSON.stringify(product)+'</script></html>';}
test('UPC, EAN, GTIN, UPC-E expansion and checksum validation',()=>{
 assert.equal(productBarcode('0452-4227 1061'),barcode);
 assert.equal(productBarcode('0045242271061'),'0045242271061');
 assert.equal(productBarcode('96385074'),'96385074');
 assert.equal(expandUPCE('04252614'),'042100005264');assert.equal(productBarcode('04252614'),'042100005264');
 for(const code of ['123','045242271062','javascript:alert(1)','123456789012345678'])assert.throws(()=>productBarcode(code));
});
test('only exact barcode matches produce an identified item; model is never inferred',async()=>{
 const found=await findProduct(barcode,async()=>response({items:[{...product,model:''}]}),now);
 assert.equal(found.found,true);assert.equal(found.model,null);assert.equal(found.title,product.title);
 const mismatch=await findProduct(barcode,async()=>response({items:[{...product,upc:'012800511730',ean:'0012800511730'}]}),now);
 assert.equal(mismatch.found,false);assert.equal(mismatch.links.length,2);
});

test('retailer structured data requires a matching GTIN and safely reads identifiers',()=>{
 const html=page({'@graph':[{'@type':'Product',gtin13:'0'+barcode,sku:'1234567',mpn:'49-56-0002'}]});
 assert.equal(retailerProduct(html,barcode).sku,'1234567');assert.equal(retailerProduct(html,'012800511730'),null);
 assert.equal(retailerItemNumber('https://www.acehardware.com/departments/tools/saws/1234567').number,'1234567');
 assert.equal(retailerItemNumber('https://www.truevalue.com/item/','654321').merchant,'True Value');
 assert.equal(retailerItemNumber('https://fake-acehardware.com/departments/tools/saws/1234567'),null);
});
test('Ace is preferred to True Value for exact retailer item numbers',async()=>{
 const item={...product,offers:[listing('truevalue.com',8),listing('acehardware.com',10)]};
 const fake=async url=>{
  if(url.startsWith('https://api.upcitemdb.com/'))return response({items:[item]});
  const ace=new URL(url).hostname.replace(/^www\./,'')==='acehardware.com';
  return new Response(page({'@type':'Product',gtin12:barcode,sku:ace?'1234567':'654321',offers:{price:ace?'12.50':'11.00',priceCurrency:'USD',availability:'https://schema.org/InStock'}}),{headers:{'Content-Type':'text/html'}});
 };
 const r=await findProduct(barcode,fake,now);assert.equal(r.item_number.merchant,'Ace Hardware');assert.equal(r.item_number.number,'1234567');assert.equal(r.best,undefined);assert.equal(r.offers,undefined);
 const onlyTV=await findProduct(barcode,async url=>url.startsWith('https://api.upcitemdb.com/')?response({items:[{...item,offers:[item.offers[0]]}]}):url.includes('klemsonline.com') || url.startsWith('https://www.acehardware.com/search')?new Response('',{status:404}):fake(url),now);
 assert.equal(onlyTV.item_number.merchant,'True Value');
});
test('mismatched retailer GTIN cannot supply a SKU or model',async()=>{
 const fake=async url=>url.startsWith('https://api.upcitemdb.com/')?response({items:[{...product,offers:[listing('acehardware.com')]}]}):new Response(page({'@type':'Product',gtin12:'012800511730',sku:'wrong',mpn:'wrong',offers:{price:1,priceCurrency:'USD',availability:'https://schema.org/InStock'}}),{headers:{'Content-Type':'text/html'}});
 const r=await findProduct(barcode,fake,now);assert.equal(r.item_number,null);assert.equal(r.model,product.model);assert.equal(r.offers,undefined);
});
test('untrusted URLs and redirect targets are never fetched',async()=>{
 const called=[];
 const fake=async url=>{called.push(url);if(url.startsWith('https://api.upcitemdb.com/'))return response({items:[{...product,offers:[listing('acehardware.com',10,{link:'https://www.upcitemdb.com/norob/alink/?id=example'})]}]});return new Response(null,{status:302,headers:{Location:'http://169.254.169.254/latest/meta-data/'}});};
 await findProduct(barcode,fake,now);assert.equal(called.length,4);assert.ok(called.every(url=>!url.includes('169.254')));
 assert.equal(safeProductURL('javascript:alert(1)'),null);assert.equal(safeProductURL('https://user:password@example.com/'),null);
});
test('provider failure and throttling return useful errors',async()=>{
 await assert.rejects(findProduct(barcode,async()=>new Response('',{status:429}),now),e=>e.status===429);
 await assert.rejects(findProduct(barcode,async()=>{throw Error('offline');},now),e=>e.status===503);
});
test('shared cache prevents repeat provider calls and daily budget is bounded',async()=>{
 const DB=testDatabase();let calls=0;const fake=async url=>{if(!url.startsWith('https://api.upcitemdb.com/'))return new Response('',{status:404});calls++;return response({items:[product]});};
 const request=new Request('https://ace-tools.bonnylight3.chatgpt.site/api/products/lookup?barcode='+barcode);
 const first=await productLookup(request,{DB},fake);const second=await productLookup(request,{DB},fake);
 assert.equal(first.title,second.title);assert.equal(calls,1);
 DB.sqlite.prepare('DELETE FROM product_cache').run();
 const day=Math.floor(Date.now()/86400000);DB.sqlite.prepare('UPDATE lookup_limits SET count=90 WHERE key=?').run('day:'+day);
 await assert.rejects(productLookup(request,{DB},fake),e=>e.status===429);assert.equal(calls,1);
});
test('product endpoint is public without dashboard credentials and honors CORS',async()=>{
 const DB=testDatabase();const data={barcode,found:true,title:'Cached product',offers:[],links:[]};
 DB.sqlite.prepare('INSERT INTO product_cache VALUES (?,?,?)').run('items-v9:'+barcode.padStart(14,'0'),JSON.stringify(data),Date.now()+100000);
 const r=await worker.fetch(new Request('https://ace-tools.bonnylight3.chatgpt.site/api/products/lookup?barcode='+barcode,{headers:{Origin:'https://mundusmortem.github.io'}}),{DB});
 assert.equal(r.status,200);assert.equal((await r.json()).title,'Cached product');assert.equal(r.headers.get('access-control-allow-origin'),'https://mundusmortem.github.io');
 const bad=await worker.fetch(new Request('https://ace-tools.bonnylight3.chatgpt.site/api/products/lookup?barcode=123'),{DB});assert.equal(bad.status,400);
});

test('reported UPC 043156961306 unwraps the Ace tracker and reads the exact SKU', async()=>{
 const official=JSON.parse(readFileSync(new URL('./fixtures/ace-57997.json',import.meta.url),'utf8'));
 const code='043156961306';const seen=[];
 const canonical='https://www.acehardware.com/departments/hardware/door-knobs-and-locks/keyed-door-levers-and-knobs/57997';
 const fake=async url=>{
  seen.push(url);
  if(url.startsWith('https://api.upcitemdb.com/'))return response({items:[{upc:code,title:official.name,model:'F40V PLY 605',offers:[listing('acehardware.com',1,{link:'https://www.upcitemdb.com/norob/alink/?id=reported'})]}]});
  if(url.startsWith('https://www.upcitemdb.com/'))return new Response(null,{status:302,headers:{Location:'https://www.gopjn.com/t/example?url='+encodeURIComponent('https://www.acehardware.com/p/57997')}});
  if(url.startsWith('https://www.acehardware.com/search'))return new Response('',{status:404});
  if(url==='https://www.acehardware.com/p/57997')return new Response(null,{status:301,headers:{Location:canonical}});
  assert.equal(url,canonical);return new Response(page(official),{headers:{'Content-Type':'text/html'}});
 };
 const result=await findProduct(code,fake,now);
 assert.equal(result.item_number.number,'57997');assert.equal(result.item_number.merchant,'Ace Hardware');
 assert.equal(result.offers,undefined);assert.equal(result.best,undefined);
 assert.ok(seen.every(url=>!url.startsWith('https://www.gopjn.com/')));
});


test('tracking URLs are unwrapped only to approved HTTPS retailer targets',()=>{
 assert.equal(directRetailerURL('https://www.gopjn.com/t/example?url='+encodeURIComponent('https://www.acehardware.com/p/57997')),'https://www.acehardware.com/p/57997');
 for(const target of ['http://169.254.169.254/','https://fake-acehardware.com/p/57997','javascript:alert(1)','https://user:password@www.acehardware.com/p/57997'])assert.equal(directRetailerURL('https://tracker.example/?url='+encodeURIComponent(target)),null);
});
test('legacy price caches cannot bypass item-only lookup', async()=>{
 const DB=testDatabase();const request=new Request('https://ace-tools.bonnylight3.chatgpt.site/api/products/lookup?barcode='+barcode);
 DB.sqlite.prepare('INSERT INTO product_cache VALUES (?,?,?)').run(barcode.padStart(14,'0'),JSON.stringify({found:true,title:'Legacy catalog listing',offers:[listing('acehardware.com',1)]}),Date.now()+100000);
 let called=0;const result=await productLookup(request,{DB},async url=>{if(!url.startsWith('https://api.upcitemdb.com/'))return new Response('',{status:404});called++;return response({items:[product]});});
 assert.equal(called,1);assert.equal(result.title,product.title);assert.equal(result.offers,undefined);assert.equal(result.best,undefined);
});

test('Ace barcode search discovers and verifies an item even when the catalog has no Ace offer', async()=>{
 const official=JSON.parse(readFileSync(new URL('./fixtures/ace-57997.json',import.meta.url),'utf8'));
 const code='043156961306';const seen=[];
 const result=await findProduct(code,async url=>{
  seen.push(url);
  if(url.startsWith('https://api.upcitemdb.com/'))return response({items:[{upc:code,title:official.name,offers:[]}]});
  if(url==='https://www.acehardware.com/search?query='+code)return new Response(null,{status:301,headers:{Location:'https://www.acehardware.com/p/57997'}});
  assert.equal(url,'https://www.acehardware.com/p/57997');return new Response(page(official),{headers:{'Content-Type':'text/html'}});
 },now);
 assert.equal(result.item_number.number,'57997');assert.equal(result.model,'F40VPLY605');
 assert.ok(seen.every(url=>!url.includes('upcitemdb.com/norob')));
});

test('blocked Ace page retains a labeled catalog item number but no price', async()=>{
 const code='043156961306';
 const result=await findProduct(code,async url=>{
  if(url.startsWith('https://api.upcitemdb.com/'))return response({items:[{upc:code,title:'Schlage privacy knob',offers:[listing('acehardware.com',1,{link:'https://www.upcitemdb.com/norob/alink/?id=reported'})]}]});
  if(url.startsWith('https://www.upcitemdb.com/'))return new Response(null,{status:302,headers:{Location:'https://www.gopjn.com/t/example?url='+encodeURIComponent('https://www.acehardware.com/p/57997')}});
  return new Response('Forbidden',{status:403});
 },now);
 assert.equal(result.item_number.number,'57997');assert.equal(result.item_number.verified,false);
 assert.equal(result.best,undefined);assert.equal(result.offers,undefined);assert.equal(result.verification,undefined);
});

test('catalog SKU fallback is rejected when the live page has a different GTIN or is missing',async()=>{
 for(const status of [200,404]){
  const result=await findProduct(barcode,async url=>url.startsWith('https://api.upcitemdb.com/')?response({items:[{...product,offers:[listing('acehardware.com',1,{link:'https://www.acehardware.com/p/57997'})]}]}):new Response(page({'@type':'Product',gtin12:'012800511730',sku:'57997'}),{status,headers:{'Content-Type':'text/html'}}),now);
  assert.equal(result.item_number,null);assert.equal(result.offers,undefined);
 }
});

test('catalog misses still search Ace and follow only two safe product results', async()=>{
 const seen=[];
 const fake=async url=>{
  seen.push(url);
  if(url.startsWith('https://api.upcitemdb.com/'))return response({items:[]});
  if(url.includes('/search?'))return new Response('<a href="https://evil.example/p/99999">Bad</a><a href="/p/11111">One</a><a href="/p/22222">Two</a><a href="/p/33333">Three</a>',{headers:{'Content-Type':'text/html'}});
  return new Response(page({'@type':'Product',gtin12:url.endsWith('22222')?barcode:'012800511730',sku:url.endsWith('22222')?'22222':'11111',name:'Ace item'}),{headers:{'Content-Type':'text/html'}});
 };
 const result=await findProduct(barcode,fake,now);
 assert.equal(result.found,true);assert.equal(result.item_number.number,'22222');assert.equal(result.title,'Ace item');
 assert.equal(seen.length,4);assert.ok(!seen.some(url=>url.includes('evil.example')||url.endsWith('33333')));
});
test('successful first attempts do not fetch search-result links', async()=>{
 let calls=0;
 const result=await findProduct(barcode,async url=>{
  calls++;
  if(url.startsWith('https://api.upcitemdb.com/'))return response({items:[product]});
  return new Response(page({'@type':'Product',gtin12:barcode,sku:'22222'})+'<a href="/p/33333">More</a>',{headers:{'Content-Type':'text/html'}});
 },now);
 assert.equal(result.item_number.number,'22222');assert.equal(calls,2);
});




test('item-only lookup never contacts comparison retailers or waits for True Value after an Ace match', async()=>{
 const seen=[];
 const fake=async url=>{
  seen.push(url);
  if(url.startsWith('https://api.upcitemdb.com/'))return response({items:[{...product,offers:[listing('lowes.com'),listing('walmart.com'),listing('truevalue.com')]}]});
  assert.ok(url.includes('acehardware.com'),'price retailers and unnecessary identifier fallbacks must not be fetched');
  return new Response(page({'@type':'Product',gtin12:barcode,sku:'22222',offers:{price:12,priceCurrency:'USD',availability:'https://schema.org/InStock'}}),{headers:{'Content-Type':'text/html'}});
 };
 const result=await findProduct(barcode,fake,now);
 assert.equal(result.item_number.number,'22222');assert.equal(seen.length,2);
 assert.equal('offers' in result,false);assert.equal('best' in result,false);
 assert.deepEqual(result.links.map(link=>link.label),['Ace Hardware','True Value']);
});
test('catalog item links without prices still supply an Ace fallback', async()=>{
 const result=await findProduct(barcode,async url=>{
  if(url.startsWith('https://api.upcitemdb.com/'))return response({items:[{...product,offers:[{domain:'acehardware.com',link:'https://www.acehardware.com/p/22222'}]}]});
  if(url.includes('/search?'))return new Response('',{status:404});
  assert.equal(url,'https://www.acehardware.com/p/22222');
  return new Response(page({'@type':'Product',gtin12:barcode,sku:'22222'}),{headers:{'Content-Type':'text/html'}});
 },now);
 assert.equal(result.item_number.number,'22222');assert.equal(result.item_number.verified,true);
});
test('item-only cache is shared by the standalone scanner and Special Orders', async()=>{
 const DB=testDatabase();let calls=0;
 const fake=async url=>{
  calls++;
  if(url.startsWith('https://api.upcitemdb.com/'))return response({items:[product]});
  return new Response(page({'@type':'Product',gtin12:barcode,sku:'22222'}),{headers:{'Content-Type':'text/html'}});
 };
 const url='https://ace-tools.bonnylight3.chatgpt.site/api/products/lookup?barcode='+barcode;
 await productLookup(new Request(url),{DB},fake);
 const cached=await productLookup(new Request(url+'&mode=sku'),{DB},fake);
 assert.equal(calls,2);assert.equal(cached.item_number.number,'22222');assert.equal('offers' in cached,false);
});

test('reported barcode 082901170006 recovers selectable SKU 17000 from an exact Ace dealer match',async()=>{
 const official=JSON.parse(readFileSync(new URL('./fixtures/ace-dealer-17000.json',import.meta.url),'utf8'));
 for(const catalog of [{items:[]},{items:[{upc:'082901170006',title:official.name}]}]) {
  const result=await findProduct('082901170006',async url=>{
   if(url.startsWith('https://api.upcitemdb.com/'))return response(catalog);
   if(url.includes('acehardware.com'))return new Response('Forbidden',{status:403});
   assert.equal(url,'https://klemsonline.com/p/item-082901170006');
   return new Response(page(official),{headers:{'Content-Type':'text/html'}});
  },now);
  assert.equal(result.found,true);assert.equal(result.item_number.number,'17000');
  assert.equal(result.item_number.verified,false);assert.equal(result.item_number.source_label,'Ace dealer match');
 }
});
test('dealer with another barcode cannot supply an Ace SKU',async()=>{
 const result=await findProduct(barcode,async url=>url.startsWith('https://api.upcitemdb.com/')?response({items:[product]}):url.includes('acehardware.com')?new Response('',{status:403}):new Response(page({'@type':'Product',gtin:'082901170006',sku:'17000'}),{headers:{'Content-Type':'text/html'}}),now);
 assert.equal(result.item_number,null);
});
