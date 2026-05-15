import React from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ACTION_METAS, LOGIC_METAS } from "@/lib/workflow-types";
import type { NodeSpec } from "./lib/insertNode";

interface Props {
  trigger: React.ReactNode;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onPick: (spec: NodeSpec) => void;
  align?: "start" | "center" | "end";
}

const NodePickerPopover: React.FC<Props> = ({ trigger, open, onOpenChange, onPick, align = "center" }) => {
  const pickAction = (action_type: typeof ACTION_METAS[number]["type"]) => {
    onPick({ kind: "action", action_type });
    onOpenChange(false);
  };
  const pickLogic = (kind: "condition" | "wait") => {
    onPick({ kind });
    onOpenChange(false);
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align={align}
        sideOffset={6}
        className="w-[280px] max-h-[420px] overflow-y-auto p-0"
      >
        <Section title="Actions">
          {ACTION_METAS.map((m) => {
            const Icon = m.icon;
            const disabled = !!m.comingSoon;
            return (
              <button
                key={m.type}
                type="button"
                disabled={disabled}
                onClick={() => !disabled && pickAction(m.type)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors ${
                  disabled
                    ? "cursor-not-allowed opacity-50"
                    : "hover:bg-accent text-foreground"
                }`}
              >
                <Icon className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1">{m.label}</span>
                {m.comingSoon && (
                  <span className="rounded bg-yellow-500/15 px-1.5 py-0.5 text-[9px] font-medium text-yellow-500">
                    Soon
                  </span>
                )}
              </button>
            );
          })}
        </Section>
        <Section title="Logic">
          {LOGIC_METAS.map((m) => {
            const Icon = m.icon;
            return (
              <button
                key={m.kind}
                type="button"
                onClick={() => pickLogic(m.kind as "condition" | "wait")}
                className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent"
              >
                <Icon className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1">{m.label}</span>
              </button>
            );
          })}
        </Section>
      </PopoverContent>
    </Popover>
  );
};

const Section: React.FC<React.PropsWithChildren<{ title: string }>> = ({ title, children }) => (
  <div className="border-b border-border/40 px-2 py-2 last:border-b-0">
    <h4 className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      {title}
    </h4>
    <div className="space-y-0.5">{children}</div>
  </div>
);

export default NodePickerPopover;
