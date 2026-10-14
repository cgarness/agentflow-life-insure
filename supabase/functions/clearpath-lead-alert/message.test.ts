import {message,validDetails,fieldLimits,type Details} from './message.ts';
function assert(v:unknown){if(!v)throw new Error('assertion failed');}
Deno.test('owner alert: labeled lines, omitted blanks, no footer, bounded complete fields',()=>{
 const details={name:'Test\nExample',phone:'202-555-0100',email:'',coverage:'$50,000',goal:'Covering funeral expenses',bestTime:'Morning - America/Los_Angeles',verified:'Yes'};
 assert(validDetails(details));
 const text=message('test','lead',details);
 assert(text.startsWith('NEW VET LEAD\n- Name: Test Example\n- Phone: 202-555-0100'));
 assert(text.includes('\n- Coverage requested: $50,000'));
 assert(!text.includes('Email:')&&!text.includes('STOP')&&!text.includes('opt out'));
 const max=Object.fromEntries(Object.entries(fieldLimits).map(([k,n])=>[k,'x'.repeat(n)])) as Details;
 assert(validDetails(max));assert(message('test','lead',max).length<=1600);
 assert(!validDetails({...details,to:'another-recipient'}));
 assert(!validDetails({...details,phone:123}));assert(!validDetails([]));
 assert(message('test','test').includes('TEST:'));
});
