# Firebase Auth + Supabase PostgreSQL Demo

A single-page web app that uses **Firebase Authentication** as the identity provider and **Supabase** (PostgreSQL + Row Level Security) as the data layer.

---

## Architecture

```
Browser
  ├─ Firebase Auth SDK  → sign-up / sign-in / sign-out
  │   └─ ID Token (JWT) contains  { sub: "<uid>", role: "authenticated", … }
  │
  └─ Supabase JS Client (accessToken callback)
      └─ Every request sends the Firebase JWT → Supabase validates it
          └─ RLS policies use  auth.uid()  and  auth.role()
```

> **Critical point:** Firebase's default ID tokens do **not** contain a
> `role` claim. Supabase third-party auth requires `role: "authenticated"`
> for RLS to grant access. You must provision this custom claim via the
> Firebase Admin SDK — see [Step 3](#3-provision-the-role-custom-claim) below.

---

## Prerequisites

| Requirement | Notes |
|---|---|
| Node.js ≥ 18 | `node -v` |
| Firebase project | Email/Password auth enabled |
| Supabase project | Third-party auth → Firebase integration enabled |

### Supabase tables & RLS (Crucial Firebase Compatibility Fix)

> ⚠️ **Important:** In native Supabase Auth, `auth.uid()` attempts to cast the `sub` claim to `UUID`. Firebase UIDs are alphanumeric strings (not UUIDs), causing queries using `auth.uid()` to fail with:
> `ERROR: invalid input syntax for type uuid: "<firebase-uid>"`
>
> You must use `(auth.jwt() ->> 'sub')` and `TEXT` columns. Run the complete SQL script in [`schema.sql`](file:///c:/Users/Dell/Desktop/demo-auth/schema.sql) in your Supabase SQL Editor:

```sql
-- See schema.sql for the complete DDL script:
-- 1. profiles table (uses TEXT primary key for Firebase UID)
CREATE TABLE IF NOT EXISTS public.profiles (
  id         TEXT PRIMARY KEY,
  full_name  TEXT,
  email      TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT TO authenticated USING ((auth.jwt() ->> 'sub') = id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK ((auth.jwt() ->> 'sub') = id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated USING ((auth.jwt() ->> 'sub') = id);

-- 2. test_records table (user_id is TEXT matching Firebase UID)
CREATE TABLE IF NOT EXISTS public.test_records (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL DEFAULT (auth.jwt() ->> 'sub'),
  title       TEXT NOT NULL,
  description TEXT DEFAULT '',
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.test_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own records" ON public.test_records FOR SELECT TO authenticated USING ((auth.jwt() ->> 'sub') = user_id);
CREATE POLICY "Users can insert own records" ON public.test_records FOR INSERT TO authenticated WITH CHECK ((auth.jwt() ->> 'sub') = user_id);
CREATE POLICY "Users can update own records" ON public.test_records FOR UPDATE TO authenticated USING ((auth.jwt() ->> 'sub') = user_id);
CREATE POLICY "Users can delete own records" ON public.test_records FOR DELETE TO authenticated USING ((auth.jwt() ->> 'sub') = user_id);
```

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` and fill in your values:

| Variable | Where to find it |
|---|---|
| `VITE_FIREBASE_API_KEY` | Firebase Console → Project Settings → General |
| `VITE_FIREBASE_AUTH_DOMAIN` | Same page (e.g. `your-project.firebaseapp.com`) |
| `VITE_FIREBASE_PROJECT_ID` | Same page |
| `VITE_FIREBASE_STORAGE_BUCKET` | Same page |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Same page |
| `VITE_FIREBASE_APP_ID` | Same page |
| `VITE_SUPABASE_URL` | Supabase Dashboard → Settings → API |
| `VITE_SUPABASE_ANON_KEY` | Same page — the **anon / public** key |

### 3. Provision the `role` custom claim

Firebase's ID tokens do **not** include a `role` claim by default. Supabase
third-party auth needs `role: "authenticated"` in every JWT for RLS to work.

**a) Download a service-account key:**

Firebase Console → Project Settings → **Service accounts** → **Generate new private key**

Save the file as `firebase-service-account.json` in the project root (it's
already in `.gitignore`).

**b) Run the provisioning script:**

```bash
npm run provision-claims
```

This sets `{ role: "authenticated" }` as a custom claim on all existing
Firebase Auth users.

> **For production:** deploy a Firebase Cloud Function on the
> `auth.user().onCreate` trigger so every new user gets the claim
> automatically:
>
> ```js
> const functions = require('firebase-functions');
> const admin = require('firebase-admin');
> admin.initializeApp();
>
> exports.addAuthenticatedClaim = functions.auth.user().onCreate(async (user) => {
>   await admin.auth().setCustomUserClaims(user.uid, { role: 'authenticated' });
> });
> ```

### 4. Start the dev server

```bash
npm run dev
```

Open **http://localhost:5173** in your browser.

---

## Testing with two accounts

1. **Register Account A** (e.g. `alice@example.com`).
2. After registration, if you see a warning that the `role` claim is not set:
   - Run `npm run provision-claims` in a separate terminal.
   - Log out and log back in (or hard-refresh the page) so the fresh token
     includes the new claim.
3. Create two or three test records as Account A.
4. **Log out**, then **register Account B** (e.g. `bob@example.com`).
5. Repeat the claim provisioning if needed.
6. Verify that Account B sees **zero** records — RLS ensures full isolation.
7. Create records as Account B, then switch back to Account A and confirm
   each account only sees its own data.

---

## Project structure

```
demo-auth/
├── index.html                  # SPA shell
├── package.json
├── vite.config.js
├── .env.example                # Template for env vars
├── .gitignore
├── scripts/
│   └── provision-claims.mjs    # Sets role:"authenticated" via Admin SDK
└── src/
    ├── main.js                 # App entry — auth state, CRUD wiring
    ├── firebase.js             # Firebase init + auth helpers
    ├── supabase.js             # Supabase client with accessToken callback
    ├── records.js              # CRUD functions for test_records
    ├── ui.js                   # DOM helpers + toast notifications
    └── style.css               # Dark-mode glassmorphism design system
```

---

## Key Features

- **Email Verification Gate:** New registrations trigger Google's native email verification flow (`sendEmailVerification`) with real-time status auto-polling.
- **Forgot Password Workflow:** Self-serve password reset email (`sendPasswordResetEmail`) directly from the sign-in screen.
- **Permanent Account Deletion:** Danger zone option that wipes user records from Supabase, drops the profile row, and deletes the Firebase Auth account (`deleteUser`).
- **Auto-Provisioned Role Claims:** Vite dev middleware immediately sets `role: "authenticated"` so users can query Supabase tables immediately upon signup.

---

## Security notes

- **No service-role key in the browser.** All Supabase requests use the
  **anon** (publishable) key. Data access is governed entirely by RLS.
- **No Firebase Admin credentials in the browser.** The provisioning script
  runs server-side only.
- **Token freshness.** The `accessToken` callback calls
  `getIdToken(false)` which returns a cached token and only refreshes when
  the token is within 5 minutes of expiry.
- **RLS isolation.** Each user can only read/write rows where
  `user_id = (auth.jwt() ->> 'sub')`.
