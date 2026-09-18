# DDigitize — technical audit (pre-phase inspection)

Date: 2026-09-18. Inspection only — no code, schema, policy or data changes were made.

---

## 1. Existing architecture

- **Framework**: TanStack Start v1 (React 19, Vite 8, TypeScript strict-ish with
  `noPropertyAccessFromIndexSignature`), Tailwind 4 via `src/styles.css`, shadcn/ui components.
- **Routing**: flat file routes in `src/routes` (no `_authenticated` layout). Routes:
  `index` (projects list), `dashboard`, `audit`, `export`, `users` (accounts), `settings`,
  `auth`, `reset-password`, and the project subtree `p.$projectId.{tsx,index,setup,tasks,progress,review}`.
  `__root.tsx` holds `AuthProvider`, `TopBar`, `AppSidebar`, `Toaster`, error/404 boundaries.
- **State**: TanStack Query for all server data (keys in `src/lib/data.ts` `qk`,
  `src/lib/projects.ts` `pk`); React `useState`/refs for map and tool state; no Redux/Zustand.
- **Server**: `src/start.ts` registers `attachSupabaseAuth` function middleware, an error
  middleware rendering `src/lib/error-page.ts`, and a CSRF middleware scoped to server fns.
  Only one server-fn module exists: `src/lib/users.functions.ts`
  (`createUserAccount`, `resetUserPassword`, `signInWithUsername`, `changeMyPassword`).
  No Supabase Edge Functions — correct for this stack.
- **Map**: `src/components/map/MapWorkspace.tsx` (~1180 lines, lazily loaded inside
  `ClientOnly`), MapLibre GL 6 + `pmtiles` protocol registered once in `src/lib/pmtiles.ts`
  (also pins the MapLibre worker URL), drawing via `terra-draw` + maplibre adapter,
  measurement via `@turf/*`, panels in `src/components/map/*`.
- **Deployment**: Vercel (`vercel.json`, nitro preset `vercel`), repo `IgharoJoseph/DDigitize`.

## 2. Existing features (working today)

Auth (email or username + password, password reset, first account becomes owner/admin),
admin account creation, per-user settings/password change, projects list, org dashboard,
project setup tabs (layers + attribute fields + rules, imagery register/inspector, work areas
incl. grid generator and GeoJSON import, team + area assignments), map workspace
(basemaps, imagery opacity/visibility, PMTiles streaming, draw point/line/polygon/rectangle,
vertex edit, undo/redo, snapping, coordinate readout, autosave), attribute form generated from
the layer schema, live validation, submit-for-review, QA review queue with approve/return,
per-feature comment threads, tasks-per-work-area page, progress page, audit log page,
admin-only export (Shapefile/GeoJSON/KML/CSV), dark/light theme, contributor preview mode.

## 3. Existing database structure

Migrations in `drizzle/migrations`: `0000_dronetrace_core_schema`, `0001_projects_roles_work_areas`,
`0002_gis_production_extensions`, `0003_contributor_area_submit_policy`,
`0004_add_profile_usernames`, `0005_privilege_hierarchy`.

Tables: `profiles`, `user_roles`, `app_owners`, `projects`, `project_members`, `work_areas`,
`area_assignments`, `feature_categories` (= layers), `category_fields`, `features`,
`feature_comments`, `imagery_datasets`, `activity_log`.

Enums: `app_role(admin, contributor)`, `project_role(manager, supervisor, contributor)`,
`area_status(unassigned, assigned, in_progress, submitted, complete)`,
`project_status(setup, active, review, closed, draft, on_hold, completed, archived)`,
`review_status(draft, submitted, verified, needs_revision, under_review)`,
`geom_type(polygon, line, point)`, `field_type(text, number, boolean, select)`.

Geometry is stored as **JSONB GeoJSON**, not PostGIS geometry. No spatial indexes.

## 4. Existing authentication architecture

