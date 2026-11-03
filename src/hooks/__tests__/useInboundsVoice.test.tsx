import {act,renderHook,waitFor} from '@testing-library/react';
import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({devices:[] as Array<Record<string,unknown>>,proof:vi.fn(),token:vi.fn()}));
vi.mock('@/lib/inbounds/api',()=>({roomToken:mocks.token,roomCallState:mocks.proof}));
vi.mock('@/lib/ringtoneOutputs',()=>({applyRingtoneOutputs:vi.fn()}));
vi.mock('@twilio/voice-sdk',()=>{
 class Device{
  static State={Registered:'registered'};state='offline';events:Record<string,Function>={};audio={on:vi.fn()};
  constructor(){mocks.devices.push(this as unknown as Record<string,unknown>);}
  on(name:string,cb:Function){this.events[name]=cb;}
  register=vi.fn(async()=>{this.state='registered';this.events.registered?.();});
  destroy=vi.fn();updateToken=vi.fn();
 }
 return{Device,Call:{Codec:{Opus:'opus',PCMU:'pcmu'}}};
});
import {useInboundsVoice} from '@/hooks/useInboundsVoice';
const ID='a5000000-0000-0000-0000-000000000001',USER='a1000000-0000-0000-0000-000000000002';
function fakeCall(id:string|null=ID){const events:Record<string,Function>={};return{events,parameters:{From:'+12025550111'},customParameters:new Map(id?[['af_call_row_id',id]]:[]),on:(n:string,cb:Function)=>{events[n]=cb;},accept:vi.fn(()=>events.accept?.()),reject:vi.fn(()=>events.reject?.()),disconnect:vi.fn(()=>events.disconnect?.()),mute:vi.fn()};}
function mount(){const ready=vi.fn(),refresh=vi.fn(async()=>{});return{ready,...renderHook(()=>useInboundsVoice('a4000000-0000-0000-0000-000000000002',USER,ready,refresh))};}
beforeEach(()=>{mocks.devices.length=0;mocks.token.mockResolvedValue({token:'synthetic',identity:'ir_synthetic'});mocks.proof.mockResolvedValue({agent_id:USER,ended_at:null,dispositioned:false});Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:vi.fn(async()=>({getTracks:()=>[{stop:vi.fn()}]}))}});});
describe('room phone authority and lifecycle',()=>{
 it('rejects envelopes without a canonical call id and rejects when paused',async()=>{const h=mount();await act(()=>h.result.current.connect());const events=mocks.devices[0].events as Record<string,Function>;h.result.current.canRing.current=true;const bad=fakeCall(null);act(()=>events.incoming(bad));expect(bad.reject).toHaveBeenCalledOnce();h.result.current.canRing.current=false;const paused=fakeCall();act(()=>events.incoming(paused));expect(paused.reject).toHaveBeenCalledOnce();h.unmount();});
 it('keeps an accepted call blocked after disconnect until a server receipt exists',async()=>{const h=mount();await act(()=>h.result.current.connect());const events=mocks.devices[0].events as Record<string,Function>;h.result.current.canRing.current=true;const c=fakeCall();act(()=>events.incoming(c));act(()=>h.result.current.answer());await waitFor(()=>expect(h.result.current.awaiting).toBe(ID));act(()=>c.events.disconnect());expect(h.result.current.state).toBe('idle');expect(h.result.current.awaiting).toBe(ID);h.result.current.canRing.current=true;const next=fakeCall();act(()=>events.incoming(next));expect(next.reject).toHaveBeenCalledOnce();h.unmount();});
 it('disconnects a lost race based on server ownership without browser writes',async()=>{mocks.proof.mockResolvedValue({agent_id:'a1000000-0000-0000-0000-000000000001',ended_at:null,dispositioned:false});const h=mount();await act(()=>h.result.current.connect());h.result.current.canRing.current=true;const c=fakeCall();act(()=>(mocks.devices[0].events as Record<string,Function>).incoming(c));act(()=>h.result.current.answer());await waitFor(()=>expect(c.disconnect).toHaveBeenCalledOnce());expect(h.result.current.awaiting).toBeNull();h.unmount();});
 it('does not create a Device after an abandoned microphone request',async()=>{let release:(s:unknown)=>void=()=>{};vi.mocked(navigator.mediaDevices.getUserMedia).mockReturnValue(new Promise(r=>{release=r;}) as Promise<MediaStream>);const h=mount();let p:Promise<void>;act(()=>{p=h.result.current.connect();});h.unmount();await act(async()=>{release({getTracks:()=>[]});await p;});expect(mocks.devices).toHaveLength(0);});
});
