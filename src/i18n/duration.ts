/**
 * #1838: a span of time in words without "ago" ("about 40 minutes" / "लगभग 40 मिनट"), for "up to {age} old".
 * Its own module so client components don't pull in the message files with `@/i18n/locale`.
 */
export function durationIn(locale: "en" | "hi", ms: number): string {
  const mins = Math.max(1, Math.round(ms / 60_000));
  const [value, unit] = mins < 60 ? [mins, "minute"] : mins < 36 * 60 ? [Math.round(mins / 60), "hour"] : [Math.round(mins / 1440), "day"];
  const words = new Intl.NumberFormat(locale === "en" ? "en-IN" : locale, { style: "unit", unit, unitDisplay: "long" }).format(value);
  return `${locale === "en" ? "about" : "लगभग"} ${words}`;
}
