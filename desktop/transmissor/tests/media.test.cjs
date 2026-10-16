/* eslint-disable @typescript-eslint/no-require-imports -- Native SDK executables use CommonJS. */
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const {Reader,ownedBytes,VIDEO_BYTES}=require('../media.cjs');
test('SDK buffers never include pooled bytes outside the PCM/frame',()=>{
 const backing=Buffer.allocUnsafe(512);backing.fill(99);const slice=backing.subarray(7,19);slice.fill(2);
 const out=ownedBytes(slice);assert.equal(out.byteOffset,0);assert.equal(out.buffer.byteLength,12);assert.deepEqual([...out],Array(12).fill(2));
});
test('fragmented IPC preserves 64 bit capture timestamp and payload',async()=>{
 const h=Buffer.alloc(12);h.writeUInt32LE(8);h.writeBigUInt64LE(123456789012n,4);
 const r=new Reader(Readable.from([h.subarray(0,3),h.subarray(3),Buffer.from([1,2,3]),Buffer.from([4,5,6,7,8])]));
 const f=await r.frame('audio');assert.equal(f.pts,123456789012n);assert.deepEqual([...f.data],[1,2,3,4,5,6,7,8]);assert.equal(await r.frame('audio'),null);
});
test('bad frame size rejects before allocation and truncated payload rejects',async()=>{
 const h=Buffer.alloc(12);h.writeUInt32LE(VIDEO_BYTES+4);
 await assert.rejects(()=>new Reader(Readable.from([h])).frame('video'),/Invalid frame size/);
 h.writeUInt32LE(8);await assert.rejects(()=>new Reader(Readable.from([h,Buffer.alloc(3)])).frame('audio'),/Truncated frame/);
});

test('720p transport validates its exact frame size and rejects 1080p payload',async()=>{
 const bytes=1280*720*3/2,h=Buffer.alloc(12);h.writeUInt32LE(bytes);
 const reader=new Reader(Readable.from([h,Buffer.alloc(bytes)]));
 assert.equal((await reader.frame('video',bytes)).data.length,bytes);
 h.writeUInt32LE(VIDEO_BYTES);
 await assert.rejects(()=>new Reader(Readable.from([h])).frame('video',bytes),/Invalid frame size/);
});
