import { diagnosisPatterns, contextStatus } from './phrases';
import { fact } from './clinical';
import { editDistance, medicationNames } from './medications';
import type { CapturedFact } from './types';

export function diagnosesIn(clause: string) {
  const matches = diagnosisPatterns.flatMap(([id, label, pattern]) => {
    pattern.lastIndex = 0;
    return [...clause.matchAll(pattern)].map(m => ({ id, label, index: m.index!, text: m[0] }));
  }).sort((a, b) => b.text.length - a.text.length || a.index - b.index);
  const selected: typeof matches = [];
  for (const m of matches) {
    if (!selected.some(x => m.index < x.index + x.text.length && m.index + m.text.length > x.index)) selected.push(m);
  }
  return selected.sort((a, b) => a.index - b.index);
}

// Recognition never supplies the missing "controlled" qualification.
export function bloodPressureFacts(clause: string, ids: string[]): CapturedFact[] {
  if (!ids.includes('hypertension')) return [];
  const terms = diagnosesIn(clause).filter(m => m.id === 'hypertension');
  const anchor = terms[0] ?? (clause.match(/\b(?:blood pressure|bp)\b/i)
    ? { index: clause.search(/\b(?:blood pressure|bp)\b/i), text: clause.match(/\b(?:blood pressure|bp)\b/i)![0] } : null);
  if (!anchor || /\bpulmonary\b/i.test(clause)) return [];
  const before = clause.slice(0, anchor.index), after = clause.slice(anchor.index + anchor.text.length);
  const bad = /\b(?:uncontrolled|poorly controlled|not(?: well)? controlled)\s*$/i.test(before) ||
    /^\s*(?:(?:is|was|remains)\s+|:\s*)?(?:currently\s+)?(?:uncontrolled|poorly controlled|not(?: well)? controlled)\b/i.test(after);
  const good = /\b(?:well[ -]?)?controlled\s*$/i.test(before) || /^\s*(?:(?:is|was|remains)\s+|:\s*)?(?:currently\s+)?(?:well[ -]?)?controlled\b/i.test(after);
  if (!bad && !good) return [];
  const historical = /\b(?:was|previously|formerly|used to be)\b/i.test(clause) ||
    /\b(?:ago|in\s+(?:19|20)\d{2})\b/i.test(clause);
  // No source thresholds were approved for numerical BP measurements. Do not
  // silently ignore a reading or use historical control as current clearance.
  const measurement = /\b\d{2,3}\s*\/\s*\d{2,3}\b/.test(clause);
  const uncertain = historical || measurement || /\b(?:unsure|not sure|maybe|possible|possibly|might|unknown|if)\b/i.test(clause);
  const value = uncertain ? 'unknown' : bad ? 'no' : 'yes';
  return [fact('answer', 'taBpControlled', value, value === 'yes' ? 'Blood pressure controlled' :
    value === 'no' ? 'Blood pressure not controlled' : 'Blood pressure control unclear', clause)];
}

export interface ConditionSuggestion { entered: string; replacement: string; label: string }
const spellingTerms: [string, string][] = [
  ['hypertension', 'High blood pressure'], ['diabetes', 'Diabetes'], ['emphysema', 'Emphysema'],
  ['asthma', 'Asthma'], ['hypotension', 'Low blood pressure'], ['hypothyroidism', 'Underactive thyroid'],
  ['hyperthyroidism', 'Overactive thyroid'], ['hyperlipidemia', 'High cholesterol'], ['arthritis', 'Arthritis'],
  ['parkinsons', 'Parkinson’s'], ['dementia', 'Dementia'], ['cirrhosis', 'Cirrhosis'], ['leukemia', 'Leukemia'],
];
export function suggestCondition(text: string): ConditionSuggestion[] {
  const knownSpans = diagnosesIn(text), suggestions: (ConditionSuggestion & { distance: number })[] = [];
  for (const match of text.matchAll(/\b[a-z]{5,30}\b/gi)) {
    const word = match[0].toLowerCase(), start = match.index!;
    if (knownSpans.some(m => start >= m.index && start < m.index + m.text.length) ||
      medicationNames.some(n => n.toLowerCase() === word) || spellingTerms.some(([term]) => term === word)) continue;
    for (const [term, label] of spellingTerms) {
      if (Math.abs(term.length - word.length) > 2) continue;
      const distance = editDistance(word, term);
      if (distance > 0 && distance <= (word.length >= 8 ? 2 : 1)) suggestions.push({ entered: match[0], replacement: term, label, distance });
    }
  }
  return suggestions.sort((a, b) => a.distance - b.distance).slice(0, 3);
}
export function replaceConditionSpelling(text: string, entered: string, replacement: string): string | null {
  // Revalidate the suggested pair and replace only that literal word. The
  // original negation/uncertainty and all other case words remain intact.
  if (!suggestCondition(text).some(s => s.entered === entered && s.replacement === replacement)) return null;
  const escaped = entered.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`\\b${escaped}\\b`, 'g'), replacement);
}
export { contextStatus };
