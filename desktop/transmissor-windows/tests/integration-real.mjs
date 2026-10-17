// Test-only administrative parent. Native Python SDK + existing public API, OWN room.
// No Windows APIs, no microphone, no desktop capture, no synthetic frame injection.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {randomBytes,createHmac} from 'node:crypto';
import {writeFile,mkdir} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
const require=createRequire(import.meta.url),root=new URL('../../../',import.meta.url).pathname;
require(root+'node_modules/@next/env').loadEnvConfig(root,true,{info(){},error(){}});
const {RoomServiceClient}=require(root+'node_modules/livekit-server-sdk');
const {Redis}=require(root+'node_modules/@upstash/redis');
const redis=Redis.fromEnv({signal:()=>AbortSignal.timeout(8000),retry:{retries:0}});
const endpoint=new URL(process.env.LIVEKIT_URL);endpoint.protocol=endpoint.protocol==='wss:'?'https:':'http:';
const service=new RoomServiceClient(endpoint.origin,process.env.LIVEKIT_API_KEY,process.env.LIVEKIT_API_SECRET,{requestTimeout:8,failover:false});
const nonce=randomBytes(16).toString('hex'),run=randomBytes(16).toString('hex');
const roomId=nonce+createHmac('sha256',process.env.ROOM_INVITE_SECRET).update('discord2:room-invite:v1:').update(nonce).digest('hex').slice(0,32);
const invite='https://discord-2-kuau.onrender.com/sala/'+roomId;
const children=[];
let created=false;
const report={type:'windows-session-python-sdk-on-linux-public-api',desktopCapture:false,windowsCaptureValidated:false,syntheticFramesFed:false,mediaValidated:false,passed:false};
async function until(fn,ms=40000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await delay(250);}throw Error('Test deadline');}
function peer(){
 const child=spawn(root+'desktop/transmissor-windows/.venv/bin/python',[root+'desktop/transmissor-windows/tests/native_session_peer.py'],{env:{PATH:process.env.PATH,HOME:process.env.HOME,RUST_LOG:'off'},stdio:['pipe','pipe','ignore']});
 children.push(child);child.events=[];let pending='';
 child.stdout.on('data',chunk=>{pending+=chunk;let n;while((n=pending.indexOf('\n'))>=0){const line=pending.slice(0,n);pending=pending.slice(n+1);try{child.events.push(JSON.parse(line));}catch{/* No raw SDK logs. */}}});
 child.stdin.on('error',()=>{});child.stdin.write(JSON.stringify({invite})+'\n');return child;
}
async function ready(child){await until(()=>{if(child.events.some(e=>e.state==='done'))throw Error('Session ended before ready');return child.events.some(e=>e.state==='ready');});}
async function stop(child){
 if(child.exitCode===null&&child.signalCode===null)child.stdin.end('stop\n');
 await until(()=>child.exitCode!==null||child.signalCode!==null,25000);
 return child.events.find(e=>e.state==='done');
}
function check(done){assert.ok(done);for(const key of ['acquired','releaseConfirmed','captureClosed','tracksClosed','sourcesClosed','disconnected'])assert.equal(done.report[key],true,key);assert.equal(done.report.captureObserved,false);assert.equal(done.report.audioObserved,false);}
try{
 const room=await service.createRoom({name:roomId,metadata:run,maxParticipants:6,emptyTimeout:120});created=true;assert.equal(room.maxParticipants,6);
 const first=peer();await ready(first);
 const people=await service.listParticipants(roomId);assert.equal(people.filter(p=>p.permission?.canPublish).length,1);
 assert.equal(people[0].tracks.length,2);assert.ok(people[0].tracks.every(t=>[3,4].includes(t.source)));
 report.screenAndScreenAudioPublished=true;
 const second=peer();await until(()=>second.events.some(e=>e.state==='done'));
 assert.equal(second.events.find(e=>e.state==='done').report.acquired,false);
 await stop(second);assert.equal((await service.listParticipants(roomId)).filter(p=>p.permission?.canPublish).length,1);report.exclusivity=true;
 check(await stop(first));report.stopReleased=true;
 const third=peer();await ready(third);report.restart=true;
 third.kill('SIGKILL');await until(async()=>(await service.listParticipants(roomId)).length===0);
 const fourth=peer();await ready(fourth);report.recoveredAfterAbruptExit=true;
 check(await stop(fourth));report.cleanupConfirmed=true;report.passed=true;
}catch(error){report.failure=error.constructor.name;report.phaseFailure=children.map(c=>c.events.find(e=>e.state==='done')||{state:'unfinished'});process.exitCode=1;}
finally{
 for(const child of children){if(child.exitCode===null&&child.signalCode===null){try{await stop(child);}catch{child.kill('SIGKILL');report.forcedCleanup=true;}}}
 if(created){
  try{
   const rooms=await service.listRooms([roomId]);
   if(rooms[0]?.metadata===run){report.participantsAtExit=(await service.listParticipants(roomId)).length;report.reservationAbsent=!(await redis.get('discord2:room:publisher:v1:'+roomId));await service.deleteRoom(roomId);report.ownRoomDeleted=true;}
  }catch{report.cleanupFailed=true;}
 }
 report.passed=report.passed&&!report.forcedCleanup&&!report.cleanupFailed&&report.ownRoomDeleted&&report.participantsAtExit===0&&report.reservationAbsent;
 if(!report.passed)process.exitCode=1;
 const dir=new URL('../results/',import.meta.url);await mkdir(dir,{recursive:true});
 await writeFile(new URL('SDK-PUBLIC-'+Date.now()+'.json',dir),JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});
 console.log(JSON.stringify(report));
}
