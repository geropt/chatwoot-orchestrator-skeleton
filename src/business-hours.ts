type BusinessHoursConfig = {
  businessHoursEnabled: boolean;
  businessTimezone: string;
  businessWorkingDays: number[];
  businessStartMinutes: number;
  businessEndMinutes: number;
};

export type BusinessHoursStatus = {
  enabled: boolean;
  isOpen: boolean;
  localDay: number | null;
  localMinutes: number | null;
};

export function getBusinessHoursStatus(
  now: Date,
  config: BusinessHoursConfig
): BusinessHoursStatus {
  if (!config.businessHoursEnabled) {
    return {
      enabled: false,
      isOpen: true,
      localDay: null,
      localMinutes: null
    };
  }

  const local = getLocalDayAndMinutes(now, config.businessTimezone);
  const isWorkingDay = config.businessWorkingDays.includes(local.day);
  const isInRange = isMinutesInRange(
    local.minutes,
    config.businessStartMinutes,
    config.businessEndMinutes
  );

  return {
    enabled: true,
    isOpen: isWorkingDay && isInRange,
    localDay: local.day,
    localMinutes: local.minutes
  };
}

function getLocalDayAndMinutes(
  date: Date,
  timezone: string
): { day: number; minutes: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });

  const parts = formatter.formatToParts(date);
  const weekday = parts.find(part => part.type === "weekday")?.value;
  const hour = Number(parts.find(part => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find(part => part.type === "minute")?.value ?? "0");

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6
  };

  const day = weekday ? weekdayMap[weekday] : 0;
  return {
    day,
    minutes: hour * 60 + minute
  };
}

function isMinutesInRange(value: number, start: number, end: number): boolean {
  if (start === end) {
    return true;
  }

  if (start < end) {
    return value >= start && value < end;
  }

  return value >= start || value < end;
}
