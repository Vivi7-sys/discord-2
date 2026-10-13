import { TrackSource } from "livekit-server-sdk";

export const screenPermission = {
  canPublish: true,
  canSubscribe: true,
  canPublishData: false,
  canPublishSources: [TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO],
};

export const viewerPermission = {
  canPublish: false,
  canSubscribe: true,
  canPublishData: false,
  canPublishSources: [],
};

export function isShareActionEnabled(action: "acquire" | "release", environment: string | undefined, flag: string | undefined) {
  return action === "release" || environment === "development" || flag === "true";
}
