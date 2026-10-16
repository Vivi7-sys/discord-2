// Real API/SFU/native publisher lifecycle, no capture, synthetic frames or microphones.
// Default: OWN isolated room, local API; --public: new empty invitation on private stdin.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {randomBytes,createHmac} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
const require=createRequire(import.meta.url),root=new URL('../../../',import.meta.url).pathname;
const rtc=require('../node_modules/@livekit/rtc-node');
require('../node_modules/@livekit/rtc-node/dist/log.cjs').log.level='silent';
const ownPublic=process.argv.includes('--public-owned');
const publicMode=process.argv.includes('--public')||ownPublic,run=randomBytes(16).toString('hex');
const children=[],viewer=new rtc.Room();
let service,redis,roomId,api,created=false,base='http://127.0.0.1:3196';
const report={type:'real-native-publisher-lifecycle-no-media',publicBackend:publicMode,
 timestamp:new Date().toISOString(),desktopCapture:false,syntheticFrames:false,mediaValidated:false,passed:false};
async function until(fn,ms=40000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await delay(200);}throw Error('Deadline');}
async function stop(child,signal='SIGTERM'){
 if(child.exitCode!==null || child.signalCode!==null)return;
 child.kill(signal);
 await Promise.race([new Promise(r=>child.once('exit',r)),delay(23000,undefined,{ref:false})]);
 if(child.exitCode===null && child.signalCode===null){child.kill('SIGKILL');throw Error('Forced cleanup required');}
}
function publisher(){
 const child=spawn('/usr/bin/node',[new URL('../publisher.cjs',import.meta.url).pathname],
 {env:{PATH:'/usr/bin:/bin',HOME:process.env.HOME,RUST_LOG:'off'},stdio:['pipe','pipe','ignore']});
 children.push(child);child.events=[];let pending='';
 child.stdout.on('data',chunk=>{pending+=chunk;let index;while((index=pending.indexOf('\n'))>=0){const line=pending.slice(0,index);pending=pending.slice(index+1);try{child.events.push(JSON.parse(line));}catch{/* No raw output in report. */}}});
 child.stdin.on('error',()=>{});
 child.stdin.write(JSON.stringify({base,roomId,name:'D2 lifecycle',fps:30,profile:'720p30',codec:'h264',audio:false,protocolVersion:2,videoMemFd:null})+'\n');
 return child;
}
function has(child,state){return child.events.some(e=>e.state===state);}
async function ready(child){await until(()=>{if(has(child,'error'))throw Error('Publisher '+child.events.find(e=>e.state==='error').stage);return has(child,'ready');});}
const publications=()=>[...viewer.remoteParticipants.values()].reduce((n,p)=>n+p.trackPublications.size,0);
try{
 if(publicMode&&!ownPublic){
  let input='';for await(const chunk of process.stdin)input+=chunk;
  const invite=new URL(input.trim());
  assert.equal(invite.origin,'https://discord-2-kuau.onrender.com');
  assert.ok(/^\/sala\/[a-f0-9]{64}\/?$/.test(invite.pathname));
  base=invite.origin;roomId=invite.pathname.split('/')[2];
 }else{
  require(root+'node_modules/@next/env').loadEnvConfig(root,true,{info(){},error(){}});
  const {RoomServiceClient}=require(root+'node_modules/livekit-server-sdk');
  const {Redis}=require(root+'node_modules/@upstash/redis');
  redis=Redis.fromEnv({signal:()=>AbortSignal.timeout(8000),retry:{retries:0}});
  const endpoint=new URL(process.env.LIVEKIT_URL);endpoint.protocol=endpoint.protocol==='wss:'?'https:':'http:';
  service=new RoomServiceClient(endpoint.origin,process.env.LIVEKIT_API_KEY,process.env.LIVEKIT_API_SECRET,{requestTimeout:8,failover:false});
  const nonce=randomBytes(16).toString('hex');roomId=nonce+createHmac('sha256',process.env.ROOM_INVITE_SECRET).update('discord2:room-invite:v1:').update(nonce).digest('hex').slice(0,32);
  const room=await service.createRoom({name:roomId,metadata:run,maxParticipants:6,emptyTimeout:120});created=true;assert.equal(room.maxParticipants,6);
  if(ownPublic){base='https://discord-2-kuau.onrender.com';report.testCredentialsOnlyInParent=true;}
  else{
  api=spawn(process.execPath,[root+'node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3196'],{cwd:root,env:{...process.env,NODE_ENV:'production',ENABLE_SHARE_IN_PRODUCTION:'true',DISCORD2_INTEGRATION_RUN:run},stdio:['ignore','pipe','ignore']});
  let output='';api.stdout.on('data',chunk=>output+=chunk);
  await until(async()=>{if(api.exitCode!==null)throw Error('Local API exited');return output.includes('Ready in') && (await fetch(base+'/api/health')).ok;});
  }
 }
 const response=await fetch(base+'/api/livekit/token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({roomId,displayName:'D2 lifecycle observer'}),signal:AbortSignal.timeout(60000)});
 report.tokenStatus=response.status;assert.equal(response.status,200);const credentials=await response.json();
 await viewer.connect(credentials.serverUrl,credentials.token,{autoSubscribe:false});
 // Never enter a room already containing anyone else's session.
 assert.equal(viewer.remoteParticipants.size,0,'Test requires an empty room');
 const first=publisher();await ready(first);await until(()=>publications()>0);report.trackPublished=true;
 const collision=publisher();await until(()=>has(collision,'error'));
 const error=collision.events.find(e=>e.state==='error');report.collision={stage:error.stage,reason:error.reason};assert.equal(error.stage,'acquire');assert.equal(error.reason,'API 409');await stop(collision);
 assert.ok(publications()>0);report.exclusivePublisher=true;
 await stop(first);assert.ok(has(first,'reservation-released'));assert.ok(has(first,'stopped'));report.stopReleased=true;
 const second=publisher();await ready(second);report.restart=true;
 await stop(second,'SIGKILL');await until(()=>viewer.remoteParticipants.size===0);report.abruptDisconnect=true;
 const third=publisher();await ready(third);report.slotRecoveredAfterDisconnect=true;
 await stop(third);assert.ok(has(third,'reservation-released'));await until(()=>viewer.remoteParticipants.size===0);
 report.finalRelease=true;report.passed=true;
}catch(error){report.failure=error instanceof assert.AssertionError?'AssertionError':error.message==='Deadline'?'Deadline':error.constructor.name;process.exitCode=1;}
finally{
 for(const child of children){try{await stop(child);}catch{report.forcedCleanup=true;}}
 try{await viewer.disconnect();await rtc.dispose();}catch{report.viewerCleanupFailed=true;}
 if(created){
  try{
   const rooms=await service.listRooms([roomId]);
   if(rooms[0]?.metadata===run){
    const participants=await service.listParticipants(roomId);report.participantsAtExit=participants.length;
    report.reservationAbsent=!(await redis.get('discord2:room:publisher:v1:'+roomId));
    await service.deleteRoom(roomId);report.ownRoomDeleted=true;
   }
  }catch{report.roomCleanupFailed=true;process.exitCode=1;}
 }
 if(api)await stop(api);
 report.passed=report.passed&&!report.forcedCleanup&&!report.viewerCleanupFailed&&!report.roomCleanupFailed&&(!created||(report.participantsAtExit===0&&report.reservationAbsent&&report.ownRoomDeleted));
 if(!report.passed)process.exitCode=1;
 await writeFile(new URL('../results/LIFECYCLE-'+Date.now()+'.json',import.meta.url),JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});
 console.log(JSON.stringify(report));
}
