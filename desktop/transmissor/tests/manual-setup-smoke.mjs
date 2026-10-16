// Setup/UI/cleanup only. Does NOT start capture, join a viewer or assess media.
import {spawn} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
const launcher=new URL('../manual-validation.mjs',import.meta.url).pathname;
const child=spawn(process.execPath,[launcher],{stdio:['pipe','pipe','ignore']});
let output='',stopped=false;
const deadline=setTimeout(()=>{child.kill('SIGINT');},45000);
child.stdout.on('data',data=>{output+=data.toString();if(!stopped&&output.includes('Feche a janela principal')){stopped=true;setTimeout(()=>child.kill('SIGINT'),2000);}});
const code=await new Promise(r=>child.on('exit',r));clearTimeout(deadline);
const path=/Relatório salvo: (.+)\n/.exec(output)?.[1];
if(!path)throw Error('Manual test setup/cleanup did not create a report');
const report=JSON.parse(await readFile(path,'utf8'));
const result={type:'gtk-setup-smoke-no-capture',gtkStarted:stopped,sessions:report.sessions.length,
  roomDeleted:report.roomDeleted,serverAtExit:report.serverAtExit,forcedProcessKill:!!report.forcedProcessKill,
  captureValidated:false,audio:report.audioTest,report:path};
result.passed=code===0&&stopped&&result.sessions===0&&result.roomDeleted&&result.serverAtExit?.publishers===0&&result.serverAtExit?.reservationAbsent&&!result.forcedProcessKill&&result.audio?.modulesRemoved&&result.audio?.playbackUnchanged;
const target=new URL('../results/GTK-SETUP-SMOKE-'+Date.now()+'.json',import.meta.url);
await writeFile(target,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify(result));if(!result.passed)process.exitCode=1;
