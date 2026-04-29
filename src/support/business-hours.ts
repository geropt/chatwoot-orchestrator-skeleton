import type { BusinessHoursConfig, Weekday } from "../config.js";

export type BusinessHoursWindow = {
  start: string;
  end: string;
};

export type BusinessHoursStatus = {
  isOpen: boolean;
  timezone: string;
  localDate: string;
  localTime: string;
  nextOpenAt: Date | null;
};

export type BusinessHoursOptions = {
  timezone: string;
  schedule: BusinessHoursConfig;
  holidays: string[];
  now?: Date;
};

const WEEKDAYS: Weekday[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday"
];

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  weekday: Weekday;
  hour: number;
  minute: number;
};

export function getBusinessHoursStatus(
  options: BusinessHoursOptions
): BusinessHoursStatus {
  const now = options.now ?? new Date();
  const holidays = new Set(options.holidays);
  const parts = getZonedParts(now, options.timezone);
  const localDate = formatDate(parts);
  const localTime = formatTime(parts.hour, parts.minute);
  const isHoliday = holidays.has(localDate);
  const minuteOfDay = parts.hour * 60 + parts.minute;
  const periods = normalizePeriods(options.schedule[parts.weekday] ?? []);

  const isOpen =
    !isHoliday &&
    periods.some(
      (period) =>
        minuteOfDay >= toMinuteOfDay(period.start) &&
        minuteOfDay < toMinuteOfDay(period.end)
    );

  return {
    isOpen,
    timezone: options.timezone,
    localDate,
    localTime,
    nextOpenAt: findNextOpenAt({
      now,
      parts,
      timezone: options.timezone,
      schedule: options.schedule,
      holidays
    })
  };
}

function findNextOpenAt(input: {
  now: Date;
  parts: ZonedParts;
  timezone: string;
  schedule: BusinessHoursConfig;
  holidays: Set<string>;
}): Date | null {
  const currentMinute = input.parts.hour * 60 + input.parts.minute;

  for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
    const date = addLocalDays(input.parts, dayOffset);
    const localDate = formatDate({
      ...input.parts,
      year: date.year,
      month: date.month,
      day: date.day
    });
    if (input.holidays.has(localDate)) continue;

    const weekday = WEEKDAYS[date.weekdayIndex];
    const periods = normalizePeriods(input.schedule[weekday] ?? []);
    for (const period of periods) {
      const startMinute = toMinuteOfDay(period.start);
      if (dayOffset === 0 && startMinute <= currentMinute) continue;
      const hour = Math.floor(startMinute / 60);
      const minute = startMinute % 60;
      return zonedDateTimeToDate({
        year: date.year,
        month: date.month,
        day: date.day,
        hour,
        minute,
        timezone: input.timezone
      });
    }
  }

  return null;
}

function normalizePeriods(periods: BusinessHoursWindow[]): BusinessHoursWindow[] {
  return [...periods]
    .filter((period) => isTime(period.start) && isTime(period.end))
    .filter((period) => toMinuteOfDay(period.start) < toMinuteOfDay(period.end))
    .sort((a, b) => toMinuteOfDay(a.start) - toMinuteOfDay(b.start));
}

function getZonedParts(date: Date, timezone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value])
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: weekdayFromShortName(parts.weekday),
    hour: Number(parts.hour),
    minute: Number(parts.minute)
  };
}

function weekdayFromShortName(value: string): Weekday {
  switch (value) {
    case "Sun":
      return "sunday";
    case "Mon":
      return "monday";
    case "Tue":
      return "tuesday";
    case "Wed":
      return "wednesday";
    case "Thu":
      return "thursday";
    case "Fri":
      return "friday";
    case "Sat":
      return "saturday";
    default:
      throw new Error(`Unsupported weekday: ${value}`);
  }
}

function addLocalDays(
  parts: Pick<ZonedParts, "year" | "month" | "day">,
  days: number
): { year: number; month: number; day: number; weekdayIndex: number } {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    weekdayIndex: date.getUTCDay()
  };
}

function zonedDateTimeToDate(input: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  timezone: string;
}): Date {
  let timestamp = Date.UTC(
    input.year,
    input.month - 1,
    input.day,
    input.hour,
    input.minute
  );

  for (let i = 0; i < 3; i++) {
    const parts = getZonedParts(new Date(timestamp), input.timezone);
    const desired = Date.UTC(
      input.year,
      input.month - 1,
      input.day,
      input.hour,
      input.minute
    );
    const actual = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute
    );
    const diff = desired - actual;
    if (diff === 0) break;
    timestamp += diff;
  }

  return new Date(timestamp);
}

function formatDate(parts: Pick<ZonedParts, "year" | "month" | "day">): string {
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

function formatTime(hour: number, minute: number): string {
  return `${pad2(hour)}:${pad2(minute)}`;
}

function isTime(value: string): boolean {
  return /^\d{2}:\d{2}$/.test(value) && toMinuteOfDay(value) < 24 * 60;
}

function toMinuteOfDay(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
