// Synthetic cases only. These are software regressions, not carrier approvals or clinical advice.
const {test}=require('node:test');const assert=require('node:assert/strict');
const {freshCase,freshSchedule}=require('../../.underwriting-check/compiled/underwriting/types');
const {evaluate,commissionLeaders,orderResults}=require('../../.underwriting-check/compiled/underwriting/engine');
const {nicotineClass,validateCase,validSchedule}=require('../../.underwriting-check/compiled/underwriting/validation');
const {isUnderwritingPath}=require('../../.underwriting-check/compiled/underwriting/routing');
const {americoBuild,americoKnockouts,mutualBuild}=require('../../.underwriting-check/compiled/underwriting/data');
const {dynamicQuestions}=require('../../.underwriting-check/compiled/underwriting/ui/questions');
function fixture(patch={}){return {...freshCase(),age:'65',state:'TX',height:'70',weight:'200',face:'20000',nicotine:'never',
 conditionsStatus:'none',medicationsStatus:'none',answers:{oxygen12:'no',adl12:'no',hospice12:'no',mobility12:'no',pending:'no',
 amState:'yes',moState:'yes',moReviewed:'yes',moPart1:'no',moPart2:'no'},details:{moForm:'Synthetic current-state form confirmation'},...patch};}
const result=(c,carrier='americo')=>evaluate(c).find(r=>r.carrier===carrier);
const conditionCase=(ids,patch={})=>fixture({conditionsStatus:'listed',conditions:ids,...patch});
const medCase=(name,status='current')=>fixture({medicationsStatus:'listed',medications:[{id:'test',name,indication:'Unknown',status}]});
const hasRule=(r,id)=>r.reasons.some(x=>x.rule===id);
const scope=(r)=>r.reasons.filter(x=>x.rule.startsWith('AM-CAP'));
test('fresh inputs contain no implied negative clinical answers',()=>{const c=freshCase();assert.equal(c.conditionsStatus,'');assert.equal(c.medicationsStatus,'');assert.deepEqual(c.answers,{});});
test('invalid empty case cannot evaluate',()=>assert.throws(()=>evaluate(freshCase())));
for(const [key,value] of [['age','65.2'],['age','NaN'],['age','1e2'],['weight','-1'],['face','Infinity'],['face','20000.1'],['state','ZZ'],['height','70.5']])
 test(`reject invalid ${key}=${value}`,()=>assert.ok(validateCase(fixture({[key]:value})).length));
for(const [status,months,window,expected] of [['never','',24,'no'],['current','',24,'yes'],['unknown','',24,'unknown'],['former','23',24,'yes'],['former','24',24,'no'],['former','11',12,'yes'],['former','12',12,'no']])
 test(`nicotine ${status}/${months}/${window}`,()=>assert.equal(nicotineClass(fixture({nicotine:status,nicotineMonths:months}),window),expected));
