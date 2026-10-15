/**
 * main.js — Application entry point
 *
 * Orchestrates Firebase auth state → Supabase CRUD lifecycle:
 *
 *  1. Firebase onAuthStateChanged drives all view switching.
 *  2. On sign-up we also upsert a row into `public.profiles` so downstream
 *     queries can join on user metadata.
 *  3. After sign-up the token is force-refreshed so the `role:authenticated`
 *     custom claim (set by the provisioning script / Cloud Function) is
 *     picked up immediately.
 *  4. The Supabase client's `accessToken` callback automatically supplies
 *     a fresh Firebase JWT on every request — no manual header management.
 */

import {
  auth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  sendEmailVerification,
  sendPasswordResetEmail,
  deleteUser,
  googleProvider,
  signInWithPopup,
  isFirebaseConfigured,
  missingFirebaseVars,
} from './firebase.js';

import { supabase, isSupabaseConfigured } from './supabase.js';
import { createRecord, listRecords, updateRecord, deleteRecord } from './records.js';
import { $, show, hide, setBtnLoading, toast, escapeHtml } from './ui.js';

const overlay             = $('#loading-overlay');
const authSection         = $('#auth-section');
const dashSection         = $('#dashboard-section');
const configNoticeSection = $('#config-notice-section');
const missingVarsList     = $('#missing-vars-list');

const verifyEmailSection = $('#verify-email-section');
const verifyEmailDisplay = $('#verify-email-display');
const checkVerifyBtn     = $('#check-verify-btn');
const resendVerifyBtn    = $('#resend-verify-btn');
const verifyCancelBtn    = $('#verify-cancel-btn');

let verifyPollTimer = null;
let resendTimer     = null;

const tabLogin        = $('#tab-login');
const tabRegister     = $('#tab-register');
const loginForm       = $('#login-form');
const registerForm    = $('#register-form');
const googleSignInBtn = $('#google-signin-btn');

const logoutBtn       = $('#logout-btn');
const userEmailBadge  = $('#user-email-badge');

const forgotPasswordLink = $('#forgot-password-link');
const forgotModal        = $('#forgot-modal');
const forgotForm         = $('#forgot-form');
const forgotEmailInput   = $('#forgot-email');
const forgotSubmitBtn    = $('#forgot-submit-btn');
const cancelForgotBtn    = $('#cancel-forgot-btn');

const deleteAccountBtn = $('#delete-account-btn');
const deleteModal      = $('#delete-modal');
const confirmDeleteBtn = $('#confirm-delete-btn');
const cancelDeleteBtn  = $('#cancel-delete-btn');

const profileName     = $('#profile-name');
const profileEmail    = $('#profile-email');
const profileUid      = $('#profile-uid');
const profileProvider = $('#profile-provider');
const profileRole     = $('#profile-role');

const recordForm        = $('#record-form');
const recordIdInput     = $('#record-id');
const recordTitle       = $('#record-title');
const recordDescription = $('#record-description');
const recordSubmit      = $('#record-submit');
const recordCancel      = $('#record-cancel');
const recordsList     = $('#records-list');
const recordsLoading  = $('#records-loading');
const recordsEmpty    = $('#records-empty');
const refreshBtn      = $('#refresh-records-btn');

// ══════════════════════════════════════════════════════════════════════════════
//  AUTH STATE MACHINE & CONFIG CHECK
// ══════════════════════════════════════════════════════════════════════════════

function showConfigNotice() {
  hide(dashSection);
  hide(authSection);
  show(configNoticeSection);

  if (missingVarsList) {
    missingVarsList.innerHTML = '';
    const missing = [...missingFirebaseVars];
    if (!isSupabaseConfigured) {
      if (!import.meta.env.VITE_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL.includes('your-project-ref')) {
        missing.push('VITE_SUPABASE_URL');
      }
      if (!import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...')) {
        missing.push('VITE_SUPABASE_ANON_KEY');
      }
    }
    for (const v of missing) {
      const li = document.createElement('li');
      li.textContent = v;
      missingVarsList.appendChild(li);
    }
  }
}

if (!isFirebaseConfigured || !isSupabaseConfigured) {
  overlay.classList.remove('visible');
  showConfigNotice();
} else {
  onAuthStateChanged(auth, async (user) => {
    // Dismiss the splash loader on the first callback
    overlay.classList.remove('visible');

    if (user) {
      if (user.emailVerified) {
        clearInterval(verifyPollTimer);
        showDashboard(user);
      } else {
        showVerifyEmail(user);
      }
    } else {
      clearInterval(verifyPollTimer);
      showAuth();
    }
  });
}

