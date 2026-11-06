import { getEnv } from "@/lib/env";

export function mediaUploadsEnabled(): boolean {
  return getEnv().MEDIA_UPLOADS_ENABLED;
}

export function mediaVideoEnabled(): boolean {
  const env = getEnv();
  return env.MEDIA_UPLOADS_ENABLED && env.MEDIA_VIDEO_ENABLED;
}
