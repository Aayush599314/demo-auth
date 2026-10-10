/**
 * ui.js — Lightweight DOM helpers & toast notifications
 */

// ── Query helpers ───────────────────────────────────────────────────────────
export const $ = (sel) => document.querySelector(sel);
export const $$ = (sel) => [...document.querySelectorAll(sel)];

// ── Show / hide helpers ─────────────────────────────────────────────────────
export function show(el) { el.classList.remove('hidden'); }
export function hide(el) { el.classList.add('hidden'); }

// ── Button loading state ────────────────────────────────────────────────────
export function setBtnLoading(btn, loading) {
  const text    = btn.querySelector('.btn-text');
  const spinner = btn.querySelector('.btn-spinner');
  btn.disabled = loading;
  if (text)    loading ? hide(text)    : show(text);
  if (spinner) loading ? show(spinner) : hide(spinner);
}

// ── Toast notifications ─────────────────────────────────────────────────────
const toastContainer = () => document.getElementById('toast-container');
const TOAST_ICONS = { success: '✓', error: '✕', info: 'ℹ' };

/**
 * Show a toast notification.
 * @param {string} message
 * @param {'success'|'error'|'info'} type
 * @param {number} durationMs
 */
export function toast(message, type = 'info', durationMs = 4000) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${TOAST_ICONS[type] || ''}</span><span>${escapeHtml(message)}</span>`;
  toastContainer().appendChild(el);

  setTimeout(() => {
    el.classList.add('exit');
    el.addEventListener('animationend', () => el.remove());
  }, durationMs);
}

// ── Escape HTML ─────────────────────────────────────────────────────────────
export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

