# DroneTrace: projects, roles and per-area assignments

Rework the app around **projects**. Each project has its own feature layers, its own imagery, its own team, and its own work areas. People see only what their role in that project allows.

## Roles

Four levels, three of them per project:

| Role | Scope | Can do |
| --- | --- | --- |
| Admin | Whole app | Everything, plus the only role that can download data (Shapefile, GeoJSON, KML, CSV). Creates projects and appoints managers. |
| Manager | One project | Sets up the project: creates feature layers and their attribute fields, registers imagery, draws work areas, invites supervisors and contributors, assigns areas. Reviews and verifies work. Sees full team progress. |
| Supervisor | One project | Reviews submitted work (verify / needs revision), can digitize, sees full team progress. Cannot change layers or team. |
| Contributor | One project, assigned areas only | Digitizes inside the areas assigned to them, fills the manager's attribute fields, submits for review. Sees only their own progress. |

Assumptions, tell me if wrong: managers cannot download (only admins); the first account created stays the app admin; a person can hold different roles in different projects.

## Project workflow

```text
Admin creates project ─▶ appoints a Manager
        │
Manager: define feature layers + attributes  ─▶ register drone imagery
        │                                        ─▶ draw work areas (grid / boundary / upload)
        │                                        ─▶ add supervisors + contributors, assign areas
        ▼
Contributor opens project ─▶ map zooms to their area ─▶ digitizes ─▶ autosaves as Draft ─▶ Submits
        ▼
Supervisor / Manager reviews ─▶ Verified  or  Needs revision (with a note back to the contributor)
        ▼
Admin exports the verified data (SHP / GeoJSON / KML / CSV)
```

A project has a simple status: Setup → Active → Review → Closed. While in Setup the manager sees a checklist (layers, imagery, areas, team) so nothing is forgotten before contributors start.

## What each person sees

- **Landing page**: the list of projects that person belongs to, with their role, progress bar and a "Open workspace" button. Admins additionally see every project and a "New project" button.
- **Workspace** (`/p/{project}`): the map, only that project's layers and imagery. Contributors get their assigned areas outlined and highlighted; areas belonging to other people are dimmed and locked. Drawing outside an assigned area is refused with a clear message.
- **Setup** (`/p/{project}/setup`, managers): layers and attribute fields, imagery, work areas, team and assignments — tabs in one place.
- **Progress** (`/p/{project}/progress`): managers/supervisors see totals, per-contributor table, per-area completion, review queue and activity. Contributors see the same page reduced to their own numbers and their own areas, plus anything sent back for revision.
- **Review queue** (managers/supervisors): submitted features one by one, zoom to each, verify or send back with a note.
- **Export** (admins only): choose project, layers, statuses and format.

## Technical notes

New tables (all with row-level security and grants):

- `projects` — name, description, status, created_by.
- `project_members` — project, user, role (`manager` | `supervisor` | `contributor`), unique per project+user.
- `work_areas` — project, name, boundary geometry (WGS84 GeoJSON polygon), status, notes.
- `area_assignments` — work area, user, assigned_by, assigned_at, status.
- `feature_categories`, `category_fields`, `imagery_datasets`, `features`, `activity_log` gain `project_id`; `features` also gains `work_area_id`.

Existing seeded categories and imagery move into a "Sample project" so nothing is lost.

Access is enforced in the database, not just the UI, via security-definer helpers: `is_app_admin(uid)`, `project_role(uid, project_id)`, `has_project_role(uid, project_id, role)`, `is_assigned_to_area(uid, area_id)`. Policies: read a project only as member or admin; write layers/areas/team only as manager or admin; insert a feature only when the geometry's centre falls inside a work area assigned to you (or you are manager/supervisor/admin); set status `verified` / `needs_revision` only as supervisor, manager or admin; select on `features` for export limited to admins plus project members.

Geometry stays strictly WGS84 `[longitude, latitude]` with the existing coordinate validation; the containment check reuses the same helpers.

Shapefile export is added client-side with `shp-write` (zipped .shp/.shx/.dbf/.prj, one file per geometry type); GeoJSON, KML and CSV keep their current exporters. Export UI and server access are both restricted to admins.

## Build order

1. Migration: projects, members, work areas, assignments, project scoping, helper functions, new policies, sample-project backfill.
2. Auth/role plumbing: project context, role hook, route guards, navigation per role.
3. Project list + creation, project setup tabs (layers, imagery, areas incl. GeoJSON upload and grid generator, team + assignments).
4. Workspace scoped to project: layer list from that project's schema, assigned-area highlighting and locking, submit-for-review.
5. Progress dashboards (full vs personal), review queue.
6. Admin export page with Shapefile support.
