import type { Answer, CaseInput, Evidence, Medication, Result } from '../types';

export interface Basics {
  age: string;
  state: string;
  height: string;
  weight: string;
  smoking: '' | 'smoker' | 'nonsmoker' | 'former' | 'other' | 'unknown';
  quitMonths: string;
}
export const emptyBasics = (): Basics => ({ age: '', state: '', height: '', weight: '', smoking: '', quitMonths: '' });
export interface CapturedFact {
  id: string;
  label: string;
  evidence: string;
  kind: 'condition' | 'answer' | 'detail' | 'medication' | 'history';
  key: string;
  value: string;
}
export interface MedicationSuggestion {
  id: string;
  entered: string;
  candidates: string[];
  status: Medication['status'];
}
export interface NotesState {
  case: CaseInput;
  facts: CapturedFact[];
  suggestions: MedicationSuggestion[];
  unresolved: string[];
  answered: string[];
  revision: number;
}
export interface Extraction {
  facts: CapturedFact[];
  medications: Medication[];
  suggestions: MedicationSuggestion[];
  unresolved: string[];
}
export interface ChatTurn { id: number; role: 'user' | 'assistant'; text: string }
export interface FollowupOption { label: string; value: string }
export interface Followup {
  id: string;
  text: string;
  hint?: string;
  options: FollowupOption[];
  answerKeys?: string[];
  detailKey?: string;
}
export interface QuickCard {
  carrier: Result['carrier'];
  name: string;
  product: string;
  color: 'green' | 'yellow' | 'red';
  label: 'Likely fit' | 'Possible fit' | 'Likely decline';
  tier: string;
  benefit: Result['benefit'];
  reason: string;
  evidence: Evidence[];
  gaps: string[];
  native: Result;
}
export const isAnswer = (s: string): s is Answer => ['', 'yes', 'no', 'unknown'].includes(s);
