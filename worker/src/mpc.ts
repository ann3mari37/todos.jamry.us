// The MaLinda Perry cockpit's features (Google Calendar, Payhip sales) exist only on malindaperryconsulting.com
// addresses. Every other address this app runs on (todos.jamry.us) behaves exactly as before.

export const MPC_DOMAIN = 'malindaperryconsulting.com';

export function isMpcHost(host: string): boolean {
  const h = host.toLowerCase().replace(/:\d+$/, '');
  return h === MPC_DOMAIN || h.endsWith('.' + MPC_DOMAIN);
}

/** True when this request's site (APP_URL after siteFor) is a malindaperryconsulting.com address. */
export function isMpcSite(appUrl: string | undefined): boolean {
  try { return !!appUrl && isMpcHost(new URL(appUrl).host); } catch { return false; }
}
