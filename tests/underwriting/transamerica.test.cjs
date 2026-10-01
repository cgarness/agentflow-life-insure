// Synthetic source regressions. These are not evidence of carrier approvals.
const {test}=require('node:test');const assert=require('node:assert/strict');
const {freshCase}=require('../../.underwriting-check/compiled/underwriting/types');
const {transamerica}=require('../../.underwriting-check/compiled/underwriting/rules/transamerica');
const {transamericaBuild,transamericaRxExclude}=require('../../.underwriting-check/compiled/underwriting/transamerica-data');
const {commissionLeaders,orderResults}=require('../../.underwriting-check/compiled/underwriting/engine');
function fixture(ids=[],patch={}){return {...freshCase(),age:'65',state:'TX',height:'70',weight:'200',face:'20000',nicotine:'never',
 conditionsStatus:ids.length?'listed':'none',conditions:ids,medicationsStatus:'none',
 answers:{oxygen12:'no',adl12:'no',hospice12:'no',mobility12:'no',pending:'no',taTobacco12:'no',
 taCurrentSupport:'no',taHospital:'no',taPending:'no',taLegal:'no',taLifestyle:'no',taUnrelated:'yes',taEligibility:'yes',taReviewed:'yes'},
 details:{taForm:'Synthetic complete application / TX'},...patch};}
const rule=(r,id)=>r.reasons.some(e=>e.rule===id);
const assessed=(ids=[],answers={},details={},patch={})=>{const c=fixture(ids,patch);Object.assign(c.answers,answers);Object.assign(c.details,details);return transamerica(c);};
test('verified Transamerica no-history case is a provisional Premier candidate',()=>assert.equal(assessed().tier,'Premier candidate'));
for(const [id,tier] of [['copd','Select'],['chf','Select'],['afib','Premier'],['ms','Select'],['lupus','Select'],['parkinson','Select']])
 test(`source single-condition ${id} -> ${tier}`,()=>assert.match(assessed([id]).tier,new RegExp('^'+tier)));
for(const id of ['als','dementia','amputation'])test(`source decline ${id} cannot be softened by build`,()=>assert.equal(assessed([id]).status,'outside'));
for(const key of ['taCurrentSupport','taHospital','taPending','taLegal']){
 test(`${key} explicit Yes excludes`,()=>assert.equal(assessed([],{[key]:'yes'}).status,'outside'));
 test(`${key} unknown prevents candidate`,()=>assert.equal(assessed([],{[key]:'unknown'}).status,'review'));
}
test('no-current-care confirmation does not erase older care-history unknowns',()=>assert.equal(assessed([],{oxygen12:'yes'}).status,'review'));
test('Americo oxygen rule never becomes a Transamerica decline',()=>assert.notEqual(assessed([],{oxygen12:'yes'}).status,'outside'));
test('generic nicotine current alone does not prove tobacco use',()=>assert.equal(assessed([],{}, {},{nicotine:'current'}).tier,'Premier candidate'));
test('actual tobacco history adds Select Tobacco factor',()=>assert.equal(assessed([],{taTobacco12:'yes'},{},{nicotine:'current'}).tier,'Select Tobacco candidate'));
test('contradictory never-nicotine and current tobacco is review',()=>assert.equal(assessed([],{taTobacco12:'yes'}).status,'review'));
test('unknown tobacco remains review',()=>assert.equal(assessed([],{taTobacco12:'unknown'}).status,'review'));
test('California does not silently receive Premier or assumed Select',()=>assert.equal(assessed([],{}, {},{state:'CA'}).status,'review'));
test('below Premier minimum does not invent a Select offer',()=>assert.equal(assessed([],{}, {},{face:'5000'}).status,'review'));
test('NY exclusion is explicit',()=>assert.equal(assessed([],{}, {},{state:'NY'}).status,'outside'));
for(const [age,face,outside] of [[75,100000,false],[76,100000,true],[76,25000,false],[85,25000,false],[86,25000,true]])
 test(`Transamerica ${age}/${face} product limits`,()=>assert.equal(assessed([],{}, {},{age:String(age),face:String(face)}).status==='outside',outside));
