let library;
export function loadDecoder(){if(window.ZXingBrowser)return Promise.resolve(window.ZXingBrowser);if(library)return library;library=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=new URL('./vendor/zxing-browser.min.js',import.meta.url).href;script.onload=()=>window.ZXingBrowser?resolve(window.ZXingBrowser):reject(Error('Barcode decoder could not start.'));script.onerror=()=>{library=null;script.remove();reject(Error('Barcode decoder is unavailable. Enter the barcode digits instead.'));};document.head.append(script);});return library;}
async function detector(){if(!('BarcodeDetector'in window))return null;try{const formats=await BarcodeDetector.getSupportedFormats();const use=['ean_13','ean_8','upc_a','upc_e','itf'].filter(f=>formats.includes(f));return use.length?new BarcodeDetector({formats:use}):null;}catch{return null;}}
export async function scanImage(file){
 if(!file?.type.startsWith('image/'))throw Error('Choose a photo of the barcode.');if(file.size>15000000)throw Error('Choose a barcode photo smaller than 15 MB.');
 const native=await detector();if(native){const bitmap=await createImageBitmap(file);try{const results=await native.detect(bitmap);if(results.length)return results[0].rawValue;}finally{bitmap.close();}}
 const lib=await loadDecoder(),reader=new lib.BrowserMultiFormatReader(),url=URL.createObjectURL(file);
 try{return (await reader.decodeFromImageUrl(url)).getText();}catch{throw Error('No barcode could be read. Try a clearer, well-lit photo or enter its digits.');}finally{URL.revokeObjectURL(url);}
}
export class CameraScanner{
 constructor(video,onCode){this.video=video;this.onCode=onCode;this.cancelled=true;this.generation=0;}
 stop(){this.cancelled=true;this.generation++;clearTimeout(this.timer);this.controls?.stop();this.controls=null;this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;const media=this.video.srcObject;media?.getTracks?.().forEach(t=>t.stop());this.video.srcObject=null;}
 async start(){
  this.stop();this.cancelled=false;const generation=this.generation;
  if(!navigator.mediaDevices?.getUserMedia)throw Error('Camera scanning is unavailable in this browser. Upload a barcode photo or enter its digits.');
  const native=await detector();if(this.cancelled||generation!==this.generation)return;
  if(native){
   let stream;try{stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});}catch{throw Error('Camera access was not available. Allow camera permission or use a photo/barcode number.');}
   if(this.cancelled||generation!==this.generation){stream.getTracks().forEach(t=>t.stop());return;}
   this.stream=stream;this.video.srcObject=stream;await this.video.play();
   const tick=async()=>{if(this.cancelled||generation!==this.generation)return;try{const codes=await native.detect(this.video);if(codes.length){const value=codes[0].rawValue;this.stop();this.onCode(value);return;}}catch{}if(!this.cancelled)this.timer=setTimeout(tick,220);};tick();
  }else{
   const lib=await loadDecoder();if(this.cancelled||generation!==this.generation)return;
   const reader=new lib.BrowserMultiFormatReader();
   let stream;try{stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});}catch{throw Error('Camera access was not available. Allow camera permission or use a photo/barcode number.');}
   if(this.cancelled||generation!==this.generation){stream.getTracks().forEach(t=>t.stop());return;}
   this.stream=stream;
   try{const controls=await reader.decodeFromStream(stream,this.video,(result,error,controls)=>{if(this.cancelled||generation!==this.generation){controls?.stop();return;}if(result){const value=result.getText();controls?.stop();this.stop();this.onCode(value);}});if(this.cancelled||generation!==this.generation)controls.stop();else this.controls=controls;}catch{const cancelled=this.cancelled;this.stop();if(!cancelled)throw Error('Camera scanning could not start. Use a barcode photo or type its digits.');}
  }
 }
}
