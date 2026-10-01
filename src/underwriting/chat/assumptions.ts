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
  // Absence of a reported treatment/complication is the approved scenario, not
  // a confirmed historical answer. An explicit unknown or historical mention wins.
  const assumeNo = (key: string) => { if (!c.answers[key]) { c.answers[key] = 'no'; assumed.push(key); } };
  if (c.conditions.includes('diabetes')) {
    if (!c.details.insulinCurrent && !c.medications.some(m => /insulin|lantus|levemir|humalog|novolog|basaglar|tresiba/i.test(m.name))) assumeNo('taInsulin12');
    if (c.medications.some(m => /^insulin$/i.test(m.name) && m.status === 'current') && !c.answers.taInsulin12) {
      c.answers.taInsulin12 = 'yes'; assumed.push('current reported insulin treatment');
    }
    if (!c.conditions.some(id => ['kidney', 'pvd', 'amputation'].includes(id))) {
      assumeNo('diabetesComplication'); assumeNo('taDiabetesComplication');
    }
    if (!c.conditions.some(id => ['chf', 'cad', 'heart_attack', 'heart_surgery', 'stroke', 'pvd', 'kidney', 'liver'].includes(id))) assumeNo('taDiabetesRelated');
  }
  if (c.conditions.includes('cad') && !c.conditions.some(id => ['heart_attack', 'heart_surgery'].includes(id)) && !c.answers.taCadSimple) {
    c.answers.taCadSimple = 'yes'; assumed.push('no unlisted heart attack or heart surgery');
  }
  // Do NOT invent diagnosis age, cancer type/treatment dates, BP control,
  // condition relatedness, state availability, citizenship or application review.
  return { case: c, assumed };
}
