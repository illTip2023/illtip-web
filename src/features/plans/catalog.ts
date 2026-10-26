/**
 * Plan copy, mirrored from illtip-mobile:
 *   src/constants/chooseYourPlan.ts (JOB_APPLY_PLANS), hireYourPlan.ts (HIRE_REQUEST_PLANS),
 *   paymentPlans.ts (PAYMENT_PLANS), eliteGoldPlan.ts (ELITE_GOLD_PLAN), choosePlanThemes.ts
 *   and the English strings in src/config/i18n/locales/en.json → subscription.*
 *
 * Deliberately NOT copied: the static sale / "compare-at" prices. Every price on the web comes from
 * the backend's resolvedPrice/resolvedCurrency (or upgrade.amount/currency).
 */
import type { SubscriptionCatalog } from './api';

export type Feature = { label: string; badge?: string; tone?: 'green' | 'purple' | 'gold'; isNew?: boolean; included?: boolean };

export type ChoosePlan = {
  id: string;
  backendPlanId: string;
  billing: 'monthly' | 'quarterly' | 'elite';
  months: number;
  title: string;
  subtitle: string;
  priceSuffix?: string;
  ctaLabel: string;
  footerNote?: string;
  isPopular?: boolean;
  socialProofText?: string;
  offerBox?: { title: string; subtitle: string };
  features: Feature[];
};

export type ChooseFlow = 'career' | 'hire';

/**
 * The app labels the 3-month plans "ONE-TIME PAYMENT", but the backend sells them as recurring
 * Stripe subscriptions / Paystack plans (billingPeriod 3_MONTH, renews unless cancelled), so the web
 * says "every 3 months" instead. Swap back to 'ONE-TIME PAYMENT' here if that's really intended.
 */
const QUARTER_SUFFIX = 'every 3 months';

export const CHOOSE_FLOWS: Record<
  ChooseFlow,
  { subtitle: string; savePercent: string; theme: 'career' | 'hire'; plans: ChoosePlan[] }
