import React, { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { numberGroupFormSchema, type NumberGroupFormValues } from "./numberGroupsSchema";
import type { NumberGroupRow } from "./usePhoneSettingsController";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  mode: "create" | "edit";
  group?: NumberGroupRow | null;
  onSaved: () => void | Promise<void>;
};

export const NumberGroupFormModal: React.FC<Props> = ({ open, onOpenChange, organizationId, mode, group, onSaved }) => {
  const form = useForm<NumberGroupFormValues>({
    resolver: zodResolver(numberGroupFormSchema),
    defaultValues: { name: "", description: "" },
  });

  useEffect(() => {
    if (!open) return;
    form.reset({
      name: group?.name ?? "",
      description: group?.description ?? "",
    });
  }, [open, group, form]);

  const submitting = form.formState.isSubmitting;

  const onSubmit = async (values: NumberGroupFormValues) => {
    const description = values.description?.trim() ? values.description.trim() : null;
    if (mode === "create") {
      const { error } = await supabase.from("number_groups").insert({
        organization_id: organizationId,
        name: values.name.trim(),
        description,
      });
      if (error) {
        toast.error(`Could not create group: ${error.message}`);
        return;
      }
      toast.success("Group created");
    } else if (group) {
      const { error } = await supabase
        .from("number_groups")
        .update({
          name: values.name.trim(),
          description,
          updated_at: new Date().toISOString(),
        })
        .eq("id", group.id);
      if (error) {
        toast.error(`Could not update group: ${error.message}`);
        return;
      }
      toast.success("Group updated");
    }
    await onSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            {mode === "create" ? "Create number group" : "Edit number group"}
          </DialogTitle>
          <DialogDescription>
            Groups let you assign a subset of org numbers to a specific campaign.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-2">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. West Coast pool" {...field} maxLength={100} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description (optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Notes for teammates about when to use this group"
                      className="resize-none min-h-[80px]"
                      maxLength={500}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {mode === "create" ? "Create group" : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
