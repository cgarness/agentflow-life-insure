/**
 * Test double for `@/components/ui/select` (Radix), used as
 * `vi.mock("@/components/ui/select", () => import("./nativeSelectMock"))`.
 *
 * Radix Select needs pointer capture and layout that jsdom lacks, so its options cannot be
 * opened under test. This renders ONE native `<select>` per `Select`, labelled by the
 * trigger's `aria-label`, with an `<option>` per `SelectItem` (value, disabled, text). What is
 * under test is which options the component offers and whether the control is enabled — not
 * Radix itself.
 */
import React from "react";

type ItemProps = { value: string; disabled?: boolean; children?: React.ReactNode };
type TriggerProps = { children?: React.ReactNode; "aria-label"?: string; id?: string; className?: string };

export const SelectItem: React.FC<ItemProps> = () => null;
export const SelectTrigger: React.FC<TriggerProps> = () => null;
export const SelectValue: React.FC<{ placeholder?: string }> = () => null;
export const SelectContent: React.FC<{ children?: React.ReactNode }> = () => null;
export const SelectGroup: React.FC<{ children?: React.ReactNode }> = () => null;
export const SelectLabel: React.FC<{ children?: React.ReactNode }> = () => null;
export const SelectSeparator: React.FC = () => null;

function textOf(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (React.isValidElement(node)) return textOf((node.props as { children?: React.ReactNode }).children);
  return "";
}

export const Select: React.FC<{
  value?: string;
  onValueChange?: (v: string) => void;
  disabled?: boolean;
  children?: React.ReactNode;
}> = ({ value, onValueChange, disabled, children }) => {
  const items: { value: string; disabled: boolean; text: string }[] = [];
  let label: string | undefined;
  let id: string | undefined;
  const walk = (node: React.ReactNode) =>
    React.Children.forEach(node, (child) => {
      if (!React.isValidElement(child)) return;
      const props = child.props as ItemProps & TriggerProps;
      if (child.type === SelectItem) {
        items.push({ value: props.value, disabled: !!props.disabled, text: textOf(props.children).trim() });
        return;
      }
      if (child.type === SelectTrigger) {
        label = props["aria-label"];
        id = props.id;
      }
      if (props.children) walk(props.children);
    });
  walk(children);
  return (
    <select
      aria-label={label}
      id={id}
      value={value ?? ""}
      disabled={disabled}
      onChange={(e) => onValueChange?.(e.target.value)}
    >
      {items.map((item) => (
        <option key={item.value} value={item.value} disabled={item.disabled}>{item.text}</option>
      ))}
    </select>
  );
};
