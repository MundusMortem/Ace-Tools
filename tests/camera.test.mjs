import test from 'node:test';
import assert from 'node:assert/strict';
import {CameraScanner, scanImage} from '../dist/scanner/camera.mjs';
function globals(values) {
 const saved=Object.fromEntries(Object.keys(values).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 for(const [key,value] of Object.entries(values))Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
 return ()=>{for(const [key,descriptor] of Object.entries(saved))descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];};
}
function media() {const track={readyState:'live',stop(){this.readyState='ended';}};return {track,stream:{getTracks:()=>[track]}};}
function video() {return {srcObject:null,async play(){}};}
function native(values=[]) {return class {static async getSupportedFormats(){return ['ean_13','upc_a'];}async detect(){return values;}};}
test('retained native camera scanner stops tracks when closed',async()=>{
 const m=media(),Detector=native();const restore=globals({window:{BarcodeDetector:Detector},BarcodeDetector:Detector,navigator:{mediaDevices:{getUserMedia:async()=>m.stream}}});
 const scanner=new CameraScanner(video(),()=>{});
 try {await scanner.start();assert.equal(m.track.readyState,'live');scanner.stop();assert.equal(m.track.readyState,'ended');assert.equal(scanner.video.srcObject,null);}finally{scanner.stop();restore();}
});
test('retained scanner closes a camera stream granted after cancellation',async()=>{
 const m=media(),Detector=native();let resolveMedia,entered;
 const ready=new Promise(r=>entered=r);
 const restore=globals({window:{BarcodeDetector:Detector},BarcodeDetector:Detector,navigator:{mediaDevices:{getUserMedia:()=>{entered();return new Promise(r=>resolveMedia=r);}}}});
 const scanner=new CameraScanner(video(),()=>{throw Error('Cancelled scan returned a barcode');});
 try {const pending=scanner.start();await ready;scanner.stop();resolveMedia(m.stream);await pending;assert.equal(m.track.readyState,'ended');assert.equal(scanner.video.srcObject,null);}finally{scanner.stop();restore();}
});
test('native camera detection returns barcode once and releases the camera',async()=>{
 const m=media(),Detector=native([{rawValue:'045242271061'}]),codes=[];
 const restore=globals({window:{BarcodeDetector:Detector},BarcodeDetector:Detector,navigator:{mediaDevices:{getUserMedia:async()=>m.stream}}});
 const scanner=new CameraScanner(video(),code=>codes.push(code));
 try{await scanner.start();await new Promise(r=>setImmediate(r));assert.deepEqual(codes,['045242271061']);assert.equal(m.track.readyState,'ended');}finally{scanner.stop();restore();}
});
test('retained ZXing fallback uses the camera and releases decoder controls',async()=>{
 const m=media();let stopped=0;
 const lib={BrowserMultiFormatReader:class{async decodeFromStream(stream,video){video.srcObject=stream;return {stop(){stopped++;}};}}};
 const restore=globals({window:{ZXingBrowser:lib},navigator:{mediaDevices:{getUserMedia:async()=>m.stream}}});
 const scanner=new CameraScanner(video(),()=>{});
 try{await scanner.start();assert.equal(m.track.readyState,'live');scanner.stop();assert.equal(m.track.readyState,'ended');assert.ok(stopped>0);}finally{scanner.stop();restore();}
});
test('camera denial gives the photo/manual fallback message',async()=>{
 const Detector=native();const restore=globals({window:{BarcodeDetector:Detector},BarcodeDetector:Detector,navigator:{mediaDevices:{getUserMedia:async()=>{throw Error('denied');}}}});
 const scanner=new CameraScanner(video(),()=>{});
 try{await assert.rejects(scanner.start(),/Allow camera permission or use a photo\/barcode number/);}finally{scanner.stop();restore();}
});
test('barcode photos decode locally and their image bitmap is closed',async()=>{
 const Detector=native([{rawValue:'045242271061'}]);let closed=false;
 const restore=globals({window:{BarcodeDetector:Detector},BarcodeDetector:Detector,createImageBitmap:async()=>({close(){closed=true;}})});
 try{assert.equal(await scanImage(new File(['image'],'barcode.png',{type:'image/png'})),'045242271061');assert.equal(closed,true);await assert.rejects(scanImage(new File(['text'],'text.txt',{type:'text/plain'})),/Choose a photo/);}finally{restore();}
});
