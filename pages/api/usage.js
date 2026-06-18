import { getUserFromRequest, supabaseAdmin, adminConfigured } from '../../lib/supabaseAdmin';

export default async function handler(req, res) {
  if (!adminConfigured) { res.status(200).json([]); return; }
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: 'Not signed in' }); return; }
    const { data, error } = await supabaseAdmin
      .from('generations')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) throw error;
    res.status(200).json(data || []);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
}
