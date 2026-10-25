import { describe, expect, it } from 'vitest';
import { fallbackInterpret } from '../fallback-capture';
import { PROJECT_TEMPLATES, suggestSteps, templateFor } from '../templates';

describe('project step templates', () => {
  it.each([
    ['Create a project management app for Malinda', 'app'],
    ['Createa new app', 'app'],
    ['Create an insurance app', 'app'],
    ['Launch website', 'website'],
    ['Submit the document', 'paperwork'],
    ['Renew insurance', 'paperwork'],
    ['Submit job application', 'paperwork'],
    ['Do my taxes', 'taxes'],
    ['Paint my garage', 'paint'],
    ['Organize the garage', 'declutter'],
    ['Declutter the kitchen', 'declutter'],
    ['Deep clean the house', 'deep_clean'],
    ['Moving to a new apartment', 'move'],
    ['Plan trip', 'trip'],
    ["Plan Mom's birthday party", 'event'],
    ['Learn Spanish', 'learn'],
    ['Train for a 5k', 'fitness'],
    ['Find a new job', 'job'],
    ['Write a blog post series', 'writing'],
    ['Pay off credit card debt', 'budget'],
    ['Renovate the bathroom', 'repair'],
    ['Plant a vegetable garden', 'garden'],
    ['Get a dental checkup', 'health'],
    ['Book a dentist appointment', 'health'],
    ['Finish my book', 'writing'],
    ['Buy a new laptop', 'purchase'],
    ['Start a side hustle', 'business'],
    ['Set up a CRM', 'setup'],
    ['Figure out next steps', 'generic'],
  ])('"%s" → %s', (title, key) => {
    expect(templateFor(title).key).toBe(key);
  });

  it('every template has at least 5 concrete steps with time estimates', () => {
    for (const t of PROJECT_TEMPLATES) {
      expect(t.steps.length).toBeGreaterThanOrEqual(5);
      for (const st of t.steps) {
        expect(st.title.length).toBeGreaterThan(3);
        expect(st.minutes).toBeGreaterThan(0);
      }
    }
  });

  it('skips steps the project already has and limits how many are added at once', () => {
    const { steps } = suggestSteps('Paint my garage', ['Choose colors and get a few samples'], 3);
    expect(steps.map((x) => x.title)).toEqual(['Measure the walls and buy paint and supplies', 'Clear and cover the space', 'Clean, patch holes and tape edges']);
  });

  it('captured projects come with their first steps', () => {
    const r = fallbackInterpret('I need to paint my garage and also start a new app');
    expect(r.items.map((i) => [i.kind, i.next_actions.length])).toEqual([['goal', 3], ['goal', 3]]);
    expect(r.items[1].next_actions[0]).toEqual({ title: 'Write down who it is for and the one problem it solves', estimated_minutes: 20 });
  });
});
