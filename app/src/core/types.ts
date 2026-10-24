// Domain types shared by the app and the Cloudflare Worker.

export type GoalStatus = 'active' | 'waiting' | 'blocked' | 'paused' | 'completed' | 'archived';
export type ActionStatus =
  | 'suggested'
  | 'ready'
  | 'in_progress'
  | 'waiting'
  | 'blocked'
  | 'completed'
  | 'dismissed';
export type DeadlineType = 'none' | 'target' | 'hard';
export type RecommendationKind = 'meaningful_move' | 'time_sensitive' | 'easy_momentum' | 'quietly_waiting';
export type AccountabilityMode = 'default' | 'keep_visible' | 'help_me' | 'i_avoid_this' | 'do_not_remind';
export type DailyMode = 'meaningful' | 'small_tasks' | 'off_my_mind' | 'show_all';

export interface LifeArea {
  id: string;
  name: string;
  color: string;
  icon: string;
  sort_order: number;
  archived_at: string | null;
}

export interface Goal {
  id: string;
  life_area_id: string | null;
  title: string;
  description: string | null;
  meaning: string | null;
  meaning_source: 'none' | 'user' | 'ai_suggested';
  deadline: string | null; // YYYY-MM-DD
  deadline_type: DeadlineType;
  status: GoalStatus;
  completion_criteria: string | null;
  icon: string;
  accountability: AccountabilityMode;
  snoozed_until: string | null;
  last_meaningful_progress_at: string | null;
  completed_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Action {
  id: string;
  goal_id: string | null;
  life_area_id: string | null;
  title: string;
  notes: string | null;
  completion_criteria: string | null;
  estimated_minutes: number | null;
  status: ActionStatus;
  origin: 'user' | 'ai';
  requires_clarification: boolean;
  user_edited: boolean;
  sort_order: number;
  times_recommended: number;
  times_skipped: number;
  completed_at: string | null;
  created_at: string;
}

export interface Accomplishment {
  id: string;
  title: string;
  notes: string | null;
  goal_id: string | null;
  action_id: string | null;
  life_area_id: string | null;
  planned: boolean;
  meaningful: boolean;
  occurred_at: string;
  created_at: string;
}

export interface Dependency {
  action_id: string;
  depends_on_id: string;
}

export interface FeedbackEntry {
  action_id: string | null;
  goal_id: string | null;
  response: 'accepted' | 'dismissed' | 'deferred' | 'not_suitable' | 'show_other';
  created_at: string;
}

export interface Recommendation {
  kind: RecommendationKind;
  goal: Goal | null;
  action: Action | null;
  reason: string;
  score: number;
}