test('actual file has 29 measured build rows',()=>assert.equal(transamericaBuild.length,29));
for(const row of transamericaBuild){
 test(`Transamerica height ${row[0]} all ten build endpoints`,()=>{for(let b=0;b<5;b++)for(const w of [row[1+b*2],row[2+b*2]]){
  const r=assessed([],{}, {},{height:String(row[0]),weight:String(w)});
  const e=r.reasons.find(x=>x.rule==='TA-BUILD');assert.ok(e);assert.match(e.text,new RegExp(['Graded','Select','Premier','Select','Graded'][b]));
 }});
 test(`Transamerica height ${row[0]} overweight excluded`,()=>assert.equal(assessed([],{}, {},{height:String(row[0]),weight:String(row[10]+1)}).status,'outside'));
}
test('fractional weight between integer bands is not rounded into a tier',()=>assert.equal(assessed([],{}, {},{weight:'292.5'}).status,'review'));
test('underweight without explicit decline rule stays review',()=>assert.equal(assessed([],{}, {},{weight:'100'}).status,'review'));
for(const patch of [{age:'81',weight:'325'},{face:'30000',weight:'325'}])test('Graded age/amount limits '+JSON.stringify(patch),()=>assert.equal(assessed([],{}, {},patch).status,'outside'));
for(const name of transamericaRxExclude)test(`TA current Rx exclusion: ${name}`,()=>{
 const c=fixture();c.medicationsStatus='listed';c.medications=[{id:'1',name,indication:'Unknown',status:'current'}];assert.ok(rule(transamerica(c),'TA-RX'));
});
for(const status of ['stopped','unknown'])test('current Rx exclusion not generalized to '+status,()=>{
 const c=fixture();c.medicationsStatus='listed';c.medications=[{id:'1',name:'Aricept',indication:'Unknown',status}];assert.equal(transamerica(c).status,'review');
});
test('unknown Rx, dosage or synonym is not clearance or a guessed exclusion',()=>{for(const name of ['Unlisted medicine','Aricept 10mg']){
 const c=fixture();c.medicationsStatus='listed';c.medications=[{id:'1',name,indication:'Unknown',status:'current'}];assert.equal(transamerica(c).status,'review');
}});
test('multiple diagnoses without unrelated assessment remain review',()=>assert.equal(assessed(['copd','afib'],{taUnrelated:'unknown'}).status,'review'));
test('unrelated Select conditions are not arbitrarily stacked to Graded',()=>assert.equal(assessed(['copd','ms']).tier,'Select Nontobacco candidate'));
test('related-condition confirmation cannot be ignored',()=>assert.equal(assessed(['copd','afib'],{taUnrelated:'no'}).status,'review'));
for(const [months,tier] of [['11','Select'],['12',null],['13','Premier']])test(`single MI ${months} months`,()=>{
 const r=assessed(['heart_attack'],{taMultipleMi:'no'},{taMiMonths:months});if(tier)assert.match(r.tier,new RegExp('^'+tier));else assert.equal(r.status,'review');
});
test('multiple MI is Select independent of single-event timeframe',()=>assert.match(assessed(['heart_attack'],{taMultipleMi:'yes'}).tier,/^Select/));
test('single TIA is not treated as stroke',()=>assert.match(assessed(['stroke'],{},{taStrokeType:'single-tia'}).tier,/^Premier/));
test('stroke exact five-year boundary stays unknown',()=>assert.equal(assessed(['stroke'],{},{taStrokeType:'stroke',taStrokeMonths:'60'}).status,'review'));
test('missing kidney subtype does not invent a dialysis time anchor',()=>assert.equal(assessed(['kidney']).status,'review'));
test('mild kidney subtype follows its qualified row',()=>assert.match(assessed(['kidney'],{},{taKidneyType:'mild'}).tier,/^Premier/));
const diab={taInsulin12:'no',taDiabetesComplication:'no',taDiabetesRelated:'no'};
test('diabetes after 40 without listed modifiers is Premier',()=>assert.match(assessed(['diabetes'],diab,{taDiabetesAge:'50'}).tier,/^Premier/));
test('diagnosis age 40 exactly is unknown, not arbitrarily binned',()=>assert.equal(assessed(['diabetes'],diab,{taDiabetesAge:'40'}).status,'review'));
test('diagnosis before 40 is Select',()=>assert.match(assessed(['diabetes'],diab,{taDiabetesAge:'35'}).tier,/^Select/));
test('diagnosis cannot occur after current age',()=>assert.equal(assessed(['diabetes'],diab,{taDiabetesAge:'70'}).status,'review'));
test('insulin past 12 months is Select',()=>assert.match(assessed(['diabetes'],{...diab,taInsulin12:'yes'},{taDiabetesAge:'50'}).tier,/^Select/));
test('unclassified diabetic complication not flattened into eye/kidney/nerve',()=>assert.equal(assessed(['diabetes'],{...diab,diabetesComplication:'yes'},{taDiabetesAge:'50'}).status,'review'));
test('diabetes with declared cardiac comorbidity cannot be cleared as unrelated',()=>assert.equal(assessed(['diabetes','chf'],diab,{taDiabetesAge:'50'}).status,'review'));
const cancer={taCancerComplete:'yes',taCancerSpread:'no',taCancerSurgeryOnly:'yes'};
for(const [type,m,tier] of [['breast',23,'Decline'],['breast',24,'Select'],['breast',48,'Premier'],['prostate',59,'Select'],['prostate',60,'Premier'],['thyroid',24,'Premier'],['colorectal',24,'Graded'],['colorectal',48,'Select'],['colorectal',120,'Premier'],['other',48,'Select']])
 test(`${type} cancer ${m} months completed treatment -> ${tier}`,()=>{const r=assessed(['cancer'],cancer,{taCancerType:type,taCancerMonths:String(m)});if(tier==='Decline')assert.equal(r.status,'outside');else assert.match(r.tier,new RegExp('^'+tier));});
