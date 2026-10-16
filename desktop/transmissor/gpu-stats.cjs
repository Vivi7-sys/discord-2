/* eslint-disable @typescript-eslint/no-require-imports -- Native SDK executables use CommonJS. */
// Inspect only this publisher's DRM descriptors; never inspect other processes.
const fs=require('node:fs');
function gpuStats(){
 const devices=[];
 try{for(const fd of fs.readdirSync('/proc/self/fd')){
  try{
   const target=fs.readlinkSync('/proc/self/fd/'+fd);
   if(!/^\/dev\/dri\/renderD[0-9]+$/.test(target))continue;
   const info=fs.readFileSync('/proc/self/fdinfo/'+fd,'utf8');
   const fields=Object.fromEntries(info.split('\n').flatMap(line=>{const m=/^(drm-driver|drm-pdev|drm-client-id|drm-engine-[a-z0-9_-]+):\s*(.+)$/.exec(line);return m?[[m[1],m[2]]]:[];}));
   if(!devices.some(d=>d.fields['drm-client-id']===fields['drm-client-id']))devices.push({device:target,fields});
  }catch{/* Descriptor may close during the snapshot. */}
 }}catch{/* Linux diagnostic only. */}
 return devices;
}
module.exports={gpuStats};
