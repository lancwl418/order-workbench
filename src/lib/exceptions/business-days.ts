import { differenceInBusinessDays as dateFnsDiffBusinessDays } from "date-fns";

/**
 * Calculate business days between two dates (excluding Sat/Sun).
 * Wraps date-fns differenceInBusinessDays for future extensibility (e.g., holidays).
 */
export function differenceInBusinessDays(
  dateLeft: Date,
  dateRight: Date
): number {
  return dateFnsDiffBusinessDays(dateLeft, dateRight);
}
