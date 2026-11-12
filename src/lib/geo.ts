/** US states and Canadian provinces: canonical names, USPS codes and 2020 populations. */

export type Region = { code: string; name: string; pop: number; country: "US" | "CA" };

const US: [string, string, number][] = [
  ["AL", "Alabama", 5024279], ["AK", "Alaska", 733391], ["AZ", "Arizona", 7151502],
  ["AR", "Arkansas", 3011524], ["CA", "California", 39538223], ["CO", "Colorado", 5773714],
  ["CT", "Connecticut", 3605944], ["DE", "Delaware", 989948], ["DC", "District of Columbia", 689545],
  ["FL", "Florida", 21538187], ["GA", "Georgia", 10711908], ["HI", "Hawaii", 1455271],
  ["ID", "Idaho", 1839106], ["IL", "Illinois", 12812508], ["IN", "Indiana", 6785528],
  ["IA", "Iowa", 3190369], ["KS", "Kansas", 2937880], ["KY", "Kentucky", 4505836],
  ["LA", "Louisiana", 4657757], ["ME", "Maine", 1362359], ["MD", "Maryland", 6177224],
  ["MA", "Massachusetts", 7029917], ["MI", "Michigan", 10077331], ["MN", "Minnesota", 5706494],
  ["MS", "Mississippi", 2961279], ["MO", "Missouri", 6154913], ["MT", "Montana", 1084225],
  ["NE", "Nebraska", 1961504], ["NV", "Nevada", 3104614], ["NH", "New Hampshire", 1377529],
  ["NJ", "New Jersey", 9288994], ["NM", "New Mexico", 2117522], ["NY", "New York", 20201249],
  ["NC", "North Carolina", 10439388], ["ND", "North Dakota", 779094], ["OH", "Ohio", 11799448],
  ["OK", "Oklahoma", 3959353], ["OR", "Oregon", 4237256], ["PA", "Pennsylvania", 13002700],
  ["RI", "Rhode Island", 1097379], ["SC", "South Carolina", 5118425], ["SD", "South Dakota", 886667],
  ["TN", "Tennessee", 6910840], ["TX", "Texas", 29145505], ["UT", "Utah", 3271616],
  ["VT", "Vermont", 643077], ["VA", "Virginia", 8631393], ["WA", "Washington", 7705281],
  ["WV", "West Virginia", 1793716], ["WI", "Wisconsin", 5893718], ["WY", "Wyoming", 576851],
];

const CA: [string, string, number][] = [
  ["ON", "Ontario", 14789406], ["QC", "Quebec", 8574571], ["BC", "British Columbia", 5147712],
  ["AB", "Alberta", 4441180], ["MB", "Manitoba", 1382145], ["SK", "Saskatchewan", 1178981],
  ["NS", "Nova Scotia", 992055], ["NB", "New Brunswick", 789225], ["NL", "Newfoundland", 520998],
  ["PE", "Prince Edward Island", 164318],
];

export const REGIONS: Region[] = [
  ...US.map(([code, name, pop]) => ({ code, name, pop, country: "US" as const })),
  ...CA.map(([code, name, pop]) => ({ code, name, pop, country: "CA" as const })),
];

const BY_CODE = new Map(REGIONS.map((r) => [r.code, r]));
const BY_NAME = new Map(REGIONS.map((r) => [r.name.toLowerCase(), r]));

/** Aliases the school feeds actually print ("N.Y.", "Md.", "Ont.", "B.C."). */
const ALIASES: Record<string, string> = {
  "n y": "NY", "ny": "NY", "new york": "NY",
  "md": "MD", "md.": "MD", "maryland": "MD",
  "nj": "NJ", "n.j.": "NJ", "new jersey": "NJ",
  "pa": "PA", "pa.": "PA", "pennsylvania": "PA",
  "mass": "MA", "mass.": "MA", "ma": "MA", "massachusetts": "MA",
  "conn": "CT", "conn.": "CT", "ct": "CT", "connecticut": "CT",
  "calif": "CA", "calif.": "CA", "ca": "CA", "california": "CA",
  "ont": "ON", "ont.": "ON", "ontario": "ON",
  "que": "QC", "que.": "QC", "quebec": "QC", "québec": "QC",
  "b c": "BC", "b.c.": "BC", "bc": "BC", "british columbia": "BC",
  "alta": "AB", "alta.": "AB", "ab": "AB", "alberta": "AB",
  "sask": "SK", "sask.": "SK", "sk": "SK", "saskatchewan": "SK",
  "man": "MB", "man.": "MB", "mb": "MB", "manitoba": "MB",
  "n s": "NS", "n.s.": "NS", "nova scotia": "NS",
  "n b": "NB", "n.b.": "NB", "new brunswick": "NB",
  "n l": "NL", "n.l.": "NL", "newfoundland": "NL",
  "p e i": "PE", "p.e.i.": "PE", "prince edward island": "PE",
  "d c": "DC", "d.c.": "DC", "district of columbia": "DC",
};

/** "N.Y." → "NY"; anything unrecognised returns null so it never becomes a phantom state. */
export function regionCode(raw?: string | null): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/\./g, "").replace(/\s+/g, " ").toLowerCase();
  if (!cleaned) return null;
  const aliased = ALIASES[cleaned] ?? ALIASES[raw.trim().toLowerCase()];
  if (aliased) return aliased;
  const upper = cleaned.toUpperCase();
  if (BY_CODE.has(upper)) return upper;
  const named = BY_NAME.get(cleaned);
  return named ? named.code : null;
}

export function region(code: string): Region | undefined {
  return BY_CODE.get(code);
}
