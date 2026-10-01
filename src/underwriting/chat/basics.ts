import { z } from 'zod';
import { states } from '../data';
import { freshCase, type CaseInput } from '../types';
import type { Basics } from './types';

const digits = z.string().regex(/^\d{1,4}$/);
export const basicsSchema = z.object({
  age: digits.refine(v => +v >= 18 && +v <= 100, 'Enter age 18–100.'),
  state: z.string().refine(v => states.includes(v), 'Choose a state.'),
  height: digits.refine(v => +v >= 48 && +v <= 90, 'Choose a height.'),
  weight: z.string().regex(/^\d{2,4}(\.\d{1,2})?$/).refine(v => +v >= 40 && +v <= 1000, 'Enter weight in pounds.'),
  smoking: z.enum(['smoker', 'nonsmoker', 'former', 'other', 'unknown']),
  quitMonths: z.string().max(4),
}).strict().superRefine((v, ctx) => {
  if (v.smoking === 'former' && (!/^\d{1,4}$/.test(v.quitMonths) || +v.quitMonths > 1200)) {
    ctx.addIssue({ code: 'custom', path: ['quitMonths'], message: 'Enter months since last nicotine use.' });
  }
});
export const noteSchema = z.string().trim().min(1, 'Add a health note.').max(3000, 'Keep each note under 3,000 characters.');
export function basicsErrors(input: Basics): Record<string, string> {
  const result = basicsSchema.safeParse(input);
  if (result.success) return {};
  return Object.fromEntries(result.error.issues.map(i => [String(i.path[0]), i.message]));
}
export function caseWithBasics(b: Basics, previous = freshCase()): CaseInput {
  basicsSchema.parse(b);
  // A nonsmoker explicitly confirms 24+ months nicotine-free in the control.
  // This represents a threshold, not a claim that the applicant never smoked.
  return { ...previous, age: b.age, state: b.state, height: b.height, weight: b.weight, face: '',
    nicotine: b.smoking === 'smoker' || b.smoking === 'other' ? 'current'
      : b.smoking === 'unknown' ? 'unknown' : 'former',
    nicotineMonths: b.smoking === 'nonsmoker' ? '24' : b.smoking === 'former' ? b.quitMonths : '',
    answers: { ...previous.answers, taTobacco12: b.smoking === 'smoker' ? 'yes'
      : b.smoking === 'nonsmoker' ? 'no' : '' },
  };
}
export function basicsSummary(b: Basics): string {
  const smoking = { smoker: 'Smoker', nonsmoker: 'Nonsmoker', former: `Quit ${b.quitMonths}mo ago`, other: 'Other nicotine', unknown: 'Smoking unknown', '': '' };
  return `${b.age} · ${b.state} · ${Math.floor(+b.height / 12)}′${+b.height % 12}″ · ${b.weight} lb · ${smoking[b.smoking]}`;
}
