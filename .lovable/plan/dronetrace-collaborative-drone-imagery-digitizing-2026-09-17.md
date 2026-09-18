# DroneTrace — collaborative drone imagery digitizing

A GIS workstation in the browser: admins publish drone imagery and feature templates, contributors trace buildings, roads and parcels on top, and everyone sees progress live.

## What gets built

### 1. Map workspace (the main screen)
- Full-bleed map canvas with collapsible left and right panels, so the imagery always dominates.
- Drone imagery streamed from PMTiles files, sharp down to very high zoom.
- Basemap switcher: Satellite, OpenStreetMap, Topo, Minimal — plus an opacity slider for the drone layer.
- Bottom status bar: live cursor position in decimal degrees, degrees/minutes/seconds and UTM, current zoom, and a metric scale bar.
- Dark and light theme toggle.

### 2. Drawing and attributes (contributors)
- Tools for polygons, lines, points and rectangles, with vertex editing, vertex deletion and snapping to nearby vertices.
- When a shape is finished or selected, an attribute panel opens with exactly the fields the admin defined for that category — nothing more, nothing less.
- Autosave with visible status ("Saving…", "Saved automatically"), plus undo/redo.
- Layer list with per-category visibility toggles and search/filter by category or contributor.

### 3. Feature template builder (admins)
- Create categories (Residential, Commercial, Primary Road, Parcel, Waterway, Powerline, …) each with its own geometry type, colour and field list.
- Field types: text, number, yes/no, and dropdown with custom options; each field can be marked required.
- Upload a starting GeoJSON of empty features or grid boundaries for contributors to work against.

### 4. Imagery management (admins)
- Register a PMTiles dataset by URL (R2, S3, Supabase Storage) with metadata: ground resolution, flight date, bounds, centre, min/max zoom.
- Built-in inspector that opens the file's header and byte ranges and reports whether it is servable, before publishing it to contributors.
- Sample imagery presets included so the app is testable immediately.
- Conversion guide panel with copy-ready GDAL + pmtiles commands and an explanation of why multi-gigabyte GeoTIFFs must be converted locally rather than in the browser.

### 5. Progress dashboard
- Live counts: total features, breakdown per category, total area mapped in m² and hectares, total road length in km.
- Contributor leaderboard and a recent-activity log.
- Review states: Draft, Submitted, Verified, Needs Revision — admins can move features between them.
- One-click export to GeoJSON, KML and CSV.

## Accounts and data

Lovable Cloud will be enabled to store projects, imagery datasets, templates, features and activity. Sign-in is email + password; the first account can be promoted to admin. Contributors can only edit their own features; admins can review everything. All geometry is stored as WGS84 GeoJSON.

## Technical notes

- MapLibre GL JS + `pmtiles` protocol registration; drawing via a MapLibre-compatible draw layer with custom snapping.
- Routes: `/` workspace map, `/dashboard`, `/admin/templates`, `/admin/imagery`, `/auth`.
- Tables: `profiles`, `user_roles` (separate table, security-definer `has_role`), `projects`, `imagery_datasets`, `feature_categories`, `category_fields`, `features` (geometry as jsonb GeoJSON + attributes jsonb + review status), `activity_log`. RLS on all of them.
- Rendering in Web Mercator, storage strictly EPSG:4326; UTM zone and DMS computed client-side.
- Autosave debounced through a server function; undo/redo held in client state.

## Build order

1. Cloud + auth + schema, design system and app shell.
2. Map workspace with PMTiles, basemaps, coordinate bar.
3. Template builder, then drawing tools + attribute drawer + autosave.
4. Imagery hub with inspector and converter guide.
5. Dashboard, review workflow, exports.
