import { describe, expect, it } from 'vitest';
import { composeNotes, readyToHandOff, titleProblem } from '../clarity';

describe('titleProblem', () => {
  it('accepts titles that stand on their own', () => {
    expect(titleProblem('Send Malinda the draft review-request email for approval')).toBeNull();
    expect(titleProblem('Build the client review form')).toBeNull();
    expect(titleProblem('Choose the 3 review questions')).toBeNull();
  });
  it('rejects vague or dangling titles, with an example of a clear one', () => {
    for (const t of ['Follow up', 'Fix it', 'Send this', 'Review', 'Call landlord', 'Update the thing', 'Look into stuff']) {
      expect(titleProblem(t), t).toMatch(/too vague/);
    }
  });
});

describe('composeNotes', () => {
  it('lays out who it is from, context, how, done-when, links and questions', () => {
    expect(composeNotes(
      { context: 'Clients will see this page after leaving a review.', how: 'Build the page with the gift and a Google review button.', done_when: 'It shows after a test submission.', links: 'Figma: https://example.com', ask: 'Malinda' },
      { by: 'Malinda', project: 'Build the review system' },
    )).toBe([
      'From Malinda · “Build the review system”',
      'Context: Clients will see this page after leaving a review.',
      'What to do: Build the page with the gift and a Google review button.',
      'Done when: It shows after a test submission.',
      'Links: Figma: https://example.com',
      'Questions: Malinda',
    ].join('\n'));
  });
});

describe('readyToHandOff', () => {
  it('needs real notes that say what done looks like', () => {
    expect(readyToHandOff('Build it')).toBe(false);
    expect(readyToHandOff('Build the thank-you page with the gift and Google button. Done when it shows after a test review.')).toBe(true);
  });
});
