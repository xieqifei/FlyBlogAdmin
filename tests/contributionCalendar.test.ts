import assert from 'node:assert/strict';
import test from 'node:test';
import { contributionCalendar, contributionMonthStarts } from '../src/contributionData.ts';

test('builds a calendar-year grid and counts creation dates in the selected year', () => {
  const calendar = contributionCalendar([
    '2026-09-01 10:00:00', '2026-09-01T20:00:00+08:00', '2026-08-31',
    '2025-09-02', '2025-09-01', 'invalid',
  ], new Date(2026, 8, 1, 12));

  assert.ok(calendar.days.length === 371 || calendar.days.length === 378);
  assert.equal(calendar.total, 3);
  assert.deepEqual(calendar.days.find((day) => day.date === '2026-09-01'), { date: '2026-09-01', count: 2, level: 4, inRange: true });
  assert.equal(calendar.days.find((day) => day.date === '2026-08-31')?.level, 2);
  assert.equal(calendar.days.find((day) => day.date === '2025-12-31')?.inRange, false);
  assert.deepEqual(calendar.days.find((day) => day.date === '2026-12-31'), { date: '2026-12-31', count: 0, level: 0, inRange: true });
});

test('can switch to a previous year', () => {
  const calendar = contributionCalendar(['2025-09-02', '2026-09-01'], new Date(2026, 8, 1, 12), 2025);
  assert.equal(calendar.year, 2025);
  assert.equal(calendar.total, 1);
  assert.equal(calendar.days.find((day) => day.date === '2025-09-02')?.count, 1);
});

test('labels every month once, including future months in the current year', () => {
  const calendar = contributionCalendar([], new Date(2026, 8, 1, 12), 2026);
  const weeks = Array.from({ length: calendar.weeks }, (_, index) => calendar.days.slice(index * 7, index * 7 + 7));
  assert.deepEqual(contributionMonthStarts(weeks).filter(Boolean), [
    '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06',
    '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12',
  ]);
});