> = {
  career: {
    subtitle: 'Unlock more opportunities. Choose what works best for your career.',
    savePercent: 'over 30%',
    theme: 'career',
    plans: [
      {
        id: 'career-access',
        backendPlanId: 'career-1m',
        billing: 'monthly',
        months: 1,
        title: 'Career Access',
        subtitle: 'Flexible Monthly Plan',
        priceSuffix: '/month',
        ctaLabel: 'Continue Monthly',
        footerNote: 'Cancel anytime',
        features: [
          { label: 'Apply to 100 Jobs a month' },
          { label: 'Unlock Employer Details' },
          { label: '10 AI Resumes a month' },
          { label: 'Verified Account Badge' },
          { label: 'Unlimited AI Chat Bot Access' },
          { label: 'Unlock Recommendations' },
          { label: 'Priority support phone call' },
          { label: 'How to Improve Your Profile', isNew: true },
          { label: 'Ways to Stand Out', isNew: true },
        ],
      },
      {
        id: 'career-success-pro',
        backendPlanId: 'career-3m',
        billing: 'quarterly',
        months: 3,
        title: 'Career Success Pro',
        subtitle: '3 Months Premium Access',
        priceSuffix: QUARTER_SUFFIX,
        ctaLabel: 'Get Premium Access',
        isPopular: true,
        socialProofText: 'Most users choose this plan',
        features: [
          { label: 'Unlimited Job Applications', badge: 'UNLIMITED', tone: 'green' },
          { label: 'Full Employer Details' },
          { label: 'AI Resume Builder (High Usage)' },
          { label: 'Verified & Boosted Profile', badge: 'BOOSTED', tone: 'purple' },
          { label: '1 Free Boost Post (3 Day Visibility)' },
          { label: 'Large Ranking Boost' },
          { label: 'Unlock Recommendations' },
          { label: 'Priority support phone call' },
          { label: 'How to Improve Your Profile', isNew: true },
          { label: 'Ways to Stand Out', isNew: true },
          { label: 'Unlimited AI Chat Bot Access', badge: 'UNLIMITED', tone: 'green', isNew: true },
        ],
      },
      eliteChoosePlan('career-elite-gold'),
    ],
  },
  hire: {
    subtitle: 'Select the perfect recruitment plan to find top talent.',
    savePercent: 'over 15%',
    theme: 'hire',
    plans: [
      {
        id: 'hiring-access',
        backendPlanId: 'hire-1m',
        billing: 'monthly',
        months: 1,
        title: 'Hiring Access',
        subtitle: 'Standard Monthly Plan',
        priceSuffix: '/month',
        ctaLabel: 'Continue Monthly',
        footerNote: 'Cancel anytime',
        features: [
          { label: 'Post 25 Jobs a month (CAPPED)', included: true },
          { label: 'View High Volume Applicants Profile', included: true },
          { label: 'Verified Badge', included: true },
          { label: 'NO Profile Ranking Boost', included: false },
          { label: 'NO Free Boost Post', included: false },
          { label: 'Candidates Pre-Screening', included: true },
        ],
      },
      {
        id: 'hiring-success-pro',
        backendPlanId: 'hire-3m',
        billing: 'quarterly',
        months: 3,
        title: 'Hiring Success Pro',
        subtitle: '3 Months Full Access',
        priceSuffix: QUARTER_SUFFIX,
        ctaLabel: 'Get Pro Access',
        isPopular: true,
        socialProofText: 'Most recruiters choose this plan',
        offerBox: {
          title: 'Save Over 15%',
          subtitle: 'Get 3 full months of premium hiring power for less than the price of 3 months!',
        },
        features: [
          { label: 'UNLIMITED Job Posts', badge: 'UNLIMITED', tone: 'green' },
          { label: 'FULL Employer Details', badge: 'FULL', tone: 'green' },
          { label: 'MAXIMUM Ranking Boost', badge: 'BOOSTED', tone: 'gold' },
          { label: 'Verified & Boosted Profile', badge: 'BOOSTED', tone: 'gold' },
          { label: '1 FREE Boost Post (3 Day Visibility)' },
          { label: 'Top-Tier Feed Placement' },
          { label: 'View Unlimited Candidate Profile' },
          { label: 'PRO Recommendations', badge: 'EXCLUSIVE', tone: 'gold' },
          { label: 'Candidate Pre-Screening' },
        ],
      },
      eliteChoosePlan('hiring-elite-gold'),
    ],
  },
};

function eliteChoosePlan(id: string): ChoosePlan {
  return {
    id,
    backendPlanId: 'elite-gold-1m',
    billing: 'elite',
    months: 1,
    title: 'Elite Gold',
    subtitle: '1-Month Plan',
    priceSuffix: '/month',
    // The app says "GET STARTED - SAVE 72% NOW"; that percentage is measured against a static
    // compare-at price we don't show on the web, so the claim is left out.
    ctaLabel: 'Get Started',
    isPopular: true,
    features: [],
  };
}

/** ELITE_GOLD_PLAN (eliteGoldPlan.ts) / subscription.eliteGold.* */
export const ELITE_GOLD = {
  brandLabel: "i'llTip",
  title: 'Elite Gold',
  durationLabel: '1-Month Plan',
  limitedOfferLabel: 'Limited Time Offer',
  allAccessLabel: 'All Access',
  sections: [
    {
      emoji: '🚀',
      title: 'Accelerate Your Network & Opportunities',
      features: [
        { title: 'Unlimited Job Applications & Posting', subtitle: 'Full-Throttle Access: Post and apply without limits.' },
        { title: 'Verified & Boosted Profile + 1 Free Boost Post', subtitle: 'Verified Authority: Get seen first. Stand out to employers.' },
        { title: 'Promote Your Business/Services', subtitle: 'Amplify Your Voice: Turn listings into opportunities.' },
      ],
    },
    {
      emoji: '🧠',
      title: 'Supercharge Your Career Path',
      features: [
        { title: 'AI Resume Builder & Chat Bot', subtitle: 'Elite AI Suite: Perfect resumes and instant answers.' },
        { title: 'Higher Ranking, More Visibility', subtitle: 'Top-Tier Exposure: Dominant ranking in feeds and search.' },
        { title: 'Full Career Hub & Expert Content', subtitle: 'Access Exclusive Strategies: Resume, interview, and success guides.' },
      ],
    },
  ],
};

