/**
 * Shared date/time formatting from effective org/user settings.
 * Prefer these helpers over ad-hoc date-fns format() or toLocaleDateString.
 */

import { formatInTimeZone } from "date-fns-tz";
import { parseISO, isValid } from "date-fns";
import { useMemo } from "react";
import type { EffectiveSettings } from "@/lib/api";

export type DateFormatOption = "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD" | "DD MMM YYYY";
export type TimeFormatOption = "12h" | "24h";
export type WeekStartOption = "sunday" | "monday";

export const DATE_FORMAT_OPTIONS: { value: DateFormatOption; label: string }[] = [
  { value: "DD/MM/YYYY", label: "DD/MM/YYYY" },
  { value: "MM/DD/YYYY", label: "MM/DD/YYYY" },
  { value: "YYYY-MM-DD", label: "YYYY-MM-DD" },
  { value: "DD MMM YYYY", label: "DD MMM YYYY" },
];

export const TIME_FORMAT_OPTIONS: { value: TimeFormatOption; label: string }[] = [
  { value: "12h", label: "12-hour" },
  { value: "24h", label: "24-hour" },
];

export const DEFAULT_EFFECTIVE: EffectiveSettings = {
  timezone: "UTC",
  date_format: "DD MMM YYYY",
  time_format: "12h",
  week_start: "monday",
  reminder_send_hour: 9,
  reminder_skip_weekends: false,
  allow_user_display_override: false,
  allow_user_channel_toggle: true,
  sources: {},
};

function dateFnsPattern(dateFormat: string): string {
  switch (dateFormat) {
    case "DD/MM/YYYY":
      return "dd/MM/yyyy";
    case "MM/DD/YYYY":
      return "MM/dd/yyyy";
    case "YYYY-MM-DD":
      return "yyyy-MM-dd";
    case "DD MMM YYYY":
    default:
      return "dd MMM yyyy";
  }
}

function timeFnsPattern(timeFormat: string): string {
  return timeFormat === "24h" ? "HH:mm" : "h:mm a";
}

function asDate(value: Date | string | number | null | undefined): Date | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return isValid(value) ? value : null;
  if (typeof value === "number") {
    const d = new Date(value);
    return isValid(d) ? d : null;
  }
  const raw = String(value).trim();
  // Date-only: never shift by timezone — parse as local calendar date
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split("-").map(Number);
    const local = new Date(y, m - 1, d);
    return isValid(local) ? local : null;
  }
  const parsed = parseISO(raw);
  if (isValid(parsed)) return parsed;
  const fallback = new Date(raw);
  return isValid(fallback) ? fallback : null;
}

