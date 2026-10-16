/* eslint-disable @typescript-eslint/no-require-imports -- Native SDK executables use CommonJS. */
// Test-only receiver. Aggregate statistics, no playback/content/credential persistence.
const path=require('node:path');
const rtc=require(process.env.DISCORD2_RTC_MODULE || '@livekit/rtc-node');
const {FrameMetrics}=require('../media.cjs');
require(path.join(path.dirname(require.resolve(process.env.DISCORD2_RTC_MODULE || '@livekit/rtc-node')),'log.cjs')).log.level='silent';
const room=new rtc.Room(),readers=new Set(),videoTiming=new FrameMetrics(false);
const stats={videoFrames:0,audioFrames:0,audioPeak:0,audioSamples:0,audioEnergy:0,clippedSamples:0,width:0,height:0,frames1080p:0,frameSizes:{},sources:[],codecs:[]};
let firstAudio=null,lastAudio=null,cpuStart=process.cpuUsage(),start=process.hrtime.bigint();
room.on(rtc.RoomEvent.TrackSubscribed,(track,pub)=>{
 const video=track.kind===rtc.TrackKind.KIND_VIDEO;
 stats.sources.push(pub.source);stats.codecs.push(pub.mimeType);
 const reader=(video?new rtc.VideoStream(track):new rtc.AudioStream(track,48000,2)).getReader();readers.add(reader);
 void(async()=>{try{while(true){const {done,value}=await reader.read();if(done)break;
 if(video){stats.videoFrames++;const key=`${value.frame.width}x${value.frame.height}`;stats.frameSizes[key]=(stats.frameSizes[key]||0)+1;stats.width=Math.max(stats.width,value.frame.width);stats.height=Math.max(stats.height,value.frame.height);
  if(value.frame.width===1920 && value.frame.height===1080)stats.frames1080p++;videoTiming.record(value.timestampUs,0);}
 else{const now=process.hrtime.bigint();if(firstAudio===null)firstAudio=now;lastAudio=now;stats.audioFrames++;for(const sample of value.data){stats.audioPeak=Math.max(stats.audioPeak,Math.abs(sample));stats.audioEnergy+=sample*sample;stats.audioSamples++;stats.clippedSamples+=Math.abs(sample)>=32767?1:0;}}
 }}catch{}finally{readers.delete(reader);}})();
});
function dbfs(v){return v?20*Math.log10(v/32768):null;}
function snapshot(){const cpu=process.cpuUsage(cpuStart),elapsed=Number(process.hrtime.bigint()-start)/1e9;const {audioEnergy,...s}=stats;
 return {...s,video:videoTiming.snapshot(true),audioRmsDbfs:dbfs(Math.sqrt(audioEnergy/(stats.audioSamples||1))),audioPeakDbfs:dbfs(stats.audioPeak),audioSpanSeconds:firstAudio&&lastAudio?Number(lastAudio-firstAudio)/1e9:0,audioDurationSeconds:stats.audioSamples/96000,cpuSeconds:(cpu.user+cpu.system)/1e6,cpuPercent:(cpu.user+cpu.system)/1e4/elapsed};}
process.on('message',m=>{void(async()=>{
 if(m.action==='connect')await room.connect(m.url,m.token,{autoSubscribe:true});
 if(m.action==='disconnect'){await Promise.allSettled([...readers].map(r=>r.cancel()));await room.disconnect();await rtc.dispose();}
 return snapshot();
})().then(result=>process.send?.({id:m.id,ok:true,result}),()=>process.send?.({id:m.id,ok:false}));});
