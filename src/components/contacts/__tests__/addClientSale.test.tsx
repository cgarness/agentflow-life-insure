import React from "react";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {act,cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {toast} from "sonner";
import type {OrganizationCarriers} from "@/hooks/useOrganizationCarriers";
import {installComboboxDomStubs,pickCarrier} from "@/test/carrierComboboxTestUtils";
const h=vi.hoisted(()=>({list:null as unknown as OrganizationCarriers}));
vi.mock("sonner",()=>({toast:{error:vi.fn(),warning:vi.fn()}}));
vi.mock("@/hooks/useOrganizationCarriers",()=>({useOrganizationCarriers:()=>h.list}));
const ready=(carriers=["Test Carrier","Other Carrier"]):OrganizationCarriers=>({status:"ready",carriers,retry:vi.fn()});
vi.mock("@/components/shared/PhoneInput",()=>({PhoneInput:({value,onChange}: {value:string;onChange:(v:string)=>void})=><input aria-label="Phone" value={value} onChange={e=>onChange(e.target.value)}/>}));
vi.mock("@/components/shared/DateInput",()=>({DateInput:({value,onChange}: {value:string;onChange:(v:string)=>void})=><input data-testid="date" value={value} onChange={e=>onChange(e.target.value)}/>}));
vi.mock("@/components/shared/StateSelector",()=>({StateSelector:()=>null}));
// The commission preview needs a QueryClient this harness does not mount; policyCommissionPreviewModals covers it.
vi.mock("@/components/commission/preview/PolicyCommissionEstimate",()=>({PolicyCommissionEstimate:()=>null}));
import AddClientModal from "../AddClientModal";
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.mocked(toast.error).mockClear();});
beforeEach(()=>{h.list=ready();installComboboxDomStubs();});
async function setup(save:ReturnType<typeof vi.fn>){
 vi.stubGlobal("crypto",{randomUUID:()=>"stable-request"});
 const close=vi.fn();const page=render(<AddClientModal open onClose={close} onSave={save}/>);
 const fill=(label:string,value:string)=>fireEvent.change(screen.getByText(label).parentElement!.querySelector("input")!,{target:{value}});
 fill("First Name *","Pat");fill("Last Name *","Lee");fireEvent.change(screen.getByLabelText("Phone"),{target:{value:"5551234567"}});
 await pickCarrier("Test Carrier");
 return {close,page,submit:()=>fireEvent.submit(page.container.querySelector("form")!)};
}
describe("Add Client sale intent and retries",()=>{
 it("retains a policy draft when Sold Date is empty instead of silently dropping its sale",async()=>{
  const save=vi.fn().mockResolvedValue(undefined);const {submit,close}=await setup(save);submit();
  expect(save).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
 });
 it("retains the operation ID and open form after failure, then retries exactly that sale",async()=>{
  const save=vi.fn().mockRejectedValueOnce(new Error("network error")).mockResolvedValue(undefined);
  const {submit,close}=await setup(save);fireEvent.change(screen.getAllByTestId("date")[0],{target:{value:"2026-10-03"}});
  submit();await waitFor(()=>expect(screen.getByRole("button",{name:"Add Client"})).not.toBeDisabled());
  expect(close).not.toHaveBeenCalled();submit();await waitFor(()=>expect(close).toHaveBeenCalledTimes(1));
  expect(save.mock.calls.map(args=>({requestId:args[1].requestId,recordSale:args[1].recordSale}))).toEqual([{requestId:"stable-request",recordSale:true},{requestId:"stable-request",recordSale:true}]);
 });
 it("blocks double submissions and closing while save is pending",async()=>{
  let finish!:()=>void;const save=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;}));
  const {submit,close}=await setup(save);fireEvent.change(screen.getAllByTestId("date")[0],{target:{value:"2026-10-03"}});submit();submit();fireEvent.click(screen.getByRole("button",{name:"Close client form"}));
  expect(save).toHaveBeenCalledTimes(1);expect(close).not.toHaveBeenCalled();
  await act(async()=>{finish();});expect(close).toHaveBeenCalledTimes(1);
 });
 it("retries a frozen new-client sale unchanged after its carrier is removed or the list fails",async()=>{
  const prepared={frozen:"submission"};
  const save=vi.fn().mockImplementationOnce(async(_form:unknown,sale:{attempt:{sent:boolean;prepared:unknown}})=>{
   sale.attempt.sent=true;sale.attempt.prepared=prepared;throw new Error("Connection lost");})
   .mockRejectedValueOnce(new Error("Still offline")).mockResolvedValue(undefined);
  const {submit,close,page}=await setup(save);fireEvent.change(screen.getAllByTestId("date")[0],{target:{value:"2026-10-03"}});
  submit();await screen.findByText(/Connection lost/);
  h.list=ready(["Other Carrier"]);page.rerender(<AddClientModal open onClose={close} onSave={save}/>);
  submit();await screen.findByText(/Last retry/);
  h.list={status:"error",carriers:null,retry:vi.fn()};page.rerender(<AddClientModal open onClose={close} onSave={save}/>);
  submit();await waitFor(()=>expect(close).toHaveBeenCalledTimes(1));
  expect(save).toHaveBeenCalledTimes(3);
  for(const [form,sale] of save.mock.calls.slice(1)){
   expect(sale.attempt.frozen).toBe(prepared);expect(sale.requestId).toBe("stable-request");
   expect(sale.commission).toEqual(save.mock.calls[0][1].commission);expect(form).toEqual(save.mock.calls[0][0]);
  }
  expect(toast.error).not.toHaveBeenCalled();
 });
});

