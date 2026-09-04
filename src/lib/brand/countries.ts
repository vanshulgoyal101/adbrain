/**
 * Country dialling codes for the phone field.
 *
 * Flags are derived from the ISO 3166-1 alpha-2 code via Unicode regional
 * indicators rather than shipped as images, so there are no assets to load and
 * nothing to keep in sync.
 */
export interface Country {
  /** ISO 3166-1 alpha-2. */
  code: string;
  name: string;
  /** Dialling code without the leading "+". */
  dial: string;
}

/**
 * Common markets first so they're reachable without scrolling, then the rest
 * alphabetically. Order also resolves shared dialling codes: the first match
 * wins, which is why the US precedes Canada on +1.
 */
export const COUNTRIES: Country[] = [
  { code: "IN", name: "India", dial: "91" },
  { code: "US", name: "United States", dial: "1" },
  { code: "GB", name: "United Kingdom", dial: "44" },
  { code: "AE", name: "United Arab Emirates", dial: "971" },
  { code: "CA", name: "Canada", dial: "1" },
  { code: "AU", name: "Australia", dial: "61" },
  { code: "SG", name: "Singapore", dial: "65" },

  { code: "AF", name: "Afghanistan", dial: "93" },
  { code: "AL", name: "Albania", dial: "355" },
  { code: "DZ", name: "Algeria", dial: "213" },
  { code: "AD", name: "Andorra", dial: "376" },
  { code: "AR", name: "Argentina", dial: "54" },
  { code: "AM", name: "Armenia", dial: "374" },
  { code: "AT", name: "Austria", dial: "43" },
  { code: "AZ", name: "Azerbaijan", dial: "994" },
  { code: "BH", name: "Bahrain", dial: "973" },
  { code: "BD", name: "Bangladesh", dial: "880" },
  { code: "BY", name: "Belarus", dial: "375" },
  { code: "BE", name: "Belgium", dial: "32" },
  { code: "BT", name: "Bhutan", dial: "975" },
  { code: "BO", name: "Bolivia", dial: "591" },
  { code: "BA", name: "Bosnia and Herzegovina", dial: "387" },
  { code: "BW", name: "Botswana", dial: "267" },
  { code: "BR", name: "Brazil", dial: "55" },
  { code: "BN", name: "Brunei", dial: "673" },
  { code: "BG", name: "Bulgaria", dial: "359" },
  { code: "KH", name: "Cambodia", dial: "855" },
  { code: "CL", name: "Chile", dial: "56" },
  { code: "CN", name: "China", dial: "86" },
  { code: "CO", name: "Colombia", dial: "57" },
  { code: "CR", name: "Costa Rica", dial: "506" },
  { code: "HR", name: "Croatia", dial: "385" },
  { code: "CU", name: "Cuba", dial: "53" },
  { code: "CY", name: "Cyprus", dial: "357" },
  { code: "CZ", name: "Czechia", dial: "420" },
  { code: "DK", name: "Denmark", dial: "45" },
  { code: "EC", name: "Ecuador", dial: "593" },
  { code: "EG", name: "Egypt", dial: "20" },
  { code: "SV", name: "El Salvador", dial: "503" },
  { code: "EE", name: "Estonia", dial: "372" },
  { code: "FJ", name: "Fiji", dial: "679" },
  { code: "FI", name: "Finland", dial: "358" },
  { code: "FR", name: "France", dial: "33" },
  { code: "GE", name: "Georgia", dial: "995" },
  { code: "DE", name: "Germany", dial: "49" },
  { code: "GH", name: "Ghana", dial: "233" },
  { code: "GR", name: "Greece", dial: "30" },
  { code: "GT", name: "Guatemala", dial: "502" },
  { code: "GY", name: "Guyana", dial: "592" },
  { code: "HT", name: "Haiti", dial: "509" },
  { code: "HN", name: "Honduras", dial: "504" },
  { code: "HK", name: "Hong Kong", dial: "852" },
  { code: "HU", name: "Hungary", dial: "36" },
  { code: "IS", name: "Iceland", dial: "354" },
  { code: "ID", name: "Indonesia", dial: "62" },
  { code: "IR", name: "Iran", dial: "98" },
  { code: "IQ", name: "Iraq", dial: "964" },
  { code: "IE", name: "Ireland", dial: "353" },
  { code: "IL", name: "Israel", dial: "972" },
  { code: "IT", name: "Italy", dial: "39" },
  { code: "JP", name: "Japan", dial: "81" },
  { code: "JO", name: "Jordan", dial: "962" },
  { code: "KZ", name: "Kazakhstan", dial: "7" },
  { code: "KE", name: "Kenya", dial: "254" },
  { code: "KW", name: "Kuwait", dial: "965" },
  { code: "KG", name: "Kyrgyzstan", dial: "996" },
  { code: "LA", name: "Laos", dial: "856" },
  { code: "LV", name: "Latvia", dial: "371" },
  { code: "LB", name: "Lebanon", dial: "961" },
  { code: "LY", name: "Libya", dial: "218" },
  { code: "LI", name: "Liechtenstein", dial: "423" },
  { code: "LT", name: "Lithuania", dial: "370" },
  { code: "LU", name: "Luxembourg", dial: "352" },
  { code: "MO", name: "Macau", dial: "853" },
  { code: "MW", name: "Malawi", dial: "265" },
  { code: "MY", name: "Malaysia", dial: "60" },
  { code: "MV", name: "Maldives", dial: "960" },
  { code: "MT", name: "Malta", dial: "356" },
  { code: "MX", name: "Mexico", dial: "52" },
  { code: "MD", name: "Moldova", dial: "373" },
  { code: "MC", name: "Monaco", dial: "377" },
  { code: "ME", name: "Montenegro", dial: "382" },
  { code: "MA", name: "Morocco", dial: "212" },
  { code: "MM", name: "Myanmar", dial: "95" },
  { code: "NA", name: "Namibia", dial: "264" },
  { code: "NP", name: "Nepal", dial: "977" },
  { code: "NL", name: "Netherlands", dial: "31" },
  { code: "NZ", name: "New Zealand", dial: "64" },
  { code: "NI", name: "Nicaragua", dial: "505" },
  { code: "NG", name: "Nigeria", dial: "234" },
  { code: "MK", name: "North Macedonia", dial: "389" },
  { code: "NO", name: "Norway", dial: "47" },
  { code: "OM", name: "Oman", dial: "968" },
  { code: "PK", name: "Pakistan", dial: "92" },
  { code: "PS", name: "Palestine", dial: "970" },
  { code: "PA", name: "Panama", dial: "507" },
  { code: "PG", name: "Papua New Guinea", dial: "675" },
  { code: "PY", name: "Paraguay", dial: "595" },
  { code: "PE", name: "Peru", dial: "51" },
  { code: "PH", name: "Philippines", dial: "63" },
  { code: "PL", name: "Poland", dial: "48" },
  { code: "PT", name: "Portugal", dial: "351" },
  { code: "QA", name: "Qatar", dial: "974" },
  { code: "RO", name: "Romania", dial: "40" },
  { code: "RU", name: "Russia", dial: "7" },
  { code: "SM", name: "San Marino", dial: "378" },
  { code: "SA", name: "Saudi Arabia", dial: "966" },
  { code: "SN", name: "Senegal", dial: "221" },
  { code: "RS", name: "Serbia", dial: "381" },
  { code: "SK", name: "Slovakia", dial: "421" },
  { code: "SI", name: "Slovenia", dial: "386" },
  { code: "ZA", name: "South Africa", dial: "27" },
  { code: "KR", name: "South Korea", dial: "82" },
  { code: "ES", name: "Spain", dial: "34" },
  { code: "LK", name: "Sri Lanka", dial: "94" },
  { code: "SR", name: "Suriname", dial: "597" },
  { code: "SE", name: "Sweden", dial: "46" },
  { code: "CH", name: "Switzerland", dial: "41" },
  { code: "SY", name: "Syria", dial: "963" },
  { code: "TW", name: "Taiwan", dial: "886" },
  { code: "TJ", name: "Tajikistan", dial: "992" },
  { code: "TZ", name: "Tanzania", dial: "255" },
  { code: "TH", name: "Thailand", dial: "66" },
  { code: "TN", name: "Tunisia", dial: "216" },
  { code: "TR", name: "Turkey", dial: "90" },
  { code: "TM", name: "Turkmenistan", dial: "993" },
  { code: "UG", name: "Uganda", dial: "256" },
  { code: "UA", name: "Ukraine", dial: "380" },
  { code: "UY", name: "Uruguay", dial: "598" },
  { code: "UZ", name: "Uzbekistan", dial: "998" },
  { code: "VE", name: "Venezuela", dial: "58" },
  { code: "VN", name: "Vietnam", dial: "84" },
  { code: "YE", name: "Yemen", dial: "967" },
  { code: "ZM", name: "Zambia", dial: "260" },
  { code: "ZW", name: "Zimbabwe", dial: "263" },
];