function showAuth() {
  clearInterval(verifyPollTimer);
  resetRecordForm();
  recordsList.innerHTML = '';
  profileName.textContent = '—';
  profileEmail.textContent = '—';
  profileUid.textContent = '—';
  profileProvider.textContent = '—';
  profileRole.textContent = '—';
  hide(dashSection);
  hide(configNoticeSection);
  hide(verifyEmailSection);
  show(authSection);
}

function showVerifyEmail(user) {
  hide(dashSection);
  hide(authSection);
  hide(configNoticeSection);
  show(verifyEmailSection);

  verifyEmailDisplay.textContent = user.email || 'your email';

  // Automatically poll every 3.5s to detect when link is clicked
  clearInterval(verifyPollTimer);
  verifyPollTimer = setInterval(async () => {
    try {
      const current = auth.currentUser;
      if (!current) {
        clearInterval(verifyPollTimer);
        return;
      }
      await current.reload();
      if (current.emailVerified) {
        clearInterval(verifyPollTimer);
        toast('Email verified successfully! 🎉', 'success');
        await onVerificationSuccess(current);
      }
    } catch {
      // offline / temporary network blip
    }
  }, 3500);
}

async function onVerificationSuccess(user) {
  // Provision claim in background if needed
  try {
    await fetch('/api/provision-claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: user.uid }),
    });
  } catch (err) {
    console.warn('Auto-provision note:', err);
  }

  // Force-refresh token
  await user.getIdToken(/* forceRefresh */ true);

  // Sync profile to Supabase
  try {
    await supabase.from('profiles').upsert({
      id: user.uid,
      full_name: user.displayName || user.email?.split('@')[0] || '',
      email: user.email,
    });
  } catch (err) {
    console.warn('Profile sync note:', err);
  }

  hide(verifyEmailSection);
  showDashboard(user);
}

async function showDashboard(user) {
  clearInterval(verifyPollTimer);
  hide(authSection);
  hide(configNoticeSection);
  hide(verifyEmailSection);
  show(dashSection);

  userEmailBadge.textContent = user.email;
  if (user.displayName) {
    profileName.textContent = user.displayName;
  } else if (!profileName.textContent || profileName.textContent === '—') {
    profileName.textContent = '—';
  }
  profileEmail.textContent     = user.email;
  profileUid.textContent       = user.uid;
  profileProvider.textContent  = user.providerData[0]?.providerId ?? '—';

  // Show the role claim from the token (for debugging / transparency)
  try {
    let tokenResult = await user.getIdTokenResult();
    let role = tokenResult.claims.role;

    // If role claim is missing, automatically provision it via dev server
    if (!role) {
      try {
        const res = await fetch('/api/provision-claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uid: user.uid }),
        });
        if (res.ok) {
          await user.getIdToken(true);
          tokenResult = await user.getIdTokenResult();
          role = tokenResult.claims.role;
        }
      } catch {
        // Dev server API unavailable
      }
    }

    if (role === 'authenticated') {
      profileRole.innerHTML = '<span class="status-pill success">authenticated</span>';
    } else {
      profileRole.innerHTML = '<span class="status-pill warning">not set ⚠️</span>';
      toast(
        'Warning: the "role" custom claim is not set on this user. ' +
        'Run  npm run provision-claims  then re-login.',
        'error',
        8000
      );
    }
  } catch {
    profileRole.textContent = 'unknown';
  }

  // Sync profile to public.profiles
  try {
    await supabase.from('profiles').upsert({
      id: user.uid,
      full_name: user.displayName || user.email?.split('@')[0] || '',
      email: user.email,
    });
  } catch (profileErr) {
    console.warn('Profile sync note:', profileErr);
  }

  await loadRecords();
}

// ══════════════════════════════════════════════════════════════════════════════
//  TAB SWITCHING
// ══════════════════════════════════════════════════════════════════════════════

tabLogin.addEventListener('click', () => {
  tabLogin.classList.add('active');
  tabRegister.classList.remove('active');
  tabLogin.setAttribute('aria-selected', 'true');
  tabRegister.setAttribute('aria-selected', 'false');
  show(loginForm);
  hide(registerForm);
});

