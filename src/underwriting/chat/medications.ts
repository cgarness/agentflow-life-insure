import { mutualRxExclude, mutualRxIndication, mutualRxStarred } from '../data';
import { transamericaRxExclude } from '../transamerica-data';
import type { Medication } from '../types';
import type { MedicationSuggestion } from './types';

// Spelling vocabulary only: inclusion or brand recognition NEVER implies a
// diagnosis, therapeutic equivalence, or an underwriting outcome.
const commonNames = ['Metformin', 'Glucophage', 'Insulin', 'Lantus', 'Levemir', 'Humalog', 'Novolog', 'Basaglar',
  'Tresiba', 'Ozempic', 'Mounjaro', 'Trulicity', 'Rybelsus', 'Jardiance', 'Farxiga', 'Glipizide', 'Glyburide',
  'Januvia', 'Pioglitazone', 'Actos', 'Albuterol', 'Ventolin', 'ProAir', 'Symbicort', 'Advair', 'Trelegy Ellipta',
  'Breztri Aerosphere', 'Budesonide', 'Prednisone', 'Lisinopril', 'Losartan', 'Amlodipine', 'Metoprolol',
  'Atenolol', 'Hydrochlorothiazide', 'Furosemide', 'Lasix', 'Spironolactone', 'Entresto', 'Atorvastatin',
  'Lipitor', 'Rosuvastatin', 'Crestor', 'Simvastatin', 'Pravastatin', 'Gabapentin', 'Pregabalin', 'Lyrica',
  'Duloxetine', 'Cymbalta', 'Sertraline', 'Zoloft', 'Escitalopram', 'Lexapro', 'Fluoxetine', 'Prozac',
  'Bupropion', 'Wellbutrin', 'Trazodone', 'Hydroxyzine', 'Hydralazine', 'Levothyroxine', 'Synthroid',
  'Omeprazole', 'Pantoprazole', 'Allopurinol', 'Tamsulosin', 'Finasteride', 'Montelukast', 'Singulair',
  'Meloxicam', 'Methotrexate', 'Tramadol', 'Oxycodone', 'Hydrocodone', 'Aspirin', 'Nitroglycerin',
  'Anastrozole', 'Letrozole', 'Levetiracetam', 'Keppra', 'Topiramate', 'Clonazepam', 'Alprazolam'];
export const medicationNames = [...new Map([...commonNames, ...mutualRxExclude, ...mutualRxStarred,
  ...mutualRxIndication, ...transamericaRxExclude.filter(n => n !== 'Donepazil')]
  .map(n => [n.toLowerCase(), n])).values()];
const normalized = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function editDistance(a: string, b: string): number {
  const rows: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  rows[0] = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    rows[i]![j] = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1,
      rows[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
      rows[i]![j] = Math.min(rows[i]![j]!, rows[i - 2]![j - 2]! + 1);
    }
  }
  return rows[a.length]![b.length]!;
}
export function suggestMedication(word: string): string[] {
  const term = normalized(word);
  if (term.length < 5 || term.length > 35) return [];
  const exact = medicationNames.find(n => normalized(n) === term);
  if (exact) return [exact];
  const candidates = medicationNames.map(name => ({ name, key: normalized(name) }))
    .filter(n => Math.abs(n.key.length - term.length) <= 2)
    .map(n => ({ name: n.name, distance: editDistance(term, n.key) }))
    .filter(n => n.distance <= (term.length >= 8 ? 2 : 1))
    .sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name));
  return candidates.filter(n => n.distance <= (candidates[0]?.distance ?? 0) + 1).slice(0, 3).map(n => n.name);
}
function statusFor(prefix: string): Medication['status'] {
  if (/\b(stopped|discontinued|no longer (?:takes?|taking|on)|used to take|off)\b/i.test(prefix)) return 'stopped';
  if (/\b(maybe|might|unsure|not sure|possibly)\b/i.test(prefix)) return 'unknown';
  return 'current';
}
export function findMedications(clause: string): {
  medications: Medication[]; suggestions: MedicationSuggestion[]; spans: [number, number][];
} {
  const medications: Medication[] = [], suggestions: MedicationSuggestion[] = [], spans: [number, number][] = [];
  for (const name of [...medicationNames].sort((a, b) => b.length - a.length)) {
    const re = new RegExp(`\\b${escape(name)}\\b`, 'ig');
    for (const match of clause.matchAll(re)) {
      const start = match.index!, end = start + match[0].length;
      if (spans.some(([a, b]) => start < b && end > a)) continue;
      const prefix = clause.slice(0, start);
      if (/\b(?:(?:does not|doesn't|never) (?:take|use)|no|not on)\s*$/i.test(prefix)) { spans.push([start, end]); continue; }
      medications.push({ id: normalized(name), name, status: statusFor(prefix), indication: '' });
      spans.push([start, end]);
    }
  }
  for (const match of clause.matchAll(/\b[a-z][a-z-]{4,34}\b/ig)) {
    const start = match.index!, end = start + match[0].length;
    if (spans.some(([a, b]) => start < b && end > a)) continue;
    const candidates = suggestMedication(match[0]);
    if (!candidates.length || candidates.some(n => normalized(n) === normalized(match[0]))) continue;
    suggestions.push({ id: normalized(match[0]), entered: match[0], candidates, status: statusFor(clause.slice(0, start)) });
    spans.push([start, end]);
  }
  return { medications, suggestions, spans };
}
