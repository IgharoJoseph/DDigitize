-- Roles
CREATE TYPE public.app_role AS ENUM ('admin', 'contributor');
CREATE TYPE public.geom_type AS ENUM ('polygon', 'line', 'point');
CREATE TYPE public.field_type AS ENUM ('text', 'number', 'boolean', 'select');
CREATE TYPE public.review_status AS ENUM ('draft', 'submitted', 'verified', 'needs_revision');

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT ON public.profiles TO anon;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles readable" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "profiles update own" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "profiles insert own" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE POLICY "roles readable by self or admin" ON public.user_roles FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- New user bootstrap: profile + role (first ever user becomes admin)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  admin_count int;
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)))
  ON CONFLICT (id) DO NOTHING;

  SELECT count(*) INTO admin_count FROM public.user_roles WHERE role = 'admin';
  IF admin_count = 0 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin') ON CONFLICT DO NOTHING;
  END IF;
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'contributor') ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Imagery datasets
CREATE TABLE public.imagery_datasets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  url text NOT NULL,
  description text,
  gsd_cm numeric,
  flight_date date,
  min_zoom int NOT NULL DEFAULT 0,
  max_zoom int NOT NULL DEFAULT 22,
  center_lng numeric,
  center_lat numeric,
  bounds jsonb,
  tile_type text NOT NULL DEFAULT 'raster',
  is_published boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.imagery_datasets TO authenticated;
