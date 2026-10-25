import { describe, expect, it } from 'vitest';
import { doFirst, emailLink, isAutomated, notificationGroups, oneLine, rulesBriefing, senderLabel, subjectKey, type BriefMessage } from '../emailBrief';

const now = new Date('2026-10-26T15:00:00');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
let n = 0;
const msg = (p: Partial<BriefMessage>): BriefMessage => ({
  id: `m${++n}`, account_id: 'acc', provider_message_id: `p${n}`, from_name: null, from_address: null, subject: null, snippet: null,
  received_at: hoursAgo(2), is_unread: true, category: 'other', importance: 1, ...p,
});

const ci = (i: number) => msg({
  from_name: 'ann3mari37', from_address: 'notifications@github.com', category: 'fyi', importance: 2,
  subject: `[ann3mari37/todos.jamry.us] Run failed: Test & deploy - main (${i}a7f3c2e)`,
  snippet: `[ann3mari37/todos.jamry.us] Test & deploy workflow run Repository: ann3mari37/todos.jamry.us Workflow: Test & deploy Duration: ${30 + i}.0 seconds today`,
});

const inbox = () => [
  msg({ from_name: 'Dana Whitfield', from_address: 'dana@firm.com', subject: 'Re: Document review', snippet: 'Hi! Can you send the signed cover page before Thursday? I need it to submit.', category: 'action_needed', importance: 3 }),
  msg({ from_name: 'Acme Insurance', from_address: 'no-reply@acme.com', subject: 'Your policy renews November 1', snippet: 'Renewal notice: confirm coverage and pay $412 by Nov 1 to avoid a lapse.', category: 'action_needed', importance: 3 }),
  msg({ from_name: 'Maya Chen', from_address: 'maya@gmail.com', subject: 'Saturday?', snippet: 'Are you still free for brunch on Saturday at 11?', category: 'personal', importance: 2 }),
  msg({ from_name: 'Sam Ortiz', from_address: 'sam@studio.com', subject: 'Photos from the shoot', snippet: 'Here are the photos from last week. No reply needed.', category: 'personal', importance: 1 }),
  ci(1), ci(2), ci(3), ci(4), ci(5),
  msg({ from_name: 'The Weekly Bloom', from_address: 'news@bloom.com', subject: 'Five bulbs to plant', snippet: 'Please read our tips', category: 'newsletter', importance: 1 }),
];

describe('email briefing rules', () => {
  it('tells people from machines', () => {
    expect(isAutomated({ from_address: 'notifications@github.com', category: 'fyi' })).toBe(true);
    expect(isAutomated({ from_address: 'hello@notify.railway.app', category: 'fyi' })).toBe(true);
    expect(isAutomated({ from_address: 'team@mail.anthropic.com', category: 'personal' })).toBe(true);
    expect(isAutomated({ from_address: 'joe.smith@outlook.com', category: 'personal' })).toBe(false);
    expect(senderLabel({ from_name: 'ann3mari37', from_address: 'notifications@github.com', category: 'fyi' })).toBe('GitHub');
    expect(senderLabel({ from_name: 'Dana Whitfield', from_address: 'dana@firm.com', category: 'personal' })).toBe('Dana');
    expect(subjectKey('[ann3mari37/todos.jamry.us] Run failed: Test & deploy - main (4a7f3c2e)')).toBe('Run failed: Test & deploy - main');
  });

  it('puts people with requests and real bills first, and never alerts, notifications or "no reply needed"', () => {
    const list = inbox();
    const first = doFirst(list, [], now).map((f) => senderLabel(list.find((m) => m.id === f.message_id)!));
    expect(first).toEqual(['Dana', 'Maya', 'Acme Insurance']);
  });

  it('groups notifications by service with their usual topic', () => {
    const [gh] = notificationGroups(inbox());
    expect(gh).toMatchObject({ sender: 'GitHub', count: 5 });
    expect(gh.topic).toMatch(/^Run failed: Test & deploy/);
  });

  it('uses the subject, not the raw preview, for machine mail', () => {
    expect(oneLine(ci(9))).toMatch(/^GitHub: Run failed: Test & deploy/);
    expect(oneLine(inbox()[0])).toBe('Dana: Can you send the signed cover page before Thursday?');
  });

  it('writes a short, readable summary paragraph', () => {
    const b = rulesBriefing(inbox(), [], now);
    expect(b.summary).toBe(
      '3 emails need you. Start with Dana: Can you send the signed cover page before Thursday? Then Maya and Acme Insurance. '
      + 'One other email from Sam, nothing urgent. Notifications: 5 from GitHub (mostly “Run failed: Test & deploy - main”) and 1 from The Weekly Bloom.',
    );
    expect(b.summary).not.toMatch(/Repository:|Duration:/);
  });

  it('links each email to its own mail app', () => {
    const m = inbox()[0];
    expect(emailLink(m, { id: 'acc', provider: 'gmail', email_address: 'me@gmail.com' })).toEqual({ url: `https://mail.google.com/mail/u/?authuser=me%40gmail.com#all/${m.provider_message_id}`, label: 'Open in Gmail' });
    expect(emailLink({ ...m, web_link: 'https://outlook.office365.com/owa/?ItemID=x' }, { id: 'acc', provider: 'outlook', email_address: 'me@work.com' })?.label).toBe('Open in Outlook');
    expect(emailLink({ ...m, message_id_header: '<abc@mail.gmail.com>' }, { id: 'acc', provider: 'imap', email_address: 'me@gmail.com' })?.url).toContain('#search/rfc822msgid%3Aabc%40mail.gmail.com');
    expect(emailLink(m, { id: 'acc', provider: 'imap', email_address: 'me@ohrrenova.com', webmail_url: 'https://www.spacemail.com/mail/' })).toEqual({ url: 'https://www.spacemail.com/mail/', label: 'Open in Spacemail' });
    expect(emailLink({ ...m, message_id_header: '<abc@x.com>' }, { id: 'acc', provider: 'imap', email_address: 'me@mydomain.com' }, true)?.url).toBe('message://%3Cabc%40x.com%3E');
    expect(emailLink(m, { id: 'acc', provider: 'imap', email_address: 'me@icloud.com' })?.label).toBe('Open in iCloud Mail');
  });
});
