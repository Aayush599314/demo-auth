-- =============================================================================
-- SQL Schema & RLS Policies for Firebase Third-Party Auth with Supabase
-- =============================================================================
--
-- IMPORTANT COMPATIBILITY NOTE (The "auth.uid()" vs Firebase UID Gotcha):
-- -----------------------------------------------------------------------------
-- In native Supabase Auth, `auth.uid()` casts the JWT `sub` claim to `uuid`:
--   auth.uid() = (nullif(current_setting('request.jwt.claim.sub', true), ''))::uuid
--
-- Firebase UIDs are NOT UUIDs (they are 28-character alphanumeric strings, e.g.
-- '1f5a9b8c0d2e4f6a8b0c1d2e3f'). Calling `auth.uid()` will cause PostgreSQL
-- to throw:
--   ERROR: invalid input syntax for type uuid: "1f5a9b8c0d2e4f6a8b0c1d2e3f"
--
-- For Firebase third-party authentication, your RLS policies and table columns
-- MUST use `(auth.jwt() ->> 'sub')` instead of `auth.uid()`, and the user ID
-- columns must be typed as `TEXT`, NOT `UUID`.
-- =============================================================================

-- 1. Helper function (Optional, but makes policies much cleaner):
CREATE OR REPLACE FUNCTION auth.firebase_uid()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(auth.jwt() ->> 'sub', '')::text;
$$;

-- =============================================================================
-- Table: public.profiles
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id         TEXT PRIMARY KEY,  -- Firebase UID (e.g. 28-character alphanumeric string)
  full_name  TEXT,
  email      TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they used auth.uid()
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

-- RLS Policies for profiles using auth.jwt() ->> 'sub'
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  TO authenticated
  USING ((auth.jwt() ->> 'sub') = id);

CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK ((auth.jwt() ->> 'sub') = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING ((auth.jwt() ->> 'sub') = id);


-- =============================================================================
-- Table: public.test_records
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.test_records (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL DEFAULT (auth.jwt() ->> 'sub'), -- Stores Firebase UID
  title       TEXT NOT NULL,
  description TEXT DEFAULT '',
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.test_records ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they used auth.uid()
DROP POLICY IF EXISTS "Users can view own records" ON public.test_records;
DROP POLICY IF EXISTS "Users can insert own records" ON public.test_records;
DROP POLICY IF EXISTS "Users can update own records" ON public.test_records;
DROP POLICY IF EXISTS "Users can delete own records" ON public.test_records;

-- RLS Policies for test_records using auth.jwt() ->> 'sub'
CREATE POLICY "Users can view own records"
  ON public.test_records FOR SELECT
  TO authenticated
  USING ((auth.jwt() ->> 'sub') = user_id);

CREATE POLICY "Users can insert own records"
  ON public.test_records FOR INSERT
  TO authenticated
  WITH CHECK ((auth.jwt() ->> 'sub') = user_id);

CREATE POLICY "Users can update own records"
  ON public.test_records FOR UPDATE
  TO authenticated
  USING ((auth.jwt() ->> 'sub') = user_id);

CREATE POLICY "Users can delete own records"
  ON public.test_records FOR DELETE
  TO authenticated
  USING ((auth.jwt() ->> 'sub') = user_id);
