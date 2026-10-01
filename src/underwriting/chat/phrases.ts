// Deliberately bounded phrase recognizer. Unsupported or uncertain text is not
// claimed to have been understood by a general-purpose language model.
export const diagnosisPatterns: [string, string, RegExp][] = [
  ['copd', 'COPD', /\b(?:copd|emphysema|chronic bronchitis)\b/gi],
  ['asthma', 'Asthma', /\basthma\b/gi],
  ['diabetes', 'Diabetes', /\b(?:type\s*[12]\s*diabet(?:es|ic)|diabet(?:es|ic)|t[12]d(?:m)?)\b/gi],
  ['chf', 'Heart failure', /\b(?:chf|congestive heart failure|heart failure)\b/gi],
  ['cad', 'Heart disease', /\b(?:cad|coronary (?:artery )?(?:disease|heart disease)|heart disease)\b/gi],
  ['heart_attack', 'Heart attack', /\b(?:heart attacks?|myocardial infarction)\b/gi],
  ['heart_surgery', 'Stent / heart surgery', /\b(?:stents?|bypass|angioplasty|heart surgery|pacemaker|valve replacement)\b/gi],
  ['afib', 'AFib', /\b(?:a[ -]?fib|atrial fibrillation)\b/gi],
  ['stroke', 'Stroke / TIA', /\b(?:strokes?|tias?|transient ischemic attack|mini[ -]?stroke)\b/gi],
  ['pvd', 'PVD / PAD', /\b(?:pvd|pad|peripheral (?:vascular|arterial|artery) disease)\b/gi],
  ['kidney', 'Kidney disease', /\b(?:ckd|kidney (?:disease|failure)|renal (?:disease|failure)|dialysis)\b/gi],
  ['leukemia', 'Leukemia', /\bleuk[ae]emia\b/gi],
  ['liver', 'Liver disease', /\b(?:liver (?:disease|failure)|cirrhosis|hepatitis(?:\s+[abc])?)\b/gi],
  ['cancer', 'Cancer history', /\b(?:cancer|melanoma|carcinoma|lymphoma)\b/gi],
  ['transplant', 'Transplant', /\b(?:organ|tissue|heart|liver|lung|kidney|bone marrow)?\s*transplant\b/gi],
  ['ms', 'Multiple sclerosis', /\bmultiple sclerosis\b/gi],
  ['lupus', 'Systemic lupus', /\bsystemic lupus\b/gi],
  ['als', 'ALS', /\b(?:als|lou gehrig(?:'s|s)? disease)\b/gi],
  ['dementia', 'Dementia / Alzheimer’s', /\b(?:dementia|alzheimer(?:'s|s)?)\b/gi],
  ['huntington', 'Huntington’s', /\bhuntington(?:'s|s)?\b/gi],
  ['brain_tumor', 'Brain tumor', /\bbrain tumou?r\b/gi],
  ['parkinson', 'Parkinson’s', /\bparkinson(?:'s|s)?\b/gi],
  ['sleep_apnea', 'Sleep apnea', /\bsleep apn(?:ea|oea)\b/gi],
  ['mental', 'Mental health history', /\b(?:bipolar|schizophrenia|depression|ptsd|anxiety)\b/gi],
];
export function contextStatus(clause: string, start: number): 'yes' | 'no' | 'unknown' | 'family' {
  const prefix = clause.slice(0, start).toLowerCase();
  if (/\b(?:mother|father|sister|brother|parent|family history|husband|wife)\b/.test(prefix)) return 'family';
  if (/\b(?:maybe|possible|possibly|might|suspected|unsure|not sure|rule out|waiting to see)\b/.test(prefix)) return 'unknown';
  const afterNegation = prefix.match(/\b(?:no|never|denies|without|does not have|doesn't have)\b(.*)$/);
  // A positive verb ends the scope: “no insulin but has COPD”.
  if (afterNegation && !/\b(?:but|has|had|with|takes?|taking|on)\b/.test(afterNegation[1] ?? '')) return 'no';
  return 'yes';
}
export const isFamilyClause = (s: string) => /\b(?:family history|(?:her|his|their|my)\s+(?:mother|father|sister|brother|parent|husband|wife)|mother|father)\b/i.test(s);
export const normalizedNote = (s: string) => s.replace(/[’‘]/g, "'").replace(/[–—]/g, '-').trim();
export function clausesOf(text: string): string[] {
  return normalizedNote(text).split(/[,;\n.!?]+|\bbut\b/i).map(s => s.trim()).filter(Boolean);
}
