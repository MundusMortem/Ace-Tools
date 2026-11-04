import test from 'node:test';
import assert from 'node:assert/strict';
import {productBarcode, expandUPCE, catalogOffers, selectBestOffer, retailerProduct, retailerItemNumber, findProduct, productLookup, safeProductURL} from '../worker/products.mjs';
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
 assert.equal(selectBestOffer(offers,now).offer.price,20);
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
  const ace=new URL(url).hostname==='acehardware.com';
  return new Response(page({'@type':'Product',gtin12:barcode,sku:ace?'1234567':'654321',offers:{price:ace?'12.50':'11.00',priceCurrency:'USD',availability:'https://schema.org/InStock'}}),{headers:{'Content-Type':'text/html'}});
 };
 const r=await findProduct(barcode,fake,now);assert.equal(r.item_number.merchant,'Ace Hardware');assert.equal(r.item_number.number,'1234567');assert.equal(r.best.kind,'verified');assert.equal(r.best.offer.price,11);
 const onlyTV=await findProduct(barcode,async url=>url.startsWith('https://api.upcitemdb.com/')?response({items:[{...item,offers:[item.offers[0]]}]}):fake(url),now);
 assert.equal(onlyTV.item_number.merchant,'True Value');
});
test('mismatched retailer GTIN cannot supply a SKU, model or verified price',async()=>{
 const fake=async url=>url.startsWith('https://api.upcitemdb.com/')?response({items:[{...product,offers:[listing('acehardware.com')]}]}):new Response(page({'@type':'Product',gtin12:'012800511730',sku:'wrong',mpn:'wrong',offers:{price:1,priceCurrency:'USD',availability:'https://schema.org/InStock'}}),{headers:{'Content-Type':'text/html'}});
 const r=await findProduct(barcode,fake,now);assert.equal(r.item_number,null);assert.equal(r.model,product.model);assert.equal(r.offers[0].verified,false);
});
test('untrusted URLs and redirect targets are never fetched',async()=>{
 const called=[];
 const fake=async url=>{called.push(url);if(url.startsWith('https://api.upcitemdb.com/'))return response({items:[{...product,offers:[listing('acehardware.com',10,{link:'https://www.upcitemdb.com/norob/alink/?id=example'})]}]});return new Response(null,{status:302,headers:{Location:'http://169.254.169.254/latest/meta-data/'}});};
 await findProduct(barcode,fake,now);assert.equal(called.length,2);assert.ok(called.every(url=>!url.includes('169.254')));
 assert.equal(safeProductURL('javascript:alert(1)'),null);assert.equal(safeProductURL('https://user:password@example.com/'),null);
});
test('provider failure and throttling return useful errors',async()=>{
 await assert.rejects(findProduct(barcode,async()=>new Response('',{status:429}),now),e=>e.status===429);
 await assert.rejects(findProduct(barcode,async()=>{throw Error('offline');},now),e=>e.status===503);
});
test('shared cache prevents repeat provider calls and daily budget is bounded',async()=>{
 const DB=testDatabase();let calls=0;const fake=async()=>{calls++;return response({items:[product]});};
 const request=new Request('https://ace-tools.bonnylight3.chatgpt.site/api/products/lookup?barcode='+barcode);
 const first=await productLookup(request,{DB},fake);const second=await productLookup(request,{DB},fake);
 assert.equal(first.title,second.title);assert.equal(calls,1);
 DB.sqlite.prepare('DELETE FROM product_cache').run();
 const day=Math.floor(Date.now()/86400000);DB.sqlite.prepare('UPDATE lookup_limits SET count=90 WHERE key=?').run('day:'+day);
 await assert.rejects(productLookup(request,{DB},fake),e=>e.status===429);assert.equal(calls,1);
});
test('product endpoint is public without dashboard credentials and honors CORS',async()=>{
 const DB=testDatabase();const data={barcode,found:true,title:'Cached product',offers:[],links:[]};
 DB.sqlite.prepare('INSERT INTO product_cache VALUES (?,?,?)').run(barcode.padStart(14,'0'),JSON.stringify(data),Date.now()+100000);
 const r=await worker.fetch(new Request('https://ace-tools.bonnylight3.chatgpt.site/api/products/lookup?barcode='+barcode,{headers:{Origin:'https://mundusmortem.github.io'}}),{DB});
 assert.equal(r.status,200);assert.equal((await r.json()).title,'Cached product');assert.equal(r.headers.get('access-control-allow-origin'),'https://mundusmortem.github.io');
 const bad=await worker.fetch(new Request('https://ace-tools.bonnylight3.chatgpt.site/api/products/lookup?barcode=123'),{DB});assert.equal(bad.status,400);
});