tabRegister.addEventListener('click', () => {
  tabRegister.classList.add('active');
  tabLogin.classList.remove('active');
  tabRegister.setAttribute('aria-selected', 'true');
  tabLogin.setAttribute('aria-selected', 'false');
  show(registerForm);
  hide(loginForm);
});

// ══════════════════════════════════════════════════════════════════════════════
//  REGISTER
// ══════════════════════════════════════════════════════════════════════════════

registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn   = $('#register-submit');
  const name  = $('#register-name').value.trim();
  const email = $('#register-email').value.trim();
  const pass  = $('#register-password').value;

  setBtnLoading(btn, true);
  try {
    // 1. Create Firebase user
    const cred = await createUserWithEmailAndPassword(auth, email, pass);

    // 2. Set displayName and update UI directly
    await updateProfile(cred.user, { displayName: name });
    profileName.textContent = name;

    // 3. Send verification email via Google
    await sendEmailVerification(cred.user);

    // 4. Automatically provision role claim in background
    try {
      await fetch('/api/provision-claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: cred.user.uid }),
      });
    } catch (claimErr) {
      console.warn('Auto-provision note:', claimErr);
    }

    toast('Verification link sent! Please check your inbox 📬', 'info', 7000);
    registerForm.reset();
    showVerifyEmail(cred.user);
  } catch (err) {
    toast(friendlyError(err), 'error');
  } finally {
    setBtnLoading(btn, false);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  LOGIN
// ══════════════════════════════════════════════════════════════════════════════

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn   = $('#login-submit');
  const email = $('#login-email').value.trim();
  const pass  = $('#login-password').value;

  setBtnLoading(btn, true);
  try {
    const cred = await signInWithEmailAndPassword(auth, email, pass);
    if (!cred.user.emailVerified) {
      toast('Please verify your email before accessing your account 📩', 'warning', 6000);
      showVerifyEmail(cred.user);
    } else {
      toast('Signed in successfully', 'success');
      loginForm.reset();
    }
  } catch (err) {
    toast(friendlyError(err), 'error');
  } finally {
    setBtnLoading(btn, false);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  GOOGLE SIGN-IN
// ══════════════════════════════════════════════════════════════════════════════

if (googleSignInBtn) {
  googleSignInBtn.addEventListener('click', async () => {
    setBtnLoading(googleSignInBtn, true);
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      toast(`Welcome, ${cred.user.displayName || cred.user.email}! 👋`, 'success');
    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
        toast(friendlyError(err), 'error');
      }
    } finally {
      setBtnLoading(googleSignInBtn, false);
    }
  });
}

// ══════════════════════════════════════════════════════════════════════════════
//  FORGOT PASSWORD
// ══════════════════════════════════════════════════════════════════════════════

if (forgotPasswordLink && forgotModal) {
  forgotPasswordLink.addEventListener('click', () => {
    const loginEmailVal = $('#login-email')?.value.trim();
    if (loginEmailVal && forgotEmailInput) {
      forgotEmailInput.value = loginEmailVal;
    }
    forgotModal.classList.remove('hidden');
    forgotModal.classList.add('visible');
    forgotEmailInput?.focus();
  });

  if (cancelForgotBtn) {
    cancelForgotBtn.addEventListener('click', () => {
      forgotModal.classList.remove('visible');
      forgotModal.classList.add('hidden');
    });
  }

  forgotModal.addEventListener('click', (e) => {
    if (e.target === forgotModal) {
      forgotModal.classList.remove('visible');
      forgotModal.classList.add('hidden');
    }
  });

  if (forgotForm) {
    forgotForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = forgotEmailInput.value.trim();
      if (!email) return;

      setBtnLoading(forgotSubmitBtn, true);
      try {
        await sendPasswordResetEmail(auth, email);
        toast(`Password reset link sent to ${email} 📩`, 'success', 6000);
        forgotModal.classList.remove('visible');
        forgotModal.classList.add('hidden');
        forgotForm.reset();
      } catch (err) {
        toast(friendlyError(err), 'error');
      } finally {
        setBtnLoading(forgotSubmitBtn, false);
      }
    });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  EMAIL VERIFICATION ACTIONS
// ══════════════════════════════════════════════════════════════════════════════

checkVerifyBtn.addEventListener('click', async () => {
  const user = auth.currentUser;
  if (!user) return showAuth();

  setBtnLoading(checkVerifyBtn, true);
  try {
    await user.reload();
    if (user.emailVerified) {
      clearInterval(verifyPollTimer);
      toast('Email verified! Welcome 🎉', 'success');
      await onVerificationSuccess(user);
    } else {
      toast('Email not verified yet. Please check your inbox (and spam folder) and click the link.', 'warning', 6000);
    }
  } catch (err) {
    toast(friendlyError(err), 'error');
  } finally {
    setBtnLoading(checkVerifyBtn, false);
  }
});

