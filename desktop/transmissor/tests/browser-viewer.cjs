// Optional smoke test of the EXISTING local website. Creates/closes its own incognito context.
// No capture API, browser flags, device permissions, production URL or existing tab changes.
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function browserViewer(base,roomId){
 const v=await fetch('http://127.0.0.1:9222/json/version',{signal:AbortSignal.timeout(2000)}).then(r=>r.json());
 const socket=new WebSocket(v.webSocketDebuggerUrl);
 await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});
 let next=0;const pending=new Map();
 socket.onmessage=e=>{const m=JSON.parse(e.data);const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);if(m.error)p.reject(Error('Browser command failed'));else p.resolve(m.result);}};
 function send(method,params={},sessionId){return new Promise((resolve,reject)=>{const id=++next;const timer=setTimeout(()=>{pending.delete(id);reject(Error('Browser deadline'));},10000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});}
 let context;
 try{
  context=(await send('Target.createBrowserContext')).browserContextId;
  const target=(await send('Target.createTarget',{url:`${base}/sala/${roomId}`,browserContextId:context})).targetId;
  const session=(await send('Target.attachToTarget',{targetId:target,flatten:true})).sessionId;
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false},session);
  const evaluate=async expression=>(await send('Runtime.evaluate',{expression,returnByValue:true,userGesture:true},session)).result?.value;
  const end=Date.now()+30000;
  while(!await evaluate('(()=>{const e=document.querySelector("#room-join-name");return !!e && Object.keys(e).some(k=>k.startsWith("__reactFiber"));})()')){if(Date.now()>end)throw Error('Website form unavailable');await delay(250);}
  await evaluate('document.querySelector("#room-join-name").focus();true');
  await send('Input.insertText',{text:'Teste web nativo'},session);
  await evaluate('document.querySelector("#room-join-name").form.requestSubmit();true');
  await delay(1500);
  let latest, timer, busy=false;
  const controller={
   async stats(){const current=await evaluate(`(()=>{const enable=document.querySelector('.remote-audio button');if(enable?.textContent.trim()==='Ativar som')enable.click();const video=[...document.querySelectorAll('video')].find(v=>v.videoWidth>0);const q=video?.getVideoPlaybackQuality?.();return {videoWidth:video?.videoWidth??0,videoHeight:video?.videoHeight??0,videoTime:video?.currentTime??0,decodedFrames:q?.totalVideoFrames??0,droppedFrames:q?.droppedVideoFrames??0,audio:[...document.querySelectorAll('audio')].map(a=>({paused:a.paused,readyState:a.readyState,currentTime:a.currentTime,error:a.error?.code??null}))};})()`);if(current?.videoWidth>0 && (!latest || current.decodedFrames>=latest.decodedFrames))latest=current;return latest || current;},
   async close(){clearInterval(timer);await send('Target.disposeBrowserContext',{browserContextId:context}).finally(()=>socket.close());}
  };
  timer=setInterval(()=>{if(!busy){busy=true;void controller.stats().catch(()=>{}).finally(()=>{busy=false;});}},750);
  return controller;
 }catch(e){if(context)try{await send('Target.disposeBrowserContext',{browserContextId:context});}catch{}socket.close();throw e;}
}
module.exports={browserViewer};
