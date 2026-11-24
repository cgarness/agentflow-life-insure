import {describe,it,expect} from 'vitest';
import {createPendingSmsStore} from '../pendingSmsStore';
import {manualSmsRequestBody} from '../sendManualSms';
import { classifySmsResponse } from '../smsSendResult';
const org='10000000-0000-4000-8000-000000000001',actor='20000000-0000-4000-8000-000000000002',contact='30000000-0000-4000-8000-000000000001';
const number='40000000-0000-4000-8000-000000000001',alternate='40000000-0000-4000-8000-000000000002';
const base={organizationId:org,actorId:actor,viewerId:actor,contactId:contact,contactType:'lead' as const,to:'+12025550101',body:'Synthetic',senderPreference:'+12025551111',expectedSenderId:number,overrideSenderId:null};
describe('sticky sender intent and immutable handoff',()=>{
 it('never mutates the request snapshot when the UI changes sender',()=>{const store=createPendingSmsStore();store.bindAuthority({realUserId:actor,organizationId:org,impersonating:false});const input={...base};const result=store.begin(input);if(!('record'in result))throw Error(result.refusal);input.expectedSenderId=alternate;expect(manualSmsRequestBody(result.record.snapshot).expected_sender_id).toBe(number);});
 it('reuses the immutable unresolved request after only a default change',()=>{const store=createPendingSmsStore();store.bindAuthority({realUserId:actor,organizationId:org,impersonating:false});const r=store.begin(base);if(!('record'in r))throw Error(r.refusal);store.settle(r.record.localId,r.record.attemptId,{state:'uncertain',reason:'transport',code:'TRANSPORT',message:'Synthetic timeout'});const retry=store.begin({...base,expectedSenderId:alternate,senderPreference:'+12025552222'});if(!('record'in retry))throw Error(retry.refusal);expect(retry.record.snapshot.requestId).toBe(r.record.snapshot.requestId);expect(retry.record.snapshot.expectedSenderId).toBe(number);});
 it('does not turn an uncertain message into a fresh override attempt',()=>{const store=createPendingSmsStore();store.bindAuthority({realUserId:actor,organizationId:org,impersonating:false});const r=store.begin(base);if(!('record'in r))throw Error(r.refusal);store.settle(r.record.localId,r.record.attemptId,{state:'uncertain',reason:'transport',code:'TRANSPORT',message:'Synthetic timeout'});const one=store.begin({...base,expectedSenderId:alternate,overrideSenderId:alternate});expect(one).toMatchObject({ok:false,refusal:'duplicate_unresolved'});});
});

describe("first selected SMS sender", () => {
  const first = { ...base, firstUse: { senderId: number, generation: 0 } };
  const timeout = { state: "uncertain", reason: "transport", code: "TRANSPORT", message: "Synthetic timeout" } as const;

  function beginFirst() {
    const store = createPendingSmsStore();
    store.bindAuthority({ realUserId: actor, organizationId: org, impersonating: false });
    const input = { ...first, firstUse: { ...first.firstUse } };
    const result = store.begin(input);
    if (!("record" in result)) throw Error(result.refusal);
    return { store, input, record: result.record };
  }

  it("keeps the original first sender and generation through a retry, including generation zero", () => {
    const { store, input, record } = beginFirst();
    input.firstUse.senderId = alternate;
    input.firstUse.generation = 2;
    const wire = manualSmsRequestBody(record.snapshot);
    expect(wire).toMatchObject({
      expected_sender_id: number, from: base.senderPreference,
      first_use: { sender_id: number, generation: 0, body: base.body },
    });
    expect(wire).not.toHaveProperty("override_sender_id");
    expect(wire).not.toHaveProperty("body");
    store.settle(record.localId, record.attemptId, timeout);
    const retry = store.begin(first);
    if (!("record" in retry)) throw Error(retry.refusal);
    expect(manualSmsRequestBody(retry.record.snapshot)).toEqual(wire);
  });

  it.each([
    ["ordinary same sender", base],
    ["one-time same sender", { ...base, overrideSenderId: number }],
    ["later generation", { ...first, firstUse: { senderId: number, generation: 1 } }],
    ["different number", { ...first, expectedSenderId: alternate, firstUse: { senderId: alternate, generation: 0 } }],
  ] as const)("refuses to turn an uncertain first send into a new %s attempt", (_, next) => {
    const { store, record } = beginFirst();
    store.settle(record.localId, record.attemptId, timeout);
    expect(store.begin(next)).toEqual({ ok: false, refusal: "duplicate_unresolved" });
    expect(store.getSnapshot()).toHaveLength(1);
  });

  it("settles an uncertain first request after the server proves rejection, and starts a new key only on explicit send", () => {
    const { store, record } = beginFirst();
    store.settle(record.localId, record.attemptId, timeout);
    const replay = store.begin(first);
    if (!("record" in replay)) throw Error(replay.refusal);
    expect(replay.record.snapshot.requestId).toBe(record.snapshot.requestId);
    const rejected = classifySmsResponse(409, JSON.stringify({ success: false, code: "FIRST_CONTACT_REJECTED" }), true);
    const settled = store.settle(replay.record.localId, replay.record.attemptId, rejected);
    expect(settled).toMatchObject({ state: "not_sent", uncertainty: null, attempts: 2 });
    expect(store.getSnapshot()).toHaveLength(1);
    expect(store.intentCount).toBe(0);
    const explicitNewSend = store.begin(first);
    if (!("record" in explicitNewSend)) throw Error(explicitNewSend.refusal);
    expect(explicitNewSend.record.snapshot.requestId).not.toBe(record.snapshot.requestId);
  });

  it("keeps the legacy body for old requests and refuses to upgrade an uncertain ordinary send", () => {
    const store = createPendingSmsStore();
    store.bindAuthority({ realUserId: actor, organizationId: org, impersonating: false });
    const ordinary = store.begin(base);
    if (!("record" in ordinary)) throw Error(ordinary.refusal);
    const wire = manualSmsRequestBody(ordinary.record.snapshot);
    expect(wire.body).toBe(base.body);
    expect(wire).not.toHaveProperty("first_use");
    store.settle(ordinary.record.localId, ordinary.record.attemptId, timeout);
    expect(store.begin(first)).toEqual({ ok: false, refusal: "duplicate_unresolved" });
  });
});