Supabase Auth, email/password; username sign-in resolved server-side in
`signInWithUsername` (username → email lookup with the service role, password verified
server-side, tokens returned, client calls `setSession`). `handle_new_user` trigger creates
the profile, grants `contributor`, and makes the very first account `admin` + `app_owners`.
Client session state lives in `src/hooks/useAuth.tsx` (`onAuthStateChange`, `has_role`/`is_owner`
RPCs, plus a localStorage-backed "view as contributor" preview flag).

## 5. Existing authorization architecture

Three layers, all present:

1. **App level** — `user_roles` (admin) + `app_owners` (owner), helpers
   `is_app_admin`, `is_owner`, `app_rank` (owner 100 / admin 90 / else 0).
2. **Project level** — `project_members.role`, helpers `project_role_of`, `role_rank`
   (manager 50 / supervisor 30 / contributor 10), `project_authority`,
   `can_manage_project`, `can_review_project`, `is_project_member`.
3. **Spatial level** — `area_assignments` + `is_assigned_to_area` + `can_digitize_in`;
   the `features` INSERT policy requires `can_digitize_in(auth.uid(), project_id, work_area_id)`.

RLS is enabled on every table with role-scoped policies (see `<supabase-tables>` output).
Frontend mirrors this via `useProjectAccess`.

## 6. Existing GIS architecture

- PMTiles over HTTP range requests, one shared archive per dataset (no duplication) —
  matches the spec's tiling requirement.
- Imagery metadata: url, bounds, min/max zoom, GSD, flight date, published flag;
  `inspectPmtiles` validates header + a real tile byte-range before publishing.
- Coordinates: `src/lib/geo.ts` enforces `[lng, lat]`, validates/clamps, provides
  `safeBounds` (object and `[w,s,e,n]` array forms), `safeLngLat`, `isValidGeometry`.
- Validation: `src/lib/validation.ts` — geometry validity, work-area containment,
  self-intersection (`kinks`), duplicate/overlap ratio per layer rules, required attributes,
  error/warning severities; run during drawing and before save.
- Rendering: two GeoJSON sources (features, work areas) with fill/line/circle layers;
  assigned areas highlighted, others dimmed.

## 7. Existing storage architecture

**None.** No Supabase Storage buckets exist. Imagery is referenced by external URL
(GitHub Pages / any range-capable host). Nothing in the app uploads files.

## 8. Existing workflow

Owner/admin creates a project and appoints a manager → manager defines layers + attribute
fields + rules, registers imagery, draws work areas, adds supervisors/contributors, assigns
areas → contributor digitises inside their areas, fills attributes, autosaves as `draft`,
submits → supervisor/manager reviews (`verified` or `needs_revision` with a note, comments)
→ approved features locked → admin exports.

## 9. Security weaknesses (found, not changed)

| # | Severity | Issue |
|---|---|---|
| S1 | High | `profiles` SELECT policy is `USING (true)`: every signed-in user can read all emails, names and usernames. Should be own-row + project co-members. |
| S2 | High | **Export is frontend-gated only.** `export.tsx` hides the UI for non-admins, but `features` SELECT is allowed for any project member, so a contributor could read and export project data directly through the API. Needs a server-side export path (server fn that checks app rank) and/or an audited download endpoint. |
| S3 | Medium | `project_members` UPDATE `WITH CHECK` does not exclude self-modification; a manager-level actor can craft a self-role change. Needs `user_id <> auth.uid()` (plus an owner-only exception). |
| S4 | Medium | `app_owners` readable by all authenticated users — reveals who the super user is. |
| S5 | Medium | `role_rank` has no `search_path` set (linter 0011). 12 SECURITY DEFINER helpers are EXECUTE-able by `anon`; they leak nothing meaningful but should be revoked from `anon`. |
| S6 | Medium | `activity_log` INSERT is `auth.uid() = user_id` with a free-text `action`/`detail`: the audit trail is client-written and forgeable. Spec-level audit logging should be trigger-based. |
| S7 | Low | `work_areas` UPDATE by an assigned contributor is unrestricted in columns — a contributor can change `name`/`boundary`/`notes`, not just submit status. Needs a column-level trigger guard. |
| S8 | Low | No server-side enforcement of "approved features are locked": the `features` UPDATE policy lets the creator edit while `can_digitize_in` holds, regardless of `status = 'verified'`. Currently enforced in the UI only. |

