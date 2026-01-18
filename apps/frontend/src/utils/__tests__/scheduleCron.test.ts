import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_DAY_OF_MONTH,
  DEFAULT_DAY_OF_WEEK,
  DEFAULT_MINUTE,
  DEFAULT_TIME,
  buildCronExpression,
  describeCronExpression,
  parseCronExpression,
} from "../scheduleCron";

describe("scheduleCron utilities", () => {
  it("parses hourly cron expressions", () => {
    expect(parseCronExpression("5 * * * *")).toEqual({
      frequency: "hourly",
      timeOfDay: DEFAULT_TIME,
      minuteOfHour: "5",
      dayOfMonth: DEFAULT_DAY_OF_MONTH,
      dayOfWeek: DEFAULT_DAY_OF_WEEK,
      customCron: "",
    });
  });

  it("parses daily cron expressions", () => {
    expect(parseCronExpression("15 8 * * *")).toEqual({
      frequency: "daily",
      timeOfDay: "08:15",
      minuteOfHour: "15",
      dayOfMonth: DEFAULT_DAY_OF_MONTH,
      dayOfWeek: DEFAULT_DAY_OF_WEEK,
      customCron: "",
    });
  });

  it("parses weekly cron expressions", () => {
    expect(parseCronExpression("0 6 * * 1")).toEqual({
      frequency: "weekly",
      timeOfDay: "06:00",
      minuteOfHour: "0",
      dayOfMonth: DEFAULT_DAY_OF_MONTH,
      dayOfWeek: "1",
      customCron: "",
    });
  });

  it("parses monthly cron expressions", () => {
    expect(parseCronExpression("30 9 15 * *")).toEqual({
      frequency: "monthly",
      timeOfDay: "09:30",
      minuteOfHour: "30",
      dayOfMonth: "15",
      dayOfWeek: DEFAULT_DAY_OF_WEEK,
      customCron: "",
    });
  });

  it("falls back to custom for unsupported cron expressions", () => {
    expect(parseCronExpression("*/5 * * * *")).toEqual({
      frequency: "custom",
      timeOfDay: DEFAULT_TIME,
      minuteOfHour: DEFAULT_MINUTE,
      dayOfMonth: DEFAULT_DAY_OF_MONTH,
      dayOfWeek: DEFAULT_DAY_OF_WEEK,
      customCron: "*/5 * * * *",
    });
  });

  it("builds hourly cron expressions and warns on invalid minutes", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      buildCronExpression({
        frequency: "hourly",
        timeOfDay: "09:00",
        minuteOfHour: "70",
        dayOfMonth: DEFAULT_DAY_OF_MONTH,
        dayOfWeek: DEFAULT_DAY_OF_WEEK,
        customCron: "",
      })
    ).toBe(`${DEFAULT_MINUTE} * * * *`);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it("describes common cron expressions in plain language", () => {
    expect(describeCronExpression("0 9 * * *")).toBe(
      "Every day at 09:00 UTC"
    );
  });

  it("labels custom cron expressions as custom", () => {
    expect(describeCronExpression("*/5 * * * *")).toBe(
      "Custom schedule (UTC)"
    );
  });
});
