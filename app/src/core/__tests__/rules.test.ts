import { describe, expect, it } from 'vitest';
import { fallbackInterpret } from '../fallback-capture';
import { estimateMinutes, guessLifeArea, looksLikeProject, matchProject, parseDue, stripDue, suggestWhy, triageEmail } from '../rules';

const NOW = new Date(2026, 9, 24, 10); // Saturday, Oct 24 2026
const due = (t: string) => parseDue(t, NOW);
const areas = [
  { id: 'home', name: 'Home', archived_at: null },
  { id: 'work', name: 'Work', archived_at: null },
  { id: 'fin', name: 'Finances', archived_at: null },
  { id: 'health', name: 'Health', archived_at: null },
];

describe('parseDue', () => {
  it('reads relative and weekday dates', () => {
    expect(due('call mom tomorrow')?.date).toBe('2026-10-25');
    expect(due('pay rent by Friday')?.date).toBe('2026-10-30');
    expect(due('dentist next Friday')?.date).toBe('2026-11-06');
    expect(due('finish report in 2 weeks')?.date).toBe('2026-11-07');
    expect(due('wrap up by end of month')?.date).toBe('2026-10-31');
    expect(due('book flights next week')?.date).toBe('2026-10-26');
  });
  it('reads month names and numbers, rolling past dates into next year', () => {
    expect(due('Renew insurance by Nov 1')).toMatchObject({ date: '2026-11-01', type: 'hard' });
    expect(due('party on 3rd December')?.date).toBe('2026-12-03');
    expect(due('taxes due 4/15')).toMatchObject({ date: '2027-04-15', type: 'hard' });
    expect(due('trip Jan 5')?.date).toBe('2027-01-05');
  });
  it('uses target dates unless there is an outside consequence, and ignores text without dates', () => {
    expect(due('clean garage this weekend')).toMatchObject({ date: '2026-10-31', type: 'target' });
    expect(due('paint the garage')).toBeNull();
    expect(due('read 20 pages')).toBeNull();
  });
  it('strips the date phrase from titles', () => {
    expect(stripDue('Pay rent by Friday', due('Pay rent by Friday'))).toBe('Pay rent');
  });
});

describe('estimates and projects', () => {
  it('estimates minutes from the verb or explicit time', () => {
    expect(estimateMinutes('Call the dentist')).toBe(10);
    expect(estimateMinutes('Reply to Maya')).toBe(5);
    expect(estimateMinutes('Go for a run')).toBe(30);
    expect(estimateMinutes('Practice piano 45 min')).toBe(45);
    expect(estimateMinutes('Think about life')).toBeNull();
  });
  it('matches tasks to existing projects by a distinctive shared word', () => {
    const goals = [{ id: 'g1', title: 'Paint the garage' }, { id: 'g2', title: 'Launch website' }];
    expect(matchProject('Buy shelves for the garage', goals)?.id).toBe('g1');
    expect(matchProject('Write website copy', goals)?.id).toBe('g2');
    expect(matchProject('Call mom', goals)).toBeNull();
  });
});

describe('fallbackInterpret with rules', () => {
  it('adds dates, minutes, projects and areas without AI', () => {
    const goals = [{ id: 'g-garage', title: 'Organize the garage' }];
    const r = fallbackInterpret('Pay the electric bill by Friday, call the dentist tomorrow, and buy bins for the garage', areas, goals, NOW);
    expect(r.items.map((i) => [i.title, i.deadline, i.estimated_minutes, i.suggested_goal_id, i.suggested_life_area_id])).toEqual([
      ['Pay the electric bill', '2026-10-30', 10, null, 'fin'],
      ['Call the dentist', '2026-10-25', 10, null, 'health'],
      ['Buy bins for the garage', null, 15, 'g-garage', null],
    ]);
  });
});