test('a former user must provide months',()=>assert.ok(validateCase(fixture({nicotine:'former'})).some(x=>x.field==='nicotineMonths')));
test('passing Americo screens does not establish Select 1',()=>{const r=result(fixture());assert.equal(r.tierKind,'unknown');assert.notEqual(r.status,'candidate');assert.match(r.gaps.join(' '),/does not establish Select 1/);});
for(const age of [39,86])test(`Americo age ${age} outside`,()=>assert.equal(result(fixture({age:String(age)})).status,'outside'));
for(const age of [40,75,76,85])test(`Americo age ${age} within general limits`,()=>assert.notEqual(result(fixture({age:String(age)})).status,'outside'));
test('Americo age 75 supports published 50k maximum',()=>assert.notEqual(result(fixture({age:'75',face:'50000'})).status,'outside'));
test('Americo age 76 cannot use 50k',()=>assert.equal(result(fixture({age:'76',face:'50000'})).status,'outside'));
test('Americo age 76 permits 40k within other checks',()=>assert.notEqual(result(fixture({age:'76',face:'40000'})).status,'outside'));
test('NY company-authorization exclusion is explicit',()=>assert.ok(hasRule(result(fixture({state:'NY'})),'AM-NY')));
for(let i=0;i<americoBuild.min.length;i++){
 const height=String(americoBuild.first+i),lo=americoBuild.min[i],hi=americoBuild.max[i];
 test(`Americo build ${height}: exact min/max included`,()=>{for(const weight of [lo,hi])assert.notEqual(result(fixture({height,weight:String(weight)})).status,'outside');});
 test(`Americo build ${height}: just outside excluded`,()=>{for(const weight of [lo-0.1,hi+0.1])assert.ok(hasRule(result(fixture({height,weight:String(weight)})),'AM-BUILD'));});
}
test('unsupported height does not use a BMI extrapolation',()=>assert.match(result(fixture({height:'80'})).gaps.join(' '),/Do not interpolate/));
for(const id of americoKnockouts)test(`Americo documented knockout ${id}`,()=>assert.ok(hasRule(result(conditionCase([id])),`AM-KO-${id}`)));
for(const key of ['oxygen12','adl12','hospice12','mobility12','pending']){
 test(`Americo safety Yes ${key} overrides potential fit`,()=>{const c=fixture();c.answers[key]='yes';assert.equal(result(c).status,'outside');});
 test(`Americo safety unknown ${key} never becomes No`,()=>{const c=fixture();c.answers[key]='unknown';assert.equal(result(c).status,'review');});
}
test('COPD + nicotine + respiratory Yes is a ceiling, not an offer',()=>{const c=conditionCase(['copd'],{nicotine:'current'});c.answers.respQuestion='yes';const r=result(c);assert.equal(r.tierKind,'ceiling');assert.match(r.tier,/Select 2 Nicotine/);assert.notEqual(r.status,'candidate');assert.equal(r.commissionKey,undefined);});
test('COPD without a confirmed respiratory question is review',()=>assert.match(result(conditionCase(['copd'],{nicotine:'current'})).gaps.join(' '),/actual Americo respiratory/));
test('COPD nonsmoker does not establish Select 1',()=>{const c=conditionCase(['copd']);c.answers.respQuestion='yes';assert.equal(result(c).tierKind,'unknown');});
test('COPD smoker older than Select 2 Nicotine age is outside documented options',()=>{const c=conditionCase(['copd'],{age:'76',nicotine:'current'});c.answers.respQuestion='yes';assert.equal(result(c).status,'outside');});
test('an oxygen knockout overrides a respiratory tier ceiling',()=>{const c=conditionCase(['copd'],{nicotine:'current'});c.answers.respQuestion='yes';c.answers.oxygen12='yes';assert.equal(result(c).status,'outside');});
for(const [id,answerKey] of [['cad','heartQuestion'],['stroke','strokeQuestion'],['copd','respQuestion']])test(`${id} smoker ceiling`,()=>{const c=conditionCase([id],{nicotine:'current'});c.answers[answerKey]='yes';assert.match(result(c).tier,/Select 2 Nicotine/);});
test('diabetes smoker summary produces ceiling',()=>assert.match(result(conditionCase(['diabetes'],{nicotine:'current'})).tier,/Select 2 Nicotine/));
test('diabetes plus confirmed heart disease nonnicotine combination',()=>{const c=conditionCase(['diabetes','cad']);c.answers.heartQuestion='yes';assert.ok(hasRule(result(c),'AM-COMBINATION'));});
test('stroke and TIA are one condition group, not two',()=>{const c=conditionCase(['stroke']);c.answers.strokeQuestion='yes';assert.ok(!hasRule(result(c),'AM-COMBINATION'));});
test('PVD and diabetes nonnicotine preserves a ceiling',()=>assert.equal(result(conditionCase(['pvd','diabetes'])).tierKind,'ceiling'));
test('diabetes complication does not invent smoker classification for a nonsmoker',()=>{const c=conditionCase(['diabetes']);c.answers.diabetesComplication='yes';const r=result(c);assert.equal(r.tierKind,'unknown');assert.match(r.gaps.join(' '),/clarification/);});
test('unknown medication never inferred as a diagnosis',()=>{const c=medCase('Unlisted drug');const before=[...c.conditions];evaluate(c);assert.deepEqual(c.conditions,before);assert.equal(result(c).status,'review');});
test('Mutual Part One Yes is not a categorical decline',()=>{const c=fixture();c.answers.moPart1='yes';const r=result(c,'mutual');assert.equal(r.status,'review');assert.ok(hasRule(r,'MO-PART1'));});
test('Mutual no application confirmation is review',()=>{const c=fixture();c.answers.moReviewed='';assert.equal(result(c,'mutual').status,'review');});
test('Mutual complete source-application affirmation supports candidate only',()=>{const r=result(fixture(),'mutual');assert.equal(r.status,'candidate');assert.equal(r.tier,'Level candidate');});
test('Mutual Part Two Yes is Graded candidate under checked limits',()=>{const c=fixture();c.answers.moPart2='yes';const r=result(c,'mutual');assert.equal(r.tier,'Graded candidate');assert.equal(r.benefit,'graded');});
for(const patch of [{age:'81'},{face:'20001'}])test(`Mutual Graded limit ${JSON.stringify(patch)}`,()=>{const c=fixture(patch);c.answers.moPart2='yes';assert.equal(result(c,'mutual').status,'outside');});
test('Mutual 5ft10 level=300 graded=316',()=>{assert.equal(mutualBuild.level[14],300);assert.equal(mutualBuild.graded[14],316);const c=fixture({weight:'301'});assert.equal(result(c,'mutual').benefit,'graded');});
test('Mutual current unstarred exact medication exclusion',()=>assert.ok(hasRule(result(medCase('Aricept'),'mutual'),'MO-RX-EXCLUDED')));
test('Mutual starred Spiriva does not become categorical exclusion or approval',()=>{const r=result(medCase('Spiriva'),'mutual');assert.equal(r.status,'review');assert.equal(r.tierKind,'ceiling');assert.ok(hasRule(r,'MO-RX-STAR'));});
test('Mutual indication list is not an exclusion table',()=>{const r=result(medCase('Eliquis'),'mutual');assert.equal(r.status,'review');assert.ok(hasRule(r,'MO-RX-INDICATION'));});
test('medication case/outer whitespace normalize, not dosage or unknown aliases',()=>{assert.ok(hasRule(result(medCase(' aricept '),'mutual'),'MO-RX-EXCLUDED'));assert.ok(!hasRule(result(medCase('Aricept XR 10 mg'),'mutual'),'MO-RX-EXCLUDED'));});
for(const status of ['stopped','unknown'])test(`excluded current-med rule does not apply to status ${status}`,()=>assert.ok(!hasRule(result(medCase('Aricept',status),'mutual'),'MO-RX-EXCLUDED')));
test('Transamerica verified source never fabricates a candidate without complete carrier-specific facts',()=>{for(const c of [fixture(),conditionCase(['copd'])]){const r=result(c,'transamerica');assert.equal(r.status,'review');assert.equal(r.commissionKey,undefined);assert.ok(r.reasons.every(e=>e.source==='TA2608'));}});
test('respiratory followups only appear for a matching module',()=>{assert.ok(!dynamicQuestions(fixture()).some(q=>q.id==='respQuestion'));assert.ok(dynamicQuestions(conditionCase(['copd'])).some(q=>q.id==='respQuestion'));});
for(const p of ['/underwriting','/underwritin','/UNDERWRITING','/underwriting/'])test(`route match ${p}`,()=>assert.equal(isUnderwritingPath(p),true));
for(const p of ['/dashboard','/underwriting-admin','/underwriting/secret','/underwriter','/'])test(`route isolation ${p}`,()=>assert.equal(isUnderwritingPath(p),false));
function schedule(rates={}){return {...freshSchedule(),reference:'Synthetic test schedule',contract:'Synthetic contract',effectiveFrom:'2026-01-01',effectiveTo:'2026-12-31',acknowledged:true,rates};}
function peer(carrier,key,patch={}){return {carrier,name:carrier,product:'Synthetic test',status:'candidate',tier:'Test candidate',tierKind:'candidate',benefit:'immediate',reasons:[],gaps:[],warnings:[],commissionKey:key,commissionGroup:'immediate:reviewed-state-application',...patch};}
const peers=[peer('americo','am-s1-n'),peer('mutual','mo-level')];
test('commission absent => no winner',()=>assert.deepEqual(commissionLeaders(peers,freshSchedule(),'2026-09-30'),[]));
test('commission missing a comparable peer => no winner',()=>assert.deepEqual(commissionLeaders(peers,schedule({'am-s1-n':'120'}),'2026-09-30'),[]));
test('commission uses rates only for a complete comparable group',()=>assert.deepEqual(commissionLeaders(peers,schedule({'am-s1-n':'120','mo-level':'100'}),'2026-09-30'),['americo']));
test('equal commissions preserve a tie',()=>assert.deepEqual(commissionLeaders(peers,schedule({'am-s1-n':'100','mo-level':'100'}),'2026-09-30'),['americo','mutual']));
test('zero is a real supplied rate, empty is not',()=>assert.deepEqual(commissionLeaders(peers,schedule({'am-s1-n':'0','mo-level':'1'}),'2026-09-30'),['mutual']));
test('expired schedule => no winner',()=>assert.deepEqual(commissionLeaders(peers,schedule({'am-s1-n':'120','mo-level':'100'}),'2027-01-01'),[]));
test('ceiling cannot receive payout badge',()=>assert.deepEqual(commissionLeaders([peer('americo','am-s1-n',{tierKind:'ceiling'}),peers[1]],schedule({'am-s1-n':'200','mo-level':'100'}),'2026-09-30'),[]));
test('immediate and graded cannot be commission peers',()=>assert.deepEqual(commissionLeaders([peers[0],peer('mutual','mo-graded',{commissionGroup:'graded:reviewed-state-application'})],schedule({'am-s1-n':'100','mo-graded':'200'}),'2026-09-30'),[]));
for(const patch of [{effectiveFrom:'2026-02-30'},{acknowledged:false},{contract:''},{basis:'advance'},{rates:{'mo-level':'301'}},{rates:{'bad-key':'1'}}])test(`invalid schedule ${JSON.stringify(patch)}`,()=>assert.equal(validSchedule({...schedule(),...patch},'2026-09-30'),false));
test('results sorting does not mutate the underlying array',()=>{const r=evaluate(fixture());const old=r.map(x=>x.carrier);orderResults(r);assert.deepEqual(r.map(x=>x.carrier),old);});
test('a declared Mutual impairment is not cleared by a generic Part One/Two summary',()=>assert.equal(result(conditionCase(['copd']),'mutual').status,'review'));
test('schedule dates consistently use the local calendar day',()=>{const {currentLocalDate}=require('../../.underwriting-check/compiled/underwriting/validation');assert.equal(currentLocalDate(new Date(2026,8,30,23,59,59)),'2026-09-30');assert.equal(currentLocalDate(new Date(2026,9,1,0,0,0)),'2026-10-01');});
test('oversized numeric strings are rejected',()=>assert.ok(validateCase(fixture({age:'0'.repeat(5000)+'65'})).length));