/** The app's primary market, used when a stored number has no country code. */
export const DEFAULT_COUNTRY_CODE = "IN";

/** 🇮🇳 from "IN" — regional indicator symbols, so no flag images are needed. */
export function flagEmoji(code: string): string {
  const upper = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper)) return "";
  return String.fromCodePoint(
    ...[...upper].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  );
}

export function getCountry(code: string | null | undefined): Country {
  return (
    COUNTRIES.find((c) => c.code === (code ?? "").toUpperCase()) ??
    COUNTRIES.find((c) => c.code === DEFAULT_COUNTRY_CODE)!
  );
}

export interface ParsedPhone {
  countryCode: string;
  /** The number without the dialling code. */
  national: string;
}

/**
 * Split a stored number into country + national parts. Matches the longest
 * dialling code so "+911..." resolves to India (+91) rather than the US (+1).
 */
export function parsePhone(raw: string | null | undefined): ParsedPhone {
  const value = (raw ?? "").trim();
  if (!value.startsWith("+")) {
    return { countryCode: DEFAULT_COUNTRY_CODE, national: value };
  }
  const digits = value.slice(1).replace(/[^\d]/g, "");
  const candidates = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);
  for (const country of candidates) {
    if (digits.startsWith(country.dial)) {
      // Keep the user's spacing by trimming the dial code off the original text.
      const rest = value.slice(1).replace(/^\s*/, "");
      const national = rest.startsWith(country.dial)
        ? rest.slice(country.dial.length).trim()
        : digits.slice(country.dial.length);
      return { countryCode: country.code, national };
    }
  }
  return { countryCode: DEFAULT_COUNTRY_CODE, national: value.slice(1).trim() };
}

/** Recombine into the single string the rest of the app stores and renders. */
export function formatPhone(countryCode: string, national: string): string {
  const trimmed = national.trim();
  if (!trimmed) return "";
  return `+${getCountry(countryCode).dial} ${trimmed}`;
}