GRANT SELECT ON public.imagery_datasets TO anon;
GRANT ALL ON public.imagery_datasets TO service_role;
ALTER TABLE public.imagery_datasets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "imagery published readable" ON public.imagery_datasets FOR SELECT USING (is_published OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "imagery admin write" ON public.imagery_datasets FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "imagery admin update" ON public.imagery_datasets FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "imagery admin delete" ON public.imagery_datasets FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Feature schema template
CREATE TABLE public.feature_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  geometry_type public.geom_type NOT NULL,
  color text NOT NULL DEFAULT '#38bdf8',
  description text,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.feature_categories TO authenticated;
GRANT SELECT ON public.feature_categories TO anon;
GRANT ALL ON public.feature_categories TO service_role;
ALTER TABLE public.feature_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "categories readable" ON public.feature_categories FOR SELECT USING (true);
CREATE POLICY "categories admin insert" ON public.feature_categories FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "categories admin update" ON public.feature_categories FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "categories admin delete" ON public.feature_categories FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.category_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES public.feature_categories(id) ON DELETE CASCADE,
  key text NOT NULL,
  label text NOT NULL,
  field_type public.field_type NOT NULL DEFAULT 'text',
  options text[] NOT NULL DEFAULT '{}',
  required boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 0,
  UNIQUE (category_id, key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.category_fields TO authenticated;
GRANT SELECT ON public.category_fields TO anon;
GRANT ALL ON public.category_fields TO service_role;
ALTER TABLE public.category_fields ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fields readable" ON public.category_fields FOR SELECT USING (true);
CREATE POLICY "fields admin insert" ON public.category_fields FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "fields admin update" ON public.category_fields FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "fields admin delete" ON public.category_fields FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Digitized features (geometry stored as WGS84 GeoJSON)
CREATE TABLE public.features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid REFERENCES public.feature_categories(id) ON DELETE SET NULL,
  dataset_id uuid REFERENCES public.imagery_datasets(id) ON DELETE SET NULL,
  geometry jsonb NOT NULL,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  status public.review_status NOT NULL DEFAULT 'draft',
  area_sqm numeric NOT NULL DEFAULT 0,
  length_m numeric NOT NULL DEFAULT 0,
  review_note text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX features_category_idx ON public.features (category_id);
CREATE INDEX features_creator_idx ON public.features (created_by);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.features TO authenticated;
GRANT SELECT ON public.features TO anon;
GRANT ALL ON public.features TO service_role;
ALTER TABLE public.features ENABLE ROW LEVEL SECURITY;
CREATE POLICY "features readable" ON public.features FOR SELECT USING (true);
CREATE POLICY "features insert own" ON public.features FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "features update own or admin" ON public.features FOR UPDATE TO authenticated
USING (auth.uid() = created_by OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "features delete own or admin" ON public.features FOR DELETE TO authenticated
USING (auth.uid() = created_by OR public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
CREATE TRIGGER features_touch BEFORE UPDATE ON public.features FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Activity log
CREATE TABLE public.activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  feature_id uuid,
  action text NOT NULL,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activity_created_idx ON public.activity_log (created_at DESC);
GRANT SELECT, INSERT ON public.activity_log TO authenticated;
GRANT SELECT ON public.activity_log TO anon;
GRANT ALL ON public.activity_log TO service_role;
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "activity readable" ON public.activity_log FOR SELECT USING (true);
CREATE POLICY "activity insert own" ON public.activity_log FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- Seed: standard categories + fields
INSERT INTO public.feature_categories (id, name, geometry_type, color, description, sort_order) VALUES
  ('11111111-1111-4111-8111-000000000001', 'Residential Building', 'polygon', '#f97316', 'Dwellings and residential structures', 1),
  ('11111111-1111-4111-8111-000000000002', 'Commercial Building', 'polygon', '#a855f7', 'Shops, offices, markets', 2),
  ('11111111-1111-4111-8111-000000000003', 'Primary Road', 'line', '#ef4444', 'Major carriageways', 3),
  ('11111111-1111-4111-8111-000000000004', 'Secondary Road', 'line', '#eab308', 'Local and access roads', 4),
  ('11111111-1111-4111-8111-000000000005', 'Agricultural Parcel', 'polygon', '#22c55e', 'Farm plots and fields', 5),
  ('11111111-1111-4111-8111-000000000006', 'Waterway', 'line', '#0ea5e9', 'Rivers, streams, drains', 6),
  ('11111111-1111-4111-8111-000000000007', 'Powerline', 'line', '#f43f5e', 'Transmission and distribution lines', 7),
  ('11111111-1111-4111-8111-000000000008', 'Point of Interest', 'point', '#14b8a6', 'Utilities, landmarks, assets', 8);

INSERT INTO public.category_fields (category_id, key, label, field_type, options, required, sort_order) VALUES
  ('11111111-1111-4111-8111-000000000001', 'building_name', 'Building name / ref', 'text', '{}', false, 1),
  ('11111111-1111-4111-8111-000000000001', 'storeys', 'Number of storeys', 'number', '{}', true, 2),
  ('11111111-1111-4111-8111-000000000001', 'roof_material', 'Roof material', 'select', '{"Metal sheet","Concrete","Tile","Thatch","Asbestos"}', true, 3),
  ('11111111-1111-4111-8111-000000000001', 'occupied', 'Currently occupied', 'boolean', '{}', false, 4),
  ('11111111-1111-4111-8111-000000000002', 'business_name', 'Business name', 'text', '{}', true, 1),
  ('11111111-1111-4111-8111-000000000002', 'use_type', 'Use type', 'select', '{"Retail","Office","Warehouse","Hospitality","Market stall"}', true, 2),
  ('11111111-1111-4111-8111-000000000002', 'storeys', 'Number of storeys', 'number', '{}', false, 3),
  ('11111111-1111-4111-8111-000000000003', 'road_name', 'Road name', 'text', '{}', false, 1),
  ('11111111-1111-4111-8111-000000000003', 'surface', 'Surface', 'select', '{"Asphalt","Concrete","Gravel","Earth"}', true, 2),
  ('11111111-1111-4111-8111-000000000003', 'lanes', 'Lanes', 'number', '{}', false, 3),
  ('11111111-1111-4111-8111-000000000004', 'road_name', 'Road name', 'text', '{}', false, 1),
  ('11111111-1111-4111-8111-000000000004', 'surface', 'Surface', 'select', '{"Asphalt","Gravel","Earth"}', true, 2),
  ('11111111-1111-4111-8111-000000000005', 'crop_type', 'Crop type', 'select', '{"Maize","Cassava","Rice","Vegetables","Fallow"}', true, 1),
  ('11111111-1111-4111-8111-000000000005', 'irrigated', 'Irrigated', 'boolean', '{}', false, 2),
  ('11111111-1111-4111-8111-000000000006', 'water_name', 'Name', 'text', '{}', false, 1),
  ('11111111-1111-4111-8111-000000000006', 'seasonality', 'Seasonality', 'select', '{"Perennial","Seasonal","Intermittent"}', true, 2),
  ('11111111-1111-4111-8111-000000000007', 'voltage_kv', 'Voltage (kV)', 'number', '{}', false, 1),
  ('11111111-1111-4111-8111-000000000007', 'pole_material', 'Pole material', 'select', '{"Wood","Concrete","Steel lattice"}', false, 2),
  ('11111111-1111-4111-8111-000000000008', 'poi_name', 'Name', 'text', '{}', true, 1),
  ('11111111-1111-4111-8111-000000000008', 'poi_type', 'Type', 'select', '{"Borehole","School","Clinic","Transformer","Culvert","Other"}', true, 2);

-- Seed: sample public PMTiles datasets so the app is testable immediately
INSERT INTO public.imagery_datasets (name, url, description, gsd_cm, flight_date, min_zoom, max_zoom, center_lng, center_lat, bounds, tile_type, is_published) VALUES
  ('Sample: Firenze aerial ortho (raster)', 'https://r2-public.protomaps.com/protomaps-sample-datasets/firenze.pmtiles', 'Public sample raster PMTiles archive, useful for testing high-zoom streaming.', 15, '2021-06-01', 0, 16, 11.2558, 43.7696, '{"west":11.15,"south":43.72,"east":11.35,"north":43.83}', 'raster', true),
  ('Sample: USGS Stamen terrain (raster)', 'https://pmtiles.io/stamen_toner(raster)CC-BY+ODbL_z3.pmtiles', 'Small public raster archive for smoke-testing the PMTiles protocol.', 100, '2020-01-01', 0, 3, 0, 20, '{"west":-180,"south":-85,"east":180,"north":85}', 'raster', true);
