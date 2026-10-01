export const sources = {
  AM2511: {carrier:'Americo', title:'Eagle Select Final Expense Agent Guide', version:'24-275-1 (11/25)',
    reviewed:'2026-09-30', status:'User-selected baseline; applicable state variations must be checked',
    url:'https://americofinalexpense.com/ES/FinalExpenseAgentGuide.pdf'},
  MO2604: {carrier:'Mutual of Omaha / United of Omaha', title:'Simplified Issue Life Insurance Underwriting Guide — Living Promise sections only',
    version:'618352_0426 / April 2026', reviewed:'2026-09-30', status:'Text and Living Promise build/Rx tables visually verified; current state-application mapping remains partial',
    sha256:'a2121f71c3f73fae25ca442842a4f065b310487c8031a4d53703b7394791c1e7',
    url:'https://cdn.mutualofomaha.com/assets/ad238be6-67ff-4113-821f-c6dcba1df065'},
  TA2608: {carrier:'Transamerica', title:'FE Express Solution / Graded FE Express Solution Agent Guide',
    version:'3247945R12 (08/26)', reviewed:'2026-09-30',
    status:'Direct PDF text and rendered pages agree; supported rules only, unknowns require review',
    sha256:'b6523e263b35327467bdee589c523183cab75f8cf232cc2dd5f25d92e132b48b',
    url:'https://cdn.bfldr.com/86JM1UOD/as/m7q69ngk78kw39p7w5923h/Transamerica_FE_Expres%E2%80%A6'}
} as const;
export function sourceName(id: string): string {
  return sources[id as keyof typeof sources]?.title ?? 'Implementation validation';
}