export type PaymentPlan = { backendPlanId: string; title: string; durationLabel: string; features: string[] };

/** PAYMENT_PLANS (paymentPlans.ts) / subscription.paymentPlans.* — the "Payment Plans" browse list. */
export const PAYMENT_PLANS: PaymentPlan[] = [
  {
    backendPlanId: 'verified-badge-3m',
    title: 'Verified Badge',
    durationLabel: '3 month plan',
    features: [
      'Verified Account Badge',
      'Look More Professional',
      'Get Noticed Faster',
      'Build Trust Instantly',
      'Increase Visibility & Opportunities',
      'Unlimited AI Chat Bot Access',
      'Unlock Recommendations',
    ],
  },
  {
    backendPlanId: 'career-1m',
    title: 'Career Access',
    durationLabel: '1 month plan',
    features: [
      'Apply to 100 Jobs a month',
      'Unlock Employer Details',
      '10 AI Resumes a month',
      'Verified Account Badge',
      'Unlimited AI Chat Bot Access',
      'Unlock Recommendations',
      'Priority support phone call',
      'How to Improve Your Profile',
      'Ways to Stand Out',
    ],
  },
  {
    backendPlanId: 'career-3m',
    title: 'Career Success Pro',
    durationLabel: '3 month plan',
    features: [
      'Unlimited Job Applications',
      'Full Employer Details',
      'AI Resume Builder (High Usage)',
      'Verified & Boosted Profile',
      '1 Free Boost Post (3 Day Visibility)',
      'Large Ranking Boost',
      'Unlock Recommendations',
      'Priority support phone call',
      'How to Improve Your Profile',
      'Ways to Stand Out',
      'Unlimited AI Chat Bot Access',
    ],
  },
  {
    backendPlanId: 'hire-1m',
    title: 'Hiring Access',
    durationLabel: '1 month plan',
    features: ['Post 25 Jobs a Month', 'Boosted Visibility', 'Verified Account Badge', 'Verified & Boosted Profile', 'Unlimited AI Chat Bot Access', 'Unlock Recommendations'],
  },
  {
    backendPlanId: 'elite-gold-1m',
    title: "i'llTip Elite Gold",
    durationLabel: '1 month plan',
    features: [
      'Unlimited Job Applications',
      'Unlimited Job Posting Access',
      'Verified & Boosted Profile',
      '1 Free Boost Post',
      'AI Resume Builder Access',
      'Full Career Success Hub Access',
      'Higher Raking in Search & Feed',
      'Promote your Business, Services or your Brand',
      'Increased Visibility to Employers, Recruiters & Users',
      'Access Exclusive Career Success Content',
      'Learn how to Stand Out to Employers',
      'Resume & Interview Guidance',
      'Real Success Stories from Job Seekers & Hiring Tips',
      'Unlimited AI Chat Bot Access',
      'Unlock Recommendations',
    ],
  },
  {
    backendPlanId: 'hire-3m',
    title: 'Hiring Success Pro',
    durationLabel: '3 month plan',
    features: ['Unlimited Job Posts', '1 Free Boost Post (3 Day Visibility)', 'Higher Listing Visibility', 'Verified & Boosted Profile', 'Unlimited AI Chat Bot Access', 'Unlock Recommendations'],
  },
  // 'boost-post' is left out: in the app it's only bought from a post's Boost button, which the web doesn't have.
];

/** PaymentPlansScreen CATALOG_LABELS. */
export const CATALOG_LABELS: Record<SubscriptionCatalog, string> = {
  career: 'Career Access',
  hire: 'Hiring Access',
  eliteGold: 'Elite Gold',
  flat: 'Verified Badge',
};

export function planTitle(planId: string | undefined, fallback?: string): string {
  return PAYMENT_PLANS.find((p) => p.backendPlanId === planId)?.title || fallback || 'Subscription Plan';
}

export const TRUST = [
  { title: 'Secure Payment', subtitle: '100% secure & safe' },
  { title: 'Cancel Anytime', subtitle: 'No lock-in contracts' },
  { title: '24/7 Support', subtitle: "We're here to help" },
];
