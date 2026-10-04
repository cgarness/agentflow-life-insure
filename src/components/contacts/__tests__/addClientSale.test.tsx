import React from "react";
import {afterEach,describe,expect,it,vi} from "vitest";
import {act,cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
vi.mock("sonner",()=>({toast:{error:vi.fn()}}));
vi.mock("@/components/shared/PhoneInput",()=>({PhoneInput:({value,onChange}: {value:string;onChange:(v:string)=>void})=><input aria-label="Phone" value={value} onChange={e=>onChange(e.target.value)}/>}));
vi.mock("@/components/shared/DateInput",()=>({DateInput:({value,onChange}: {value:string;onChange:(v:string)=>void})=><input data-testid="date" value={value} onChange={e=>onChange(e.target.value)}/>}));
vi.mock("@/components/shared/StateSelector",()=>({StateSelector:()=>null}));
import AddClientModal from "../AddClientModal";
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
function setup(save:ReturnType<typeof vi.fn>){
 vi.stubGlobal("crypto",{randomUUID:()=>"stable-request"});
 const close=vi.fn();const page=render(<AddClientModal open onClose={close} onSave={save}/>);
 const fill=(label:string,value:string)=>fireEvent.change(screen.getByText(label).parentElement!.querySelector("input")!,{target:{value}});
 fill("First Name *","Pat");fill("Last Name *","Lee");fireEvent.change(screen.getByLabelText("Phone"),{target:{value:"5551234567"}});
 fill("Carrier","Test Carrier");
 return {close,page,submit:()=>fireEvent.submit(page.container.querySelector("form")!)};
}
describe("Add Client sale intent and retries",()=>{
 it("records ordinary contact intent when Sold Date is empty",async()=>{
  const save=vi.fn().mockResolvedValue(undefined);const {submit,close}=setup(save);submit();
  await waitFor(()=>expect(close).toHaveBeenCalledTimes(1));
  expect(save.mock.calls[0][1]).toEqual({requestId:"stable-request",recordSale:false});
 });
 it("retains the operation ID and open form after failure, then retries exactly that sale",async()=>{
  const save=vi.fn().mockRejectedValueOnce(new Error("network error")).mockResolvedValue(undefined);
  const {submit,close}=setup(save);fireEvent.change(screen.getAllByTestId("date")[0],{target:{value:"2026-10-03"}});
  submit();await waitFor(()=>expect(screen.getByRole("button",{name:"Add Client"})).not.toBeDisabled());
  expect(close).not.toHaveBeenCalled();submit();await waitFor(()=>expect(close).toHaveBeenCalledTimes(1));
  expect(save.mock.calls.map(args=>args[1])).toEqual([{requestId:"stable-request",recordSale:true},{requestId:"stable-request",recordSale:true}]);
 });
 it("blocks double submissions and closing while save is pending",async()=>{
  let finish!:()=>void;const save=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;}));
  const {submit,close}=setup(save);submit();submit();fireEvent.click(screen.getByRole("button",{name:"Close client form"}));
  expect(save).toHaveBeenCalledTimes(1);expect(close).not.toHaveBeenCalled();
  await act(async()=>{finish();});expect(close).toHaveBeenCalledTimes(1);
 });
});
