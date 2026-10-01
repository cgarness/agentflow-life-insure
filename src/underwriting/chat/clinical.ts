import type { CapturedFact } from './types';

const amount = (s: string) => Number(({ one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10' } as Record<string, string>)[s.toLowerCase()] ?? s);
export function durationMonths(s: string): number | null {
  const m = s.match(/\b(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten)\s*(years?|yrs?|months?|mos?)\b/i);
  if (!m) return null;
  const n = amount(m[1]!) * (/^(year|yr)/i.test(m[2]!) ? 12 : 1);
  return Number.isFinite(n) && n <= 1200 ? n : null;
}
export function fact(kind: CapturedFact['kind'], key: string, value: string, label: string, evidence: string): CapturedFact {
  return { id: `${kind}:${key}`, kind, key, value, label, evidence };
}
export function clinicalFacts(clause: string, ids: string[]): CapturedFact[] {
  const out: CapturedFact[] = [];
  const add = (key: string, value: string, label: string) => out.push(fact('answer', key, value, label, clause));
  const detail = (key: string, value: string, label: string) => out.push(fact('detail', key, value, label, clause));
  const unsure = /\b(maybe|possibly|unsure|not sure|might|suspected)\b/i.test(clause);
  if (/\b(?:oxygen|o2)\b/i.test(clause)) {
    if (unsure) add('oxygen12', 'unknown', 'Oxygen history unclear');
    else if (/\bnever (?:used |needed |had |been on )?(?:supplemental )?(?:oxygen|o2)\b|\bno oxygen (?:use )?(?:in |during )?(?:the )?(?:past|last) (?:year|12 months)\b/i.test(clause)) add('oxygen12', 'no', 'No oxygen in past year');
    else if (/\b(?:last used|stopped|off|discontinued)\b/i.test(clause) && durationMonths(clause) !== null) {
      const n = durationMonths(clause)!;
      add('oxygen12', n > 12 ? 'no' : n < 12 ? 'yes' : 'unknown', `Oxygen stopped ${n}mo ago`);
    } else if (/\b(?:on|uses?|using|needs?|requires?|prescribed) (?:supplemental )?(?:oxygen|o2)\b/i.test(clause) && !/\b(?:no|not|off|never)\b|\bago\b/i.test(clause)) add('oxygen12', 'yes', 'Uses supplemental oxygen');
    else detail('oxygenMention', 'yes', 'Oxygen history needs timing');
  }
  if (ids.includes('diabetes')) {
    if (/\b(?:on|takes?|using|uses?) insulin\b/i.test(clause) && !/\b(?:not|no|stopped)\b/i.test(clause)) add('taInsulin12', unsure ? 'unknown' : 'yes', 'Insulin use');
    if (/\bno insulin\b|\bnot (?:on|taking) insulin\b/i.test(clause) && !/\b(?:last|past|never)\b/i.test(clause)) detail('insulinCurrent', 'no', 'No current insulin — prior year unconfirmed');
    if (/\bnever (?:used |taken |on )?insulin\b|\bno insulin (?:in )?(?:the )?(?:past|last) (?:year|12 months)\b/i.test(clause)) add('taInsulin12', 'no', 'No insulin in past year');
    if (/\bno (?:diabetic |diabetes )?complications\b|\bwithout (?:diabetic |diabetes )?complications\b/i.test(clause)) {
      add('diabetesComplication', 'no', 'No diabetes complications'); add('taDiabetesComplication', 'no', 'No diabetes complications');
    } else if (/\b(?:neuropathy|retinopathy|nephropathy|diabet(?:ic|es) complications)\b/i.test(clause)) {
      const linked = /\b(?:diabetic (?:neuropathy|retinopathy|nephropathy)|diabetes complications|(?:neuropathy|retinopathy|nephropathy) (?:due to|from) diabetes)\b/i.test(clause) && !/\b(?:no|not)\b/i.test(clause);
      add('diabetesComplication', !unsure && linked ? 'yes' : 'unknown', linked ? 'Diabetes complication reported' : 'Confirm whether complication is diabetes-related');
      add('taDiabetesComplication', !unsure && linked ? 'yes' : 'unknown', linked ? 'Diabetes complication reported' : 'Confirm whether complication is diabetes-related');
    }
    const age = clause.match(/\b(?:diagnosed|dx|diabetes started) (?:with diabetes )?(?:at )?(?:age )?(\d{1,2})\b/i);
    if (age && !unsure) detail('taDiabetesAge', age[1]!, `Diabetes diagnosed at ${age[1]}`);
  }
  if (ids.includes('cancer')) {
    const types: [string, RegExp][] = [['breast', /\bbreast\b/i], ['prostate', /\bprostate\b/i], ['colorectal', /\b(?:colon|rectal|colorectal)\b/i],
      ['thyroid', /\bthyroid\b/i], ['bladder', /\bbladder\b/i], ['kidney', /\bkidney\b/i], ['cervical', /\bcervical\b/i],
      ['testicular', /\btesticular\b/i], ['melanoma', /\bmelanoma\b/i], ['other', /\b(?:lung|pancreatic|stomach|esophageal|ovarian)\b/i]];
    for (const [type, pattern] of types) if (pattern.test(clause)) detail('taCancerType', type, `${type === 'other' ? 'Other' : type} cancer`);
    const n = durationMonths(clause);
    const ended = /\b(?:last (?:treatment|chemo|radiation)|(?:treatment|chemo|radiation) (?:ended|finished|completed|stopped)|finished (?:treatment|chemo|radiation)|completed (?:treatment|chemo|radiation))\b/i.test(clause);
    if (ended && n !== null && !unsure) {
      detail('taCancerMonths', String(n), `Last cancer treatment ${n}mo ago`);
      add('taCancerComplete', 'yes', 'Cancer treatment complete');
    } else if (n !== null && /\bcancer\b/i.test(clause)) detail('cancerHistoryMonths', String(n), `Cancer history ${n}mo ago — treatment date unknown`);
    if (/\bno (?:cancer )?(?:spread|recurrence|return)|\b(?:never (?:spread|returned|recurred)|not (?:spread|returned|recurred))\b/i.test(clause)) {
      // "No spread" alone does not also answer recurrence.
      if (/\b(?:spread|metasta)/i.test(clause)) add('cancerNoSpread', 'yes', 'No cancer spread stated');
      if (/\b(?:recurr|return)/i.test(clause)) add('cancerNoRecurrence', 'yes', 'No cancer recurrence stated');
      // Multi-site disease is still asked; do not silently clear that factor.
    } else if (/\b(?:metastatic|metastasized|recurrent|recurred|spread|returned)\b/i.test(clause)) add('taCancerSpread', unsure ? 'unknown' : 'yes', 'Cancer spread / recurrence');
    if (/\b(?:surgery only|only surgery)\b/i.test(clause)) add('taCancerSurgeryOnly', unsure ? 'unknown' : 'yes', 'Surgery-only treatment');
    if (/\b(?:still (?:in )?treatment|currently (?:on )?(?:chemo|radiation)|active cancer)\b/i.test(clause)) add('taCancerComplete', 'no', 'Cancer treatment not complete');
  }
  if (ids.includes('liver') && /\bcirrhosis\b/i.test(clause)) detail('taLiverType', 'cirrhosis', 'Cirrhosis');
  if (ids.includes('heart_attack')) {
    if (/\b(?:single|one|1) heart attack\b/i.test(clause)) add('taMultipleMi', 'no', 'Single heart attack');
    if (/\b(?:multiple|two|three|[2-9]) heart attacks\b/i.test(clause)) add('taMultipleMi', 'yes', 'Multiple heart attacks');
    const n = durationMonths(clause);
    if (/\bheart attack\b/i.test(clause) && n !== null && !unsure) detail('taMiMonths', String(n), `Heart attack ${n}mo ago`);
  }
  if (ids.includes('heart_surgery') && /\b(?:stent|bypass|angioplasty|pacemaker|heart surgery)\b/i.test(clause)) {
    const n = durationMonths(clause);
    if (n !== null && !unsure) detail('taSurgeryMonths', String(n), `Heart procedure ${n}mo ago`);
  }
  if (ids.includes('stroke')) {
    if (/\b(?:single|one|1) tia\b/i.test(clause)) detail('taStrokeType', 'single-tia', 'Single TIA');
    else if (/\b(?:multiple|two|[2-9]) tias\b/i.test(clause)) detail('taStrokeType', 'multiple-tia', 'Multiple TIAs');
    else if (/\bstroke\b/i.test(clause) && !/mini[ -]?stroke/i.test(clause)) detail('taStrokeType', 'stroke', 'Stroke');
    const n = durationMonths(clause);
    if (n !== null && !unsure) detail('taStrokeMonths', String(n), `Stroke / TIA ${n}mo ago`);
  }
  return out;
}
