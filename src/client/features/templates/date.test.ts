import { describe, expect, it } from 'vitest';

import {
  isValidIanaTimeZone,
  isValidLocalDate,
  localDateForTimeZone,
} from '../../../shared/templates';

describe('template date helpers', () => {
  it('accepts real calendar dates and rejects invalid leap days', () => {
    expect(isValidLocalDate('2024-02-29')).toBe(true);
    expect(isValidLocalDate('2025-02-29')).toBe(false);
    expect(isValidLocalDate('2026-04-31')).toBe(false);
    expect(isValidLocalDate('2026-13-01')).toBe(false);
  });

  it('keeps local dates stable across daylight-saving transitions', () => {
    expect(localDateForTimeZone(new Date('2026-03-29T00:30:00.000Z'), 'Europe/Berlin')).toBe(
      '2026-03-29',
    );
    expect(localDateForTimeZone(new Date('2026-03-29T22:30:00.000Z'), 'Europe/Berlin')).toBe(
      '2026-03-30',
    );
    expect(localDateForTimeZone(new Date('2026-10-25T22:30:00.000Z'), 'Europe/Berlin')).toBe(
      '2026-10-25',
    );
    expect(localDateForTimeZone(new Date('2026-10-25T23:30:00.000Z'), 'Europe/Berlin')).toBe(
      '2026-10-26',
    );
  });

  it('only accepts IANA time zones', () => {
    expect(isValidIanaTimeZone('America/Los_Angeles')).toBe(true);
    expect(isValidIanaTimeZone('Not/A-Time-Zone')).toBe(false);
  });
});
