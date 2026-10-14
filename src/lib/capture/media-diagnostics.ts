import type { Room, Track } from "livekit-client";

type Sample = { timestamp: number; bytes: number; jitterDelay: number; emitted: number };

/** Opt-in local, sem tráfego de telemetria, SDP, IPs, identidades ou React state. */
export function startMediaDiagnostics(room: Room): () => void {
  let enabled = false;
  try { enabled = localStorage.getItem("discord2-media-diagnostics") === "1"; } catch { /* Armazenamento bloqueado. */ }
  if (!enabled) return () => {};
  let stopped = false;
  let running = false;
  const previous = new WeakMap<Track, Map<string, Sample>>();
  const poll = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const participants = [room.localParticipant, ...room.remoteParticipants.values()];
      for (const participant of participants) {
        for (const publication of participant.trackPublications.values()) {
          const track = publication.track;
          if (!track) continue;
          const settings = track.mediaStreamTrack.getSettings() as MediaTrackSettings & { restrictOwnAudio?: boolean; suppressLocalAudioPlayback?: boolean };
          console.debug("[D2 capture/playback]", {
            source: publication.source, local: participant === room.localParticipant,
            width: settings.width, height: settings.height, fps: settings.frameRate,
            restrictOwnAudio: settings.restrictOwnAudio,
            suppressLocalAudioPlayback: settings.suppressLocalAudioPlayback,
          });
          const report = await track.getRTCStatsReport();
          if (stopped) return;
          const samples = previous.get(track) ?? new Map<string, Sample>();
          previous.set(track, samples);
          report?.forEach((stat) => {
            if (stat.type !== "outbound-rtp" && stat.type !== "inbound-rtp" && stat.type !== "remote-inbound-rtp") return;
            const bytes = stat.bytesSent ?? stat.bytesReceived ?? 0;
            const old = samples.get(stat.id);
            const elapsed = old ? stat.timestamp - old.timestamp : 0;
            const emitted = stat.jitterBufferEmittedCount ?? 0;
            const jitterDelay = stat.jitterBufferDelay ?? 0;
            console.debug("[D2 media]", {
              direction: stat.type, kind: stat.kind,
              kbps: old && elapsed > 0 ? Math.round(8 * (bytes - old.bytes) / elapsed) : undefined,
              fps: stat.framesPerSecond, width: stat.frameWidth, height: stat.frameHeight,
              qualityLimit: stat.qualityLimitationReason,
              encodeMsPerFrame: stat.framesEncoded ? 1000 * stat.totalEncodeTime / stat.framesEncoded : undefined,
              jitterMs: stat.jitter === undefined ? undefined : stat.jitter * 1000,
              jitterBufferMs: old && emitted > old.emitted ? 1000 * (jitterDelay - old.jitterDelay) / (emitted - old.emitted) : undefined,
              rttMs: stat.roundTripTime === undefined ? undefined : stat.roundTripTime * 1000,
              packetsLost: stat.packetsLost, framesDropped: stat.framesDropped, freezes: stat.freezeCount,
            });
            samples.set(stat.id, { timestamp: stat.timestamp, bytes, jitterDelay, emitted });
          });
        }
      }
    } catch { /* Stats opcionais não podem interromper reprodução/reconexão. */ }
    finally { running = false; }
  };
  const timer = setInterval(() => { void poll(); }, 5000);
  return () => { stopped = true; clearInterval(timer); };
}
