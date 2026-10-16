/* eslint-disable @typescript-eslint/no-require-imports -- Native SDK executables use CommonJS. */
// Local capture/IPC/FFI benchmark. No room, network, credentials or device capture.
const {Reader,ownedBytes,FrameMetrics}=require('../media.cjs');
const net=require('node:net'),path=require('node:path');
const rtc=require('@livekit/rtc-node');
require(path.join(path.dirname(require.resolve('@livekit/rtc-node')),'log.cjs')).log.level='silent';
const [mode='drain',audioFd,format='I420',memFd='none',widthArg='1920',heightArg='1080']=process.argv.slice(2);
const width=Number(widthArg),height=Number(heightArg);
const v=mode==='ffi'?new rtc.VideoSource(width,height):null;
const a=mode==='ffi'?new rtc.AudioSource(48000,2,100):null;
const slots=memFd!=='none'?Array.from({length:3},(_,i)=>new Uint8Array(require('../native/shm.node').mapFrame(Number(memFd),i,width*height*3/2))):null;
const vm=new FrameMetrics(),am=new FrameMetrics();
async function frames(stream,video){const reader=new Reader(stream);while(true){const h=await reader.read(12);if(!h)break;const n=h.readUInt32LE(),pts=h.readBigUInt64LE(4),data=await reader.read(n);if(!data)throw Error('Truncated');const t=performance.now();if(video){if(v)v.captureFrame(new rtc.VideoFrame(slots?slots[data.readUInt32LE()]:ownedBytes(data),width,height,rtc.VideoBufferType[format]),pts);vm.record(pts,performance.now()-t);if(slots)console.log(JSON.stringify({state:'video-release',slot:data.readUInt32LE()}));}else{if(a){const bytes=ownedBytes(data);await a.captureFrame(new rtc.AudioFrame(new Int16Array(bytes.buffer),48000,2,n/4));}am.record(pts,performance.now()-t);}}}
(async()=>{console.log(JSON.stringify({state:'ready'}));const start=performance.now(),cpu=process.cpuUsage();await Promise.all([frames(new net.Socket({fd:0,readable:true,writable:false,highWaterMark:1024*1024}),true),frames(new net.Socket({fd:Number(audioFd),readable:true,writable:false}),false)]);if(v)await v.close();if(a)await a.close();await rtc.dispose();const elapsed=(performance.now()-start)/1000,c=process.cpuUsage(cpu);console.log(JSON.stringify({mode,format,video:vm.snapshot(),audio:am.snapshot(),elapsedSeconds:elapsed,cpuSeconds:(c.user+c.system)/1e6,cpuPercent:(c.user+c.system)/1e4/elapsed}));})().catch(()=>{process.exitCode=1;});
