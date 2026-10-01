import { z } from 'zod';
import { validateCase, validSchedule, currentLocalDate } from './validation';
import type { CaseInput } from './types';
const answer=z.enum(['','yes','no','unknown']);
export const underwritingSchema=z.object({
  age:z.string(),state:z.string(),height:z.string(),weight:z.string(),face:z.string(),
  nicotine:z.enum(['','never','current','former','unknown']),nicotineMonths:z.string(),
  conditionsStatus:z.enum(['','none','listed','unknown']),conditions:z.array(z.string()).max(40),otherCondition:z.string().max(250),
  medicationsStatus:z.enum(['','none','listed','unknown']),medications:z.array(z.object({
    id:z.string().max(60),name:z.string().max(100),indication:z.string().max(180),status:z.enum(['current','stopped','unknown'])
  }).strict()).max(25),answers:z.record(answer),details:z.record(z.string().max(250))
}).strict().superRefine((value,ctx)=>{
  for(const issue of validateCase(value))ctx.addIssue({code:z.ZodIssueCode.custom,path:[issue.field],message:issue.message});
});
export const scheduleSchema=z.object({basis:z.literal('first-year-commissionable-premium'),reference:z.string().max(120),
  contract:z.string().max(120),effectiveFrom:z.string(),effectiveTo:z.string(),acknowledged:z.boolean(),rates:z.record(z.string())
}).strict().superRefine((value,ctx)=>{
  if(!validSchedule(value,currentLocalDate()))ctx.addIssue({code:z.ZodIssueCode.custom,message:'Complete a valid, in-date schedule and its comparison acknowledgement.'});
});
export function validateWithZod(input:CaseInput):void {underwritingSchema.parse(input);}
