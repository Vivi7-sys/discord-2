// Read-only health + invalid credentials; no invitation generation or private keys.
import {writeFile} from 'node:fs/promises';
const base='https://discord-2-kuau.onrender.com';
const report={type:'public-endpoint-contract-only',timestamp:new Date().toISOString(),base,authenticatedConnection:false};
for(const [key,route,body] of [['health','/api/health',null],['invalidInvite','/api/livekit/token',{roomId:'0'.repeat(64),displayName:'D2 contract check'}],['missingAuthorization','/api/livekit/share',{roomId:'0'.repeat(64),action:'release'}]]){
 const response=await fetch(base+route,{method:body?'POST':'GET',redirect:'error',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});
 report[key]=response.status;
 await response.body?.cancel();
}
report.passed=report.health===200 && report.invalidInvite===403 && report.missingAuthorization===401;
await writeFile(new URL('../results/PUBLIC-PREFLIGHT-'+Date.now()+'.json',import.meta.url),JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});
console.log(JSON.stringify(report));if(!report.passed)process.exitCode=1;
