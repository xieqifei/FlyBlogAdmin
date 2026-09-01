import assert from 'node:assert/strict';
import { test } from 'node:test';
import { automaticArticleDates, currentDateTime, normalizeDateTime } from '../shared/dateTime.ts';

test('fills missing article times with midnight', () => {
  assert.equal(normalizeDateTime('2026-09-01'), '2026-09-01 00:00:00');
});

test('normalizes minute and ISO date-times to second precision', () => {
  assert.equal(normalizeDateTime('2026-09-01 08:09'), '2026-09-01 08:09:00');
  assert.equal(normalizeDateTime('2026-09-01T08:09:10+08:00'), '2026-09-01 08:09:10');
});

test('formats a new article time with seconds', () => {
  assert.equal(currentDateTime(new Date(2026, 8, 1, 2, 3, 4)), '2026-09-01 02:03:04');
});

test('sets publication time once and refreshes edit time on every save', () => {
  const first = automaticArticleDates('', '2026-09-01 08:00:01', false);
  assert.deepEqual(first, { date: '2026-09-01 08:00:01', updated: '2026-09-01 08:00:01' });
  assert.deepEqual(automaticArticleDates(first.date, '2026-09-02 09:10:11', true), { date: first.date, updated: '2026-09-02 09:10:11' });
});
