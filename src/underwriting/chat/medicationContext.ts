import { mutualRxStarred, normalizeMedication } from '../data';
import type { CaseInput, CarrierId, Medication } from '../types';

// Terminology/context, not a carrier's drug-approval list. See minimal/SOURCE_REVIEW.
// Never infer a diagnosis, efficacy, or BP control from a medication. A matching
// condition must already have been entered; an alternative stated indication wins.
const contexts: Record<string, string[]> = {
  metformin: ['diabetes'],
  insulin: ['diabetes'],
  lisinopril: ['hypertension', 'chf', 'heart_attack'],
};
export function medicationContextSupported(m: Medication, c: CaseInput): boolean {
  if (m.status !== 'current' || (/^insulin$/i.test(m.name) && c.answers.taInsulin12 === 'no')) return false;
  const allowed = contexts[normalizeMedication(m.name)];
  if (!allowed) return false;
  const present = allowed.filter(id => c.conditions.includes(id));
  // Multi-indication drugs require one unambiguous reported context. The agent
  // can still have other conditions; they must pass their own carrier rules.
  if (present.length !== 1) return false;
  return !m.indication.trim() || m.indication.toLowerCase() === present[0];
}
export function medicationsSupported(carrier: CarrierId, c: CaseInput): boolean {
  if (c.details.medicationMention || c.medicationsStatus === 'unknown') return false;
  if (!c.medications.length) return c.medicationsStatus === 'none';
  if (carrier === 'mutual') {
    // The current Living Promise guide expressly allows Graded consideration
    // for starred drugs. It does not resolve other diagnoses or drug combinations.
    return c.medications.length === 1 && c.medications[0]!.status === 'current' &&
      mutualRxStarred.some(n => normalizeMedication(n) === normalizeMedication(c.medications[0]!.name));
  }
  return c.medications.every(m => medicationContextSupported(m, c));
}
