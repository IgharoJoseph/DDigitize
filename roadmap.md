# DroneTrace / GIS production platform — roadmap

## Done

- Cloud backend, email + Google sign-in, first account becomes admin
- Schema: profiles, roles, projects (client ref, CRS, start/due dates, boundary,
  statuses Draft/Setup/Active/Review/On hold/Completed/Archived), project_members,
  work_areas, area_assignments, feature layers + attribute fields with validation
  rules, features, feature_comments, activity/audit log, imagery — all with RLS
  per role and per work area
- Left sidebar shell (Dashboard, Projects, Exports, Audit log, and per-project
  Map / Tasks / QA / Reports / Layers / Team / Settings) + top bar
- Org-wide production dashboard: totals, per-project work-area progress, QA counts
- Tasks page: one task per work area, assign/reassign, status, submit for QA
- Audit log page (admins)
- Map workspace: PMTiles imagery, basemaps, drawing tools with snapping,
  attribute form from the layer schema, autosave, undo/redo, coordinate bar
- Live validation on drawing: coordinates, assigned work area, self-intersection,
  duplicate/overlap per layer rules, required attributes; errors block saving
- Feature statuses Draft / Submitted / Under review / Approved / Correction
  required; approved features locked; submit-for-review button
- QA comments thread per feature with resolve
- Review queue: approve or send back with a note
- Admin-only export: Shapefile (zip), GeoJSON, KML, CSV

## Next

1. Project setup wizard (9 guided steps) with save-as-draft
2. Project workspace Overview tab + project fields form (client, CRS, dates, boundary)
3. Conditional attribute visibility (show field only when another field has a value)
4. Digitising: split, merge, move feature, measure distance/area, snap tolerance setting
5. Clip-to-work-area option when a shape crosses the boundary
6. Feature locking while another user edits (realtime presence)
7. Version history with restore
8. Production coverage map on the dashboard (area status colours)
9. Project-wide search (feature id, attribute, contributor, area, layer, status)
10. Exports: GeoPackage, per-layer and per-area options, approved-only
11. Notifications in the top bar

## Blocked

- No account exists yet, so signed-in flows (digitising, QA, assignments) are
  untested end to end. Sign up in the app to create the first admin account.
