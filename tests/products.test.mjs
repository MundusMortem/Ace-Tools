import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifiedListings} from '../dist/scanner/listings.mjs';
import {productBarcode, expandUPCE, catalogOffers, selectBestOffer, retailerProduct, retailerItemNumber, findProduct, productLookup, safeProductURL, directRetailerURL, currentRetailerOffer} from '../worker/products.mjs';
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
 assert.equal(mismatch.found,false);assert.equal(mismatch.links.length,3);
});
test('out-of-stock, old, used and foreign prices cannot become a best USD price',()=>{
 const offers=catalogOffers({offers:[listing('old.example',1,{updated_t:now/1000-864000}),listing('foreign.example',2,{currency:'CAD'}),listing('used.example',3,{condition:'Used'}),listing('sold.example',4,{availability:'Out of Stock'}),listing('current.example',20)]},now);
 assert.equal(selectBestOffer(offers,now),null);
 assert.equal(selectBestOffer(offers.filter(o=>o.price!==20),now),null);
 const verified={...offers.at(-1),price:25,verified:true};assert.equal(selectBestOffer([...offers,verified],now).kind,'verified');
 assert.equal(selectBestOffer([...offers,verified],now).offer.price,25);
});
test('retailer structured data requires a matching GTIN and safely reads identifiers',()=>{
 const html=page({'@graph':[{'@type':'Product',gtin13:'0'+barcode,sku:'1234567',mpn:'49-56-0002'}]});
 assert.equal(retailerProduct(html,barcode).sku,'1234567');assert.equal(retailerProduct(html,'012800511730'),null);
 assert.equal(retailerItemNumber('https://www.acehardware.com/departments/tools/saws/1234567').number,'1234567');
 assert.equal(retailerItemNumber('https://www.truevalue.com/item/','654321').merchant,'True Value');
 assert.equal(retailerItemNumber('https://fake-acehardware.com/departments/tools/saws/1234567'),null);
});
test('Ace is preferred to True Value and current verified prices come from exact retailer products',async()=>{
 const item={...product,offers:[listing('truevalue.com',8),listing('acehardware.com',10)]};
 const fake=async url=>{
  if(url.startsWith('https://api.upcitemdb.com/'))return response({items:[item]});
  const ace=new URL(url).hostname.replace(/^www\./,'')==='acehardware.com';
  return new Response(page({'@type':'Product',gtin12:barcode,sku:ace?'1234567':'654321',offers:{price:ace?'12.50':'11.00',priceCurrency:'USD',availability:'https://schema.org/InStock'}}),{headers:{'Content-Type':'text/html'}});
 };
 const r=await findProduct(barcode,fake,now);assert.equal(r.item_number.merchant,'Ace Hardware');assert.equal(r.item_number.number,'1234567');assert.equal(r.best.kind,'verified');assert.equal(r.best.offer.price,11);
 const onlyTV=await findProduct(barcode,async url=>url.startsWith('https://api.upcitemdb.com/')?response({items:[{...item,offers:[item.offers[0]]}]}):url.startsWith('https://www.acehardware.com/search')?new Response('',{status:404}):fake(url),now);
 assert.equal(onlyTV.item_number.merchant,'True Value');
});
test('mismatched retailer GTIN cannot supply a SKU, model or verified price',async()=>{
 const fake=async url=>url.startsWith('https://api.upcitemdb.com/')?response({items:[{...product,offers:[listing('acehardware.com')]}]}):new Response(page({'@type':'Product',gtin12:'012800511730',sku:'wrong',mpn:'wrong',offers:{price:1,priceCurrency:'USD',availability:'https://schema.org/InStock'}}),{headers:{'Content-Type':'text/html'}});
 const r=await findProduct(barcode,fake,now);assert.equal(r.item_number,null);assert.equal(r.model,product.model);assert.equal(r.offers.length,0);
});
test('untrusted URLs and redirect targets are never fetched',async()=>{
 const called=[];
 const fake=async url=>{called.push(url);if(url.startsWith('https://api.upcitemdb.com/'))return response({items:[{...product,offers:[listing('acehardware.com',10,{link:'https://www.upcitemdb.com/norob/alink/?id=example'})]}]});return new Response(null,{status:302,headers:{Location:'http://169.254.169.254/latest/meta-data/'}});};
 await findProduct(barcode,fake,now);assert.equal(called.length,3);assert.ok(called.every(url=>!url.includes('169.254')));
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
 DB.sqlite.prepare('INSERT INTO product_cache VALUES (?,?,?)').run('verified-v6:'+barcode.padStart(14,'0'),JSON.stringify(data),Date.now()+100000);
 const r=await worker.fetch(new Request('https://ace-tools.bonnylight3.chatgpt.site/api/products/lookup?barcode='+barcode,{headers:{Origin:'https://mundusmortem.github.io'}}),{DB});
 assert.equal(r.status,200);assert.equal((await r.json()).title,'Cached product');assert.equal(r.headers.get('access-control-allow-origin'),'https://mundusmortem.github.io');
 const bad=await worker.fetch(new Request('https://ace-tools.bonnylight3.chatgpt.site/api/products/lookup?barcode=123'),{DB});assert.equal(bad.status,400);
});

