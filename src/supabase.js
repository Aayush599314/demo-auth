/**
 * supabase.js — Supabase client configured for Firebase third-party auth
 *
 * KEY DESIGN DECISION
 * ───────────────────
 * We use the `accessToken` callback (introduced in @supabase/supabase-js v2)
 * to supply a **fresh Firebase ID token** on every Supabase request.
 *
 * Supabase third-party auth validates the Firebase JWT and maps the `sub`
 * claim to `auth.uid()`.  However, RLS policies also check the `role` claim.
 * Firebase's default ID tokens do NOT include `role: "authenticated"` — that
 * custom claim must be provisioned via the Firebase Admin SDK (see
 * scripts/provision-claims.mjs).
 *
 * If the claim is missing, Supabase will treat the user as `anon` and all
 * RLS policies gating on `auth.role() = 'authenticated'` will deny access.
 */

import { createClient } from '@supabase/supabase-js';
import { auth } from './firebase.js';

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY;

const isSupabaseConfigured = Boolean(
  supabaseUrl &&
  supabaseAnon &&
  !supabaseUrl.includes('your-project-ref') &&
  !supabaseAnon.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...')
);

let supabase = null;

if (isSupabaseConfigured) {
  try {
    supabase = createClient(supabaseUrl, supabaseAnon, {
      /**
       * accessToken callback — called by the Supabase client before every request.
       * Returns the current Firebase ID token (automatically refreshed by the
       * Firebase SDK when close to expiry) or `null` when no user is signed in.
       */
      accessToken: async () => {
        const user = auth?.currentUser;
        if (!user) return null;

        // `getIdToken(false)` returns a cached token and only hits Firebase's
        // servers when the existing token is within 5 minutes of expiry.
        return user.getIdToken(/* forceRefresh */ false);
      },
    });
  } catch (err) {
    console.error('Supabase initialization error:', err);
  }
}

export { supabase, isSupabaseConfigured };

