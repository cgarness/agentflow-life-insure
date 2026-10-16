import React, { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { useCommissionGridMutations } from "@/hooks/useCommissionGridsAdmin";
import type { CreateGridMode, SharedGridCatalogEntry } from "@/lib/commission/adminTypes";
import { isIsoDate } from "@/lib/commission/gridDraft";
import { errorMessage } from "./gridFormat";

const MODES: { value: CreateGridMode; label: string; help: string }[] = [
  { value: "blank", label: "Blank", help: "An empty grid with contract levels 145 to 65." },
  { value: "structure", label: "Standard carrier list", help: "Carriers, products, ages and term lengths from an AgentFlow grid. No rates; levels 145 to 65." },
  { value: "full", label: "Duplicate with rates", help: "Everything from an AgentFlow grid, including its contract levels and rates." },
];

const schema = z
  .object({
    mode: z.enum(["blank", "structure", "full"]),
    sourceGridId: z.string(),
    name: z.string().refine((v) => v === v.trim() && v.length >= 1 && v.length <= 120, "Enter a name of 1 to 120 characters, without leading or trailing spaces."),
    effectiveDate: z.string().refine(isIsoDate, "Choose an effective date."),
  })
  .superRefine((values, ctx) => {
    if (values.mode !== "blank" && !values.sourceGridId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sourceGridId"], message: "Choose an enabled AgentFlow grid to copy." });
    }
  });
type Values = z.infer<typeof schema>;

interface CreateGridDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Enabled AgentFlow grids only: copying requires the agency's own access to the source. */
  sources: SharedGridCatalogEntry[];
  initialSourceId?: string | null;
  onCreated: (gridId: string) => void;
}

const CreateGridDialog: React.FC<CreateGridDialogProps> = ({ open, onOpenChange, sources, initialSourceId, onCreated }) => {
  const { create } = useCommissionGridMutations();
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { mode: "blank", sourceGridId: "", name: "", effectiveDate: "" } });
  const mode = form.watch("mode");

  useEffect(() => {
    if (open) form.reset({ mode: initialSourceId ? "full" : "blank", sourceGridId: initialSourceId ?? "", name: "", effectiveDate: "" });
  }, [open, initialSourceId, form]);

  const submit = (values: Values) =>
    create.mutate(
      { mode: values.mode, name: values.name, effectiveDate: values.effectiveDate, sourceGridId: values.mode === "blank" ? undefined : values.sourceGridId },
      {
        onSuccess: ({ gridId }) => {
          toast({ title: `${values.name} created` });
          onOpenChange(false);
          onCreated(gridId);
        },
        onError: (error) => toast({ title: "Grid not created", description: errorMessage(error), variant: "destructive" }),
      },
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New commission grid</DialogTitle>
          <DialogDescription>A private grid belongs to your agency only. You can edit it after it&apos;s created.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(submit)} className="space-y-4">
            <FormField control={form.control} name="mode" render={({ field }) => (
              <FormItem>
                <FormLabel>Start from</FormLabel>
                <FormControl>
                  <RadioGroup value={field.value} onValueChange={field.onChange} className="space-y-2">
                    {MODES.map((option) => (
                      <label key={option.value} className="flex cursor-pointer items-start gap-3 rounded-md border p-3">
                        <RadioGroupItem value={option.value} disabled={option.value !== "blank" && sources.length === 0} className="mt-0.5" />
                        <span>
                          <span className="block text-sm font-medium text-foreground">{option.label}</span>
                          <span className="block text-xs text-muted-foreground">{option.help}</span>
                        </span>
                      </label>
                    ))}
                  </RadioGroup>
                </FormControl>
              </FormItem>
            )} />
            {mode !== "blank" && (
              <FormField control={form.control} name="sourceGridId" render={({ field }) => (
                <FormItem>
                  <FormLabel>AgentFlow grid</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger aria-label="AgentFlow grid"><SelectValue placeholder="Choose an enabled grid" /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {sources.map((source) => <SelectItem key={source.id} value={source.id}>{source.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            )}
            {mode === "full" && (
              <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">This copy will not update when the shared grid changes.</p>
            )}
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem>
                <FormLabel>Name</FormLabel>
                <FormControl><Input {...field} maxLength={120} autoComplete="off" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="effectiveDate" render={({ field }) => (
              <FormItem>
                <FormLabel>Effective date</FormLabel>
                <FormControl><Input type="date" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
                Create grid
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

export default CreateGridDialog;
