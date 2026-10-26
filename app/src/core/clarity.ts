// Work an AI chat adds is often done by someone who wasn't in the chat (a teammate, or the person on another day).
// These checks keep it usable asynchronously: titles that stand on their own, and notes that carry the context,
// the how, and what "done" looks like.

const VAGUE_WHOLE = /^(follow[ -]?up|check( in| on)?|look into|work on|handle|deal with|finish|do|fix|update|review|misc|stuff|things|todo|task|next steps?)( it| this| that| them| stuff| things)?\.?$/i;
const DANGLING = /\b(it|this|that|them|these|those|stuff|things?|items?|etc)\.?$/i;

/** Null when a title can be understood without the chat; otherwise what to fix. */
export function titleProblem(title: string): string | null {
  const t = title.trim();
  const words = t.split(/\s+/).filter(Boolean);
  if (VAGUE_WHOLE.test(t) || words.length < 3 || t.length < 12 || DANGLING.test(t)) {
    return `"${t}" is too vague for someone who wasn't in this chat. Start with a verb and name the specific thing (and who it's for or from), e.g. "Send Malinda the draft review-request email for approval".`;
  }
  return null;
}

export interface StepBrief {
  /** Why this exists / the background a newcomer needs. */
  context?: string;
  /** What exactly to do. */
  how: string;
  /** What finished looks like. */
  done_when: string;
  links?: string;
  /** Who to ask with questions. */
  ask?: string;
  /** Anything else. */
  notes?: string;
}

/** The step's notes, laid out the same way every time so anyone can pick it up. */
export function composeNotes(b: StepBrief, from?: { by?: string | null; project?: string | null }): string {
  const lines = [
    from?.by || from?.project ? `From ${[from.by, from.project ? `“${from.project}”` : null].filter(Boolean).join(' · ')}` : null,
    b.context ? `Context: ${b.context.trim()}` : null,
    `What to do: ${b.how.trim()}`,
    `Done when: ${b.done_when.trim()}`,
    b.links ? `Links: ${b.links.trim()}` : null,
    b.ask ? `Questions: ${b.ask.trim()}` : null,
    b.notes ? b.notes.trim() : null,
  ];
  return lines.filter(Boolean).join('\n');
}

/** Free-text notes are enough to hand off only if they say what done looks like. */
export function readyToHandOff(notes: string | null | undefined): boolean {
  return !!notes && notes.trim().length >= 40 && /done when|done =|finished when|definition of done/i.test(notes);
}
