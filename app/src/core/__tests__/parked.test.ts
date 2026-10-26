import { describe, expect, it } from 'vitest';
import { dueToRevisit, revisitIn, revisitLabel } from '../parked';

const now = new Date(2026, 9, 26, 10, 0); // Oct 26 2026
const g = (id: string, p: Record<string, unknown>) => ({ id, title: id, status: 'parked' as const, revisit_on: null, revisit_when: null, ...p });

describe('parked projects', () => {
  it('brings back only parked projects whose revisit date has come, oldest first', () => {
    const due = dueToRevisit([
      g('later', { revisit_on: '2026-11-09' }),
      g('today', { revisit_on: '2026-10-26' }),
      g('overdue', { revisit_on: '2026-10-01' }),
      g('no-date', { revisit_when: 'after launch' }),
      g('active', { status: 'active', revisit_on: '2026-10-01' }),
    ], now);
    expect(due.map((x) => x.id)).toEqual(['overdue', 'today']);
  });
  it('labels the revisit date and condition', () => {
    expect(revisitLabel({ revisit_on: '2026-11-09', revisit_when: 'after the review system launches' }, now)).toBe('Revisit Nov 9 · after the review system launches');
    expect(revisitLabel({ revisit_on: null, revisit_when: 'when the budget is set' }, now)).toBe('Revisit when the budget is set');
    expect(revisitLabel({ revisit_on: '2026-10-20', revisit_when: null }, now)).toBe('Ready to revisit');
    expect(revisitLabel({ revisit_on: null, revisit_when: null }, now)).toBe('No revisit date');
  });
  it('counts days ahead in local time', () => {
    expect(revisitIn(14, now)).toBe('2026-11-09');
  });
});
