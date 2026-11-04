export const MEDIA_PILOT_AD_LIMIT = 6;

/** Split into contiguous bands, keeping one ad set when the range is too narrow. */
export function splitAgeRange(min: number, max: number): { ageMin: number; ageMax: number; label: string }[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max - min < 6) {
    return [{ ageMin: min, ageMax: max, label: `Age ${min}–${max}` }];
  }
  const mid = Math.floor((min + max) / 2);
  return [
    { ageMin: min, ageMax: mid, label: `Age ${min}–${mid}` },
    { ageMin: mid + 1, ageMax: max, label: `Age ${mid + 1}–${max}` },
  ];
}

export function campaignAdSetCount(abTest: boolean, ageMin?: number, ageMax?: number): number {
  return abTest ? splitAgeRange(ageMin ?? 25, ageMax ?? 60).length : 1;
}

export function campaignAdCount(creativeCount: number, abTest: boolean, ageMin?: number, ageMax?: number): number {
  return creativeCount * campaignAdSetCount(abTest, ageMin, ageMax);
}