resendVerifyBtn.addEventListener('click', async () => {
  const user = auth.currentUser;
  if (!user) return showAuth();

  setBtnLoading(resendVerifyBtn, true);
  try {
    await sendEmailVerification(user);
    toast('A fresh verification link has been sent to your email 📬', 'success');
    startResendCooldown(60);
  } catch (err) {
    toast(friendlyError(err), 'error');
  } finally {
    setBtnLoading(resendVerifyBtn, false);
  }
});

function startResendCooldown(seconds) {
  let remaining = seconds;
  resendVerifyBtn.disabled = true;
  const btnText = resendVerifyBtn.querySelector('.btn-text');
  clearInterval(resendTimer);

  resendTimer = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearInterval(resendTimer);
      resendVerifyBtn.disabled = false;
      if (btnText) btnText.textContent = 'Resend email';
    } else {
      if (btnText) btnText.textContent = `Resend in ${remaining}s`;
    }
  }, 1000);
}

verifyCancelBtn.addEventListener('click', async () => {
  clearInterval(verifyPollTimer);
  clearInterval(resendTimer);
  try {
    await signOut(auth);
  } catch {
    // ignore
  }
  showAuth();
});


// ══════════════════════════════════════════════════════════════════════════════
//  LOGOUT
// ══════════════════════════════════════════════════════════════════════════════

