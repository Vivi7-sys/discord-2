// Real media test in a fresh dedicated room. No existing room or deployment is changed.
import { createRequire } from 'node:module';
import { randomBytes, createHmac, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(root + 'package.json');
require('@next/env').loadEnvConfig(root, true, { info() {}, error() {} });
const directory = fileURLToPath(new URL('../', import.meta.url));
const report = { synthetic: false, configured: false, testPassed: false, roomCleanupConfirmed: null };
const save = async () => {
  await mkdir(directory + 'evidence', { recursive: true });
  await writeFile(directory + 'evidence/linux-livekit-run.json', JSON.stringify(report, null, 2) + '\n');
};
const required = ['LIVEKIT_URL','LIVEKIT_API_KEY','LIVEKIT_API_SECRET','ROOM_INVITE_SECRET'];
if (required.some(key => !process.env[key])) {
  await save(); console.log('Dedicated LiveKit test blocked: local credentials are incomplete.'); process.exit(2);
}
report.configured = true;
const { RoomServiceClient } = require('livekit-server-sdk');
const endpoint = new URL(process.env.LIVEKIT_URL);
endpoint.protocol = 'https:';
const service = new RoomServiceClient(endpoint.origin, process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, { requestTimeout: 10, failover: false });
const nonce = randomBytes(16).toString('hex');
const room = nonce + createHmac('sha256', process.env.ROOM_INVITE_SECRET).update('discord2:room-invite:v1:').update(nonce).digest('hex').slice(0,32);
let created = false;
try {
  const metadata = 'discord2-linux-tauri-test:' + randomUUID();
  const actual = await service.createRoom({ name: room, metadata, maxParticipants: 6, emptyTimeout: 120 });
  if (actual.metadata !== metadata) throw new Error('Dedicated room ownership could not be verified.');
  created = true;
  const invite = (process.env.D2_TEST_API_BASE || 'https://discord-2-kuau.onrender.com') + '/sala/' + room;
  const probe = process.env.D2_LINUX_SESSION_PROBE;
  const command = probe || 'cargo';
  const args = probe ? ['--ignored','--nocapture'] : ['test','--locked','--manifest-path','src-tauri/Cargo.toml','--features','desktop','--test','linux_real_session','--','--ignored','--nocapture'];
  const child = spawn(command, args, {
    cwd: probe ? directory + 'src-tauri' : directory, env: { ...process.env, D2_TEST_INVITE: invite, RUST_LOG:'error' }, stdio:'inherit',
  });
  const timer = setTimeout(() => { child.kill('SIGTERM'); }, 180000);
  let code;
  try { code = await new Promise((resolve,reject) => { child.on('error',reject); child.on('exit',resolve); }); }
  finally { clearTimeout(timer); }
  report.testPassed = code === 0;
  report.exitCode = code;
} catch (error) {
  // Do not serialize SDK errors, tokens, invitation URLs, or credentials.
  report.setupFailed = true;
  console.log('Real LiveKit test failed; no real-media validation claimed.');
} finally {
  if (created) {
    try { await service.deleteRoom(room); report.roomCleanupConfirmed = true; }
    catch { report.roomCleanupConfirmed = false; }
  }
  await save();
}
console.log(JSON.stringify(report));
process.exitCode = report.testPassed && report.roomCleanupConfirmed ? 0 : 1;
