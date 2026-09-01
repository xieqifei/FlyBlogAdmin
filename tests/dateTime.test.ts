import assert from 'node:assert/strict';
import { test } from 'node:test';
import { currentDateTime, dateTimeInputValue, normalizeDateTime } from '../shared/dateTime.ts';

test('fills missing article times with midnight', () => {
  assert.equal(normalizeDateTime('2026-09-01'), '2026-09-01 00:00:00');
  assert.equal(dateTimeInputValue('2026-09-01'), '2026-09-01T00:00:00');
});

test('normalizes minute and ISO date-times to second precision', () => {
  assert.equal(normalizeDateTime('2026-09-01 08:09'), '2026-09-01 08:09:00');
  assert.equal(normalizeDateTime('2026-09-01T08:09:10+08:00'), '2026-09-01 08:09:10');
});

test('formats a new article time with seconds', () => {
  assert.equal(currentDateTime(new Date(2026, 8, 1, 2, 3, 4)), '2026-09-01 02:03:04');
});
