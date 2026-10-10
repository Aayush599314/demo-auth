#!/usr/bin/env node
/**
 * provision-claims.mjs
 * ────────────────────
 * Sets the custom claim  { role: "authenticated" }  on every Firebase Auth
 * user so that Supabase third-party auth recognises them as the PostgreSQL
 * "authenticated" role and RLS policies work correctly.
 *
 * WHY THIS IS NEEDED
 * ──────────────────
 * Supabase third-party auth validates JWTs issued by Firebase but still
 * requires a `role` claim inside the token.  Firebase's default ID tokens
 * do NOT contain this claim.  The only secure way to add it is via the
 * Firebase Admin SDK (setCustomUserClaims), which must run in a trusted
 * server-side environment.
 *
 * USAGE
 * ─────
 *   1. Download a service-account key from Firebase Console →
 *      Project Settings → Service accounts → Generate new private key.
 *   2. Save it as  firebase-service-account.json  in the project root
 *      (already listed in .gitignore).
 *   3. Run:
 *        npm run provision-claims
 *
 *      Or provision a single user:
 *        npm run provision-claims -- --uid <firebase-uid>
 *
 * PRODUCTION RECOMMENDATION
 * ─────────────────────────
 * Deploy a Firebase Cloud Function on the `auth.user().onCreate` trigger
 * so every new user gets the claim automatically:
 *
 *   exports.addAuthenticatedClaim = functions.auth.user().onCreate(async (user) => {
 *     await admin.auth().setCustomUserClaims(user.uid, { role: 'authenticated' });
 *   });
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ── Locate service-account key ──────────────────────────────────────────────
const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  || resolve(process.cwd(), 'firebase-service-account.json');

if (!existsSync(keyPath)) {
  console.error(
    '\n❌  Service-account key not found.\n' +
    '    Expected at: ' + keyPath + '\n\n' +
    '    Download it from Firebase Console →\n' +
    '    Project Settings → Service accounts → Generate new private key.\n' +
    '    Save it as  firebase-service-account.json  in the project root.\n'
  );
  process.exit(1);
}

// ── Import Firebase Admin ───────────────────────────────────────────────────
let initializeApp, cert, getAuth;
try {
  const appModule = await import('firebase-admin/app');
  const authModule = await import('firebase-admin/auth');
  initializeApp = appModule.initializeApp;
  cert = appModule.cert;
  getAuth = authModule.getAuth;
} catch {
  console.error(
    '\n❌  firebase-admin is not installed.\n' +
    '    Run:  npm install firebase-admin\n'
  );
  process.exit(1);
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8'));
} catch (err) {
  console.error('\n❌  Failed to parse service-account JSON:', err.message);
  process.exit(1);
}

const app = initializeApp({
  credential: cert(serviceAccount),
});

const auth = getAuth(app);

const CLAIM = { role: 'authenticated' };

// ── Parse arguments ─────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const uidIdx = args.indexOf('--uid');
const singleUid = uidIdx !== -1 ? args[uidIdx + 1] : null;

async function provisionUser(uid) {
  const user = await auth.getUser(uid);
  const existing = user.customClaims || {};
  if (existing.role === 'authenticated') {
    console.log(`  ✔  ${uid} (${user.email || 'no-email'}) — already has role:"authenticated"`);
    return false;
  }
  await auth.setCustomUserClaims(uid, { ...existing, ...CLAIM });
  console.log(`  ✚  ${uid} (${user.email || 'no-email'}) — role:"authenticated" set`);
  return true;
}

async function provisionAll() {
  let updated = 0;
  let total = 0;
  let nextPageToken;

  do {
    const listResult = await auth.listUsers(1000, nextPageToken);
    for (const user of listResult.users) {
      total++;
      if (await provisionUser(user.uid)) updated++;
    }
    nextPageToken = listResult.pageToken;
  } while (nextPageToken);

  return { total, updated };
}

// ── Main ────────────────────────────────────────────────────────────────────
console.log('\n🔑  Provisioning custom claim:', JSON.stringify(CLAIM), '\n');

if (singleUid) {
  try {
    await provisionUser(singleUid);
  } catch (err) {
    console.error(`\n❌  Failed for UID ${singleUid}:`, err.message);
    process.exit(1);
  }
} else {
  const { total, updated } = await provisionAll();
  console.log(`\n   ${total} user(s) scanned, ${updated} updated.\n`);
}

console.log(
  '⚠️   Users must call  getIdToken(true)  (force-refresh) or re-login\n' +
  '    for the new claim to appear in their next ID token.\n'
);

process.exit(0);
