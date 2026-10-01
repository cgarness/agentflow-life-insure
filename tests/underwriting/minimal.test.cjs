const {test}=require('node:test');
const assert=require('node:assert/strict');
const base='../../.underwriting-check/compiled/underwriting/';
const {extractNote}=require(base+'chat/parse.js');
const {freshNotes,applyExtraction}=require(base+'chat/session.js');
const {quickCards}=require(base+'chat/evaluate.js');
const {caseWithBasics}=require(base+'chat/basics.js');
const {statedHistoryScreen}=require(base+'chat/assumptions.js');
const {medicationsSupported}=require(base+'chat/medicationContext.js');
const basics={age:'65',state:'TX',height:'66',weight:'170',smoking:'nonsmoker',quitMonths:''};
const fresh=()=>({...freshNotes(),case:caseWithBasics(basics)});
const note=(text,s=fresh())=>applyExtraction(s,extractNote(text,s),text);
const cards=(s,b=basics)=>quickCards(b,s);
const one=(s,id,b=basics)=>cards(s,b).find(c=>c.carrier===id);

test('healthy stated case has a supported path for all three carriers, without attestations',()=>{
 const s=note('healthy'),before=JSON.stringify(s),out=cards(s);
 assert.deepEqual(out.map(c=>c.color),['green','green','green']);assert.equal(JSON.stringify(s),before);
 for(const key of ['moPart1','moPart2','moState','moReviewed','taReviewed','taEligibility','amState'])assert.equal(s.case.answers[key],undefined);
 assert.ok(out.every(c=>c.tier===''));assert.equal(one(s,'americo').benefit,'unconfirmed');
 assert.ok(out.every(c=>c.evidence.length>0));assert.ok(out.every(c=>c.native.status!=='candidate'));
});
for(const text of ['COPD','type 2 diabetes','diabetes and heart disease','diabetes and PVD'])test(`Americo supported pathway has no automatic source-review yellow: ${text}`,()=>{
 const c=one(note(text),'americo');assert.equal(c.color,'green');assert.equal(c.tier,'');assert.equal(c.benefit,'unconfirmed');
});
for(const text of ['type 2 diabetes','heart attack','one heart attack','stroke','stent'])test(`tier-only missing detail is not loss of carrier fit: ${text}`,()=>{
 const s=note(text),c=one(s,'transamerica');assert.equal(c.color,'green');assert.equal(c.tier,'');
 assert.equal(s.case.details.taDiabetesAge,undefined);assert.equal(s.case.details.taMiMonths,undefined);assert.equal(s.case.details.taSurgeryMonths,undefined);
});
for(const text of ['type 2 diabetes metformin','diabetes insulin','controlled hypertension lisinopril'])test(`entered medication evaluated in supported condition context: ${text}`,()=>{
 const s=note(text);assert.equal(one(s,'transamerica').color,'green');assert.ok(s.case.medications.length);
});
for(const text of ['Metformin','Insulin','Lisinopril'])test(`medication alone never supplies the missing diagnosis: ${text}`,()=>{
 const s=note(text);assert.deepEqual(s.case.conditions,[]);assert.equal(one(s,'transamerica').color,'yellow');
});
test('Living Promise starred drug uses its own published Graded pathway',()=>{
 const c=one(note('Spiriva'),'mutual');assert.equal(c.color,'green');assert.equal(c.benefit,'graded');assert.ok(c.evidence.some(e=>e.rule==='MO-RX-STAR'));
 assert.equal(one(note('Spiriva'),'mutual',{...basics,age:'81'}).color,'red');
});
test('unrecognized medication, former treatment and multiple unresolved drugs do not inherit clearance',()=>{
 for(const text of ['diabetes takes metfornin','diabetes stopped Metformin','diabetes Metformin Gabapentin'])assert.equal(one(note(text),'transamerica').color,'yellow');
});
test('supported multidiagnosis guidance is reachable without a condition-count ban',()=>{
 const s=note('COPD and Parkinsons; conditions unrelated');assert.deepEqual(s.unresolved,[]);assert.equal(s.case.answers.taUnrelated,'yes');
 assert.equal(one(s,'transamerica').color,'green');assert.equal(one(s,'americo').color,'red');
});
test('a declared unrelated label does not override documented diabetes comorbidity',()=>{
 assert.equal(one(note('diabetes and heart disease; conditions unrelated'),'transamerica').color,'yellow');
});
test('cardiac and pulmonary combination uncertainty is not silently cleared',()=>{
 assert.equal(one(note('COPD and CHF'),'transamerica').color,'yellow');assert.equal(one(note('COPD and CHF'),'americo').color,'yellow');
});
test('smoking is a classified factor, not an automatic yellow',()=>{
 assert.equal(one(note('healthy'),'transamerica',{...basics,smoking:'smoker'}).color,'green');
 assert.equal(one(note('COPD'),'transamerica',{...basics,smoking:'smoker'}).color,'green');
});
test('Americo nicotine condition ceiling still enforces the 75-year age cutoff',()=>{
 assert.equal(one(note('COPD'),'americo',{...basics,age:'76',smoking:'smoker'}).color,'red');
 assert.equal(one(note('COPD'),'americo',{...basics,age:'75',smoking:'smoker'}).color,'green');
});
test('an unavailable class in California does not invent an unavailable carrier',()=>{
 const c=one(note('healthy'),'transamerica',{...basics,state:'CA'});assert.equal(c.color,'green');assert.equal(c.tier,'');
});
test('actual age and build exclusions continue to win over green pathways',()=>{
 assert.ok(cards(note('healthy'),{...basics,age:'90'}).every(c=>c.color==='red'));
 assert.ok(cards(note('healthy'),{...basics,weight:'800'}).every(c=>c.color==='red'));
 assert.ok(cards(note('healthy'),{...basics,height:'48'}).every(c=>c.color!=='green'));
});
test('NY and explicit unavailability cannot inherit baseline green',()=>{
 const s=note('healthy');s.case.answers.moState='no';assert.equal(one(s,'mutual').color,'red');
 assert.equal(one(note('healthy'),'mutual',{...basics,state:'NY'}).color,'yellow');
});
test('published medication exclusions retain priority in otherwise supported cases',()=>{
 const s=note('diabetes Metformin Aricept');assert.equal(one(s,'transamerica').color,'red');assert.equal(one(s,'mutual').color,'red');
});
test('explicit insulin uncertainty and contradictory reports cannot become a No',()=>{
 const s=note('diabetes');s.case.answers.taInsulin12='unknown';assert.equal(one(s,'transamerica').color,'yellow');
 const c=statedHistoryScreen(note('diabetes insulin'),note('diabetes insulin').case).case;c.answers.taInsulin12='no';assert.equal(medicationsSupported('transamerica',c),false);
});
test('screen assumptions never turn missing qualifiers into sourced facts',()=>{
 const s=note('diabetes and cancer 7 years ago'),before=JSON.stringify(s),c=statedHistoryScreen(s,s.case).case;
 assert.equal(c.answers.taInsulin12,'no');assert.equal(c.answers.diabetesComplication,'no');assert.equal(JSON.stringify(s),before);
 for(const k of ['taDiabetesAge','taCancerMonths','taCancerType'])assert.equal(c.details[k],undefined);
 assert.equal(one(s,'transamerica').color,'yellow');
});
test('explicit complications override omitted-complication assumptions',()=>{
 const s=note('diabetes with diabetic neuropathy');assert.equal(statedHistoryScreen(s,s.case).case.answers.diabetesComplication,'yes');
 assert.equal(one(s,'americo').color,'yellow');
});
test('known missing BP control is not invented to satisfy a desired color',()=>{
 assert.equal(one(note('high blood pressure'),'transamerica').color,'yellow');
 assert.equal(one(note('uncontrolled high blood pressure'),'transamerica').color,'yellow');
});
test('entered unknowns remain visible to the model while native exclusions remain independent',()=>{
 const s=note('Parkinsons and zorb syndrome');assert.equal(one(s,'americo').color,'red');assert.equal(one(s,'transamerica').color,'yellow');
 assert.ok(s.unresolved.length);
});
test('a later adverse detail recomputes all carrier decisions',()=>{
 const s=note('on oxygen',note('healthy'));assert.ok(cards(s).every(c=>c.color!=='green'));assert.equal(one(s,'americo').color,'red');
});