const stored={id:"client-1",firstName:"Pat",lastName:"Lee",phone:"5551234567",policyType:"Term" as const,premiumAmount:"$50.00"};
function edit(carrier:string,save=vi.fn().mockResolvedValue(undefined)){
 const close=vi.fn();const initial={...stored,carrier};const page=render(<AddClientModal open onClose={close} onSave={save} initial={initial}/>);
 return {save,close,page,initial,submit:()=>fireEvent.submit(page.container.querySelector("form")!)};
}
describe("Edit Client carrier selection",()=>{
 it("pre-selects the stored carrier and saves it unchanged",async()=>{
  const e=edit("Test Carrier");expect(screen.getByLabelText("Carrier")).toHaveTextContent(/^Test Carrier$/);
  e.submit();await waitFor(()=>expect(e.close).toHaveBeenCalled());
  expect(e.save.mock.calls[0][0].carrier).toBe("Test Carrier");expect(e.save.mock.calls[0][1]).toBeUndefined();
 });
 it("keeps a carrier removed from Settings exactly, labelled, until the user replaces it",async()=>{
  const e=edit("Retired Carrier ");
  expect(screen.getByLabelText("Carrier").textContent).toBe("Retired Carrier ");
  expect(screen.getByLabelText("Carrier")).toHaveAccessibleDescription(/\(not in Settings\)/);
  e.submit();await waitFor(()=>expect(e.close).toHaveBeenCalled());
  expect(e.save.mock.calls[0][0].carrier).toBe("Retired Carrier ");
 });
 it("keeps a case/whitespace variant exactly as stored, without the not-in-Settings tag",async()=>{
  const e=edit(" test carrier");
  expect(screen.getByLabelText("Carrier").textContent?.trim()).toBe("test carrier");
  expect(screen.queryByText(/not in Settings/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("Carrier"));
  expect(await screen.findByRole("option",{name:/^test carrier/})).toBeInTheDocument();
  expect(screen.getByRole("option",{name:"Test Carrier"})).toBeInTheDocument();
  fireEvent.keyDown(document.activeElement!,{key:"Escape"});
  await waitFor(()=>expect(screen.queryByRole("option",{name:"Test Carrier"})).not.toBeInTheDocument());
  e.submit();await waitFor(()=>expect(e.close).toHaveBeenCalled());
  expect(e.save.mock.calls[0][0].carrier).toBe(" test carrier");
 });
 it("saves an unrelated edit while the carrier list fails, with the stored carrier kept",async()=>{
  h.list={status:"error",carriers:null,retry:vi.fn()};const e=edit("Retired Carrier");
  expect(screen.getByLabelText("Carrier")).toHaveTextContent(/^Retired Carrier$/);
  fireEvent.click(screen.getByRole("button",{name:"Retry"}));expect(h.list.retry).toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Phone"),{target:{value:"5559876543"}});
  e.submit();await waitFor(()=>expect(e.close).toHaveBeenCalled());
  expect(e.save.mock.calls[0][0]).toMatchObject({carrier:"Retired Carrier",phone:"15559876543"});
 });
 it("rejects a changed carrier once the list is no longer loaded for the current agency",async()=>{
  const e=edit("Retired Carrier");await pickCarrier("Other Carrier");
  h.list={status:"loading",carriers:null,retry:vi.fn()};e.page.rerender(<AddClientModal open onClose={e.close} onSave={e.save} initial={e.initial}/>);
  e.submit();await waitFor(()=>expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Carriers haven't loaded yet")));
  expect(e.save).not.toHaveBeenCalled();
 });
 it("can replace and clear a stored carrier, and back to the saved one",async()=>{
  const e=edit("Retired Carrier");await pickCarrier("Other Carrier");
  expect(screen.getByLabelText("Carrier")).toHaveTextContent(/^Other Carrier$/);
  await pickCarrier("No carrier");expect(screen.getByLabelText("Carrier")).toHaveTextContent("Select carrier…");
  await pickCarrier("Retired Carrier");
  await pickCarrier("No carrier");
  e.submit();await waitFor(()=>expect(e.close).toHaveBeenCalled());
  expect(e.save.mock.calls[0][0].carrier).toBe("");
 });
});