## 10. Missing functionality vs the production specification

- **Tables**: `organisations`, `feature_versions` (version history/restore), `topology_rules`
  (rules are currently 4 boolean columns on `feature_categories`), `qa_reviews` (review
  actions are only a status + note on the feature), `tasks` (derived from work areas at
  runtime), `layer_field_options` (options are a `text[]`), per-layer/per-member permissions.
- **PostGIS**: geometry is JSONB; no `geometry(…,4326)` columns, no GiST indexes, no
  server-side spatial predicates (containment/overlap are computed in the browser).
- **Field types**: spec wants text, long text, integer, decimal, date, boolean, dropdown,
  multi-select; enum has only text/number/boolean/select.
- **Setup wizard** (9 steps, save-as-draft) — currently tabs, no wizard.
- **Project workspace tabs**: Overview, Exports, Settings tabs missing; project fields
  (client ref, CRS, dates, boundary) exist in the schema but have no edit form.
- **Digitising**: split, merge, move feature, measure, configurable snap tolerance,
  clip-to-work-area on boundary crossing.
- **Conditional attribute visibility**; concurrent-edit locking ("Being edited by another
  user"); version history + restore; project-wide search; production coverage map on the
  dashboard; notifications; GeoPackage export and per-layer/per-area/approved-only options;
  per-project audit filtering.
- **Contributor-simple dashboard** (My Projects / Areas / Tasks / Pending corrections).

## 11. Architectural conflicts

1. **JSONB geometry vs the PostGIS spec.** This is the only deep conflict. Safest path:
   add a generated/added `geom geometry(Geometry,4326)` column populated from the existing
   JSONB (trigger + backfill), add GiST indexes, move containment/overlap checks into SQL
   functions, and keep the JSONB column as the source the frontend already reads. No
   destructive change, no frontend rewrite, reversible.
2. **`feature_categories` is the spec's `layers` table.** Extend it (and add a
   `topology_rules` child table) rather than introducing a parallel `layers` table.
3. **Tasks are derived, spec wants a table.** Introduce `tasks` additively, seeded from
   existing work areas, keeping the derived view working until the table is populated.
4. **No organisations layer.** Everything is single-tenant today. Add `organisations` only
   when multi-tenancy is actually needed; otherwise it adds RLS surface for no benefit.
5. **`app_role` enum has only `admin`/`contributor`** while the spec names Super Admin /
   Manager / Supervisor / Contributor. Project-level roles already cover manager/supervisor;
   recommend keeping app-level as admin/owner and not widening the enum.

## 12. Performance concerns

- `fetchFeatures` loads **every** feature of a project as JSONB with no bbox/zoom filter.
  Fine at hundreds, will not scale to production volumes — needs a spatial/bbox query
  (which PostGIS + GiST unlocks) or server-side vector tiles for features.
- `fetchProfiles` loads all profiles org-wide on several pages.
- `MapWorkspace.tsx` is ~1180 lines with many interdependent effects; a render-loop bug
  from an unstable array dependency was found and fixed today. Splitting it into hooks
  (imagery, draw, features, areas, selection) would reduce that class of bug.
- Validation (overlap/duplicate) runs in the browser against all loaded features — O(n) per
  draw, and it is also the security boundary being relied on. Both argue for SQL-side checks.
- Export builds Shapefile/CSV in the browser from the full feature set.
- No realtime subscriptions anywhere, so concurrent edits are invisible.

## 13. Recommended implementation order (phased)

**Phase 1 — Security hardening (database only, no UI change).**
Tighten `profiles` SELECT; add self-modification guard to `project_members`; restrict
`app_owners` reads; set `search_path` on `role_rank`; revoke `anon` EXECUTE on helpers;
trigger-guard `work_areas` contributor updates to status-only; block edits of `verified`
features in policy/trigger; move export behind a server function that checks app rank and
writes an audit row. Deliverable: same app, enforced server-side.

