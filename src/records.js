/**
 * records.js — CRUD operations for the `test_records` table in Supabase
 *
 * Every request goes through the Supabase client which automatically
 * attaches the Firebase ID token via the `accessToken` callback.
 * Row Level Security ensures users can only see/modify their own rows
 * (assuming standard owner-based policies on `user_id = auth.uid()`).
 */

import { supabase } from './supabase.js';
import { auth } from './firebase.js';

const TABLE = 'test_records';

function getClient() {
  if (!supabase) {
    throw new Error('Supabase client is not configured. Please check your .env settings.');
  }
  return supabase;
}

/** Create a new record. */
export async function createRecord(title, description = '') {
  const client = getClient();
  const payload = { title, description };
  if (auth?.currentUser?.uid) {
    payload.user_id = auth.currentUser.uid;
  }
  const { data, error } = await client
    .from(TABLE)
    .insert(payload)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

/** List all records for the authenticated user (RLS-filtered). */
export async function listRecords() {
  const client = getClient();
  const { data, error } = await client
    .from(TABLE)
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Update a record by id. */
export async function updateRecord(id, fields) {
  const client = getClient();
  const payload = {
    ...fields,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await client
    .from(TABLE)
    .update(payload)
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

/** Delete a record by id. */
export async function deleteRecord(id) {
  const client = getClient();
  const { error } = await client
    .from(TABLE)
    .delete()
    .eq('id', id);

  if (error) throw new Error(error.message);
}

