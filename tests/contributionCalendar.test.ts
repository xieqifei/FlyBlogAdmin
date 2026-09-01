import assert from 'node:assert/strict';
import test from 'node:test';
import { contributionCalendar } from '../src/contributionData.ts';

test('builds a 53-week calendar and counts creation dates in the last 365 days', () => {
  const calendar = contributionCalendar([
    '2026-09-01 10:00:00', '2026-09-01T20:00:00+08:00', '2026-08-31',
    '2025-09-02', '2025-09-01', 'invalid',
  ], new Date(2026, 8, 1, 12));

  assert.equal(calendar.days.length, 371);
  assert.equal(calendar.total, 4);
  assert.deepEqual(calendar.days.find((day) => day.date === '2026-09-01'), { date: '2026-09-01', count: 2, level: 4, inRange: true });
  assert.equal(calendar.days.find((day) => day.date === '2026-08-31')?.level, 2);
  assert.equal(calendar.days.find((day) => day.date === '2025-09-01')?.inRange, false);
});
