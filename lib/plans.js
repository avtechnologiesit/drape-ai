// Single source of truth for plans, credits and pricing.
// Edit amounts here — every page (pricing, dashboard, checkout) reads from this file.

export const TRIAL_CREDITS = 5; // granted once, automatically, on signup

export const PLANS = [
  {
    id: 'starter',
    name: 'Starter',
    price: 499, // INR, per month
    credits: 25,
    tagline: 'For trying outfits before you buy',
    features: [
      '25 try-on generations / month',
      '3 AI-picked variants per generation',
      'AI styling assistant',
      'Email support'
    ]
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 1499,
    credits: 100,
    tagline: 'For creators and frequent shoppers',
    featured: true,
    features: [
      '100 try-on generations / month',
      '3 AI-picked variants per generation',
      'AI styling assistant',
      'Priority generation queue',
      'Priority support'
    ]
  },
  {
    id: 'business',
    name: 'Business',
    price: null,
    credits: null,
    tagline: 'For stores and bulk catalogue try-ons',
    features: [
      'Custom volume & pricing',
      'API access',
      'Bulk catalogue processing',
      'Dedicated support'
    ]
  }
];

export function getPlanById(id) {
  return PLANS.find(p => p.id === id) || null;
}
