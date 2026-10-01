import type { Extraction, NotesState } from './types';
import { clausesOf, contextStatus, diagnosisPatterns, isFamilyClause } from './phrases';
import { clinicalFacts, fact } from './clinical';
import { findMedications } from './medications';

// A compact residual vocabulary prevents an unsupported diagnosis from being
// discarded just because the same note also contains one supported diagnosis.
const filler = new Set(('a an the is are was were be been being have has had his her their she he they patient client lady man woman ' +
  'i it and or with without no not none never denies only on in at of to for since from ago years year yr yrs months month mo mos ' +
  'type diagnosed diagnosis history dx current currently used uses use taking takes take stopped discontinued off started last ' +
  'treatment treatments chemo chemotherapy radiation ended finished complete completed still past within now any all known ' +
  'insulin complications diabetic diabetes neuropathy retinopathy nephropathy oxygen o2 surgery breast prostate thyroid colon colorectal ' +
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
    for (const [id, , pattern] of diagnosisPatterns) {
      pattern.lastIndex = 0;
      const match = pattern.exec(clause);
      if (match && contextStatus(clause, match.index) === 'yes') allIds.add(id);
    }
  }
  for (const clause of clauses) {
    if (isFamilyClause(clause)) continue;
    const spans: [number, number][] = [];
    for (const [id, label, pattern] of diagnosisPatterns) {
      pattern.lastIndex = 0;
      for (const match of clause.matchAll(pattern)) {
        const suffix = clause.slice(match.index! + match[0].length);
        if (/^\s+(?:complications?|recurrence|spread|treatment)\b/i.test(suffix) && /\bno\s*$/i.test(clause.slice(0, match.index!))) continue;
        const presence = contextStatus(clause, match.index!);
        if (presence === 'family') continue;
        out.facts.push(fact('condition', id, presence, presence === 'no' ? `No ${label}` : presence === 'unknown' ? `${label} unclear` : label, clause));
        spans.push([match.index!, match.index! + match[0].length]);
      }
    }
    const drugs = findMedications(clause);
    out.medications.push(...drugs.medications); out.suggestions.push(...drugs.suggestions); spans.push(...drugs.spans);
    out.facts.push(...clinicalFacts(clause, [...allIds]));
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
    if (remainder.length) out.unresolved.push(remainder.join(' ').slice(0, 120));
  }
  out.suggestions = [...new Map(out.suggestions.map(s => [s.id, s])).values()];
  out.medications = [...new Map(out.medications.map(m => [m.id, m])).values()];
  return out;
}