/** Format a date-only value (calibration due, etc.) — no TZ shift. */
export function formatDate(
  value: Date | string | number | null | undefined,
  settings: Pick<EffectiveSettings, "date_format"> = DEFAULT_EFFECTIVE,
): string {
  const d = asDate(value);
  if (!d) return "—";
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  switch (settings.date_format) {
    case "DD/MM/YYYY":
      return `${String(day).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
    case "MM/DD/YYYY":
      return `${String(m).padStart(2, "0")}/${String(day).padStart(2, "0")}/${y}`;
    case "YYYY-MM-DD":
      return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    case "DD MMM YYYY":
    default:
      return `${String(day).padStart(2, "0")} ${months[m - 1]} ${y}`;
  }
}

/** Format a UTC timestamp in the effective timezone. */
export function formatDateTime(
  value: Date | string | number | null | undefined,
  settings: Pick<EffectiveSettings, "date_format" | "time_format" | "timezone"> = DEFAULT_EFFECTIVE,
): string {
  const d = asDate(value);
  if (!d) return "—";
  const tz = settings.timezone || "UTC";
  const pattern = `${dateFnsPattern(settings.date_format)}, ${timeFnsPattern(settings.time_format)}`;
  try {
    return formatInTimeZone(d, tz, pattern);
  } catch {
    return "—";
  }
}

export function formatTime(
  value: Date | string | number | null | undefined,
  settings: Pick<EffectiveSettings, "time_format" | "timezone"> = DEFAULT_EFFECTIVE,
): string {
  const d = asDate(value);
  if (!d) return "—";
  const tz = settings.timezone || "UTC";
  try {
    return formatInTimeZone(d, tz, timeFnsPattern(settings.time_format));
  } catch {
    return "—";
  }
}

/** Hour label for reminder send hour dropdown (0–23). */
export function formatHourLabel(hour: number, timeFormat: string): string {
  const h = Math.max(0, Math.min(23, Math.floor(hour)));
  if (timeFormat === "24h") return `${String(h).padStart(2, "0")}:00`;
  const ampm = h < 12 ? "AM" : "PM";
  const h12 = h % 12 || 12;
  return `${h12}:00 ${ampm}`;
}

/** Curated business timezones — friendly labels; values stay IANA. */
export type TimezoneOption = {
  value: string;
  /** Short professional name, e.g. "Central Time" */
  name: string;
  /** City / region hint for disambiguation */
  place: string;
  /** Preferred abbreviation when Intl only returns an offset (e.g. IST). */
  abbr?: string;
  /** Search aliases: cst, chicago, central, … */
  aliases: string[];
};

export const COMMON_TIMEZONES: TimezoneOption[] = [
  {
    value: "UTC",
    name: "Coordinated Universal Time",
    place: "UTC",
    abbr: "UTC",
    aliases: ["utc", "gmt", "zulu"],
  },
  {
    value: "America/New_York",
    name: "Eastern Time",
    place: "US & Canada",
    abbr: "ET",
    aliases: ["et", "est", "edt", "eastern", "new york", "nyc"],
  },
  {
    value: "America/Chicago",
    name: "Central Time",
    place: "US & Canada",
    abbr: "CT",
    aliases: ["ct", "cst", "cdt", "central", "chicago"],
  },
  {
    value: "America/Denver",
    name: "Mountain Time",
    place: "US & Canada",
    abbr: "MT",
    aliases: ["mt", "mst", "mdt", "mountain", "denver"],
  },
  {
    value: "America/Phoenix",
    name: "Mountain Time (no DST)",
    place: "Arizona",
    abbr: "MST",
    aliases: ["mst", "arizona", "phoenix"],
  },
  {
    value: "America/Los_Angeles",
    name: "Pacific Time",
    place: "US & Canada",
    abbr: "PT",
    aliases: ["pt", "pst", "pdt", "pacific", "los angeles", "la"],
  },
  {
    value: "America/Anchorage",
    name: "Alaska Time",
    place: "United States",
    abbr: "AKT",
    aliases: ["akt", "akst", "akdt", "alaska", "anchorage"],
  },
  {
    value: "Pacific/Honolulu",
    name: "Hawaii Time",
    place: "United States",
    abbr: "HST",
    aliases: ["hst", "hawaii", "honolulu"],
  },
  {
    value: "America/Toronto",
    name: "Eastern Time",
    place: "Canada",
    abbr: "ET",
    aliases: ["et", "toronto", "ontario", "canada east"],
  },
  {
    value: "America/Mexico_City",
    name: "Central Time",
    place: "Mexico",
    abbr: "CT",
    aliases: ["ct", "mexico", "mexico city"],
  },
  {
    value: "America/Sao_Paulo",
    name: "Brasilia Time",
    place: "Brazil",
    abbr: "BRT",
    aliases: ["brt", "brazil", "sao paulo"],
  },
  {
    value: "Europe/London",
    name: "UK Time",
    place: "London",
    abbr: "GMT",
    aliases: ["gmt", "bst", "london", "uk", "britain"],
  },
  {
    value: "Europe/Dublin",
    name: "Irish Time",
    place: "Dublin",
    abbr: "IST",
    aliases: ["dublin", "ireland"],
  },
  {
    value: "Europe/Paris",
    name: "Central European Time",
    place: "Paris",
    abbr: "CET",
    aliases: ["cet", "cest", "paris", "france"],
  },
  {
    value: "Europe/Berlin",
    name: "Central European Time",
    place: "Berlin",
    abbr: "CET",
    aliases: ["cet", "berlin", "germany"],
  },
  {
    value: "Europe/Amsterdam",
    name: "Central European Time",
    place: "Amsterdam",
    abbr: "CET",
    aliases: ["cet", "amsterdam", "netherlands"],
  },
  {
    value: "Europe/Zurich",
    name: "Central European Time",
    place: "Zurich",
    abbr: "CET",
    aliases: ["cet", "zurich", "switzerland"],
  },
  {
    value: "Europe/Madrid",
    name: "Central European Time",
    place: "Madrid",
    abbr: "CET",
    aliases: ["cet", "madrid", "spain"],
  },
  {
    value: "Europe/Rome",
    name: "Central European Time",
    place: "Rome",
    abbr: "CET",
    aliases: ["cet", "rome", "italy"],
  },
  {
    value: "Europe/Moscow",
    name: "Moscow Time",
    place: "Russia",
    abbr: "MSK",
    aliases: ["msk", "moscow", "russia"],
  },
  {
    value: "Asia/Dubai",
    name: "Gulf Standard Time",
    place: "UAE",
    abbr: "GST",
    aliases: ["gst", "dubai", "uae"],
  },
  {
    value: "Asia/Kolkata",
    name: "India Standard Time",
    place: "India",
    abbr: "IST",
    aliases: ["ist", "india", "kolkata", "calcutta", "mumbai", "delhi"],
  },
  {
    value: "Asia/Singapore",
    name: "Singapore Time",
    place: "Singapore",
    abbr: "SGT",
    aliases: ["sgt", "singapore"],
  },
  {
    value: "Asia/Hong_Kong",
    name: "Hong Kong Time",
    place: "Hong Kong",
    abbr: "HKT",
    aliases: ["hkt", "hong kong"],
  },
  {
    value: "Asia/Shanghai",
    name: "China Standard Time",
    place: "China",
    abbr: "CST",
    aliases: ["cst", "china", "shanghai", "beijing"],
  },
  {
    value: "Asia/Tokyo",
    name: "Japan Standard Time",
    place: "Japan",
    abbr: "JST",
    aliases: ["jst", "japan", "tokyo"],
  },
  {
    value: "Asia/Seoul",
    name: "Korea Standard Time",
    place: "South Korea",
    abbr: "KST",
    aliases: ["kst", "korea", "seoul"],
  },
  {
    value: "Australia/Sydney",
    name: "Australian Eastern Time",
    place: "Sydney",
    abbr: "AET",
    aliases: ["aest", "aedt", "aet", "sydney", "australia east"],
  },
  {
    value: "Australia/Melbourne",
    name: "Australian Eastern Time",
    place: "Melbourne",
    abbr: "AET",
    aliases: ["aet", "melbourne"],
  },
  {
    value: "Australia/Perth",
    name: "Australian Western Time",
    place: "Perth",
    abbr: "AWST",
    aliases: ["awst", "perth"],
  },
  {
    value: "Pacific/Auckland",
    name: "New Zealand Time",
    place: "Auckland",
    abbr: "NZT",
    aliases: ["nzt", "nzst", "nzdt", "auckland", "new zealand"],
  },
];

function intlPart(
  timeZone: string,
  type: Intl.DateTimeFormatPartTypes,
  options: Intl.DateTimeFormatOptions,
  at: Date,
): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, ...options }).formatToParts(at);
    return parts.find((p) => p.type === type)?.value || "";
  } catch {
    return "";
  }
}

/** Current abbreviation for a zone (CST, CDT, IST, GMT, …). */
export function timezoneAbbrev(timeZone: string, at: Date = new Date()): string {
  const known = COMMON_TIMEZONES.find((z) => z.value === timeZone);
  const short = intlPart(timeZone, "timeZoneName", { timeZoneName: "short" }, at);
  // Prefer live CST/CDT/EDT when the engine provides a letter abbrev (not GMT±offset)
  if (short && !/^(GMT|UTC)/i.test(short) && !/^[+-]/.test(short)) return short;
  if (known?.abbr) return known.abbr;
  if (short) return short.replace("GMT", "UTC");
  return known?.abbr || "UTC";
}

/** Offset like UTC−06:00 (en-dash) for secondary clarity. */
export function utcOffsetLabel(timeZone: string, at: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "shortOffset",
    }).formatToParts(at);
    const off = parts.find((p) => p.type === "timeZoneName")?.value || "UTC";
    return off.replace("GMT", "UTC").replace("+", "+").replace("-", "−");
  } catch {
    return "UTC";
  }
}

/**
 * Professional display label, e.g. "Central Time (CST) — US & Canada".
 * Still stores/uses the IANA id under the hood.
 */
export function timezoneDisplayLabel(timeZone: string, at: Date = new Date()): string {
  const key = (timeZone || "UTC").trim() || "UTC";
  const abbr = timezoneAbbrev(key, at);
  const known = COMMON_TIMEZONES.find((z) => z.value === key);
  if (known) {
    if (known.value === "UTC") return `Coordinated Universal Time (UTC)`;
    return `${known.name} (${abbr}) — ${known.place}`;
  }
  const long =
    intlPart(key, "timeZoneName", { timeZoneName: "longGeneric" }, at) ||
    intlPart(key, "timeZoneName", { timeZoneName: "long" }, at) ||
    key.replace(/_/g, " ");
  const city = key.includes("/") ? key.split("/").pop()!.replace(/_/g, " ") : key;
  return `${long} (${abbr}) — ${city}`;
}

/** Compact label for sentences: "Central Time (CST)". */
export function timezoneShortLabel(timeZone: string, at: Date = new Date()): string {
  const key = (timeZone || "UTC").trim() || "UTC";
  if (key === "UTC") return "UTC";
  const abbr = timezoneAbbrev(key, at);
  const known = COMMON_TIMEZONES.find((z) => z.value === key);
  if (known) return `${known.name} (${abbr})`;
  const long =
    intlPart(key, "timeZoneName", { timeZoneName: "longGeneric" }, at) ||
    key.replace(/_/g, " ");
  return `${long} (${abbr})`;
}

export function listIanaTimezones(): string[] {
  const common = COMMON_TIMEZONES.map((z) => z.value);
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] })
      .supportedValuesOf?.("timeZone");
    if (supported?.length) {
      const rest = supported.filter((z) => !common.includes(z));
      return [...common, ...rest];
    }
  } catch {
    /* fall through */
  }
  return common;
}

/** Options for selects: common list first; search expands to full IANA with labels. */
export function filterTimezoneOptions(query: string): { value: string; label: string }[] {
  const q = query.trim().toLowerCase();
  const commonOpts = COMMON_TIMEZONES.map((z) => ({
    value: z.value,
    label: timezoneDisplayLabel(z.value),
    haystack: [z.value, z.name, z.place, ...z.aliases].join(" ").toLowerCase(),
  }));

  if (!q) {
    return commonOpts.map(({ value, label }) => ({ value, label }));
  }

  const matchedCommon = commonOpts.filter((z) => z.haystack.includes(q));
  const all = listIanaTimezones();
  const matchedRest = all
    .filter((z) => !COMMON_TIMEZONES.some((c) => c.value === z))
    .filter((z) => {
      const label = timezoneDisplayLabel(z).toLowerCase();
      return z.toLowerCase().includes(q) || label.includes(q);
    })
    .slice(0, 40)
    .map((z) => ({ value: z, label: timezoneDisplayLabel(z) }));

  const seen = new Set<string>();
  const out: { value: string; label: string }[] = [];
  for (const row of [...matchedCommon.map(({ value, label }) => ({ value, label })), ...matchedRest]) {
    if (seen.has(row.value)) continue;
    seen.add(row.value);
    out.push(row);
  }
  return out;
}

export function weekStartsOn(weekStart: string): 0 | 1 {
  return weekStart === "sunday" ? 0 : 1;
}

/** Hook-friendly binder around effective settings from /me. */
export function useFormatSettings(settings?: EffectiveSettings | null) {
  const s = settings ?? DEFAULT_EFFECTIVE;
  return useMemo(
    () => ({
      settings: s,
      formatDate: (v: Date | string | number | null | undefined) => formatDate(v, s),
      formatDateTime: (v: Date | string | number | null | undefined) => formatDateTime(v, s),
      formatTime: (v: Date | string | number | null | undefined) => formatTime(v, s),
      weekStartsOn: weekStartsOn(s.week_start),
      timezone: s.timezone,
    }),
    [s],
  );
}
