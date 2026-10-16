/* eslint-disable @typescript-eslint/no-require-imports -- Native SDK executables use CommonJS. */
const {spawnSync}=require('node:child_process'),path=require('node:path');
const result=spawnSync(process.env.CC || 'cc',['-shared','-fPIC','-O2','-Wall','-Wextra','-Werror','-I/usr/include/node',path.join(__dirname,'shm.c'),'-o',path.join(__dirname,'shm.node')],{stdio:'inherit'});
process.exitCode=result.status??1;
