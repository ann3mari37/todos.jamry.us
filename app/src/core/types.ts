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
export type RecommendationKind = 'meaningful_move' | 'time_sensitive' | 'easy_momentum' | 'quietly_waiting' | 'next_up';
export type AccountabilityMode = 'default' | 'keep_visible' | 'help_me' | 'i_avoid_this' | 'do_not_remind';
export type DailyMode = 'meaningful' | 'small_tasks' | 'off_my_mind' | 'show_all';

export interface LifeArea {
  id: string;
  name: string;
  color: string;
  icon: string;
  sort_order: number;
  archived_at: string | null;
  /** Extra words that file tasks into this area automatically. */
  keywords?: string[];
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
  /** Who created it (the owner). */
  user_id?: string;
  /** Set when the project belongs to a team: every member sees it. */
  team_id?: string | null;
}

export interface Action {
  id: string;
  goal_id: string | null;
  life_area_id: string | null;
  title: string;
  notes: string | null;
  completion_criteria: string | null;
  estimated_minutes: number | null;
  /** A task's own due date (YYYY-MM-DD); projects carry theirs on the goal. */
  due_date?: string | null;
  deadline_type?: DeadlineType;
  status: ActionStatus;
  origin: 'user' | 'ai';
  requires_clarification: boolean;
  user_edited: boolean;
  sort_order: number;
  times_recommended: number;
  times_skipped: number;
  completed_at: string | null;
  created_at: string;
  /** Hidden from Today until this date (YYYY-MM-DD). */
  snoozed_until?: string | null;
  /** Last looked at in a tidy-up; restarts the "sitting a while" clock. */
  reviewed_at?: string | null;
  /** Who created it. */
  user_id?: string;
  /** Team projects: the person doing it, or (until someone takes it) the role it needs. */
  assignee_id?: string | null;
  assigned_role_id?: string | null;
  /** Who checked it off (shared on team projects). */
  completed_by?: string | null;
}

export interface Team { id: string; name: string; created_by: string; created_at: string }
export interface TeamMember { team_id: string; user_id: string; display_name: string; is_admin: boolean; joined_at: string }
export interface TeamRole { id: string; team_id: string; name: string; description: string | null }
export interface TeamMemberRole { team_id: string; user_id: string; role_id: string }
export interface TeamInvite { id: string; team_id: string; code: string; name: string | null; role_id: string | null; accepted_at: string | null; expires_at: string; created_at: string }

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
