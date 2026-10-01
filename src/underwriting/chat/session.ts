import { freshCase, type CaseInput } from '../types';
import { fact } from './clinical';
import type { CapturedFact, Extraction, NotesState } from './types';

export const freshNotes = (): NotesState => ({ case: freshCase(), facts: [], suggestions: [], unresolved: [], answered: [], revision: 0 });
export function rebuildCase(facts: CapturedFact[], medications: CaseInput['medications'], previous: CaseInput): CaseInput {
  const c: CaseInput = { ...freshCase(), age: previous.age, state: previous.state, height: previous.height, weight: previous.weight,
    nicotine: previous.nicotine, nicotineMonths: previous.nicotineMonths,
    answers: { taTobacco12: previous.answers.taTobacco12 ?? '' } };
  c.conditions = facts.filter(f => f.kind === 'condition' && f.value === 'yes').map(f => f.key);
  for (const f of facts) {
    if (f.kind === 'answer') c.answers[f.key] = f.value as CaseInput['answers'][string];
    if (f.kind === 'detail') c.details[f.key] = f.value;
  }
  const history = (key: string) => facts.some(f => f.kind === 'history' && (f.key === key || f.key === 'complete'));
  c.conditionsStatus = c.conditions.length ? 'listed' : history('conditions') ? 'none' : 'unknown';
  c.medications = medications;
  c.medicationsStatus = medications.length ? 'listed' : history('medications') ? 'none' : 'unknown';
  c.otherCondition = '';
  return c;
}
export function applyExtraction(state: NotesState, extracted: Extraction, text: string): NotesState {
  const map = new Map(state.facts.map(f => [f.id, f]));
  if (extracted.medications.length || extracted.facts.some(f => f.kind === 'condition' && f.value === 'yes')) map.delete('history:complete');
  const unresolved = [...state.unresolved, ...extracted.unresolved];
  for (const f of extracted.facts) {
    if (f.kind === 'detail') {
      const question: Record<string, string> = { taCancerType: 'cancer-type', taCancerMonths: 'cancer-treatment', taDiabetesAge: 'diabetes-age', taMiMonths: 'heart-date', taSurgeryMonths: 'surgery-date' };
      if (question[f.key]) map.delete(`answer:unknown:${question[f.key]}`);
    }
    const old = map.get(f.id);
    // A casual later negative cannot erase an earlier adverse fact. Require a
    // clear correction (or the explicit edit control) before lowering a risk.
    if (old?.value === 'yes' && f.value === 'no' && !/\b(?:actually|correction|correct that|never had|not the client)\b/i.test(text)) {
      map.set(f.id, { ...f, value: 'unknown', label: `${f.label.replace(/^No /, '')}: conflicting notes` });
      continue;
    }
    map.set(f.id, f);
  }
  const meds = new Map(state.case.medications.map(m => [m.id, m]));
  for (const m of extracted.medications) {
    meds.set(m.id, m);
    map.set(`medication:${m.id}`, fact('medication', m.id, m.status, `${m.name}${m.status === 'stopped' ? ' (stopped)' : m.status === 'unknown' ? ' (?)' : ''}`, text));
  }
  const suggestions = new Map(state.suggestions.map(s => [s.id, s]));
  if (/\b(?:meant|correction|actually)\b/i.test(text)) {
    for (const [id, suggestion] of suggestions) if (extracted.medications.some(m => suggestion.candidates.includes(m.name))) suggestions.delete(id);
  }
  for (const s of extracted.suggestions) suggestions.set(s.id, s);
  const facts = [...map.values()];
  return { ...state, facts, case: rebuildCase(facts, [...meds.values()], state.case), suggestions: [...suggestions.values()],
    unresolved: [...new Set(unresolved)].slice(0, 20), revision: state.revision + 1 };
}
export function addFacts(state: NotesState, facts: CapturedFact[], questionId: string): NotesState {
  const next = applyExtraction(state, { facts, medications: [], suggestions: [], unresolved: [] }, 'explicit correction');
  return { ...next, answered: [...new Set([...state.answered, questionId])] };
}
export function confirmMedication(state: NotesState, suggestionId: string, name: string): NotesState {
  const suggestion = state.suggestions.find(s => s.id === suggestionId);
  if (!suggestion || !suggestion.candidates.includes(name)) return state;
  const id = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const next = applyExtraction(state, { facts: [], suggestions: [], unresolved: [], medications: [{
    id, name, status: suggestion.status, indication: '',
  }] }, `Agent confirmed “${suggestion.entered}” as ${name}.`);
  return { ...next, suggestions: next.suggestions.filter(s => s.id !== suggestionId) };
}
export function removeFact(state: NotesState, id: string): NotesState {
  const removed = state.facts.find(f => f.id === id);
  if (!removed) return state;
  let facts = state.facts.filter(f => f.id !== id);
  // Removing a diagnosis also removes its inferred follow-up context, not just
  // the display chip. Removing a negative never counts as a new No answer.
  if (removed.kind === 'condition') {
    const prefixes: Record<string, string[]> = { diabetes: ['taDiabetes', 'diabetes', 'taInsulin'], cancer: ['taCancer', 'cancerHistory'],
      hypertension: ['taBp'], heart_attack: ['taMi', 'taMultipleMi'], heart_surgery: ['taSurgery'], stroke: ['taStroke'], liver: ['taLiver'] };
    facts = facts.filter(f => !(prefixes[removed.key] ?? []).some(p => f.key.startsWith(p)));
  }
  const medications = removed.kind === 'medication' ? state.case.medications.filter(m => m.id !== removed.key) : state.case.medications;
  return { ...state, facts, case: rebuildCase(facts, medications, state.case), answered: [], revision: state.revision + 1 };
}
