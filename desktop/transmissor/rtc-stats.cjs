/* eslint-disable @typescript-eslint/no-require-imports -- Native SDK executables use CommonJS. */
// SDK 1.1.0 has no public Track.getStats. Isolate its pinned FFI diagnostic here.
// Return a strict numeric/codec allowlist; never serialize ICE addresses, ids or SDP.
const path=require('node:path');
const sdkDir=path.dirname(require.resolve(process.env.DISCORD2_RTC_MODULE || '@livekit/rtc-node'));
const {FfiClient}=require(path.join(sdkDir,'ffi_client.cjs'));
async function trackStats(track){
 const ffi=FfiClient.instance;
 const res=ffi.request({message:{case:'getStats',value:{trackHandle:track.ffi_handle.handle}}});
 const result=await ffi.waitFor(ev=>ev.message.case==='getStats' && ev.message.value.asyncId===res.asyncId,{signal:AbortSignal.timeout(2000)});
 if(result.error)throw Error('Stats unavailable');
 return result.stats.flatMap(({stats:s})=>{
  if(s.case==='codec')return [{type:'codec',mimeType:s.value.codec.mimeType,clockRate:s.value.codec.clockRate,channels:s.value.codec.channels}];
  if(s.case==='outboundRtp'){
   const v=s.value.outbound;
   const keys=['frameWidth','frameHeight','framesPerSecond','framesSent','framesEncoded','totalEncodeTime','targetBitrate','qualityLimitationReason','encoderImplementation','powerEfficientEncoder','nackCount','pliCount'];
   return [{type:'outbound',...Object.fromEntries(keys.filter(k=>v[k]!==undefined).map(k=>[k,v[k]])),bytesSent:Number(s.value.sent.bytesSent),packetsSent:Number(s.value.sent.packetsSent)}];
  }
  return [];
 });
}
module.exports={trackStats};
