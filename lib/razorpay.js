import crypto from 'crypto';

const KEY_ID = process.env.RAZORPAY_KEY_ID;
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

export const razorpayConfigured = Boolean(KEY_ID && KEY_SECRET);
export const razorpayKeyId = KEY_ID;

export async function createOrder(amountInPaise, receipt) {
  if (!razorpayConfigured) throw new Error('Payments are not set up yet');
  const auth = Buffer.from(KEY_ID + ':' + KEY_SECRET).toString('base64');
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: amountInPaise, currency: 'INR', receipt })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.description || 'Could not create order');
  return data;
}

export function verifySignature(orderId, paymentId, signature) {
  if (!razorpayConfigured) return false;
  const expected = crypto.createHmac('sha256', KEY_SECRET)
    .update(orderId + '|' + paymentId)
    .digest('hex');
  return expected === signature;
}