logoutBtn.addEventListener('click', async () => {
  try {
    await signOut(auth);
    resetRecordForm();
    recordsList.innerHTML = '';
    toast('Signed out', 'info');
  } catch (err) {
    toast(friendlyError(err), 'error');
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  ACCOUNT DELETION
// ══════════════════════════════════════════════════════════════════════════════

if (deleteAccountBtn && deleteModal) {
  deleteAccountBtn.addEventListener('click', () => {
    deleteModal.classList.remove('hidden');
    deleteModal.classList.add('visible');
  });

  if (cancelDeleteBtn) {
    cancelDeleteBtn.addEventListener('click', () => {
      deleteModal.classList.remove('visible');
      deleteModal.classList.add('hidden');
    });
  }

  deleteModal.addEventListener('click', (e) => {
    if (e.target === deleteModal) {
      deleteModal.classList.remove('visible');
      deleteModal.classList.add('hidden');
    }
  });

  if (confirmDeleteBtn) {
    confirmDeleteBtn.addEventListener('click', async () => {
      const user = auth.currentUser;
      if (!user) return;

      setBtnLoading(confirmDeleteBtn, true);
      try {
        // 1. Delete user's records from Supabase
        const { error: recError } = await supabase
          .from('test_records')
          .delete()
          .eq('user_id', user.uid);
        if (recError) {
          console.warn('Supabase records cleanup warning:', recError);
        }

        // 2. Delete user's profile from Supabase
        const { error: profError } = await supabase
          .from('profiles')
          .delete()
          .eq('id', user.uid);
        if (profError) {
          console.warn('Supabase profile cleanup warning:', profError);
        }

        // 3. Delete user from Firebase Auth
        await deleteUser(user);

        // 4. Clean up UI state and return to auth view
        deleteModal.classList.remove('visible');
        deleteModal.classList.add('hidden');
        resetRecordForm();
        recordsList.innerHTML = '';
        showAuth();
        toast('Account and data deleted permanently.', 'info');
      } catch (err) {
        console.error('Account deletion error:', err);
        if (err.code === 'auth/requires-recent-login') {
          toast('For security, please log out and log back in before deleting your account.', 'warning');
        } else {
          toast(friendlyError(err), 'error');
        }
      } finally {
        setBtnLoading(confirmDeleteBtn, false);
      }
    });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  RECORDS CRUD
// ══════════════════════════════════════════════════════════════════════════════

// ── Load & render ───────────────────────────────────────────────────────────
async function loadRecords() {
  show(recordsLoading);
  hide(recordsEmpty);
  hide(recordsList);

  try {
    const records = await listRecords();
    renderRecords(records);
  } catch (err) {
    toast(`Failed to load records: ${err.message}`, 'error');
    hide(recordsLoading);
  }
}

function renderRecords(records) {
  hide(recordsLoading);

  if (!records.length) {
    show(recordsEmpty);
    hide(recordsList);
    return;
  }

  hide(recordsEmpty);
  show(recordsList);
  recordsList.innerHTML = '';

  for (const r of records) {
    const li = document.createElement('li');
    li.className = 'record-item';
    li.dataset.id = r.id;

    const createdDate = new Date(r.created_at);
    const updatedDate = r.updated_at ? new Date(r.updated_at) : null;
    const isUpdated = updatedDate && Math.abs(updatedDate.getTime() - createdDate.getTime()) > 1000;
    const dateStr = isUpdated
      ? `Updated ${updatedDate.toLocaleString()}`
      : `Created ${createdDate.toLocaleString()}`;

    li.innerHTML = `
      <div class="record-info">
        <div class="record-title">${escapeHtml(r.title)}</div>
        ${r.description ? `<div class="record-description">${escapeHtml(r.description)}</div>` : ''}
        <div class="record-meta">${dateStr}</div>
      </div>
      <div class="record-actions">
        <button class="btn icon-btn edit-btn" title="Edit" data-id="${r.id}">✏️</button>
        <button class="btn icon-btn delete-btn" title="Delete" data-id="${r.id}">🗑️</button>
      </div>
    `;
    recordsList.appendChild(li);
  }
}

// ── Create / Update ─────────────────────────────────────────────────────────
recordForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title       = recordTitle.value.trim();
  const description = recordDescription.value.trim();
  const editId      = recordIdInput.value;

  if (!title) return;

  setBtnLoading(recordSubmit, true);
  try {
    if (editId) {
      await updateRecord(editId, { title, description });
      toast('Record updated', 'success');
      resetRecordForm();
    } else {
      await createRecord(title, description);
      toast('Record created', 'success');
    }
    recordForm.reset();
    recordIdInput.value = '';
    await loadRecords();
  } catch (err) {
    toast(`Save failed: ${err.message}`, 'error');
  } finally {
    setBtnLoading(recordSubmit, false);
  }
});

// ── Edit mode ───────────────────────────────────────────────────────────────
recordsList.addEventListener('click', async (e) => {
  const editBtn = e.target.closest('.edit-btn');
  const delBtn  = e.target.closest('.delete-btn');

  if (editBtn) {
    const id = editBtn.dataset.id;
    const li = editBtn.closest('.record-item');
    const title = li.querySelector('.record-title').textContent;
    const descEl = li.querySelector('.record-description');

    recordIdInput.value     = id;
    recordTitle.value       = title;
    recordDescription.value = descEl ? descEl.textContent : '';
    recordSubmit.querySelector('.btn-text').textContent = 'Update';
    show(recordCancel);
    recordTitle.focus();
  }

  if (delBtn) {
    const id = delBtn.dataset.id;
    delBtn.disabled = true;
    try {
      await deleteRecord(id);
      toast('Record deleted', 'info');
      if (recordIdInput.value === id) {
        resetRecordForm();
      }
      await loadRecords();
    } catch (err) {
      toast(`Delete failed: ${err.message}`, 'error');
      delBtn.disabled = false;
    }
  }
});

recordCancel.addEventListener('click', resetRecordForm);
refreshBtn.addEventListener('click', loadRecords);

function resetRecordForm() {
  recordForm.reset();
  recordIdInput.value = '';
  recordSubmit.querySelector('.btn-text').textContent = 'Add';
  hide(recordCancel);
}

// ══════════════════════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════════════════════

/** Map Firebase error codes to user-friendly messages. */
function friendlyError(err) {
  const map = {
    'auth/email-already-in-use':  'That email is already registered.',
    'auth/invalid-email':         'Please enter a valid email address.',
    'auth/weak-password':         'Password must be at least 6 characters.',
    'auth/user-not-found':        'No account found with that email.',
    'auth/wrong-password':        'Incorrect password.',
    'auth/invalid-credential':    'Invalid email or password.',
    'auth/too-many-requests':     'Too many attempts — please wait a moment.',
    'auth/network-request-failed':'Network error — check your connection.',
    'auth/requires-recent-login': 'Please log in again before deleting your account.',
    'auth/missing-email':         'Please enter an email address.',
    'auth/popup-blocked':         'Sign-in popup was blocked by browser. Please allow popups.',
    'auth/account-exists-with-different-credential': 'An account already exists with the same email using a different login method.',
  };
  return map[err.code] || err.message || 'An unexpected error occurred.';
}