**Phase 2 — Spatial foundation (additive PostGIS).**
Enable PostGIS; add `features.geom` + `work_areas.geom` + `projects.boundary_geom`
(4326) with triggers keeping them in sync with the existing JSONB; backfill; GiST indexes;
SQL functions for containment/overlap/self-intersection; use them in the `features`
INSERT/UPDATE policies so spatial access control becomes database-enforced. Frontend untouched.

**Phase 3 — Schema completion.**
`topology_rules`, `qa_reviews`, `feature_versions` (+ trigger writing versions on change),
`tasks`, `layer_field_options`; widen `field_type` with long text/integer/decimal/date/multiselect;
trigger-based audit logging replacing client-written `activity_log` inserts.

**Phase 4 — Scale the reads.**
bbox/zoom-filtered feature fetch, paginated/filtered profile reads, project-scoped search
(feature id, attribute, contributor, area, layer, status) backed by SQL.

**Phase 5 — Workflow UI.**
Setup wizard with save-as-draft, project Overview/Settings/Exports tabs, contributor-simple
dashboard, QA page with review records, comments-on-my-features surface, notifications.

**Phase 6 — Digitising depth.**
Split, merge, move, measure, snap tolerance setting, clip-to-area, conditional attributes,
concurrent-edit locking via Supabase realtime presence, version history with restore.

**Phase 7 — Exports & reporting.**
Server-side exports (GeoJSON/Shapefile/CSV/GeoPackage) with approved-only, per-layer and
per-area options, every export audited; production coverage map on the dashboard.

**Phase 8 — Refactor for maintainability.**
Split `MapWorkspace.tsx` into focused hooks/components; remove the last frontend-only
security assumptions.

---

## Manual testing needed (cannot be verified from here)

- End-to-end signed-in flows with **more than one account** (contributor vs supervisor vs
  manager vs owner): digitising inside/outside an assigned area, submit → review → return →
  resubmit, comment resolve, area submit for QA. No second account currently exists.
- Vercel production deploy: confirm the five environment variables are present
  (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` as Config; `SUPABASE_URL`,
  `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` as Secret) and the latest commit
  is deployed.
- Real PMTiles archives at production size/zoom depth on slow connections.

## Deliberately not changed in this phase

Everything. No migration was applied, no policy altered, no component rewritten, no
dependency added or removed, no data touched. The only code edits today predate this audit
request (contributor-view flicker fix).

---

## Phase 1 status (implemented 2026-09-18)

S1 profiles exposure — fixed (own row / admin / project teammate only; team picker now
uses a server function that returns names without emails).
S2 export gating — fixed server-side (`buildProjectExport` requires app authority >= 90 and
writes an audit row; the page no longer reads the tables directly).
S3 self-escalation — fixed (`user_id <> auth.uid()` on member insert/update/delete).
S4 owner identity — fixed (self or admin only).
S5 linter hygiene — fixed (`role_rank` search_path pinned; anon EXECUTE revoked on all helpers).
S6 audit trail — fixed (BEFORE-INSERT trigger stamps the real user and forces `source='client'`;
AFTER triggers on features, memberships and assignments write `source='system'` rows).
S8 approved-feature locking — fixed in policy (non-reviewers cannot update a `verified` row and
cannot set `verified` themselves).
Read volume — features are now read in pages of 1000 (the API cap silently truncated large
projects) with supporting indexes.

S7 work-area definition — fixed (BEFORE UPDATE trigger `guard_work_area_definition` rejects any
change to name, boundary, notes, project or creator unless the caller passes `can_review_project`;
assigned contributors may still move the status and digitise inside the area).
Dashboard totals — fixed (aggregate functions `dashboard_feature_counts`, `dashboard_area_counts`,
`dashboard_contributor_count` count in the database under the same RLS; the dashboard no longer
downloads feature rows to add them up).

Still open: no remaining Phase 1 items.

## Phase: identity, roles, membership and authorization (done)

See docs/AUTHORIZATION.md. Five roles, project ownership, a single database
permission matrix, protected columns and explicit platform-admin bootstrap.
