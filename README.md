# DDigitize

A collaborative GIS digitizing and production management platform. Digitize buildings, roads, parcels
and utilities directly on large drone orthomosaics streamed as PMTiles, with project roles, work areas,
attribute schemas, QA review and exports.

## Stack

- TanStack Start (React 19, Vite, Tailwind CSS 4, shadcn/ui)
- MapLibre GL JS + PMTiles (HTTP range requests — imagery is never fully downloaded)
- Supabase (Postgres, auth, row level security) for data and access control
- terra-draw for digitizing, turf for geometry maths

## Local development

```bash
npm install
npm run dev
```

Create a `.env` file with your Supabase project values:

```
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
VITE_SUPABASE_PROJECT_ID=<project-id>
```

The first account that signs up becomes the application administrator.

## Database

SQL migrations live in `drizzle/migrations`. Apply them to your Supabase project in order
(SQL editor or `psql`).

## Deploy to Vercel

1. Push this repository to GitHub (`https://github.com/IgharoJoseph/DDigitize.git`).
2. In Vercel, **Add New → Project** and import the repository.
3. Leave the framework preset as-is; the build command is `npm run build`.
4. Add the three `VITE_SUPABASE_*` environment variables above (Production and Preview).
5. Deploy.

The server build auto-detects Vercel and emits the Vercel Build Output API, so no adapter
configuration is required. To pin it explicitly, set `NITRO_PRESET=vercel` as an environment variable.

After the first deploy, add the Vercel URL to your Supabase Auth **Site URL** and **Redirect URLs**
so email confirmation and Google sign-in return to the right place.
