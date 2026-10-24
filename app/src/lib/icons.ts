import type { IconName } from '../components/ui';
import type { Goal } from '../core/types';

/** Picks a friendly outline icon for a goal from its title. */
export function goalIcon(g: Goal, areaIcon?: string): IconName {
  const t = g.title.toLowerCase();
  if (/document|submit|form|paper|file/.test(t)) return 'file-text';
  if (/garage|house|home|kitchen|room|clean/.test(t)) return 'home';
  if (/insur|renew|policy|protect/.test(t)) return 'shield';
  if (/website|site|app|launch|code/.test(t)) return 'monitor';
  if (/trip|travel|flight|vacation/.test(t)) return 'send';
  if (/health|run|workout|doctor/.test(t)) return 'activity';
  if (/money|budget|tax|finance|bill/.test(t)) return 'dollar-sign';
  return (areaIcon === 'briefcase' ? 'briefcase' : 'target') as IconName;
}
