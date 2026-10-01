import { americoBuild, mutualBuild } from '../data';
import { nicotineClass } from '../validation';
import { transamericaConditions } from '../rules/transamerica-conditions';
import type { CaseInput, Evidence, Result } from '../types';
import { medicationsSupported } from './medicationContext';

export interface Placement { supported: boolean; benefit: Result['benefit']; evidence: Evidence[]; excluded?: Evidence }
const review = (): Placement => ({ supported: false, benefit: 'unconfirmed', evidence: [] });
const matched = (source: string, page: string, rule: string, text: string, benefit: Result['benefit'] = 'unconfirmed'): Placement =>
  ({ supported: true, benefit, evidence: [{ source, page, rule, text }] });
const clearScreen = (c: CaseInput) => ['oxygen12', 'adl12', 'hospice12', 'mobility12', 'pending', 'taHospital'].every(k => c.answers[k] === 'no');
const reportedRisk = (c: CaseInput, keys: string[]) => keys.some(k => c.answers[k] && c.answers[k] !== 'no');

function americoPlacement(c: CaseInput): Placement {
  if (!clearScreen(c) || nicotineClass(c, 24) === 'unknown' || !medicationsSupported('americo', c)) return review();
  const row = +c.height - americoBuild.first;
  if (americoBuild.min[row] === undefined || americoBuild.max[row] === undefined) return review();
  if (!c.conditions.length) return matched('AM2511', '5,9–10', 'AM-QUICK-BASE', 'Baseline carrier consideration under the no-reported-medical-conditions scenario; no exact tier is predicted.');
  // These are the categories the guide explicitly discusses as non-knockout
  // medical questions / available-class interactions. This is carrier-level
  // consideration, NOT the inverse claim “no Select-2 cap => Select 1”.
  const known = ['copd', 'diabetes', 'cad', 'stroke', 'pvd'];
  if (c.conditions.some(id => !known.includes(id))) return review();
  const commonCombo = c.conditions.every(id => ['cad', 'diabetes', 'stroke'].includes(id));
  const vascularCombo = c.conditions.every(id => ['pvd', 'diabetes'].includes(id));
  if (c.conditions.includes('diabetes') && c.answers.diabetesComplication !== 'no' &&
      !(vascularCombo && c.conditions.includes('pvd') && !c.answers.diabetesComplication)) return review();
  if (c.conditions.length > 1 && !commonCombo && !vascularCombo) return review();
  if (+c.age > 75 && nicotineClass(c, 24) === 'yes') return { ...review(), excluded: {
    source: 'AM2511', page: '5,9–10', rule: 'AM-QUICK-CAP-AGE',
    text: 'The reported condition plus nicotine excludes Select 1; Select 2 Nicotine and Select 3 issue ages end at 75.',
  } };
  return matched('AM2511', '9–10', 'AM-QUICK-CONSIDERATION', 'Entered case fits the guide’s described non-knockout / available-class pathway. Tier and benefit remain undetermined.');
}
function mutualPlacement(c: CaseInput, r: Result): Placement {
  if (!clearScreen(c) || c.state === 'NY' || nicotineClass(c, 12) === 'unknown' ||
      reportedRisk(c, ['moPart1']) || c.answers.moState === 'no' || !medicationsSupported('mutual', c)) return review();
  // Missing application attestations are not a medical problem. Named diagnoses
  // without current question mapping are still unresolved; never erase them.
  if (c.conditions.length || mutualBuild.min[+c.height - mutualBuild.first] === undefined) return review();
  return matched('MO2604', c.medications.length ? '9,16' : '1–2,9', 'MO-QUICK-CONSIDERATION',
    'Preliminary consideration under the no-other-reported-conditions scenario; no completed state application is asserted.',
    r.benefit === 'graded' || c.answers.moPart2 === 'yes' ? 'graded' : 'immediate');
}
function transamericaPlacement(c: CaseInput, r: Result): Placement {
  if (!clearScreen(c) || !['yes', 'no'].includes(c.answers.taTobacco12 ?? '') || !medicationsSupported('transamerica', c) ||
      reportedRisk(c, ['taCurrentSupport', 'taPending', 'taLegal', 'taLifestyle']) || c.answers.taEligibility === 'no') return review();
  const medical = transamericaConditions(c);
  // Diagnosis age / event date can affect a tier without removing every supported
  // carrier path. Do not invent their values, and do not ignore a known boundary.
  const tierOnly = (gap: string) => {
    if (gap.startsWith('Complete diabetes diagnosis age') && c.conditions.includes('diabetes')) {
      return !c.details.taDiabetesAge && ['yes', 'no'].includes(c.answers.taInsulin12 ?? '') &&
        ['yes', 'no'].includes(c.answers.taDiabetesComplication ?? '') && c.answers.taDiabetesRelated === 'no';
    }
    if (gap.startsWith('Confirm whether the heart-attack history')) return !c.answers.taMultipleMi && !c.details.taMiMonths;
    if (gap.startsWith('Single heart attack:')) return !c.details.taMiMonths;
    if (gap.startsWith('Most recent pacemaker')) return !c.details.taSurgeryMonths;
    if (gap === 'Distinguish stroke, a single TIA, and multiple TIAs.') return !c.details.taStrokeType;
    if (gap.startsWith('Stroke:') || gap.startsWith('Most recent of multiple TIAs:')) return !c.details.taStrokeMonths;
    return false;
  };
  if (medical.gaps.some(gap => !tierOnly(gap))) return review();
  // Multiple diagnoses are not automatically excluded. Published unrelated-case
  // combination guidance may be used when the relationship is actually supplied.
  // Known diabetes-comorbidity gaps above cannot be overridden by this answer.
  if (c.conditions.length > 1 && c.answers.taUnrelated !== 'yes') return review();
  if (c.answers.taUnrelated === 'no') return review();
  if (r.gaps.some(g => /build row|between published|below or between|history conflict/i.test(g))) return review();
  // A CA Premier restriction does not exclude FE Express Select. Avoid an exact
  // class claim; no price/face amount was requested in this internal quick screen.
  const benefit = r.benefit === 'graded' ? 'graded' : 'immediate';
  return matched('TA2608', '9–15,17–18', 'TA-QUICK-CONSIDERATION',
    'Carrier-level placement from supported condition/treatment ranges; missing tier-only detail is not a decline or an application attestation.', benefit);
}
export function carrierPlacement(c: CaseInput, r: Result): Placement {
  if (r.carrier === 'americo') return americoPlacement(c);
  if (r.carrier === 'mutual') return mutualPlacement(c, r);
  return transamericaPlacement(c, r);
}
