import { americo } from '../rules/americo';
import { mutual } from '../rules/mutual';
import { transamerica } from '../rules/transamerica';
import { transamericaConditions } from '../rules/transamerica-conditions';
import type { Result } from '../types';
import { caseWithBasics } from './basics';
import { statedHistoryScreen } from './assumptions';
import { optionalDetail } from './cardNotes';
import type { Basics, NotesState, QuickCard } from './types';

function redReason(r: Result): string {
  const reasons = r.reasons.filter(e => !/Within the published|Published .*build band|individual.condition.*Premier/i.test(e.text));
  const evidence = reasons.find(e => /knockout|exclusion|Outside|Above the maximum|not authorized|New York is excluded|Decline\.|declinable/i.test(e.text));
  return (evidence?.text ?? reasons[reasons.length - 1]?.text ?? 'Outside a published product guideline.').replace(' under this chart', '');
}
export function quickCards(basics: Basics, notes: NotesState): QuickCard[] {
  const actual = caseWithBasics(basics, notes.case);
  const { case: c, assumed } = statedHistoryScreen(notes, actual);
  const native = [americo(c, { checkAmount: false }), transamerica(c, { checkAmount: false }), mutual(c, { checkAmount: false })];
  const uncertain = notes.facts.some(f => f.value === 'unknown');
  const safe = ['oxygen12', 'adl12', 'hospice12', 'mobility12', 'pending', 'taHospital'].every(k => c.answers[k] === 'no');
  const recognized = !notes.suggestions.length && !notes.unresolved.length && !uncertain;
  const medical = transamericaConditions(c);
  return native.map((r): QuickCard => {
    const red = r.status === 'outside';
    // A quick field-screen is not a completed carrier application. Never set
    // taReviewed, moReviewed, amState, or hidden application answers to pass.
    // Green is conditional on the disclosed stated-history assumption, with a
    // medical path; related combinations, medications and source gaps stay yellow.
    const taGreen = r.carrier === 'transamerica' && !red && recognized && safe &&
      !c.details.medicationMention && medical.gaps.length === 0 && c.conditions.length <= 1 && c.medications.length === 0 &&
      c.medicationsStatus === 'none' && c.conditionsStatus !== 'unknown' &&
      c.answers.taTobacco12 === 'no' && r.benefit !== 'unconfirmed' &&
      !r.gaps.some(g => /build row|between published|below|Premier is unavailable/.test(g));
    const color = red ? 'red' : taGreen ? 'green' : 'yellow';
    let reason = red ? redReason(r) : taGreen ? 'Likely fit based on entered details and the quick-screen assumptions.' :
      r.carrier === 'mutual' ? (c.conditions.length ? 'Condition recognized; state-specific carrier guidance needs review.' : 'State-specific carrier guidance needs review.') : 'Carrier guidance does not confirm a tier for this case.';
    if (!red && !taGreen) {
      if (notes.suggestions.length) reason = 'Confirm the medication spelling first.';
      else if (notes.unresolved.length) reason = 'Some of the health details need clarification.';
      else if (uncertain) reason = 'An unclear or conflicting health detail needs review.';
      else if (optionalDetail(c, r)) reason = optionalDetail(c, r)!;
      else if (r.carrier === 'transamerica' && medical.gaps.some(g => g.includes('no complete, verified rule'))) reason = 'Condition recognized; carrier guidance needs review.';
      else if (r.carrier === 'transamerica' && c.conditions.length > 1) reason = 'This combination needs a carrier review.';
      else if (c.medications.length || c.details.medicationMention) reason = 'Medication impact still needs carrier review.';
    }
    const tier = taGreen ? r.tier.replace(' — individual-factor classification', '').replace(' candidate', '')
      : r.tierKind === 'ceiling' && r.carrier === 'americo' ? r.tier : 'Tier to confirm';
    return { carrier: r.carrier, name: r.name, product: r.carrier === 'transamerica' ? 'FE Express' : r.product,
      color, label: color === 'green' ? 'Likely fit' : color === 'red' ? 'Likely decline' : 'Possible fit',
      tier, benefit: taGreen ? r.benefit : r.benefit === 'graded' ? 'graded' : 'unconfirmed', reason,
      evidence: r.reasons, gaps: [...r.gaps, ...(assumed.length ? ['Quick-screen assumptions apply only to unlisted items, not confirmed medical answers.'] : []), 'Coverage amount was not requested; face-amount limits are not assessed.'], native: r };
  }).sort((a, b) => ({ green: 0, yellow: 1, red: 2 }[a.color] - { green: 0, yellow: 1, red: 2 }[b.color]) || a.name.localeCompare(b.name));
}
