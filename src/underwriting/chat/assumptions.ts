import type { CaseInput } from '../types';
import type { NotesState } from './types';

export const assumptionNotice = 'Based on the details entered. Unlisted conditions are assumed absent for this quick screen.';
const screens = ['oxygen12', 'adl12', 'hospice12', 'mobility12', 'pending', 'taHospital'] as const;
export function statedHistoryScreen(notes: NotesState, input: CaseInput): { case: CaseInput; assumed: string[] } {
  const c = { ...input, conditions: [...input.conditions], medications: input.medications.map(m => ({ ...m })),
    answers: { ...input.answers }, details: { ...input.details } };
  const assumed: string[] = [];
  // Unlisted screening red flags are absent in this disclosed scenario only.
  // A mentioned but unclear flag does not qualify as "unlisted".
  const mentions: Record<string, string[]> = { oxygen12: ['oxygenMention'],
    adl12: ['careNeeds'], hospice12: ['careNeeds'], mobility12: ['careNeeds'],
    pending: ['recentNeeds'], taHospital: ['recentNeeds'] };
  for (const key of screens) {
    if (!c.answers[key] && !(mentions[key] ?? []).some(k => c.details[k])) {
      c.answers[key] = 'no'; assumed.push(key);
    }
  }
  const uncertainCondition = notes.facts.some(f => f.kind === 'condition' && f.value === 'unknown');
  if (!c.conditions.length && !uncertainCondition && !notes.unresolved.length) {
    c.conditionsStatus = 'none'; assumed.push('unlisted conditions');
  }
  if (!c.medications.length && !notes.suggestions.length && !notes.unresolved.length && !c.details.medicationMention) {
    c.medicationsStatus = 'none'; assumed.push('unlisted medications');
  }
  // Do NOT fill diagnosis age, cancer type/treatment dates, BP control, insulin
  // timing, relatedness, state availability, citizenship or application review.
  return { case: c, assumed };
}
