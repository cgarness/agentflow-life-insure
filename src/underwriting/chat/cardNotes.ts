import type { CaseInput, Result } from '../types';

export function optionalDetail(c: CaseInput, result: Result): string | null {
  if (result.carrier !== 'transamerica') return null;
  const a = c.answers, d = c.details;
  if (c.conditions.includes('cancer')) {
    if (!d.taCancerType || !d.taCancerMonths || a.taCancerComplete !== 'yes') return 'Cancer type and last treatment date could change the result.';
    if (a.taCancerSpread !== 'no') return 'Cancer spread or recurrence details could change the result.';
  }
  if (c.conditions.includes('hypertension') && a.taBpControlled !== 'yes') return a.taBpControlled === 'no'
    ? 'Blood pressure is not controlled; carrier review needed.' : 'Blood pressure recognized. Control status could change the result.';
  if (c.conditions.includes('diabetes') && (!d.taDiabetesAge || !a.taInsulin12 || !a.taDiabetesComplication)) return 'Diagnosis age, insulin and complications could change the diabetes tier.';
  if (c.conditions.includes('heart_attack') && !d.taMiMonths) return 'The last heart attack date could change the result.';
  if (c.conditions.includes('heart_surgery') && !d.taSurgeryMonths) return 'The last heart procedure date could change the result.';
  if (d.oxygenMention) return 'Oxygen-use dates could change the result.';
  return null;
}
