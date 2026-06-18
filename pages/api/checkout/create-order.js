import { getUserFromRequest, supabaseAdmin, adminConfigured } from '../../../lib/supabaseAdmin';
import { createOrder, razorpayConfigured, razorpayKeyId } from '../../../lib/razorpay';
import { getPlanById } from '../../../lib/plans';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  try {
    if (!adminConfigured) { res.status(503).json({ error: 'Accounts are not set up yet' }); return; }
    if (!razorpayConfigured) { res.status(503).json({ error: 'Payments are not set up yet' }); return; }

    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: 'Not signed in' }); return; }

    const plan = getPlanById(req.body.planId);
    if (!plan || !plan.price) { res.status(400).json({ error: 'Invalid plan' }); return; }

    const order = await createOrder(plan.price * 100, 'drape_' + plan.id + '_' + user.id.slice(0, 8) + '_' + Date.now());

    await supabaseAdmin.from('payments').insert({
      user_id: user.id, plan: plan.id, amount: plan.price * 100,
      razorpay_order_id: order.id, status: 'created'
    });

    res.status(200).json({ orderId: order.id, amount: order.amount, currency: order.currency, keyId: razorpayKeyId });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
}
