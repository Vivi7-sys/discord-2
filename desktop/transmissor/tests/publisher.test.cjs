/* eslint-disable @typescript-eslint/no-require-imports -- Native subprocess tests. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..');
test('disconnect rejection still closes tracks, sources and SDK',async()=>{
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'d2-stop-test-'));
 const preload=path.join(temporary,'preload.cjs'),marker=path.join(temporary,'closed');
 const sdk=require.resolve('../node_modules/@livekit/rtc-node');
 fs.writeFileSync(preload,`
 const fs=require('node:fs');
 const mark=s=>fs.appendFileSync(${JSON.stringify(marker)},s+'\\n');
 const stub=(file,exports)=>require.cache[file]={id:file,filename:file,loaded:true,exports};
 class Room {constructor(){this.localParticipant={publishTrack:async()=>({})};}on(){}async connect(){}async disconnect(){throw Error('disconnect failed');}}
 stub(${JSON.stringify(sdk)},{Room,TrackPublishOptions:class {constructor(v){Object.assign(this,v);}},TrackSource:{SOURCE_SCREENSHARE:1},VideoCodec:{H264:1},LocalVideoTrack:{createVideoTrack:()=>({close:async()=>mark('track')})},RoomEvent:{Disconnected:'disconnected'},dispose:async()=>mark('sdk')});
 stub(${JSON.stringify(path.join(root,'rtc-native.cjs'))},{screenSource:()=>({close:async()=>mark('source')})});
 stub(${JSON.stringify(path.join(root,'rtc-stats.cjs'))},{trackStats:async()=>[]});
 global.fetch=async()=>({ok:true,json:async()=>({token:'fixture',serverUrl:'wss://example.invalid',reservationHeld:false})});
 `);
 let child;
 try{
  child=spawn('/usr/bin/node',['--require',preload,path.join(root,'publisher.cjs')],{stdio:['pipe','pipe','pipe'],env:Object.fromEntries(Object.entries(process.env).filter(([key])=>key!=='NODE_TEST_CONTEXT'))});
  let output='',errors='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>errors+=chunk);
  child.stdin.write(JSON.stringify({base:'http://127.0.0.1:1',roomId:'a'.repeat(64),name:'Fixture',fps:30,profile:'720p30',codec:'h264',audio:false,protocolVersion:2})+'\n');
  const end=Date.now()+5000;
  while(!output.includes('"ready"')&&Date.now()<end&&child.exitCode===null)await new Promise(r=>setTimeout(r,20));
  assert.ok(output.includes('"ready"'),JSON.stringify({output,errors,exit:child.exitCode,signal:child.signalCode}));
  const exited=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');
  await Promise.race([exited,new Promise((_,reject)=>setTimeout(()=>reject(Error('shutdown deadline')),5000).unref())]);
  assert.equal(child.exitCode,0,errors);
  assert.ok(output.includes('"stopped"'));
  assert.deepEqual(fs.readFileSync(marker,'utf8').trim().split('\n').sort(),['sdk','source','track']);
 }finally{
  if(child&&child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
  fs.rmSync(temporary,{recursive:true,force:true});
 }
});
