export type ScheduleFrequency = "hourly" | "daily" | "weekly" | "monthly" | "custom";

export const DAYS_OF_WEEK = [
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
  { value: "0", label: "Sunday" },
];

export const DEFAULT_TIME = "09:00";
export const DEFAULT_MINUTE = "0";
export const DEFAULT_DAY_OF_MONTH = "1";
export const DEFAULT_DAY_OF_WEEK = "1";

const padTwo = (value: number) => String(value).padStart(2, "0");

export const isValidNumber = (value: string, min: number, max: number) => {
  if (!/^\d+$/.test(value)) return false;
  const num = Number(value);
  return num >= min && num <= max;
};

export const parseCronExpression = (expression?: string) => {
  if (!expression) {
    return {
      frequency: "daily" as ScheduleFrequency,
      timeOfDay: DEFAULT_TIME,
      minuteOfHour: DEFAULT_MINUTE,
      dayOfMonth: DEFAULT_DAY_OF_MONTH,
      dayOfWeek: DEFAULT_DAY_OF_WEEK,
      customCron: "",
    };
  }

  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    return {
      frequency: "custom" as ScheduleFrequency,
      timeOfDay: DEFAULT_TIME,
      minuteOfHour: DEFAULT_MINUTE,
      dayOfMonth: DEFAULT_DAY_OF_MONTH,
      dayOfWeek: DEFAULT_DAY_OF_WEEK,
      customCron: expression,
    };
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  if (month !== "*") {
    return {
      frequency: "custom" as ScheduleFrequency,
      timeOfDay: DEFAULT_TIME,
      minuteOfHour: DEFAULT_MINUTE,
      dayOfMonth: DEFAULT_DAY_OF_MONTH,
      dayOfWeek: DEFAULT_DAY_OF_WEEK,
      customCron: expression,
    };
  }

  if (
    hour === "*" &&
    dayOfMonth === "*" &&
    dayOfWeek === "*" &&
    isValidNumber(minute, 0, 59)
  ) {
    return {
      frequency: "hourly" as ScheduleFrequency,
      timeOfDay: DEFAULT_TIME,
      minuteOfHour: minute,
      dayOfMonth: DEFAULT_DAY_OF_MONTH,
      dayOfWeek: DEFAULT_DAY_OF_WEEK,
      customCron: "",
    };
  }

  if (
    isValidNumber(hour, 0, 23) &&
    isValidNumber(minute, 0, 59) &&
    dayOfMonth === "*" &&
    dayOfWeek === "*"
  ) {
    return {
      frequency: "daily" as ScheduleFrequency,
      timeOfDay: `${padTwo(Number(hour))}:${padTwo(Number(minute))}`,
      minuteOfHour: minute,
      dayOfMonth: DEFAULT_DAY_OF_MONTH,
      dayOfWeek: DEFAULT_DAY_OF_WEEK,
      customCron: "",
    };
  }

  if (
    isValidNumber(hour, 0, 23) &&
    isValidNumber(minute, 0, 59) &&
    dayOfMonth === "*" &&
    isValidNumber(dayOfWeek, 0, 7)
  ) {
    const normalizedDay = dayOfWeek === "7" ? "0" : dayOfWeek;
    return {
      frequency: "weekly" as ScheduleFrequency,
      timeOfDay: `${padTwo(Number(hour))}:${padTwo(Number(minute))}`,
      minuteOfHour: minute,
      dayOfMonth: DEFAULT_DAY_OF_MONTH,
      dayOfWeek: normalizedDay,
      customCron: "",
    };
  }

  if (
    isValidNumber(hour, 0, 23) &&
    isValidNumber(minute, 0, 59) &&
    isValidNumber(dayOfMonth, 1, 31) &&
    dayOfWeek === "*"
  ) {
    return {
      frequency: "monthly" as ScheduleFrequency,
      timeOfDay: `${padTwo(Number(hour))}:${padTwo(Number(minute))}`,
      minuteOfHour: minute,
      dayOfMonth,
      dayOfWeek: DEFAULT_DAY_OF_WEEK,
      customCron: "",
    };
  }

  return {
    frequency: "custom" as ScheduleFrequency,
    timeOfDay: DEFAULT_TIME,
    minuteOfHour: DEFAULT_MINUTE,
    dayOfMonth: DEFAULT_DAY_OF_MONTH,
    dayOfWeek: DEFAULT_DAY_OF_WEEK,
    customCron: expression,
  };
};

export const buildCronExpression = (values: {
  frequency: ScheduleFrequency;
  timeOfDay: string;
  minuteOfHour: string;
  dayOfMonth: string;
  dayOfWeek: string;
  customCron: string;
}) => {
  if (values.frequency === "custom") {
    return values.customCron.trim();
  }

  if (values.frequency === "hourly") {
    let minute = values.minuteOfHour;
    if (!isValidNumber(minute, 0, 59)) {
      console.warn(
        "scheduleCron: Invalid minuteOfHour value for hourly schedule; falling back to DEFAULT_MINUTE.",
        { minuteOfHour: values.minuteOfHour }
      );
      minute = DEFAULT_MINUTE;
    }
    return `${minute} * * * *`;
  }

  const [hour = "0", minute = "0"] = values.timeOfDay.split(":");
  const safeHour = isValidNumber(hour, 0, 23) ? hour : "0";
  const safeMinute = isValidNumber(minute, 0, 59) ? minute : "0";

  if (values.frequency === "daily") {
    return `${safeMinute} ${safeHour} * * *`;
  }

  if (values.frequency === "weekly") {
    const day = isValidNumber(values.dayOfWeek, 0, 6)
      ? values.dayOfWeek
      : DEFAULT_DAY_OF_WEEK;
    return `${safeMinute} ${safeHour} * * ${day}`;
  }

  const day = isValidNumber(values.dayOfMonth, 1, 31)
    ? values.dayOfMonth
    : DEFAULT_DAY_OF_MONTH;
  return `${safeMinute} ${safeHour} ${day} * *`;
};

export const describeSchedule = (values: {
  frequency: ScheduleFrequency;
  timeOfDay: string;
  minuteOfHour: string;
  dayOfMonth: string;
  dayOfWeek: string;
}) => {
  const [hour = "0", minute = "0"] = values.timeOfDay.split(":");
  const safeHour = padTwo(Number(hour || 0));
  const safeMinute = padTwo(Number(minute || 0));

  if (values.frequency === "hourly") {
    const minuteValue = isValidNumber(values.minuteOfHour, 0, 59)
      ? values.minuteOfHour
      : DEFAULT_MINUTE;
    return `Every hour at :${padTwo(Number(minuteValue))} UTC`;
  }

  if (values.frequency === "daily") {
    return `Every day at ${safeHour}:${safeMinute} UTC`;
  }

  if (values.frequency === "weekly") {
    const dayLabel =
      DAYS_OF_WEEK.find((day) => day.value === values.dayOfWeek)?.label ||
      "Monday";
    return `Every week on ${dayLabel} at ${safeHour}:${safeMinute} UTC`;
  }

  if (values.frequency === "monthly") {
    const dayOfMonth = isValidNumber(values.dayOfMonth, 1, 31)
      ? values.dayOfMonth
      : DEFAULT_DAY_OF_MONTH;
    return `Every month on day ${dayOfMonth} at ${safeHour}:${safeMinute} UTC`;
  }

  return "Custom schedule (UTC)";
};

export const describeCronExpression = (expression: string): string => {
  const parsed = parseCronExpression(expression);
  if (parsed.frequency === "custom") {
    return "Custom schedule (UTC)";
  }
  return describeSchedule(parsed);
};
