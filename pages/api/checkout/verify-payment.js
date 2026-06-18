import { getUserFromRequest, supabaseAdmin, adminConfigured } from '../../../lib/supabaseAdmin';
import { verifySignature } from '../../../lib/razorpay';
import { getPlanById } from '../../../lib/plans';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  try {
    if (!adminConfigured) { res.status(503).json({ error: 'Accounts are not set up yet' }); return; }
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: 'Not signed in' }); return; }

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, planId } = req.body;
    const plan = getPlanById(planId);
    if (!plan) { res.status(400).json({ error: 'Invalid plan' }); return; }

    const valid = verifySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
    if (!valid) { res.status(400).json({ error: 'Payment signature could not be verified' }); return; }

    await supabaseAdmin.from('payments')
      .update({ razorpay_payment_id, status: 'paid' })
      .eq('razorpay_order_id', razorpay_order_id);

    const { data: profile } = await supabaseAdmin.from('profiles').select('credits_remaining').eq('id', user.id).single();
    const newCredits = (profile?.credits_remaining || 0) + plan.credits;

    await supabaseAdmin.from('profiles')
      .update({ plan: plan.id, credits_remaining: newCredits })
      .eq('id', user.id);

    res.status(200).json({ ok: true, credits: newCredits });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
}
