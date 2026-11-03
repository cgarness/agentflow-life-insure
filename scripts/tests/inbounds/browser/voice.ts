import {demo} from './client';
export const Call={Codec:{Opus:'opus',PCMU:'pcmu'}};
export class Device{
 static State={Registered:'registered'};state='offline';events={};audio={on:()=>{},isOutputSelectionSupported:false};
 constructor(){window.demoRing=()=>{const events={};const c={parameters:{From:'+1 (202) 555-0111'},customParameters:new Map([['af_call_row_id','a5000000-0000-0000-0000-000000000001']]),on:(k,fn)=>events[k]=fn,accept:()=>{demo.accept();events.accept?.();},disconnect:()=>{demo.end();events.disconnect?.();},reject:()=>events.reject?.(),mute:()=>{}};this.events.incoming?.(c);};}
 on(k,fn){this.events[k]=fn;}async register(){this.state='registered';this.events.registered?.();}destroy(){}updateToken(){}
}
