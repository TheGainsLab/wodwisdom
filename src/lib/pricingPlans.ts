/** The single source of truth for public plan copy and prices — rendered on
 *  the pricing page (PricingPlans) and the welcome intake (WelcomePage).
 *  Lives outside the component file so both can import it without tripping
 *  fast-refresh. */
export type PricingPlan = 'programming' | 'engine' | 'all_access' | 'ai_research';
export type PricingInterval = 'monthly' | 'quarterly';
export interface PricingPlanRow {
  plan: PricingPlan; name: string; monthly: string; quarterly: string;
  blurb: string; cta: string; feat: boolean; badge: string;
}
/** AI Research — the knowledge subscription (also included with All
 *  Access). One source for the pricing page and for the offer lines in the
 *  research library. */
export const AI_RESEARCH_PRICE: Record<PricingInterval, string> = { monthly: '$9.99', quarterly: '$24.99' };
/** Free research questions a new account gets. The server is the authority
 *  (it reports free_limit); this is what the page says before it has asked. */
export const RESEARCH_FREE_QUESTIONS = 3;
export const AI_RESEARCH_CHECKOUT = '/checkout?plan=ai_research&interval=monthly';

export const PLANS: PricingPlanRow[] = [
  { plan: 'programming', name: 'AI Programming', monthly: '$29.99', quarterly: '$74.99', blurb: 'Individualized training built around your evaluation, goals, and progress.', cta: 'Choose Programming', feat: false, badge: '' },
  { plan: 'all_access', name: 'All Access', monthly: '$49.99', quarterly: '$119.99', blurb: 'AI Programming + AI Year of the Engine + AI Research.', cta: 'Get All Access', feat: true, badge: 'Best Value' },
  { plan: 'engine', name: 'AI Year of the Engine', monthly: '$29.99', quarterly: '$74.99', blurb: 'Our conditioning system, personalized to your fitness and goals.', cta: 'Choose Engine', feat: false, badge: '' },
];