describe('triageEmail', () => {
  const mail = (from_name: string, from_address: string, subject: string, snippet: string) => ({ from_name, from_address, subject, snippet });
  it('spots requests from people and suggests a reply task', () => {
    const t = triageEmail(mail('Maya Chen', 'maya@gmail.com', 'Saturday?', 'Are you still free for brunch on Saturday at 11? Let me know.'), NOW);
    expect(t.category).toBe('action_needed');
    expect(t.importance).toBe(3);
    expect(t.suggested_actions[0]).toMatchObject({ title: 'Reply to Maya Chen about Saturday?', deadline: '2026-10-31' });
  });
  it('turns bills into pay tasks with the due date', () => {
    const t = triageEmail(mail('Acme Insurance', 'billing@acme.com', 'Your policy renews November 1', 'Payment of $412 is due Nov 1 to avoid a lapse in coverage.'), NOW);
    expect(t.category).toBe('action_needed');
    expect(t.suggested_actions[0]).toMatchObject({ title: 'Pay: Your policy renews November 1', deadline: '2026-11-01' });
  });
  it('sorts receipts, shipping, newsletters and promotions', () => {
    expect(triageEmail(mail('City Utilities', 'noreply@city.gov', 'Payment received', 'Thank you for your payment of $86.20.')).category).toBe('receipt');
    expect(triageEmail(mail('Shop', 'orders@shop.com', 'Your order has shipped', 'Your package is on its way.')).category).toBe('waiting_on');
    expect(triageEmail(mail('The Weekly Bloom', 'newsletter@bloom.com', 'This week in gardening', 'Five bulbs to plant now. Unsubscribe anytime.')).category).toBe('newsletter');
    expect(triageEmail(mail('Bloom & Co', 'deals@bloom.com', '30% off planters', 'Shop now — limited time.')).category).toBe('promotion');
    expect(triageEmail(mail('Priya', 'priya@work.com', 'Offsite agenda', 'Here is the draft agenda for next week.')).category).toBe('personal');
  });
  it('summarizes with the first sentence of the preview', () => {
    expect(triageEmail(mail('Priya', 'priya@work.com', 'Agenda', 'Here is the draft agenda for next week. More details inside the doc.')).summary)
      .toBe('Here is the draft agenda for next week.');
  });
});

describe('custom area keywords', () => {
  it('files by your own keywords first, and by custom area names', () => {
    const custom = [
      { id: 'home', name: 'Home', archived_at: null },
      { id: 'work', name: 'Work', archived_at: null, keywords: ['crm', 'Malinda'] },
      { id: 'church', name: 'Church', archived_at: null },
    ];
    expect(guessLifeArea('Update my CRM', custom)).toBe('work');
    expect(guessLifeArea('Create a project management app for MaLInda', custom)).toBe('work');
    expect(guessLifeArea('Bring snacks to church', custom)).toBe('church');
    expect(guessLifeArea('Clean the garage', custom)).toBe('home');
  });
});

describe('why it matters + project detection', () => {
  it('suggests a reason for anything that is not quick, and none for quick tasks', () => {
    expect(suggestWhy('Pay the electric bill by Friday', { minutes: 30 })).toBe('Keeps your finances on track and avoids late fees or penalties.');
    expect(suggestWhy('Create a project management app for Malinda')).toBe('Turns an idea into something real.');
    expect(suggestWhy('Sort old photos', { areaName: 'Home', minutes: 60 })).toBe('A calmer, easier home to live in.');
    expect(suggestWhy('Renew passport', { isProject: true, due: { date: '2026-11-01', type: 'hard' } })).toBe('It has a real deadline. Gets an obligation off your mind for good.');
    expect(suggestWhy('Reply to Maya')).toBeNull(); // quick
  });
  it('spots tasks that are really projects', () => {
    expect(looksLikeProject('Create a project management app for Malinda')).toBe(true);
    expect(looksLikeProject('Paint my garage')).toBe(true);
    expect(looksLikeProject('Call the dentist')).toBe(false);
    expect(looksLikeProject('Plan')).toBe(false);
  });
});
