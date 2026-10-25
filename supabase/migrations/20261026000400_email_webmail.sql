-- Where to open an inbox on the web (set from the IMAP server when the inbox is connected), so every email has an
-- "Open in …" link even when the provider has no link to a single message.

alter table email_accounts add column if not exists webmail_url text check (char_length(webmail_url) <= 300);

-- Existing IMAP inboxes: fill it in from their server.
update email_accounts a set webmail_url = case
    when c.imap_host ~* '(^|\.)spacemail\.com$' then 'https://www.spacemail.com/mail/'
    when c.imap_host ~* '^imap\.gmail\.com$' then 'https://mail.google.com/mail/'
    when c.imap_host ~* '^imap\.mail\.me\.com$' then 'https://www.icloud.com/mail'
    when c.imap_host ~* 'yahoo\.com$' then 'https://mail.yahoo.com'
    when c.imap_host ~* 'aol\.com$' then 'https://mail.aol.com'
    when c.imap_host ~* 'fastmail\.com$' then 'https://app.fastmail.com'
    when c.imap_host ~* '(office365|outlook)\.com$' then 'https://outlook.office.com/mail'
    when c.imap_host ~* 'zoho\.(com|eu|in)$' then 'https://mail.zoho.com'
    when c.imap_host ~* 'hostinger\.com$' then 'https://mail.hostinger.com'
    when c.imap_host ~* 'secureserver\.net$' then 'https://email.secureserver.net'
    when c.imap_host ~* 'privateemail\.com$' then 'https://privateemail.com'
    when c.imap_host ~* 'ionos\.(com|de|co\.uk)$' then 'https://mail.ionos.com'
  end
from email_credentials c
where c.account_id = a.id and a.provider = 'imap' and a.webmail_url is null;
