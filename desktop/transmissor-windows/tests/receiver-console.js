// Run in the spectator's DevTools Console while the video is visible.
// Local instrumentation only; no deployment, account access, media or network requests.
// Returns counters for the video element, not inbound RTP packets.
(() => {
  const video = [...document.querySelectorAll('video')].find(v => v.videoWidth > 0);
  if (!video?.requestVideoFrameCallback) throw Error('Abra o vídeo no espectador primeiro.');
  let active = true, previous = null, latest = null;
  const samples = [];
  function frame(_now, metadata) {
    latest = metadata;
    if (active) video.requestVideoFrameCallback(frame);
  }
  video.requestVideoFrameCallback(frame);
  const interval = setInterval(() => {
    const now = performance.now(), quality = video.getVideoPlaybackQuality();
    const current = {time: now, presented: latest?.presentedFrames ?? null,
      total: quality.totalVideoFrames, dropped: quality.droppedVideoFrames};
    if (previous) {
      const seconds = (now - previous.time) / 1000;
      const sample = {seconds: Number(seconds.toFixed(3)), width: video.videoWidth, height: video.videoHeight,
        videoPipelineFps: (current.total - previous.total) / seconds,
        presentedFps: current.presented === null || previous.presented === null ? null : (current.presented - previous.presented) / seconds,
        droppedFrames: current.dropped - previous.dropped,
        pageVisible: document.visibilityState === 'visible'};
      samples.push(sample); if (samples.length > 1800) samples.shift();
      console.table([sample]);
    }
    previous = current;
  }, 2000);
  window.d2ReceiverDiagnostics = {samples, stop() {active = false; clearInterval(interval);}};
  return 'Ativo. Parar: d2ReceiverDiagnostics.stop(). Resultados: d2ReceiverDiagnostics.samples. FPS RTP/decodificado: consultar webrtc-internals.';
})();
