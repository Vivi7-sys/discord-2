/* eslint-disable @typescript-eslint/no-require-imports -- Native SDK executables use CommonJS. */
// Pinned SDK 1.1.0 omits isScreencast in its public VideoSource constructor.
// Use the SDK's same native source/VideoSource methods with that FFI option enabled.
const path=require('node:path');
const rtc=require(process.env.DISCORD2_RTC_MODULE || '@livekit/rtc-node');
const {FfiClient,FfiHandle}=require(path.join(path.dirname(require.resolve(process.env.DISCORD2_RTC_MODULE || '@livekit/rtc-node')),'ffi_client.cjs'));
function screenSource(width=1920,height=1080){
 const res=FfiClient.instance.request({message:{case:'newVideoSource',value:{type:0,resolution:{width,height},isScreencast:true}}});
 return Object.assign(Object.create(rtc.VideoSource.prototype),{width,height,closed:false,info:res.source.info,ffiHandle:new FfiHandle(res.source.handle.id)});
}
module.exports={screenSource};
