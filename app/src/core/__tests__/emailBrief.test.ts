import { describe, expect, it } from 'vitest';
import { doFirst, emailLink, oneLine, rulesBriefing, type BriefMessage } from '../emailBrief';

const now = new Date('2026-10-26T15:00:00');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
let n = 0;
const msg = (p: Partial<BriefMessage>): BriefMessage => ({
  id: `m${++n}`, account_id: 'acc', provider_message_id: `p${n}`, from_name: null, from_address: null, subject: null, snippet: null,
  received_at: hoursAgo(2), is_unread: true, category: 'other', importance: 1, ...p,
});

const inbox = () => [
  msg({ from_name: 'Dana Whitfield', from_address: 'dana@firm.com', subject: 'Re: Document review', snippet: 'Hi! Can you send the signed cover page before Thursday? I need it to submit.', category: 'action_needed', importance: 3 }),
  msg({ from_name: 'Acme Insurance', from_address: 'no-reply@acme.com', subject: 'Your policy renews November 1', snippet: 'Renewal notice: confirm coverage and pay $412 by Nov 1 to avoid a lapse.', category: 'action_needed', importance: 3 }),
  msg({ from_name: 'Maya Chen', from_address: 'maya@gmail.com', subject: 'Saturday?', snippet: 'Are you still free for brunch on Saturday at 11?', category: 'action_needed', importance: 2 }),
  msg({ from_name: 'Hosting Co.', from_address: 'support@host.com', subject: 'Domain connecting', snippet: 'DNS is propagating.', category: 'waiting_on', importance: 2 }),
  msg({ from_name: 'The Weekly Bloom', from_address: 'news@bloom.com', subject: 'Five bulbs to plant', snippet: 'Please read our tips', category: 'newsletter', importance: 1 }),
  msg({ from_name: 'City Utilities', from_address: 'billing@city.gov', subject: 'Payment received', snippet: 'Receipt for $86.20', category: 'receipt', importance: 1 }),
];

describe('email briefing rules', () => {
  it('ranks people with requests and near dates first, and never newsletters or receipts', () => {
    const list = inbox();
    const first = doFirst(list, [], now).map((f) => list.find((m) => m.id === f.message_id)!.from_name);
    expect(first[0]).toBe('Dana Whitfield');
    expect(first).toContain('Maya Chen');
    expect(first).not.toContain('The Weekly Bloom');
    expect(first).not.toContain('City Utilities');
  });

  it('leaves out FYIs that say no reply is needed', () => {
    const fyi = msg({ from_name: 'Priya N', from_address: 'priya@work.com', subject: 'Offsite agenda', snippet: 'Draft agenda attached. No reply needed unless you want changes?', category: 'fyi', importance: 2 });
    expect(doFirst([fyi], [], now)).toEqual([]);
  });

  it('writes one line per email without the greeting', () => {
    expect(oneLine(inbox()[0])).toBe('Dana: Can you send the signed cover page before Thursday?');
  });

  it('writes a cohesive summary paragraph', () => {
    const b = rulesBriefing(inbox(), [], now);
    expect(b.summary).toMatch(/^3 emails need you\. Start with Dana: Can you send the signed cover page before Thursday\?/);
    expect(b.summary).toMatch(/Acme Insurance: Renewal notice/);
    expect(b.summary).not.toMatch(/[?!.]\.|\.\./);
    expect(b.summary).toMatch(/You’re waiting to hear back from Hosting Co\./);
    expect(b.summary).toMatch(/The rest \(1 receipt and 1 newsletter\) can wait\.$/);
    expect(b.counts.total).toBe(6);
  });

  it('links each email to its own mail app', () => {
    const m = inbox()[0];
    expect(emailLink(m, { id: 'acc', provider: 'gmail', email_address: 'me@gmail.com' })).toEqual({ url: `https://mail.google.com/mail/u/?authuser=me%40gmail.com#all/${m.provider_message_id}`, label: 'Open in Gmail' });
    expect(emailLink({ ...m, web_link: 'https://outlook.office365.com/owa/?ItemID=x' }, { id: 'acc', provider: 'outlook', email_address: 'me@work.com' })?.label).toBe('Open in Outlook');
    expect(emailLink({ ...m, message_id_header: '<abc@mail.gmail.com>' }, { id: 'acc', provider: 'imap', email_address: 'me@gmail.com' })?.url).toContain('#search/rfc822msgid%3Aabc%40mail.gmail.com');
    expect(emailLink({ ...m, message_id_header: '<abc@x.com>' }, { id: 'acc', provider: 'imap', email_address: 'me@mydomain.com' })?.url).toBe('message://%3Cabc%40x.com%3E');
    expect(emailLink(m, { id: 'acc', provider: 'imap', email_address: 'me@icloud.com' })?.label).toBe('Open iCloud Mail');
  });
});
