"use client";

type Props = {
  volume: number;
  muted: boolean;
  onVolumeChange: (value: number) => void;
  onToggleMute: () => void;
};

export default function StreamVolumeControl({ volume, muted, onVolumeChange, onToggleMute }: Props) {
  const silent = muted || volume === 0;
  return (
    <div className="stream-volume" role="group" aria-label="Volume da transmissão">
      <button
        className="stream-volume-toggle"
        type="button"
        onClick={onToggleMute}
        aria-label={silent ? "Ativar som da transmissão" : "Silenciar transmissão"}
        aria-pressed={muted}
        title={silent ? "Ativar som" : "Silenciar"}
      >
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M11 5 6 9H3v6h3l5 4V5Z" />
          {silent ? <path d="m16 9 5 6m0-6-5 6" /> : volume < 50 ? <path d="M15 9a4 4 0 0 1 0 6" /> : <><path d="M15 9a4 4 0 0 1 0 6" /><path d="M18 6a8 8 0 0 1 0 12" /></>}
        </svg>
      </button>
      <div className="stream-volume-slider-wrap">
        <input
          aria-label="Volume da transmissão"
          className="stream-volume-slider"
          type="range"
          min="0"
          max="100"
          step="1"
          value={volume}
          onChange={(event) => onVolumeChange(Number(event.target.value))}
          style={{ backgroundSize: `${volume}% 100%` }}
        />
      </div>
      <span className="stream-volume-percent" aria-hidden="true">{silent ? 0 : volume}%</span>
    </div>
  );
}
