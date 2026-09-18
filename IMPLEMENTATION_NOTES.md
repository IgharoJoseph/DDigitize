# DDigitize source edits

## Dashboard role switching

The administrator dashboard now includes a Platform Administration section and a single role switcher with four preview roles:

- Manager
- Project Owner
- Supervisor
- Contributor

Selecting a role changes the application UI, navigation and dashboard scoping to preview that role. The authenticated user remains a Platform Administrator in the database. The switcher therefore cannot be used to grant or remove real privileges. `Exit role view` restores the administrator view immediately.

## Management / CRM

Added an additive CRM foundation with clients, client contacts and project-client relationships, with RLS policies and indexes. A Management page is available to administrators and the simulated management roles.

## Security / production hardening

Added an additive database migration covering:

- CRM RLS and indexes
- no anonymous access to application data
- prevention of future automatic first-user platform-admin assignment
- protection against project-member self role changes
- removal of contributor work-area update policy
- database-level approved-feature workflow guards
- additional production query indexes
- hardened SECURITY DEFINER search paths

Added baseline Vercel security headers for content sniffing, framing, referrers and browser permissions.

## Important deployment note

These source edits have been made without access to the live Supabase project, production environment variables, or deployment console. The SQL migration must be reviewed and applied through the project's normal migration process, then tested against the live database. The role switcher is intentionally a UI simulation and must not be treated as a security control.

The existing application architecture and JSON geometry were retained. No PostGIS migration or destructive schema rewrite was introduced by these edits.
