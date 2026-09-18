# DDigitize identity and authorization model

Every rule below is enforced in the database. The interface mirrors the rules by
asking the database for them (`project_permissions`); it never decides them.

## Separate concepts

| Concept | Where it lives |
| --- | --- |
| Authentication | Supabase Auth (email or username sign-in) |
| System role | `user_roles.role` (`admin`, `manager`, `contributor`) + `app_owners` |
| Project membership | `project_members` (`manager`, `supervisor`, `contributor`) |
| Project ownership | `projects.owner_id` |
| Digitising scope | `area_assignments` → `work_areas` |
| Resource permissions | `has_project_permission(user, project, permission)` |
| Administrative privileges | `is_platform_admin`, `is_org_manager` |

A system role never grants project data by itself except for the two
organisation-wide roles below; project access comes from membership or ownership.

## Roles

- **Platform administrator** (`app_owners`, or `user_roles.role = 'admin'`):
  global administration. Provisioned explicitly — see bootstrap below.
- **Manager** (`user_roles.role = 'manager'`): organisation-wide oversight:
  view, export, review, approve, request changes, reopen, assign, manage.
  No create/edit/delete of geometry, no digitising scope.
- **Project owner** (`projects.owner_id`): full control of that project only.
- **Supervisor** (project member): view, create, edit, submit, review, approve,
  request changes, reopen, assign. No manage, delete or export.
- **Contributor** (project member): view, create, edit, submit, delete own
  drafts — and only inside assigned work areas.

Digitising does not imply reviewing: `create` and `review` are distinct
permissions and no role gains `review` from an area assignment.

## Permissions

`view, create, edit, delete, submit, review, approve, request_changes, reopen,
export, manage, assign` — resolved by `public.has_project_permission`, which the
policy helpers (`can_manage_project`, `can_review_project`, `can_digitize_in`)
now call so there is one rule set, not two.

## Protected columns

Enforced by `BEFORE` triggers, so a crafted API call cannot bypass them:

- `features.created_by` — forced to the caller on insert, immutable afterwards.
- `features.project_id` — immutable (blocks moving a feature between projects).
- `features.status` — approve needs `approve`, under review needs `review`,
  correction-required needs `request_changes`, reopening approved work needs
  `reopen`; the author may only move between draft and submitted.
- `features.reviewed_by` / `reviewed_at` — server-set when a reviewer changes
  the status; client values are discarded.
- `projects.owner_id` — only a platform administrator or the current owner may
  transfer; `created_by` is immutable.
- `project_members.role` — grants must be strictly below the caller's authority,
  never the caller's own row, never the platform owner.
- `work_areas` name/boundary/notes — reviewers and above only.
- `user_roles` — no client writes at all; changed only through the
  `setSystemRole` server function (administrators; administration itself only by
  the platform owner).

## Bootstrap

Registering first grants nothing. Sign in, open `/bootstrap`, and present the
server-held `PLATFORM_BOOTSTRAP_TOKEN`. It works only while no platform owner
exists; afterwards roles are granted by an existing administrator on the
Accounts page.
