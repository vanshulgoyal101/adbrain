export function creativeThumbnailUrl(originalUrl: string): string {
  try {
    const url = new URL(originalUrl);
    const match = url.pathname.match(/^(\/storage\/v1\/object\/public\/creatives\/[^/]+\/[^/]+)\/originals-v1\/([^/]+)\.(?:png|jpg|jpeg|webp)$/);
    if (!match) return originalUrl;
    url.pathname = `${match[1]}/thumbnails-v1/${match[2]}.webp`;
    return url.toString();
  } catch {
    return originalUrl;
  }
}