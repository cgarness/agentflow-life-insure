import type { Extraction, NotesState } from './types';
import { clausesOf, contextStatus, isFamilyClause } from './phrases';
import { diagnosesIn, bloodPressureFacts } from './recognition';
import { clinicalFacts, fact } from './clinical';
import { findMedications } from './medications';

// A compact residual vocabulary prevents an unsupported diagnosis from being
// discarded just because the same note also contains one supported diagnosis.
const filler = new Set(('a an the is are was were be been being have has had his her their she he they patient client lady man woman ' +
  'i it and or with without no not none never denies only on in at of to for since from ago years year yr yrs months month mo mos ' +
  'type diagnosed diagnosis history dx current currently used uses use taking takes take stopped discontinued off started last ' +
  'treatment treatments chemo chemotherapy radiation ended finished complete completed still past within now any all known ' +
  'bp blood pressure is poorly uncontrolled if insulin complications diabetic diabetes neuropathy retinopathy nephropathy oxygen o2 surgery breast prostate thyroid colon colorectal ' +
  'bladder kidney cervical testicular melanoma lung pancreatic stomach ovarian spread recurrence recurrent metastasized returned ' +
  'single multiple one two three four five six seven eight nine ten age first actually correction no longer nothing else ' +
  'healthy good health medications medication meds pills daily mg mcg units well controlled control stable some also otherwise please check assess recommend recommendation can you would like meant clarify put ' +
  'per day every week weekly as needed inhaler inhalers cancer free 2 1 monthsago yearsago').split(/\s+/));
function residual(clause: string, spans: [number, number][]): string[] {
  let s = clause;
  for (const [start, end] of [...spans].sort((a, b) => b[0] - a[0])) s = s.slice(0, start) + ' '.repeat(end - start) + s.slice(end);
  return [...new Set((s.toLowerCase().match(/[a-z][a-z'-]*/g) ?? []).filter(w => !filler.has(w)))];
}
export function extractNote(text: string, previous: NotesState): Extraction {
  const out: Extraction = { facts: [], medications: [], suggestions: [], unresolved: [] };
  const clauses = clausesOf(text);
  const allIds = new Set(previous.case.conditions);
  for (const clause of clauses) {
    if (isFamilyClause(clause)) continue;
    for (const match of diagnosesIn(clause)) {
      if (contextStatus(clause, match.index) === 'yes') allIds.add(match.id);
    }
  }
  for (const clause of clauses) {
    if (isFamilyClause(clause)) continue;
    const factsBefore = out.facts.length;
    const spans: [number, number][] = [];
    for (const match of diagnosesIn(clause)) {
      const suffix = clause.slice(match.index + match.text.length);
      if (/^\s+(?:complications?|recurrence|spread|treatment)\b/i.test(suffix) && /\bno\s*$/i.test(clause.slice(0, match.index))) continue;
      const presence = /\?/.test(text) ? 'unknown' : contextStatus(clause, match.index);
      if (presence === 'family') continue;
      out.facts.push(fact('condition', match.id, presence, presence === 'no' ? `No ${match.label}` : presence === 'unknown' ? `${match.label} unclear` : match.label, clause));
      spans.push([match.index, match.index + match.text.length]);
    }
    const drugs = findMedications(clause);
    out.medications.push(...drugs.medications); out.suggestions.push(...drugs.suggestions); spans.push(...drugs.spans);
    out.facts.push(...clinicalFacts(clause, [...allIds]), ...bloodPressureFacts(clause, [...allIds]));
    if (/\b(?:on|takes?|taking|with|uses?) (?:\w+ )?(?:meds|medications?|pills|prescriptions)\b/i.test(clause) &&
      !drugs.medications.length && !/\b(?:no|not|none|never)\b/i.test(clause)) {
      out.facts.push(fact('detail', 'medicationMention', 'yes', 'Medication name not provided', clause));
    }
    if (/\b(?:no (?:known )?(?:health (?:issues|conditions)|conditions|diagnoses|medical history)|healthy|good health)\b/i.test(clause) && !/\b(?:not|isn't|unsure|not sure|might)\b/i.test(clause)) {
      out.facts.push(fact('history', 'conditions', 'complete', 'Health history stated', clause));
    }
    if (/\b(?:no (?:other )?(?:medications|meds|prescriptions)|takes? nothing|not (?:on|taking) (?:any )?(?:meds|medications))\b/i.test(clause)) {
      out.facts.push(fact('history', 'medications', 'complete', 'Medication history stated', clause));
    }
    if (/^(?:nothing else|no other (?:health )?(?:conditions|issues) (?:or|and) (?:medications|meds))[.! ]*$/i.test(clause)) {
      out.facts.push(fact('history', 'complete', 'yes', 'No other health issues or medications reported', clause));
    }
    const remainder = residual(clause, spans);
    const uncapturedClinical = out.facts.length === factsBefore && !drugs.medications.length && !drugs.suggestions.length &&
      /\b(?:surgery|treatment|unhealthy|not healthy|medications?|insulin|chemo|radiation)\b/i.test(clause);
    if (remainder.length || uncapturedClinical) out.unresolved.push(clause);
  }
  out.suggestions = [...new Map(out.suggestions.map(s => [s.id, s])).values()];
  out.medications = [...new Map(out.medications.map(m => [m.id, m])).values()];
  return out;
}
