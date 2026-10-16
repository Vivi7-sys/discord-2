// Manual end-to-end GTK test. Server credentials stay in this harness/local API.
import {createRequire} from 'node:module';
import {spawn,spawnSync,execFileSync} from 'node:child_process';
import {randomBytes,createHmac} from 'node:crypto';
import {existsSync} from 'node:fs';
import {writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {createInterface} from 'node:readline';
const require=createRequire(import.meta.url),root=new URL('../../',import.meta.url).pathname;
const safe=Object.fromEntries(Object.entries(process.env).filter(([k])=>['PATH','HOME','XDG_RUNTIME_DIR','DBUS_SESSION_BUS_ADDRESS','WAYLAND_DISPLAY','DISPLAY','GST_PLUGIN_PATH','LD_LIBRARY_PATH','LANG','XDG_DATA_DIRS'].includes(k)));
const preflight=spawnSync('/usr/bin/python3',[root+'desktop/transmissor/launch.py','--check'],{env:safe,encoding:'utf8'});
if(preflight.status!==0){console.error('Pré-verificação falhou. Execute npm run check:desktop em desktop/transmissor. Nenhuma sala foi criada.');process.exit(1);}
if(!existsSync(root+'.next/BUILD_ID')){console.error('Falta o build local do site. Execute npm run build na raiz; não é deploy.');process.exit(1);}
require(root+'node_modules/@next/env').loadEnvConfig(root,true,{info(){},error(){}});
for(const k of ['LIVEKIT_URL','LIVEKIT_API_KEY','LIVEKIT_API_SECRET','ROOM_INVITE_SECRET'])if(!process.env[k]){console.error('Configuração do backend local incompleta. Nenhuma sala foi criada.');process.exit(1);}
const {RoomServiceClient}=require(root+'node_modules/livekit-server-sdk');
const {Redis}=require(root+'node_modules/@upstash/redis');
const redis=Redis.fromEnv({signal:()=>AbortSignal.timeout(8000),retry:{retries:0}});
const url=new URL(process.env.LIVEKIT_URL);url.protocol=url.protocol==='wss:'?'https:':'http:';
const service=new RoomServiceClient(url.origin,process.env.LIVEKIT_API_KEY,process.env.LIVEKIT_API_SECRET,{requestTimeout:8,failover:false});
const run=randomBytes(16).toString('hex'),nonce=randomBytes(16).toString('hex');
const roomId=nonce+createHmac('sha256',process.env.ROOM_INVITE_SECRET).update('discord2:room-invite:v1:').update(nonce).digest('hex').slice(0,32);
const metadata='discord2-gtk-manual:'+run,port=Number(process.env.DISCORD2_MANUAL_PORT || 3199);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid local port');
const base=`http://127.0.0.1:${port}`,invite=`${base}/sala/${roomId}`;
const audioModules=[];let playbackName,playbackBefore;
function pulse(args){return execFileSync('pactl',args,{env:{...safe,LC_ALL:'C.UTF-8'},encoding:'utf8',stderr:'ignore'}).trim();}
function playbackState(){const sink=JSON.parse(pulse(['-f','json','list','sinks'])).find(s=>s.name===playbackName);return sink?{mute:sink.mute,volume:Object.values(sink.volume).map(v=>v.value)}:null;}
const children=[],report={type:'manual-gtk-portal-pipewire-website',preflight:JSON.parse(preflight.stdout),sessions:[],humanAssessment:'pending',latencyAndAvSync:'not-measured'};
let created=false,api,main,terminal,quitting=false,checks=Promise.resolve(),finishRequested;
const finished=new Promise(r=>{finishRequested=r;});
function requestFinish(){quitting=true;finishRequested();}
function child(command,args,options={}){const p=spawn(command,args,options);children.push(p);p.on('error',()=>{report.childLaunchFailed=true;requestFinish();});return p;}
async function terminate(p,seconds=25){if(!p||p.exitCode!==null||p.signalCode!==null)return;p.kill('SIGTERM');await Promise.race([new Promise(r=>p.once('exit',r)),delay(seconds*1000)]);if(p.exitCode===null&&p.signalCode===null){p.kill('SIGKILL');report.forcedProcessKill=true;await new Promise(r=>p.once('exit',r));}}
async function vacancy(){const people=await service.listParticipants(roomId);return {publishers:people.filter(p=>p.permission?.canPublish).length,reservationAbsent:(await redis.get('discord2:room:publisher:v1:'+roomId))===null};}
function gtk(){
 const p=child('/usr/bin/python3',[root+'desktop/transmissor/launch.py','--validation'],{env:safe,stdio:['pipe','pipe','ignore']});
 p.stdin.on('error',()=>{report.gtkInputFailed=true;requestFinish();});
 p.stdin.end(JSON.stringify({invite})+'\n');let pending='';
 p.stdout.on('data',chunk=>{pending+=chunk.toString();let newline;while((newline=pending.indexOf('\n'))>=0){const line=pending.slice(0,newline);pending=pending.slice(newline+1);try{const event=JSON.parse(line);if(event.event==='gtk-diagnostic'){
  report.sessions.push(event.report);checks=checks.then(async()=>{const state=await vacancy();event.report.serverAfterStop=state;console.log(state.publishers===0&&state.reservationAbsent?'Vaga verificada livre. Pode iniciar novamente.':'Há transmissão/reserva ativa; confira se o outro transmissor está ligado.');}).catch(()=>{report.vacancyCheckUnavailable=true;});
 }}catch{/* Never print arbitrary child messages or credentials. */}}});
 p.on('error',()=>{report.gtkLaunchFailed=true;requestFinish();});return p;
}
process.on('SIGINT',requestFinish);process.on('SIGTERM',requestFinish);
try{
 await service.createRoom({name:roomId,metadata,maxParticipants:6,emptyTimeout:600,departureTimeout:30});created=true;
 if(quitting)throw Error('Cancelled');
 api=child(process.execPath,[root+'node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{cwd:root,env:{...process.env,NODE_ENV:'production',ENABLE_SHARE_IN_PRODUCTION:'true',DISCORD2_INTEGRATION_RUN:run},stdio:['ignore','pipe','ignore']});
 let announced=false;api.stdout.on('data',b=>{if(b.toString().includes('Ready in'))announced=true;});
 const end=Date.now()+30000;let ready=false;
 while(!ready){if(quitting)throw Error('Cancelled');if(api.exitCode!==null)throw Error('API unavailable');try{ready=announced&&(await fetch(base+'/api/health',{signal:AbortSignal.timeout(1000)})).ok;}catch{}if(Date.now()>end)throw Error('API deadline');if(!ready)await delay(250);}
 // Verify that this API accepts the invitation; token is discarded, never sent to GTK.
 const response=await fetch(base+'/api/livekit/token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({roomId,displayName:'Verificacao GTK'}),signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Error('API rejected test room');await response.json();
 if(quitting)throw Error('Cancelled');
 const audioSink='discord2_gtk_test_'+run;
 playbackName=pulse(['get-default-sink']);playbackBefore=playbackState();
 report.audioTest={dedicatedOutput:false,localPlaybackLoopback:false};
 audioModules.push(pulse(['load-module','module-null-sink','sink_name='+audioSink,'rate=48000','channels=2','sink_properties=device.description=Discord2-GTK-Test']));
 audioModules.push(pulse(['load-module','module-loopback','source='+audioSink+'.monitor','sink='+playbackName,'latency_msec=30']));
 report.audioTest.dedicatedOutput=true;report.audioTest.localPlaybackLoopback=true;
 console.log('Abra o espectador do site existente nesta URL local:\n'+invite+'\nEntre como espectador e habilite o som. No GTK, escolha Tela/Janela, qualidade e monitor de saída; clique em Selecionar e iniciar.\nPara testar áudio, selecione no GTK o monitor de Discord2-GTK-Test. A referência só toca bip quando você clicar, com reprodução local preservada.\nApós Parar, aguarde “Vaga verificada livre”. Para testar exclusividade, digite segundo neste terminal.\nFeche a janela principal do GTK ou pressione Ctrl+C para encerrar e limpar a sala.');
 child('/usr/bin/python3',[root+'desktop/transmissor/reference.py'],{env:{...safe,DISCORD2_REFERENCE_SINK:audioSink},stdio:'ignore'});
 main=gtk();main.once('exit',code=>{if(code!==0){report.gtkExitedWithError=true;process.exitCode=1;}requestFinish();});
 terminal=createInterface({input:process.stdin,output:process.stdout});terminal.on('line',line=>{if(line.trim()==='segundo')gtk();if(line.trim()==='sair')requestFinish();});
 await finished;
}catch{if(quitting&&!report.childLaunchFailed&&!report.gtkInputFailed){report.cancelledDuringSetup=true;}else{report.setupOrRuntimeFailed=true;process.exitCode=1;}console.error('Teste interrompido. Confira a pré-verificação e a configuração local; detalhes sensíveis não são impressos.');}
finally{
 terminal?.close();
 for(const p of children.filter(p=>p!==api).reverse())await terminate(p);
 await checks;
 if(playbackBefore)try{report.audioTest.playbackUnchanged=JSON.stringify(playbackBefore)===JSON.stringify(playbackState());}catch{report.playbackCheckUnavailable=true;}
 for(const id of audioModules.reverse())try{pulse(['unload-module',id]);}catch{report.audioCleanupUnconfirmed=true;}
 if(report.audioTest)report.audioTest.modulesRemoved=!report.audioCleanupUnconfirmed;
 if(created){try{report.serverAtExit=await vacancy();}catch{report.vacancyCheckUnavailable=true;}
  try{const rooms=await service.listRooms([roomId]);if(rooms.length&&rooms[0].metadata===metadata){await service.deleteRoom(roomId);report.roomDeleted=true;const key='discord2:room:publisher:v1:'+roomId,owner=await redis.get(key);if(owner){await redis.eval('if redis.call("GET",KEYS[1])==ARGV[1] then return redis.call("DEL",KEYS[1],KEYS[2]) end return 0',[key,key+':pending'],[owner]);report.reservationCleanedAfterRoomDeletion=true;}}}catch{report.cleanupUnconfirmed=true;}}
 await terminate(api,4);
 report.timestamp=new Date().toISOString();report.validationComplete=false;
 const path=root+`desktop/transmissor/results/GTK-MANUAL-${report.timestamp.replace(/[:.]/g,'-')}-${run.slice(0,8)}.json`;
 await writeFile(path,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log('Relatório salvo: '+path+'\nAvaliação humana de imagem, áudio, sincronismo e latência deve seguir VALIDACAO-MANUAL.md; o relatório não aprova esses itens automaticamente.');
}
