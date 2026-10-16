/* eslint-disable @typescript-eslint/no-require-imports -- Native SDK executables use CommonJS. */
// Native WebRTC SDK. Credentials are received over private stdin, never argv/env/files.
const rtc = require(process.env.DISCORD2_RTC_MODULE || '@livekit/rtc-node');
const path = require('node:path');
const net = require('node:net');
const inputs=[];
function input(fd,highWaterMark=65536){const s=new net.Socket({fd,readable:true,writable:false,highWaterMark});inputs.push(s);return s;}
const {Reader,ownedBytes,FrameMetrics}=require('./media.cjs');
const {trackStats}=require('./rtc-stats.cjs');
const {screenSource}=require('./rtc-native.cjs');
const profiles=require('./profiles.json');
const {gpuStats}=require('./gpu-stats.cjs');
require(path.join(path.dirname(require.resolve(process.env.DISCORD2_RTC_MODULE || '@livekit/rtc-node')), 'log.cjs')).log.level = 'silent';
const room = new rtc.Room();
let stage='initialization';
let config, token, reserved = false, stopping = false, sources = [], pubs = [], tracks = [];
let statsTimer, statsBusy=false, latestStats=[];
const videoMetrics=new FrameMetrics(), audioMetrics=new FrameMetrics();
const samples=[];
let mediaStart,cpuStart,lastTelemetryTime=performance.now(),lastTelemetryFrames=0;
async function collectStats(force=false){if(statsBusy || (stopping && !force))return;statsBusy=true;try{latestStats=await Promise.all(tracks.map(t=>trackStats(t)));}catch{ /* Diagnostics must not interrupt media. */ }finally{statsBusy=false;}}
function metrics(){const elapsed=mediaStart?Number(process.hrtime.bigint()-mediaStart)/1e9:0;const cpu=cpuStart?process.cpuUsage(cpuStart):{user:0,system:0};return {video:videoMetrics.snapshot(true),audio:audioMetrics.snapshot(true),elapsedSeconds:elapsed,cpuSeconds:(cpu.user+cpu.system)/1e6,cpuPercent:elapsed?(cpu.user+cpu.system)/1e4/elapsed:0,rtc:latestStats, samples, gpu:gpuStats()};}
function event(state, extra={}) { process.stdout.write(JSON.stringify({state,...extra})+'\n'); }
async function api(route, body, auth, timeout=15000) {
  const r = await fetch(config.base + route, {method:'POST', redirect:'error', headers:{'Content-Type':'application/json', ...(auth?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(timeout)});
  if (!r.ok) throw Error(`API ${r.status}`);
  return r.json();
}
async function start(c) {
  const profile=profiles[c.profile || (c.fps===60?"1080p60":"1080p30")];
  if(!profile || c.fps!==profile.fps)throw Error("Invalid profile");
  config=c={...c,...profile};
  const u=new URL(c.base);
  if(u.username || u.password || (u.protocol!=='https:' && !(u.protocol==='http:' && ['localhost','127.0.0.1'].includes(u.hostname)))) throw Error('Backend must use HTTPS');
  config.base=u.origin;
  if(c.protocolVersion!==2 || (c.audio && (!Number.isInteger(c.audioFd)||c.audioFd<3)) || !/^[a-f0-9]{64}$/.test(c.roomId) || ![30,60].includes(c.fps)) throw Error('Invalid configuration');
  stage='token';
  const session=await api('/api/livekit/token',{roomId:c.roomId,displayName:c.name}); token=session.token;
  stage='connect';
  await room.connect(session.serverUrl, token, {autoSubscribe:false,dynacast:false});
  // release is attempted even if acquire response is lost after the server grants it.
  stage='acquire';
  reserved=true;
  await api('/api/livekit/share',{roomId:c.roomId,action:'acquire'},true);
  event('reservation-acquired');
  stage='publish-video';
  const v=screenSource(c.width,c.height); sources.push(v);
  const vo=new rtc.TrackPublishOptions({source:rtc.TrackSource.SOURCE_SCREENSHARE,
    videoEncoding:{maxBitrate:c.bitrate,maxFramerate:c.fps},
    videoCodec:c.codec==='h264'?rtc.VideoCodec.H264:rtc.VideoCodec.VP8,simulcast:false});
  const vt=rtc.LocalVideoTrack.createVideoTrack('screen',v); tracks.push(vt);
  pubs.push(await room.localParticipant.publishTrack(vt,vo));
  if(c.audio) {
    stage='publish-audio';
    const a=new rtc.AudioSource(48000,2,100); sources.push(a);
    const ao=new rtc.TrackPublishOptions({source:rtc.TrackSource.SOURCE_SCREENSHARE_AUDIO,audioEncoding:{maxBitrate:128000n},dtx:false});
    const at=rtc.LocalAudioTrack.createAudioTrack('screen-audio',a); tracks.push(at);
    pubs.push(await room.localParticipant.publishTrack(at,ao));
  }
  stage='media';
  mediaStart=process.hrtime.bigint();cpuStart=process.cpuUsage();
  statsTimer=setInterval(()=>void collectStats().then(()=>{if(stopping)return;const now=performance.now();const submittedFps=(videoMetrics.count-lastTelemetryFrames)*1000/(now-lastTelemetryTime);lastTelemetryFrames=videoMetrics.count;lastTelemetryTime=now;const encoded=latestStats[0]?.find(s=>s.type==='outbound');samples.push({seconds:Number(process.hrtime.bigint()-mediaStart)/1e9,submittedFps,outbound:encoded,gpu:gpuStats(),audioQueueMs:sources[1]?.queuedDuration??null,avInputSkewMs:videoMetrics.lastPts!==null && audioMetrics.lastPts!==null?Number(videoMetrics.lastPts-audioMetrics.lastPts)/1000:null});if(samples.length>120)samples.shift();event('telemetry',{submittedFps,encodedFps:encoded?.framesPerSecond??null,encoder:encoded?.encoderImplementation??null});}),2000);
  lastTelemetryTime=performance.now();
  event('ready');
}
let stopPromise;
function stop(){return stopPromise ??= finishStop();}
async function finishStop() {
  stopping=true;clearInterval(statsTimer);
  // Pollable pipes: no libuv worker remains blocked in a read during exit.
  for(const stream of inputs)stream.destroy();
  await collectStats(true);
  event('metrics',metrics());
  if(reserved) {
    let released=false;
    for(let attempt=0;attempt<2 && !released;attempt++){
      try{const r=await api('/api/livekit/share',{roomId:config.roomId,action:'release'},true,6000);released=!r.reservationHeld;}
      catch{/* Keep the connection alive for one bounded retry, then disconnect. */}
    }
    if(!released)event('release-unconfirmed');
    else event('reservation-released');
  }
  // Revoking publish permission already removes publications on the server.
  // Disconnect instead of sending a second unpublish RPC for those removed tracks.
  await Promise.allSettled([room.disconnect()]);
  await Promise.allSettled(tracks.map(t=>t.close(false)));
  await Promise.allSettled(sources.map(s=>s.close()));
  await rtc.dispose(); token=undefined; event('stopped');
}
room.on(rtc.RoomEvent.Disconnected,()=>{if(!stopping){event('error',{stage:'connection',reason:'Disconnected'});void stop().finally(()=>process.exit(1));}});
async function main() {
  const videoReader=new Reader(input(0,1024*1024));
  await start(await videoReader.config());
  const slots=config.videoMemFd!==null && config.videoMemFd!==undefined?Array.from({length:3},(_,i)=>new Uint8Array(require('./native/shm.node').mapFrame(config.videoMemFd,i,config.width*config.height*3/2))):null;
  async function videoLoop(){
    while(!stopping){
      const frame=await videoReader.frame(slots?'slot':'video',config.width*config.height*3/2);if(!frame)break;
      const slot=slots?frame.data.readUInt32LE():null;
      if(slots && slot>=slots.length)throw Error('Invalid frame slot');
      const started=performance.now();
      if(process.hrtime.bigint()/1000n-frame.pts>500000n){videoMetrics.skippedStale++;if(slots)event('video-release',{slot});continue;}
      if(videoMetrics.lastPts!==null && frame.pts<=videoMetrics.lastPts){videoMetrics.nonMonotonicPts++;if(slots)event('video-release',{slot});continue;}
      sources[0].captureFrame(new rtc.VideoFrame(slots?slots[slot]:ownedBytes(frame.data),config.width,config.height,rtc.VideoBufferType.I420),frame.pts);
      videoMetrics.record(frame.pts,performance.now()-started);
      if(slots)event('video-release',{slot});
    }
  }
  async function audioLoop(){
    const reader=new Reader(input(config.audioFd));
    while(!stopping){
      const frame=await reader.frame('audio');if(!frame)break;
      const started=performance.now();
      if(process.hrtime.bigint()/1000n-frame.pts>500000n){audioMetrics.skippedStale++;sources[1].clearQueue();continue;}
      const data=ownedBytes(frame.data);
      await sources[1].captureFrame(new rtc.AudioFrame(new Int16Array(data.buffer),48000,2,data.length/4));
      audioMetrics.record(frame.pts,performance.now()-started);
    }
  }
  // Independent async readers: awaiting audio playout never pauses the video pipe.
  await Promise.all([videoLoop(),...(config.audio?[audioLoop()]:[])]);
}
process.on('SIGTERM',()=>void stop().finally(()=>process.exit()));
process.on('SIGINT',()=>void stop().finally(()=>process.exit()));
main().then(stop).catch(async(e)=>{if(!stopping){event('error',{stage,reason:/^API [0-9]+$/.test(e.message)?e.message:e.constructor.name});process.exitCode=1;}await stop();});