test('reported UPC 043156961306 unwraps the Ace tracker and reads nested priceSpecification', async()=>{
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
 assert.equal(result.offers.length,1);assert.equal(result.offers[0].price,29.99);assert.equal(result.offers[0].verified,true);assert.equal(result.best.kind,'verified');
 assert.ok(seen.every(url=>!url.startsWith('https://www.gopjn.com/')));
});
test('only three lowest distinct merchants with verified current USD prices are retained',()=>{
 const offer=(domain,price,extra={})=>({...listing(domain,price),url:'https://'+domain+'/product',updated_at:new Date(now).toISOString(),available:true,verified:true,...extra});
 const offers=[offer('five.example',50),offer('one.example',12),offer('two.example',20),offer('three.example',30),offer('four.example',40),offer('one.example',10),offer('old.example',1,{updated_at:new Date(now-300001).toISOString()}),offer('unverified.example',2,{verified:false}),offer('out.example',3,{available:false}),offer('cad.example',4,{currency:'CAD'}),offer('future.example',5,{updated_at:new Date(now+1000).toISOString()})];
 assert.deepEqual(verifiedListings(offers,now).map(o=>o.price),[10,20,30]);
 assert.equal(selectBestOffer(offers,now).offer.price,10);
});
test('expired, future, member-only and out-of-stock prices are not verified',()=>{
 const raw={price:20,priceCurrency:'USD',availability:'https://schema.org/InStock'};
 for(const changes of [{availability:'https://schema.org/OutOfStock'},{priceValidUntil:'2026-11-03'},{validFrom:'2026-11-05'},{validForMemberTier:'club'},{itemCondition:'https://schema.org/UsedCondition'}])assert.equal(currentRetailerOffer({offers:{...raw,...changes}},now),null);
 const nested={availability:raw.availability,priceSpecification:[{price:1,priceCurrency:'USD',priceType:'https://schema.org/StrikethroughPrice'},{price:2,priceCurrency:'USD',validForMemberTier:'club'},{price:29.99,priceCurrency:'USD'}]};
 assert.equal(currentRetailerOffer({offers:nested},now).price,29.99);
});
test('tracking URLs are unwrapped only to approved HTTPS retailer targets',()=>{
 assert.equal(directRetailerURL('https://www.gopjn.com/t/example?url='+encodeURIComponent('https://www.acehardware.com/p/57997')),'https://www.acehardware.com/p/57997');
 for(const target of ['http://169.254.169.254/','https://fake-acehardware.com/p/57997','javascript:alert(1)','https://user:password@www.acehardware.com/p/57997'])assert.equal(directRetailerURL('https://tracker.example/?url='+encodeURIComponent(target)),null);
});
test('legacy cached listings cannot bypass new verification requirements', async()=>{
 const DB=testDatabase();const request=new Request('https://ace-tools.bonnylight3.chatgpt.site/api/products/lookup?barcode='+barcode);
 DB.sqlite.prepare('INSERT INTO product_cache VALUES (?,?,?)').run(barcode.padStart(14,'0'),JSON.stringify({found:true,title:'Legacy catalog listing',offers:[listing('acehardware.com',1)]}),Date.now()+100000);
 let called=0;const result=await productLookup(request,{DB},async url=>{if(!url.startsWith('https://api.upcitemdb.com/'))return new Response('',{status:404});called++;return response({items:[product]});});
 assert.equal(called,1);assert.equal(result.title,product.title);assert.deepEqual(result.offers,[]);assert.equal(result.best,null);
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
 assert.equal(result.item_number.number,'57997');assert.equal(result.best.offer.price,29.99);assert.equal(result.model,'F40VPLY605');assert.equal(result.offers.length,1);
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
 assert.equal(result.best,null);assert.deepEqual(result.offers,[]);assert.equal(result.verification,undefined);
});

test('catalog SKU fallback is rejected when the live page has a different GTIN or is missing',async()=>{
 for(const status of [200,404]){
  const result=await findProduct(barcode,async url=>url.startsWith('https://api.upcitemdb.com/')?response({items:[{...product,offers:[listing('acehardware.com',1,{link:'https://www.acehardware.com/p/57997'})]}]}):new Response(page({'@type':'Product',gtin12:'012800511730',sku:'57997'}),{status,headers:{'Content-Type':'text/html'}}),now);
  assert.equal(result.item_number,null);assert.deepEqual(result.offers,[]);
 }
});
