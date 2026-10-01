import { extractNote } from './parse';
import { applyExtraction } from './session';
import { replaceConditionSpelling } from './recognition';
import type { NotesState } from './types';

export function correctWording(state: NotesState, original: string, replacement: string): NotesState {
  if (!state.unresolved.includes(original) || !replacement.trim()) return state;
  const extraction = extractNote(replacement, state);
  if (!extraction.facts.length && !extraction.medications.length && !extraction.suggestions.length && !extraction.unresolved.length) return state;
  // Only the explicitly edited clause is replaced; unrelated unresolved facts
  // remain. An unsuccessful correction stays unresolved rather than vanishing.
  const base = { ...state, unresolved: state.unresolved.filter(s => s !== original) };
  return applyExtraction(base, extraction, `Explicit correction: ${replacement}`);
}
export function confirmConditionSpelling(state: NotesState, original: string, entered: string, replacement: string): NotesState {
  const corrected = replaceConditionSpelling(original, entered, replacement);
  return corrected === null ? state : correctWording(state, original, corrected);
}
