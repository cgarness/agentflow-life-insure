import { clinicalFacts, durationMonths, fact } from './clinical';
import { addFacts } from './session';
import type { CapturedFact, Followup, NotesState } from './types';
const yn = [{ label: 'No', value: 'no' }, { label: 'Yes', value: 'yes' }, { label: 'Not sure', value: 'unknown' }];
const known = (s: string | undefined) => s === 'yes' || s === 'no';
export function nextQuestions(s: NotesState): Followup[] {
  const c = s.case, a = c.answers, d = c.details, q: Followup[] = [];
  const add = (f: Followup) => { if (!s.answered.includes(f.id)) q.push(f); };
  if (s.suggestions.length) return [];
  if (!known(a.oxygen12)) add({ id: 'oxygen', text: 'Any supplemental oxygen in the past 12 months?', hint: 'CPAP alone is not supplemental oxygen.', options: yn, answerKeys: ['oxygen12'] });
  if (c.conditions.includes('cancer')) {
    if (!d.taCancerType) add({ id: 'cancer-type', text: 'What type of cancer?', options: [
      { label: 'Breast', value: 'breast' }, { label: 'Prostate', value: 'prostate' }, { label: 'Colon', value: 'colorectal' },
      { label: 'Other / type it', value: 'type' }, { label: 'Not sure', value: 'unknown' }], detailKey: 'taCancerType' });
    if (!d.taCancerMonths || a.taCancerComplete !== 'yes') add({ id: 'cancer-treatment', text: 'When did the last cancer treatment end?', hint: 'For example: “treatment ended 7 years ago.”', options: [
      { label: 'Still treating', value: 'active' }, { label: 'Not sure', value: 'unknown' }], detailKey: 'taCancerMonths' });
    if (!known(a.taCancerSpread)) add({ id: 'cancer-spread', text: 'Has the cancer spread, returned, or affected multiple sites?', options: yn, answerKeys: ['taCancerSpread'] });
    if (['testicular', 'cervical', 'melanoma'].includes(d.taCancerType ?? '') && !known(a.taCancerSurgeryOnly)) add({ id: 'cancer-surgery', text: 'Surgery only—with no chemotherapy or radiation?', options: yn, answerKeys: ['taCancerSurgeryOnly'] });
  }
  if (c.conditions.includes('diabetes')) {
    if (!known(a.taInsulin12) || !known(a.taDiabetesComplication)) add({ id: 'diabetes-treatment', text: 'Insulin in the past year, or any diabetes complications?', options: [
      { label: 'Neither', value: 'neither' }, { label: 'Insulin only', value: 'insulin' }, { label: 'Complications', value: 'complications' },
      { label: 'Both', value: 'both' }, { label: 'Not sure', value: 'unknown' }] });
    if (!d.taDiabetesAge) add({ id: 'diabetes-age', text: 'How old were they when diabetes was diagnosed?', hint: 'Type the diagnosis age, not their current age.', options: [{ label: 'Not sure', value: 'unknown' }], detailKey: 'taDiabetesAge' });
  }
  if (c.conditions.includes('heart_attack') && !d.taMiMonths) add({ id: 'heart-date', text: 'When was the most recent heart attack?', options: [{ label: 'Not sure', value: 'unknown' }], detailKey: 'taMiMonths' });
  if (c.conditions.includes('heart_attack') && !known(a.taMultipleMi)) add({ id: 'heart-count', text: 'More than one heart attack?', options: yn, answerKeys: ['taMultipleMi'] });
  if (c.conditions.includes('heart_surgery') && !d.taSurgeryMonths) add({ id: 'surgery-date', text: 'When was the last heart procedure?', options: [{ label: 'Not sure', value: 'unknown' }], detailKey: 'taSurgeryMonths' });
  if (!known(a.hospice12) || !known(a.adl12) || !known(a.mobility12)) add({ id: 'care', text: 'In the past year: hospice, home health, bed-bound status, daily-care help, or wheelchair dependence?', options: yn });
  if (!known(a.pending) || !known(a.taHospital)) add({ id: 'recent', text: 'Any hospital stays, unfinished tests, procedures or results in the past year?', options: yn });
  if (!s.facts.some(f => f.kind === 'history' && f.key === 'complete')) add({ id: 'complete', text: 'Any other health conditions or medications?', options: [
    { label: 'Nothing else', value: 'no' }, { label: 'Add details', value: 'type' }, { label: 'Not sure', value: 'unknown' }] });
  return q.slice(0, 2);
}
export function answerQuestion(state: NotesState, q: Followup, value: string): NotesState {
  if (value === 'type') return state;
  const facts: CapturedFact[] = [], evidence = `Agent answer to “${q.text}”: ${value}`;
  const a = (key: string, v: string, label: string) => facts.push(fact('answer', key, v, label, evidence));
  const d = (key: string, v: string, label: string) => facts.push(fact('detail', key, v, label, evidence));
  if (q.answerKeys) {
    if (!yn.some(o => o.value === value)) return state;
    for (const key of q.answerKeys) a(key, value, `${q.id === 'oxygen' ? 'Oxygen (12mo)' : q.text.replace(/\?$/, '')}: ${value}`);
  } else if (q.id === 'diabetes-treatment') {
    if (!['neither', 'insulin', 'complications', 'both', 'unknown'].includes(value)) return state;
    const insulin = value === 'unknown' ? 'unknown' : ['insulin', 'both'].includes(value) ? 'yes' : 'no';
    // “Complications” does not imply no insulin; ask/retain uncertainty.
    a('taInsulin12', value === 'complications' ? 'unknown' : insulin, `Insulin (12mo): ${value === 'complications' ? 'unknown' : insulin}`);
    const complication = value === 'unknown' ? 'unknown' : ['complications', 'both'].includes(value) ? 'yes' : 'no';
    a('taDiabetesComplication', complication, `Diabetes complications: ${complication}`);
    a('diabetesComplication', complication, `Diabetes complications: ${complication}`);
  } else if (q.id === 'care') {
    if (!yn.some(o => o.value === value)) return state;
    for (const key of ['hospice12', 'adl12', 'mobility12']) a(key, value === 'no' ? 'no' : 'unknown', value === 'no' ? 'No listed care needs in past year' : 'Care details need review');
    if (value === 'yes') d('careNeeds', 'yes', 'Care needs reported — specify in chat');
  } else if (q.id === 'recent') {
    if (!yn.some(o => o.value === value)) return state;
    for (const key of ['pending', 'taHospital']) a(key, value === 'no' ? 'no' : 'unknown', value === 'no' ? 'No hospital stays or pending work in past year' : 'Hospital / pending work needs detail');
    if (value === 'yes') d('recentNeeds', 'yes', 'Hospital / pending work reported — specify in chat');
  } else if (q.id === 'complete') {
    if (value === 'no') facts.push(fact('history', 'complete', 'yes', 'No other conditions or medications reported', evidence));
    else if (value === 'unknown') a('historyUnknown', 'unknown', 'Full history not confirmed');
    else return state;
  } else if (q.detailKey && value !== 'unknown') {
    if (q.id === 'cancer-treatment' && value === 'active') a('taCancerComplete', 'no', 'Cancer treatment ongoing');
    else if (q.id === 'cancer-type') {
      const parsed = clinicalFacts(`${value} cancer`, ['cancer']).find(f => f.key === 'taCancerType');
      if (parsed) facts.push(parsed); else if (['breast', 'prostate', 'colorectal'].includes(value)) d(q.detailKey, value, `${value} cancer`); else return state;
    } else if (q.id === 'diabetes-age') {
      if (!/^\d{1,2}$/.test(value) || +value > +state.case.age) return state;
      d(q.detailKey, value, `Diabetes diagnosed at ${value}`);
    } else {
      const n = durationMonths(value);
      if (n === null || n > +state.case.age * 12) return state;
      d(q.detailKey, String(n), `${q.id === 'cancer-treatment' ? 'Last cancer treatment' : 'Last event'} ${n}mo ago`);
      if (q.id === 'cancer-treatment') a('taCancerComplete', 'yes', 'Cancer treatment complete');
    }
  } else if (value === 'unknown') a(`unknown:${q.id}`, 'unknown', `${q.text.replace(/\?$/, '')}: not sure`);
  else return state;
  return addFacts(state, facts, q.id);
}
export function contextualReply(s: NotesState, text: string, questions: Followup[]): NotesState | null {
  const lower = text.trim().toLowerCase();
  if (/^(?:no|yes|not sure|unknown)$/.test(lower) && questions.length === 1) return answerQuestion(s, questions[0]!, lower === 'not sure' ? 'unknown' : lower);
  if (/^(?:no to both|neither|both no)$/.test(lower) && questions.length === 2 && questions.every(q => !!q.answerKeys || ['care', 'recent'].includes(q.id))) {
    return questions.reduce((next, q) => answerQuestion(next, q, 'no'), s);
  }
  const numeric = questions.filter(q => !!q.detailKey && q.id !== 'cancer-type');
  if (numeric.length === 1 && /^(?:\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten)(?:\s+(?:years?|yrs?|months?|mos?)(?:\s+ago)?)?$/i.test(lower)) {
    const next = answerQuestion(s, numeric[0]!, lower);
    return next === s ? null : next;
  }
  return null;
}
