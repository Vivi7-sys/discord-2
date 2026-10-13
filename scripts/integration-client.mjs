// Cliente WebRTC real de teste. Só recebe JWT por IPC; nunca imprime tokens ou frames.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const rtc = require(process.env.DISCORD2_RTC_MODULE);
require(process.env.DISCORD2_RTC_MODULE.replace(/index\.cjs$/, "log.cjs")).log.level = "silent";
const room = new rtc.Room();
const readers = new Set();
let videoFrames = 0;
let audioFrames = 0;
let publications = [];
let sources = [];
let videoTimer;
let audioTimer;
room.on(rtc.RoomEvent.TrackSubscribed, (track) => {
  const video = track.kind === rtc.TrackKind.KIND_VIDEO;
  const reader = (video ? new rtc.VideoStream(track) : new rtc.AudioStream(track)).getReader();
  readers.add(reader);
  void (async () => {
    try {
      while (true) {
        const { done } = await reader.read();
        if (done) break;
        if (video) videoFrames++; else audioFrames++;
      }
    } catch { /* Trilha encerrada. */ }
    finally { readers.delete(reader); }
  })();
});

async function stopMedia() {
  clearInterval(videoTimer);
  clearInterval(audioTimer);
  const current = publications;
  publications = [];
  await Promise.allSettled(current.map((pub) => room.localParticipant.unpublishTrack(pub.sid, true)));
  await Promise.allSettled(sources.map((source) => source.close()));
  sources = [];
}

async function command(message) {
  if (message.action === "connect") {
    await room.connect(message.url, message.token, { autoSubscribe: true, dynacast: false });
  } else if (message.action === "publish") {
    const video = new rtc.VideoSource(320, 180);
    const audio = new rtc.AudioSource(16000, 1, 200);
    sources = [video, audio];
    const videoTrack = rtc.LocalVideoTrack.createVideoTrack("integration-video", video);
    const audioTrack = rtc.LocalAudioTrack.createAudioTrack("integration-audio", audio);
    const videoOptions = new rtc.TrackPublishOptions();
    videoOptions.source = rtc.TrackSource.SOURCE_SCREENSHARE;
    const audioOptions = new rtc.TrackPublishOptions();
    audioOptions.source = rtc.TrackSource.SOURCE_SCREENSHARE_AUDIO;
    publications = [await room.localParticipant.publishTrack(videoTrack, videoOptions)];
    publications.push(await room.localParticipant.publishTrack(audioTrack, audioOptions));
    // Mídia sintética enviada e decodificada por WebRTC real, sem captura do usuário.
    const pixels = new Uint8Array(320 * 180 * 4).fill(180);
    const samples = Int16Array.from({ length: 160 }, (_, i) => Math.round(Math.sin(i * 2 * Math.PI * 440 / 16000) * 2000));
    videoTimer = setInterval(() => { try { video.captureFrame(new rtc.VideoFrame(pixels, 320, 180, rtc.VideoBufferType.RGBA)); } catch { /* Revogação. */ } }, 100);
    let sending = false;
    audioTimer = setInterval(() => {
      if (sending) return;
      sending = true;
      void audio.captureFrame(new rtc.AudioFrame(samples, 16000, 1, 160)).catch(() => {}).finally(() => { sending = false; });
    }, 10);
  } else if (message.action === "stop") {
    await stopMedia();
  } else if (message.action === "disconnect") {
    await stopMedia();
    await Promise.allSettled([...readers].map((reader) => reader.cancel()));
    await room.disconnect();
    await rtc.dispose();
  }
  return {
    connected: room.isConnected,
    participants: room.remoteParticipants.size,
    videoFrames, audioFrames,
    remoteTracks: [...room.remoteParticipants.values()].reduce((n, p) => n + p.trackPublications.size, 0),
  };
}
process.on("message", (message) => {
  void command(message).then(
    (result) => process.send?.({ id: message.id, ok: true, result }),
    () => process.send?.({ id: message.id, ok: false })
  );
});
