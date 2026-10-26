-- Parked projects: ideas that need working out but aren't ready to unpack into steps yet. They stay out of Today,
-- suggestions and workload warnings, keep their notes (and any rough steps), and come back when it's time: on a
-- revisit date, or when "revisit when…" fits what the person is planning (the AI chat watches for that).
alter type goal_status add value if not exists 'parked';

alter table goals
  add column revisit_on date,
  add column revisit_when text check (char_length(revisit_when) <= 300);
