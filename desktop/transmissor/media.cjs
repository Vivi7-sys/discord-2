// Private IPC v2. Audio/video use separate descriptors to avoid head-of-line blocking.
const VIDEO_BYTES=1920*1080*3/2;
class Reader {
  constructor(stream){this.iterator=stream[Symbol.asyncIterator]();this.pending=Buffer.alloc(0);}
  async read(n){
    const chunks=[];let left=n;
    while(left){
      if(!this.pending.length){const next=await this.iterator.next();if(next.done){if(left===n)return null;throw Error('Truncated frame');}this.pending=next.value;}
      const take=Math.min(left,this.pending.length);chunks.push(this.pending.subarray(0,take));this.pending=this.pending.subarray(take);left-=take;
    }
    return chunks.length===1?chunks[0]:Buffer.concat(chunks,n);
  }
  async config(){const line=[];for(let i=0;i<4096;i++){const b=await this.read(1);if(!b)throw Error('Missing configuration');if(b[0]===10)return JSON.parse(Buffer.from(line));line.push(b[0]);}throw Error('Configuration too large');}
  async frame(kind, videoBytes=VIDEO_BYTES){
    const h=await this.read(12);if(!h)return null;
    const size=h.readUInt32LE(),pts=h.readBigUInt64LE(4);
    if((kind==='slot' && size!==4)||(kind==='video' && size!==videoBytes)||(kind==='audio'&&(size===0 || size>192000 || size%4)))throw Error('Invalid frame size');
    const data=await this.read(size);if(!data)throw Error('Missing payload');
    return {data,pts};
  }
}
// SDK 1.1.0 dataPtr uses the WHOLE backing ArrayBuffer, ignoring byteOffset.
// Keep only offset-zero exact allocations, otherwise make an owned copy.
function ownedBytes(b){return b.byteOffset===0 && b.buffer.byteLength===b.byteLength?new Uint8Array(b.buffer):Uint8Array.from(b);}
class FrameMetrics {
  constructor(captureClock=true){this.captureClock=captureClock;this.count=0;this.first=this.last=null;this.lastPts=null;this.nonMonotonicPts=0;this.workMs=0;this.maxAgeMs=0;this.buckets=[];this.skippedStale=0;}
  record(pts,work){const now=process.hrtime.bigint();if(this.first===null)this.first=now;this.last=now;this.nonMonotonicPts+=this.lastPts!==null && pts<=this.lastPts?1:0;this.lastPts=pts;const bucket=Number((now-this.first)/1000000000n);this.buckets[bucket]=(this.buckets[bucket]||0)+1;this.count++;this.workMs+=work;if(this.captureClock)this.maxAgeMs=Math.max(this.maxAgeMs,Number(now/1000n-pts)/1000);}
  snapshot(includeIdle=false){const end=includeIdle?process.hrtime.bigint():this.last;const span=this.first!==null && end!==null?Number(end-this.first)/1e9:0;return {frames:this.count,fps:span?(this.count-1)/span:0,spanSeconds:span,workMs:this.workMs,nonMonotonicPts:this.nonMonotonicPts,maxAgeMs:this.captureClock?this.maxAgeMs:null,perSecond:Array.from({length:Math.max(this.buckets.length,includeIdle?Math.ceil(span):0)},(_,i)=>this.buckets[i]||0),skippedStale:this.skippedStale};}
}
module.exports={Reader,ownedBytes,FrameMetrics,VIDEO_BYTES};
