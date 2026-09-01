export type ContributionLevel = 0 | 1 | 2 | 3 | 4;
export type ContributionDay = { date: string; count: number; level: ContributionLevel; inRange: boolean };

const WEEKS = 53;

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function addDays(value: Date, amount: number) {
  const result = new Date(value);
  result.setDate(result.getDate() + amount);
  return result;
}

function dateKey(value: Date) {
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

function validDateKey(value?: string) {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return '';
  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return dateKey(parsed) === match[0] ? match[0] : '';
}

export function contributionCalendar(dates: Array<string | undefined>, current = new Date()) {
  const today = startOfDay(current);
  const rangeStart = addDays(today, -364);
  const calendarStart = addDays(today, -today.getDay() - (WEEKS - 1) * 7);
  const counts = new Map<string, number>();

  for (const value of dates) {
    const key = validDateKey(value);
    if (!key) continue;
    const parsed = new Date(`${key}T00:00:00`);
    if (parsed < rangeStart || parsed > today) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const maximum = Math.max(0, ...counts.values());
  const days: ContributionDay[] = Array.from({ length: WEEKS * 7 }, (_, index) => {
    const date = addDays(calendarStart, index); const key = dateKey(date);
    const inRange = date >= rangeStart && date <= today; const count = inRange ? counts.get(key) || 0 : 0;
    const level = count && maximum ? Math.ceil((count / maximum) * 4) as ContributionLevel : 0;
    return { date: key, count, level, inRange };
  });

  return { days, total: [...counts.values()].reduce((sum, count) => sum + count, 0), weeks: WEEKS };
}
