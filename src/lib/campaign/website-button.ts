/** #2598/#2703: the button a website ad gets on Facebook. Launch sends it (as Meta's SHOP_NOW, SIGN_UP or LEARN_MORE) and Review shows it. */
export type WebsiteButton = "shop_now" | "sign_up" | "learn_more";

/** From the ad's own button words: Shop/Buy/Order now → Shop now, Sign up/Register → Sign up, anything else → Learn more. */
export function websiteButton(label: string | null | undefined): WebsiteButton {
  const words = (label ?? "").toLowerCase().replace(/[^a-z]+/g, " ").trim();
  if (/^(shop|buy|order) now$/.test(words)) return "shop_now";
  if (/^(sign up|register)$/.test(words)) return "sign_up";
  return "learn_more";
}