for(const type of ['cervical','testicular','melanoma'])test(`cancer ${type} surgery-only footnote enforced`,()=>assert.equal(assessed(['cancer'],{...cancer,taCancerSurgeryOnly:'no'},{taCancerType:type,taCancerMonths:'72'}).status,'review'));
test('cancer recurrence overrides older treatment',()=>assert.equal(assessed(['cancer'],{...cancer,taCancerSpread:'yes'},{taCancerType:'breast',taCancerMonths:'120'}).status,'outside'));
test('event older than applicant age is not accepted',()=>assert.equal(assessed(['heart_surgery'],{},{taSurgeryMonths:'1000'}).status,'review'));
test('candidate ranking keeps immediate ahead of Graded',()=>{const immediate=assessed(),graded=assessed([],{}, {},{weight:'325'});graded.name='AAA';assert.equal(orderResults([graded,immediate])[0].benefit,'immediate');});
test('source-based Transamerica can join a comparable immediate commission group',()=>{
 const ta=assessed(),mo={...ta,carrier:'mutual',commissionKey:'mo-level'};
 const s={basis:'first-year-commissionable-premium',reference:'Synthetic',contract:'Synthetic',effectiveFrom:'2026-01-01',effectiveTo:'2026-12-31',acknowledged:true,rates:{'ta-premier':'100','mo-level':'90'}};
 assert.deepEqual(commissionLeaders([ta,mo],s,'2026-09-30'),['transamerica']);
});

test('complete comparable schedule orders stronger supplied rate only within underwriting peers',()=>{
 const ta=assessed(),mo={...ta,carrier:'mutual',name:'Mutual of Omaha',commissionKey:'mo-level'};
 const s={basis:'first-year-commissionable-premium',reference:'Synthetic',contract:'Synthetic',effectiveFrom:'2026-01-01',effectiveTo:'2026-12-31',acknowledged:true,rates:{'ta-premier':'120','mo-level':'90'}};
 assert.equal(orderResults([mo,ta],s,'2026-09-30')[0].carrier,'transamerica');
 assert.equal(orderResults([mo,ta],s,'2027-01-01')[0].carrier,'mutual');
 mo.benefit='graded';mo.commissionGroup='graded:reviewed-state-application';s.rates['mo-level']='200';
 assert.equal(orderResults([mo,ta],s,'2026-09-30')[0].carrier,'transamerica');
});
