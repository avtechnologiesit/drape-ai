import { getUserFromRequest, getOrCreateProfile, adminConfigured } from '../../lib/supabaseAdmin';
import { TRIAL_CREDITS } from '../../lib/plans';

export default async function handler(req, res) {
  if (!adminConfigured) { res.status(503).json({ error: 'Accounts are not configured yet' }); return; }
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: 'Not signed in' }); return; }
    const profile = await getOrCreateProfile(user, TRIAL_CREDITS);
    res.status(200).json(profile);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
}
