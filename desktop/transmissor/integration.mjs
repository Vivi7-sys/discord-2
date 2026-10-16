// Test harness ONLY: backend secrets stay in this parent and the local API process.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn, fork, execFileSync} from 'node:child_process';
import {randomBytes,createHmac} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {cpus,loadavg} from 'node:os';
import {writeFile} from 'node:fs/promises';
const require=createRequire(import.meta.url);
const root=new URL('../../',import.meta.url).pathname;
require(root+'node_modules/@next/env').loadEnvConfig(root,true,{info(){},error(){}});
const {Redis}=require(root+'node_modules/@upstash/redis');
const redis=Redis.fromEnv({signal:()=>AbortSignal.timeout(8000),retry:{retries:0}});
const {RoomServiceClient}=require(root+'node_modules/livekit-server-sdk');
const run=randomBytes(16).toString('hex'),nonce=randomBytes(16).toString('hex');
const roomId=nonce+createHmac('sha256',process.env.ROOM_INVITE_SECRET).update('discord2:room-invite:v1:').update(nonce).digest('hex').slice(0,32);
const metadata='discord2-native-test:'+run;
const url=new URL(process.env.LIVEKIT_URL);url.protocol=url.protocol==='wss:'?'https:':'http:';
const service=new RoomServiceClient(url.origin,process.env.LIVEKIT_API_KEY,process.env.LIVEKIT_API_SECRET,{requestTimeout:8,failover:false});
const rtcModule=process.env.DISCORD2_RTC_MODULE || new URL('./node_modules/@livekit/rtc-node/dist/index.cjs',import.meta.url).pathname;
const fps=process.env.DISCORD2_TEST_FPS==='60'?60:30;
const profile=process.env.DISCORD2_TEST_PROFILE || (fps===60?'1080p60':'1080p30');
const dimensions=require('./profiles.json')[profile];assert.ok(dimensions && dimensions.fps===fps);
const {width,height}=dimensions;
const port=Number(process.env.DISCORD2_TEST_PORT || 3197);assert.ok(Number.isInteger(port) && port>=1024 && port<=65535);
const codec=process.env.DISCORD2_TEST_CODEC || 'vp8';assert.ok(['vp8','h264'].includes(codec));
const gainDb=Number(process.env.DISCORD2_TEST_GAIN_DB || 0);assert.ok([0,6,12].includes(gainDb));
const testSeconds=Number(process.env.DISCORD2_TEST_SECONDS || 30);assert.ok(testSeconds>=10 && testSeconds<=120);
const testConversion=process.env.DISCORD2_TEST_CONVERSION==='1';
const synthetic=process.env.DISCORD2_SYNTHETIC==='1';
const children=[], audioModules=[];
function hostCpu(){const values=cpus();return {logicalCpus:values.length,idle:values.reduce((n,c)=>n+c.times.idle,0),total:values.reduce((n,c)=>n+Object.values(c.times).reduce((a,b)=>a+b,0),0)};}
let hostStart;
let playbackName, playbackBefore;
function pulse(args){return execFileSync('pactl',args,{encoding:'utf8',env:{...process.env,LC_ALL:'C.UTF-8'}}).trim();}
function playbackState(name){const sink=JSON.parse(pulse(['-f','json','list','sinks'])).find(s=>s.name===name);return sink?{mute:sink.mute,volume:Object.values(sink.volume).map(v=>v.value)}:null;}
let browser;
let created=false,api,viewer,request,report={type:synthetic?'gstreamer-synthetic-native-livekit':'native-portal-pipewire-livekit',passed:false,requestedFps:fps,profile,width,height,capturePipeline:process.env.DISCORD2_CAPTURE_PIPELINE || 'early-drop',measureStages:process.env.DISCORD2_MEASURE_STAGES!=='0',fixture:testConversion?'BGRx1080p60':synthetic?'I420-profile':'portal',codec,testSeconds,gainDb};
async function until(fn,ms=30000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await delay(300);}throw Error('Timeout');}
async function terminate(p){if(!p || p.exitCode!==null || p.signalCode!==null)return;p.kill('SIGTERM');await Promise.race([new Promise(r=>p.once('exit',r)),delay(3000)]);if(p.exitCode===null && p.signalCode===null)p.kill('SIGKILL');}
try {
 const room=await service.createRoom({name:roomId,metadata,maxParticipants:6,emptyTimeout:120,departureTimeout:30});created=true;assert.equal(room.maxParticipants,6);
 // Default loopback-only test port (configurable for parallel test runs). A collision fails readiness via run-specific route checks.
 const base=`http://127.0.0.1:${port}`;
 api=spawn(process.execPath,[root+'node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{cwd:root,env:{...process.env,NODE_ENV:'production',ENABLE_SHARE_IN_PRODUCTION:'true',DISCORD2_INTEGRATION_RUN:run},stdio:'ignore'});children.push(api);
 await until(async()=>{if(api.exitCode!==null)throw Error('Test API exited');try{return(await fetch(base+'/api/health')).ok;}catch{return false;}});
 const r=await fetch(base+'/api/livekit/token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({roomId,displayName:'Native test viewer'})});assert.equal(r.status,200);const session=await r.json();
 viewer=fork(root+'desktop/transmissor/tests/receiver.cjs',[],{env:{PATH:process.env.PATH,DISCORD2_RTC_MODULE:rtcModule,RUST_LOG:'off'},stdio:['ignore','ignore','ignore','ipc']});children.push(viewer);
 let next=0;
 request=(action,extra={})=>new Promise((resolve,reject)=>{const id=++next;const timer=setTimeout(()=>finish(Error('Viewer timeout')),30000);function msg(m){if(m.id===id)finish(m.ok?null:Error('Viewer rejected'),m.result);}function finish(e,v){clearTimeout(timer);viewer.off('message',msg);if(e)reject(e);else resolve(v);}viewer.on('message',msg);viewer.send({id,action,...extra});});
 await request('connect',{url:session.serverUrl,token:session.token});
 if(process.env.DISCORD2_BROWSER_VIEWER==='1')browser=await require('./tests/browser-viewer.cjs').browserViewer(base,roomId);
 const safeEnv=Object.fromEntries(Object.entries(process.env).filter(([k])=>['PATH','HOME','XDG_RUNTIME_DIR','DBUS_SESSION_BUS_ADDRESS','WAYLAND_DISPLAY','DISPLAY','GST_PLUGIN_PATH','LD_LIBRARY_PATH','LANG'].includes(k)));
 safeEnv.DISCORD2_RTC_MODULE=rtcModule;
 let audioSource=process.env.DISCORD2_TEST_AUDIO_MONITOR;
 if(process.env.DISCORD2_TEST_AUDIO_TONE==='1'){
  const name='discord2_test_'+run;
  playbackName=pulse(['get-default-sink']);playbackBefore=playbackState(playbackName);
  audioModules.push(pulse(['load-module','module-null-sink','sink_name='+name,'rate=48000','channels=2','sink_properties=device.description=Discord2-Test']));
  audioSource=name+'.monitor';
  audioModules.push(pulse(['load-module','module-loopback','source='+audioSource,'sink='+playbackName,'latency_msec=30']));
  const tone=spawn('gst-launch-1.0',['-q','audiotestsrc','is-live=true','volume=0.05','freq=997','samplesperbuffer=960','!','audio/x-raw,rate=48000,channels=2','!','pulsesink','device='+name],{env:safeEnv,stdio:'ignore'});children.push(tone);
  report.audioTest={toneHz:997,linearAmplitude:0.05,isolatedMonitor:true,localPlayback:true};
 }
 assert.ok(synthetic || audioSource,'Specify DISCORD2_TEST_AUDIO_MONITOR explicitly');
 const p=spawn('/usr/bin/python3',[root+'desktop/transmissor/native-test.py'],{env:safeEnv,stdio:['pipe','pipe','pipe']});children.push(p);
 let output='',errors='', receiverAtStop;let pendingStopStats;let streamPending='';p.stdout.on('data',b=>{
  const text=b.toString();output+=text;streamPending+=text;
  let newline;while((newline=streamPending.indexOf('\n'))>=0){
   const line=streamPending.slice(0,newline);streamPending=streamPending.slice(newline+1);
   try{const event=JSON.parse(line);
    if(event.state==='capturing'){hostStart=hostCpu();console.log(synthetic?'Mídia sintética iniciada; encerramento automático.':'Captura nativa iniciada; encerramento automático.');}
    if(event.state==='capture-ended')pendingStopStats=request('stats').then(s=>{receiverAtStop=s;}).catch(()=>{});
   }catch{}
  }
 });p.stderr.on('data',b=>{errors+=b;});
 p.stdin.end(JSON.stringify({base,roomId,name:'Transmissor teste',fps,profile,capturePipeline:process.env.DISCORD2_CAPTURE_PIPELINE,testConversion,measureStages:process.env.DISCORD2_MEASURE_STAGES!=='0',audio:true,audioSource,synthetic,testSeconds,codec,gainDb,sharedMemory:process.env.DISCORD2_DISABLE_SHM!=='1'})+'\n');
 await until(()=>p.exitCode!==null || p.signalCode!==null,300000);
 if(p.exitCode!==0) console.log('Native test diagnostic:', errors.split('\n').filter(s=>/^(ImportError|ModuleNotFoundError|ValueError|RuntimeError|gi\.repository|TypeError)/.test(s)).join(' ').slice(0,400));
 if(hostStart){const h=hostCpu();report.host={logicalCpus:h.logicalCpus,busyPercent:100*(1-(h.idle-hostStart.idle)/(h.total-hostStart.total)),loadAverage:loadavg()};}
 const lines=output.trim().split('\n').filter(Boolean).map(s=>JSON.parse(s));report.stages=lines.filter(s=>s.stage).map(s=>s.stage);const capture=lines.find(s=>s.videoBuffers!==undefined);report.capture=capture || {status:'failed-or-cancelled'};
 if(pendingStopStats)await pendingStopStats;
 const received=receiverAtStop || await request('stats');report.received=received;report.receiverSnapshot=receiverAtStop?'capture-end':'process-end';
 const windows=received.video.perSecond.slice(3,-1).slice().sort((a,b)=>a-b);
 const p10=windows.length?windows[Math.floor((windows.length-1)*.1)]:0;
 report.performance={measuredReceiveFps:received.video.fps,completeWindows:windows.length,
   p10Fps:p10,minFps:windows[0]??0,medianFps:windows[Math.floor(windows.length/2)]??0,
   requestedFps:fps,targetMet:received.video.fps>=fps*.95 && p10>=fps*.9 && windows.length>=8};
 report.validation='media-transport-and-cleanup';
 if(browser){report.browser=await browser.stats();assert.equal(report.browser.videoWidth,width);assert.equal(report.browser.videoHeight,height);assert.ok(report.browser.decodedFrames>5);}
 report.captureProcessExit=p.exitCode;assert.equal(p.exitCode,0);assert.ok(capture?.videoBuffers>5);assert.ok(capture?.audioBuffers>5);assert.ok(received.videoFrames>5);assert.deepEqual(Object.keys(received.frameSizes),[`${width}x${height}`]);assert.ok(received.audioFrames>5);assert.equal(received.width,width);assert.equal(received.height,height);if(synthetic)assert.ok(received.audioPeak>100);
 await until(async()=>{const people=await service.listParticipants(roomId);report.remainingPublishers=people.filter(p=>p.permission?.canPublish).length;return report.remainingPublishers===0;});report.publisherReleased=true;
 report.reservationReleased=(await redis.get('discord2:room:publisher:v1:'+roomId))===null;assert.ok(report.reservationReleased);
 if(playbackName){report.audioTest.playbackVolumeUnchanged=JSON.stringify(playbackBefore)===JSON.stringify(playbackState(playbackName));assert.ok(report.audioTest.playbackVolumeUnchanged);}
 report.passed=true;
} catch(e){if(e.code==='ERR_ASSERTION')report.assertion={actual:e.actual,expected:e.expected,operator:e.operator};report.failure=e.message==='Timeout'?'test-timeout':'capture-or-assertion-failed';process.exitCode=1;}
finally {
 if(browser)try{await browser.close();report.browserContextClosed=true;}catch{report.browserCleanupFailed=true;}
 if(request)try{await request('disconnect');}catch{}
 for(const p of children.reverse())await terminate(p);
 for(const id of audioModules.reverse()){try{pulse(['unload-module',id]);}catch{report.audioCleanupFailed=true;}}
 if(audioModules.length)report.audioModulesRemoved=!report.audioCleanupFailed;
 if(created){const rooms=await service.listRooms([roomId]);if(rooms.length && rooms[0].metadata===metadata){await service.deleteRoom(roomId);report.roomDeleted=true;const key='discord2:room:publisher:v1:'+roomId;const owner=await redis.get(key);if(owner){await redis.eval('if redis.call("GET",KEYS[1])==ARGV[1] then return redis.call("DEL",KEYS[1],KEYS[2]) end return 0',[key,key+':pending'],[owner]);report.testReservationCleanedAfterFailure=true;}}}
 report.timestamp=new Date().toISOString();
 const resultFile=`desktop/transmissor/results/RX550-${process.env.DISCORD2_CAPTURE_PIPELINE || 'early-drop'}-${browser?'WEB':'SDK'}-${synthetic?(testConversion?'BGRX':'SINTETICA'):'NATIVA'}-${codec}-${profile}-ganho${gainDb}-${report.timestamp.replace(/[:.]/g,'-')}-${run.slice(0,8)}.json`;
 await writeFile(root+resultFile,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({passed:report.passed,requestedFps:fps,codec,gainDb,performance:report.performance,publisherStopped:report.capture?.publisherStopped,publisherKilled:report.capture?.publisherKilled,roomDeleted:report.roomDeleted,browser:report.browser,failure:report.failure,resultFile}));
}
