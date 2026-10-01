const {test}=require('node:test');
const assert=require('node:assert/strict');
const base='../../.underwriting-check/compiled/underwriting/';
const {extractNote}=require(base+'chat/parse.js');
const {freshNotes,applyExtraction,removeFact}=require(base+'chat/session.js');
const {quickCards}=require(base+'chat/evaluate.js');
const {statedHistoryScreen}=require(base+'chat/assumptions.js');
const {caseWithBasics}=require(base+'chat/basics.js');
const {confirmConditionSpelling,correctWording}=require(base+'chat/corrections.js');
const {transamericaConditions}=require(base+'rules/transamerica-conditions.js');
const {transamerica}=require(base+'rules/transamerica.js');
const {suggestCondition}=require(base+'chat/recognition.js');
const basics={age:'65',state:'TX',height:'66',weight:'170',smoking:'nonsmoker',quitMonths:''};
const fresh=()=>({...freshNotes(),case:caseWithBasics(basics)});
const note=(text,s=fresh())=>applyExtraction(s,extractNote(text,s),text);
const cards=s=>quickCards(basics,s);
const ta=s=>cards(s).find(c=>c.carrier==='transamerica');

for(const text of ['high blood pressure','High BP','HBP','HTN','hypertension','HIGH   BLOOD   PRESSURE'])test(`recognize BP alias ${text}`,()=>{
 const s=note(text);assert.deepEqual(s.case.conditions,['hypertension']);assert.deepEqual(s.unresolved,[]);
 assert.equal(s.case.answers.taBpControlled,undefined);assert.equal(ta(s).color,'yellow');assert.match(ta(s).reason,/Control status/);
});
for(const text of ['controlled high blood pressure','well controlled hypertension','HTN controlled','high BP is controlled'])test(`explicit control qualifier ${text}`,()=>{
 const s=note(text);assert.equal(s.case.answers.taBpControlled,'yes');assert.equal(ta(s).color,'green');
 assert.ok(ta(s).evidence.some(e=>e.rule==='TA-HYPERTENSION-CONTROLLED'&&e.page==='12'));
});
for(const text of ['uncontrolled hypertension','not controlled HTN','hypertension is not controlled','poorly controlled high BP'])test(`never assume controlled ${text}`,()=>{
 const s=note(text);assert.notEqual(s.case.answers.taBpControlled,'yes');assert.notEqual(ta(s).color,'green');
});
for(const text of ['pulmonary hypertension','pulmonary arterial hypertension','pulmonary   HTN'])test(`separate pulmonary identity ${text}`,()=>{
 const s=note(text);assert.deepEqual(s.case.conditions,['pulmonary_hypertension']);assert.equal(s.case.answers.taBpControlled,undefined);
 assert.equal(transamericaConditions(s.case).factors[0].tier,'Select');assert.ok(!transamericaConditions(s.case).factors.some(f=>f.id==='TA-HYPERTENSION-CONTROLLED'));
});
for(const text of ['low blood pressure','hypotension','hypothyroidism','hyperthyroidism','high cholesterol'])test(`different common condition ${text}`,()=>{
 const s=note(text);assert.ok(!s.case.conditions.includes('hypertension'));assert.deepEqual(s.unresolved,[]);assert.equal(ta(s).color,'yellow');
 assert.match(ta(s).reason,/Condition recognized/);
});
test('negative and family BP are not positive diagnoses',()=>{
 for(const text of ['no high blood pressure','mother has hypertension'])assert.ok(!note(text).case.conditions.includes('hypertension'));
});
test('uncertain BP remains unknown under omission assumptions',()=>{
 const s=note('possible hypertension');assert.equal(s.facts[0].value,'unknown');assert.equal(ta(s).color,'yellow');
});
test('medication on its own never diagnoses hypertension',()=>assert.ok(!note('Lisinopril').case.conditions.includes('hypertension')));
test('COPD yields immediate conditional screening without a question chain',()=>{
 const s=note('COPD');assert.equal(ta(s).color,'green');assert.equal(s.case.answers.oxygen12,undefined);
 assert.ok(!s.facts.some(f=>f.kind==='history'&&f.key==='complete'));assert.equal(ta(s).native.status,'review');
});
test('assumptions are an ephemeral copy, not confirmed answers or source rules',()=>{
 const s=note('COPD'),before=JSON.stringify(s);const result=statedHistoryScreen(s,s.case);
 assert.equal(JSON.stringify(s),before);assert.notEqual(result.case,s.case);assert.equal(result.case.answers.oxygen12,'no');
 for(const key of ['taReviewed','moReviewed','amState','taEligibility','taLegal','taUnrelated'])assert.equal(result.case.answers[key],undefined);
 assert.equal(transamerica(s.case,{checkAmount:false}).status,'review');assert.equal(result.case.details.taForm,undefined);
});
test('explicit unknown and yes take precedence over omitted screening answers',()=>{
 for(const value of ['yes','unknown']){
  const s=note('COPD');s.case.answers.oxygen12=value;const c=statedHistoryScreen(s,s.case).case;
  assert.equal(c.answers.oxygen12,value);assert.notEqual(ta(s).color,'green');
 }
});
test('oxygen timing mention is not an absent screening flag',()=>{
 const s=note('COPD, had oxygen years ago');assert.notEqual(statedHistoryScreen(s,s.case).case.answers.oxygen12,'no');assert.notEqual(ta(s).color,'green');
});
test('new oxygen use invalidates a prior assumed-absent result',()=>{
 const s=note('on oxygen',note('COPD'));assert.equal(cards(s).find(c=>c.carrier==='americo').color,'red');assert.notEqual(ta(s).color,'green');
});
test('no diagnosis date, subtype or treatment date is manufactured',()=>{
 const s=note('diabetes, cancer 7 years ago');const c=statedHistoryScreen(s,s.case).case;
 for(const key of ['taDiabetesAge','taCancerType','taCancerMonths'])assert.equal(c.details[key],undefined);
 assert.equal(c.answers.taCancerComplete,undefined);assert.equal(ta(s).color,'yellow');assert.match(ta(s).reason,/Cancer type and last treatment date/);
});
test('unidentified entered history never disappears into absence',()=>{
 const s=note('COPD and zorb syndrome');assert.deepEqual(s.unresolved,['COPD and zorb syndrome']);assert.equal(ta(s).color,'yellow');
 assert.equal(ta(note('no other conditions',s)).color,'yellow');
});
test('independent source decline survives unidentified additional condition',()=>assert.equal(cards(note('Parkinsons and zorb syndrome')).find(c=>c.carrier==='americo').color,'red'));
test('generic medication mention is not assumed to mean no prescriptions',()=>{
 const s=note('controlled hypertension with meds');assert.equal(s.case.details.medicationMention,'yes');assert.notEqual(ta(s).color,'green');
});
test('condition misspelling requires an explicit verified pair',()=>{
 let s=note('controlled hypertention');assert.equal(s.case.conditions.length,0);assert.equal(ta(s).color,'yellow');
 assert.ok(suggestCondition(s.unresolved[0]).some(c=>c.replacement==='hypertension'));
 assert.equal(confirmConditionSpelling(s,s.unresolved[0],'hypertention','copd'),s);
 s=confirmConditionSpelling(s,s.unresolved[0],'hypertention','hypertension');assert.deepEqual(s.case.conditions,['hypertension']);assert.equal(ta(s).color,'green');
});
test('spelling confirmation preserves original negation and uncertainty',()=>{
 for(const [text,status] of [['possible hypertention','unknown'],['no hypertention','no']]){
  let s=note(text);s=confirmConditionSpelling(s,text,'hypertention','hypertension');
  assert.equal(s.facts.find(f=>f.key==='hypertension').value,status);assert.ok(!s.case.conditions.includes('hypertension'));
 }
});
test('similar correctly spelled different conditions are never substituted',()=>{
 assert.deepEqual(suggestCondition('hypotension'),[]);assert.deepEqual(suggestCondition('hyperthyroidism'),[]);
});
test('correcting one unknown preserves all other unresolved health history',()=>{
 const s=note('blood presure, zorb syndrome');const next=correctWording(s,'blood presure','controlled hypertension');
 assert.deepEqual(next.case.conditions,['hypertension']);assert.deepEqual(next.unresolved,['zorb syndrome']);assert.equal(ta(next).color,'yellow');
});
test('invalid wording replacement remains unresolved instead of discarded',()=>{
 const s=note('zorb syndrome');const next=correctWording(s,'zorb syndrome','another unknown');assert.ok(next.unresolved.length);assert.equal(ta(next).color,'yellow');
});
test('removing BP removes its old control qualifier',()=>{
 const s=removeFact(note('controlled hypertension'),'condition:hypertension');assert.equal(s.case.answers.taBpControlled,undefined);
});
test('no amount or hidden application attestation fabricated by instant mode',()=>{
 const s=note('COPD');for(const c of cards(s))assert.ok(!c.evidence.some(e=>e.rule.endsWith('-FACE')));
 for(const key of ['taReviewed','moReviewed','amState'])assert.equal(s.case.answers[key],undefined);
});

for(const text of ['had surgery','not healthy','takes medication','COPD?','unknown COPD'])test(`vague entered medical history cannot inherit a prior green: ${text}`,()=>{
 const s=note(text,note('COPD'));assert.equal(ta(s).color,'yellow');
});

for(const text of ['high blood pressure was controlled 7 years ago','controlled hypertension 7 years ago','hypertension controlled in 2018','controlled high blood pressure 180/120','controlled high BP 120/80'])test(`BP qualifiers cannot be silently discarded: ${text}`,()=>{
 const s=note(text);assert.equal(s.case.answers.taBpControlled,'unknown');assert.equal(ta(s).color,'yellow');
});
test('explicit current BP control without unassessed qualifiers stays supported',()=>{
 const s=note('high blood pressure is currently controlled');assert.equal(ta(s).color,'green');
 const supported=note('currently controlled hypertension');assert.equal(ta(supported).color,'green');
});
