// Rule-based starter steps for projects, so a new project is never an empty page — no AI needed.
// Matched by the project's wording; the first match wins, so specific templates come before general ones.
// Steps are suggestions: the user keeps, edits or removes them. AI (when available) can refine them later.

export interface TemplateStep { title: string; minutes: number }
export interface ProjectTemplate { key: string; label: string; match: RegExp; steps: TemplateStep[] }

const s = (title: string, minutes: number): TemplateStep => ({ title, minutes });

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    key: 'taxes', label: 'tax return', match: /\btax(es)?\b|\btax return\b/i,
    steps: [
      s('Gather income forms (W-2s, 1099s, statements)', 30),
      s('Collect receipts and records for deductions', 45),
      s('Choose how to file (software, preparer, or by hand)', 15),
      s('Fill in the return', 90),
      s('Review the return for errors and missing items', 30),
      s('File and save a copy with the confirmation', 15),
    ],
  },
  {
    key: 'app', label: 'app',
    match: /\b(app|apps|software|saas|plugin|extension|chatbot|bot)\b/i,
    steps: [
      s('Write down who it is for and the one problem it solves', 20),
      s('List the must-have features for a first version', 20),
      s('Sketch the main screens', 30),
      s('Choose the tools and set up the project', 45),
      s('Build the first core feature', 90),
      s('Test it with one real user', 30),
      s('Fix the top issues from testing', 60),
      s('Launch the first version', 30),
    ],
  },
  {
    key: 'writing', label: 'writing',
    // "book" only as a noun ("my book", "a book"), so "Book a dentist appointment" isn't mistaken for writing.
    match: /\b(write|writing|draft)\b.*\b(book|blog|article|post|essay|newsletter|report|proposal|speech|grant|thesis|chapter)\b|\b(my|a|the) book\b|\b(novel|newsletter|proposal|thesis)\b/i,
    steps: [
      s('Decide the topic and who will read it', 15),
      s('Write an outline', 30),
      s('Gather notes and research', 45),
      s('Write the first draft', 120),
      s('Revise the draft', 60),
      s('Get feedback from one person', 30),
      s('Make the final edits and publish or send', 45),
    ],
  },
  {
    key: 'website', label: 'website',
    match: /\b(website|web site|site|landing page|portfolio|blog|online store)\b/i,
    steps: [
      s("Decide the site's purpose and who it's for", 15),
      s('List the pages you need', 15),
      s('Gather the text and photos', 45),
      s('Pick a platform or template', 30),
      s('Build the home page', 60),
      s('Fill in the remaining pages', 90),
      s('Check it on a phone and fix what looks off', 20),
      s('Connect the domain and publish', 30),
    ],
  },
  {
    key: 'paperwork', label: 'paperwork',
    match: /\b(submit\w*|appl(y|ication)|renew\w*|passport|licen[cs]e|visa|permit|register\w*|registration|form|paperwork|document\w*|claim|insurance)\b/i,
    steps: [
      s('Find the official requirements and the deadline', 15),
      s('Make a checklist of the documents needed', 15),
      s('Gather the documents', 30),
      s('Fill out the form', 30),
      s('Review everything once more before sending', 15),
      s('Submit it', 15),
      s('Save the confirmation and note when to follow up', 5),
    ],
  },
  {
    key: 'paint', label: 'painting', match: /\bpaint\w*\b/i,
    steps: [
      s('Choose colors and get a few samples', 30),
      s('Measure the walls and buy paint and supplies', 45),
      s('Clear and cover the space', 30),
      s('Clean, patch holes and tape edges', 45),
      s('Prime where needed', 60),
      s('Paint the first coat', 90),
      s('Paint the second coat and touch up', 90),
      s('Clean up and put things back', 30),
    ],
  },
  {
    key: 'declutter', label: 'organizing',
    match: /\b(organi[sz]\w*|declutter\w*|clean out|clear out|tidy up|sort out)\b/i,
    steps: [
      s('Set a timer and clear one section to start', 30),
      s('Sort everything into keep, donate and toss', 45),
      s('Bag up and remove the trash', 15),
      s('Drop off the donations', 30),
      s('Measure the space and get bins or shelves', 30),
      s('Put things back so each item has a home', 60),
      s('Label shelves and bins', 20),
    ],
  },
  {
    key: 'deep_clean', label: 'cleaning', match: /\b(deep clean|spring clean|clean (the |my )?(whole )?(house|home|apartment|place))\b/i,
    steps: [
      s('Pick up and put away clutter in every room', 30),
      s('Dust high to low (shelves, fans, surfaces)', 30),
      s('Clean the kitchen: counters, appliances, sink', 45),
      s('Clean the bathrooms', 45),
      s('Wash bedding and towels', 15),
      s('Vacuum and mop the floors', 45),
      s('Take out the trash and recycling', 10),
    ],
  },
  {
    key: 'move', label: 'move', match: /\b(mov(e|ing) (house|home|out|in|to|apartments?)|relocat\w*|new apartment|new house)\b/i,
    steps: [
      s('Set the moving date', 10),
      s('Get mover quotes or reserve a truck', 45),
      s('Declutter before packing', 90),
      s('Get boxes, tape and supplies', 30),
      s('Pack room by room, labeling each box', 120),
      s('Change your address and forward mail', 20),
      s('Set up utilities and internet at the new place', 30),
      s('Clean the old place', 90),
    ],
  },
  {
    key: 'trip', label: 'trip', match: /\b(trip|vacation|holiday|travel\w*|getaway|honeymoon|road trip)\b/i,
    steps: [
      s("Pick the dates and who's going", 15),
      s('Set a budget', 15),
      s('Book flights or transport', 45),
      s('Book a place to stay', 30),
      s('Check passports, IDs and travel documents', 15),
      s('Plan a few activities', 30),
      s('Arrange pet care, mail and house sitting', 20),
      s('Pack', 60),
    ],
  },
  {
    key: 'event', label: 'event', match: /\b(party|event|wedding|shower|celebration|birthday|reunion|gathering|fundraiser|anniversary)\b/i,
    steps: [
      s('Pick the date and set a budget', 15),
      s('Make the guest list', 20),
      s('Choose the place', 30),
      s('Send the invitations', 20),
      s('Plan the food and drinks', 30),
      s('Get decorations and supplies', 45),
      s('Write a simple plan for the day', 20),
      s('Send a reminder a few days before', 10),
    ],
  },
  {
    key: 'learn', label: 'learning', match: /\b(learn\w*|study|course|certification|certificate|exam|class|language|guitar|piano|instrument|degree)\b/i,
    steps: [
      s("Decide what you want to be able to do, and by when", 10),
      s('Find a course, book or teacher', 30),
      s('Block practice time on your calendar', 10),
      s('Do the first lesson', 30),
      s('Practice three times this week', 90),
      s('Check your progress after two weeks', 15),
    ],
  },
  {
    key: 'fitness', label: 'fitness', match: /\b(get fit|lose weight|weight loss|marathon|5k|10k|half marathon|workout|exercise|gym|train(ing)? for|get in shape)\b/i,
    steps: [
      s('Set a specific goal and a date', 10),
      s('Choose a plan you can stick to', 20),
      s("Schedule this week's workouts", 10),
      s('Do the first workout', 45),
      s('Track your progress each week', 10),
      s('Adjust the plan after two weeks', 15),
    ],
  },
  {
    key: 'job', label: 'job search', match: /\b(job|career|resume|cv|interview\w*|new role|promotion)\b/i,
    steps: [
      s('Decide which roles you want', 20),
      s('Update your resume', 60),
      s('Update your LinkedIn profile', 30),
      s('List ten companies you would like to work for', 30),
      s('Apply to the first three', 60),
      s('Reach out to two people in your network', 20),
      s('Prepare answers for common interview questions', 60),
    ],
  },
  {
    key: 'budget', label: 'money', match: /\b(budget\w*|savings|save money|debt|pay off|finances|retirement|invest\w*|emergency fund)\b/i,
    steps: [
      s('List your income and regular bills', 30),
      s("Review last month's spending", 30),
      s('Set targets for saving and spending', 20),
      s('Set up automatic savings or payments', 20),
      s("Cancel subscriptions you don't use", 20),
      s('Check in on it again in a month', 15),
    ],
  },
  {
    key: 'repair', label: 'home project',
    match: /\b(renovat\w*|remodel\w*|repair\w*|fix\w*|install\w*|replace\w*|build (a |the )?(deck|fence|shed|patio)|bathroom|kitchen)\b/i,
    steps: [
      s('Decide exactly what needs doing', 20),
      s('Measure and take photos', 20),
      s('Get two or three quotes or make a materials list', 60),
      s('Set a budget and a schedule', 15),
      s('Buy materials or book the contractor', 45),
      s('Do the work', 180),
      s('Check the result and clean up', 30),
    ],
  },
  {
    key: 'garden', label: 'garden', match: /\b(garden\w*|yard|lawn|landscap\w*|plant\w*|flower beds?|vegetable)\b/i,
    steps: [
      s('Decide what you want the space to look like', 20),
      s("Check sunlight and soil, and what grows well now", 20),
      s('Clear weeds and debris', 60),
      s('Buy plants, soil and supplies', 45),
      s('Plant', 90),
      s('Set up a watering routine', 15),
    ],
  },
  {
    key: 'health', label: 'health', match: /\b(doctor|dentist|checkup|check-up|physical|therapy|therapist|surgery|specialist|medical|eye exam)\b/i,
    steps: [
      s('Find a provider and check your coverage', 20),
      s('Book the appointment', 10),
      s('Write down your questions and symptoms', 15),
      s('Go to the appointment', 60),
      s('Follow up on results or prescriptions', 15),
    ],
  },
  {
    key: 'purchase', label: 'purchase',
    match: /\b(buy\w*|purchase|shop for|get a new)\b.*\b(car|truck|house|home|laptop|computer|couch|sofa|mattress|appliance|phone|tv|bike|furniture)\b/i,
    steps: [
      s('Set a budget', 10),
      s('List your must-haves', 15),
      s('Research three options', 45),
      s('Compare reviews and prices', 30),
      s('Decide and buy', 30),
    ],
  },
  {
    key: 'business', label: 'business', match: /\b(business|company|startup|side hustle|shop|store|brand|launch\w*|product|service|freelanc\w*)\b/i,
    steps: [
      s('Write the idea down in one paragraph', 20),
      s('Talk to three potential customers', 60),
      s('Define what you offer and the price', 30),
      s('Set up the name, domain and accounts', 45),
      s('Build the simplest version of the offer', 120),
      s('Find your first customer', 60),
    ],
  },
  {
    key: 'setup', label: 'setup',
    match: /\b(set ?up|migrat\w*|implement\w*|switch to|update)\b.*\b(crm|system|software|database|email|accounts?|tool|process|calendar|backup)\b|\bcrm\b/i,
    steps: [
      s('Decide what you need it to do', 20),
      s('Choose or review the tool', 30),
      s('Set up the account and the basics', 45),
      s('Import or enter your data', 60),
      s('Test it with a real example', 20),
      s('Make it part of your routine', 15),
    ],
  },
];

const GENERIC: ProjectTemplate = {
  key: 'generic', label: 'project', match: /.*/,
  steps: [
    s('Decide what "done" looks like', 10),
    s('List the steps you can think of', 15),
    s('Do the first small step', 15),
    s('Schedule time for the next step', 5),
  ],
};

export function templateFor(projectTitle: string): ProjectTemplate {
  return PROJECT_TEMPLATES.find((t) => t.match.test(projectTitle)) ?? GENERIC;
}

const normalize = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

/**
 * Starter steps for a project, skipping any it already has (by title).
 * `limit` keeps a new project focused; "Suggest more steps" can add the rest later.
 */
export function suggestSteps(projectTitle: string, existingTitles: string[] = [], limit = 5): { template: ProjectTemplate; steps: TemplateStep[] } {
  const template = templateFor(projectTitle);
  const have = new Set(existingTitles.map(normalize));
  return { template, steps: template.steps.filter((st) => !have.has(normalize(st.title))).slice(0, limit) };
}
