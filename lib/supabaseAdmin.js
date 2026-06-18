import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const adminConfigured = Boolean(url && serviceKey);

export const supabaseAdmin = adminConfigured
  ? createClient(url, serviceKey, { auth: { persistSession: false } })
  : null;

export async function getUserFromRequest(req) {
  if (!supabaseAdmin) return null;
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

export async function getOrCreateProfile(user, trialCredits) {
  if (!supabaseAdmin || !user) return null;
  const { data: existing } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();
  if (existing) return existing;

  const { data: created, error } = await supabaseAdmin
    .from('profiles')
    .insert({
      id: user.id,
      email: user.email || null,
      phone: user.phone || null,
      plan: 'trial',
      credits_remaining: trialCredits
    })
    .select('*')
    .single();
  if (error) throw error;
  return created;
}
