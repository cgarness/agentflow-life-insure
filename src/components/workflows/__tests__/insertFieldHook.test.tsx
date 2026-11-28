import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useInsertAtCursor } from "../inspector/useInsertAtCursor";

const changes = vi.fn();

function Probe({initial, multiline = true, frozen = false}: {initial: string; multiline?: boolean; frozen?: boolean}) {
  const [value, setValue] = useState(initial);
  const {ref, insert, focus, bind} = useInsertAtCursor(value, next => { changes(next); if (!frozen) setValue(next); });
  const Control = multiline ? Textarea : Input;
  return <>
    <Control aria-label="Text" ref={ref} value={value} onChange={event => setValue(event.target.value)} {...bind}/>
    <button type="button" onClick={() => insert("[X]")}>Insert</button>
    <button type="button" onClick={() => setValue("Howdy partner")}>Replace wording</button>
    <button type="button" onClick={focus}>Return focus</button>
  </>;
}
const field = () => screen.getByLabelText("Text") as HTMLTextAreaElement;
const press = (name: string) => fireEvent.click(screen.getByRole("button", {name}));
function place(start: number, end = start) {
  field().focus();
  field().setSelectionRange(start, end);
  fireEvent.keyUp(field());
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe.each([["a textarea", true], ["a single-line input", false]])("useInsertAtCursor in %s", (_name, multiline) => {
  it("inserts at the cursor, keeps the surrounding text and puts the cursor after the insertion", () => {
    render(<Probe initial="Hello world" multiline={multiline}/>);
    place(5);
    press("Insert");
    expect(field()).toHaveValue("Hello[X] world");
    expect(document.activeElement).toBe(field());
    expect([field().selectionStart, field().selectionEnd]).toEqual([8, 8]);
  });

  it("replaces the selected text only", () => {
    render(<Probe initial="Hello world" multiline={multiline}/>);
    place(6, 11);
    press("Insert");
    expect(field()).toHaveValue("Hello [X]");
    expect(field().selectionStart).toBe(9);
  });

  it("keeps working for repeated insertions without the cursor being placed again", () => {
    render(<Probe initial="ab" multiline={multiline}/>);
    place(1);
    press("Insert"); press("Insert"); press("Insert");
    expect(field()).toHaveValue("a[X][X][X]b");
    expect(field().selectionStart).toBe(10);
    expect(changes).toHaveBeenCalledTimes(3);
  });

  it("appends to a field that was never focused, and to an empty one", () => {
    const view = render(<Probe initial="Hello" multiline={multiline}/>);
    press("Insert");
    expect(field()).toHaveValue("Hello[X]");
    expect(document.activeElement).toBe(field());
    view.unmount();
    render(<Probe initial="" multiline={multiline}/>);
    press("Insert");
    expect(field()).toHaveValue("[X]");
  });

  it("appends when the wording was replaced after the cursor was last seen", () => {
    render(<Probe initial="Hello world" multiline={multiline}/>);
    place(2);
    press("Replace wording");
    press("Insert");
    expect(field()).toHaveValue("Howdy partner[X]");
  });

  it("remembers the cursor when the field loses focus without any other signal", () => {
    render(<Probe initial="Hello world" multiline={multiline}/>);
    field().focus();
    field().setSelectionRange(5, 5);
    screen.getByRole("button", {name: "Insert"}).focus();
    press("Insert");
    expect(field()).toHaveValue("Hello[X] world");
  });

  it("returns focus with the cursor where it was, and leaves a focused field alone", () => {
    render(<Probe initial="Hello world" multiline={multiline}/>);
    place(5);
    screen.getByRole("button", {name: "Return focus"}).focus();
    press("Return focus");
    expect(document.activeElement).toBe(field());
    expect([field().selectionStart, field().selectionEnd]).toEqual([5, 5]);
    field().setSelectionRange(2, 2);
    press("Return focus");
    expect(field().selectionStart).toBe(2);
  });

  it("does not move the cursor when the change is not applied", () => {
    render(<Probe initial="Hello world" multiline={multiline} frozen/>);
    place(5);
    screen.getByRole("button", {name: "Insert"}).focus();
    press("Insert");
    expect(changes).toHaveBeenCalledWith("Hello[X] world");
    expect(field()).toHaveValue("Hello world");
    expect(document.activeElement).not.toBe(field());
  });
});
