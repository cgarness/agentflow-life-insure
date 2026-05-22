import React, { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useUnsavedChanges } from "@/contexts/UnsavedChangesContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { Target, ChevronDown, Loader2, Phone, FileText, Briefcase, DollarSign } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { z } from "zod";

const goalsSchema = z.object({
  monthlyCalls: z.number().int({ message: "Must be a whole number" }).nonnegative({ message: "Must be 0 or greater" }),
  monthlyPolicies: z.number().int({ message: "Must be a whole number" }).nonnegative({ message: "Must be 0 or greater" }),
  monthlyAppts: z.number().int({ message: "Must be a whole number" }).nonnegative({ message: "Must be 0 or greater" }),
  monthlyPremium: z.number().int({ message: "Must be a whole number" }).nonnegative({ message: "Must be 0 or greater" }),
});

type GoalErrors = {
  monthlyCalls?: string;
  monthlyPolicies?: string;
  monthlyAppts?: string;
  monthlyPremium?: string;
};

export const ProfileGoalsCard: React.FC = () => {
  const { profile, updateProfile } = useAuth();
  const { registerDirty } = useUnsavedChanges();

  const [monthlyCalls, setMonthlyCalls] = useState(profile?.monthly_call_goal ?? 0);
  const [monthlyPolicies, setMonthlyPolicies] = useState(profile?.monthly_policies_goal ?? 0);
  const [monthlyAppts, setMonthlyAppts] = useState(profile?.monthly_appointment_goal ?? 0);
  const [monthlyPremium, setMonthlyPremium] = useState(profile?.monthly_premium_goal ?? 0);

  const [goalSaving, setGoalSaving] = useState(false);
  const [errors, setErrors] = useState<GoalErrors>({});

  const [saved, setSaved] = useState({
    monthlyCalls: profile?.monthly_call_goal ?? 0,
    monthlyPolicies: profile?.monthly_policies_goal ?? 0,
    monthlyAppts: profile?.monthly_appointment_goal ?? 0,
    monthlyPremium: profile?.monthly_premium_goal ?? 0,
  });

  useEffect(() => {
    if (profile) {
      setMonthlyCalls(profile.monthly_call_goal || 0);
      setMonthlyPolicies(profile.monthly_policies_goal || 0);
      setMonthlyAppts(profile.monthly_appointment_goal || 0);
      setMonthlyPremium(profile.monthly_premium_goal || 0);
      setSaved({
        monthlyCalls: profile.monthly_call_goal || 0,
        monthlyPolicies: profile.monthly_policies_goal || 0,
        monthlyAppts: profile.monthly_appointment_goal || 0,
        monthlyPremium: profile.monthly_premium_goal || 0,
      });
    }
  }, [profile]);

  const isDirty = useMemo(() => {
    return (
      monthlyCalls !== saved.monthlyCalls ||
      monthlyPolicies !== saved.monthlyPolicies ||
      monthlyAppts !== saved.monthlyAppts ||
      monthlyPremium !== saved.monthlyPremium
    );
  }, [monthlyCalls, monthlyPolicies, monthlyAppts, monthlyPremium, saved]);

  useEffect(() => {
    registerDirty("profile-goals", isDirty);
    return () => registerDirty("profile-goals", false);
  }, [isDirty, registerDirty]);

  const handleSaveGoals = async () => {
    const result = goalsSchema.safeParse({
      monthlyCalls,
      monthlyPolicies,
      monthlyAppts,
      monthlyPremium,
    });

    if (!result.success) {
      const fieldErrors: GoalErrors = {};
      result.error.errors.forEach((err) => {
        const fieldName = err.path[0] as keyof GoalErrors;
        fieldErrors[fieldName] = err.message;
      });
      setErrors(fieldErrors);
      return;
    }

    setErrors({});
    setGoalSaving(true);
    try {
      await updateProfile({
        monthly_call_goal: monthlyCalls,
        monthly_policies_goal: monthlyPolicies,
        monthly_appointment_goal: monthlyAppts,
        monthly_premium_goal: monthlyPremium,
      });
      setSaved({
        monthlyCalls,
        monthlyPolicies,
        monthlyAppts,
        monthlyPremium,
      });
      toast({
        title: "Goals updated successfully.",
        className: "bg-success text-success-foreground",
      });
    } catch (err: any) {
      toast({
        title: "Failed to save goals",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setGoalSaving(false);
    }
  };

  return (
    <Card className="bg-card border-border rounded-lg mb-6 overflow-hidden">
      <Collapsible defaultOpen={false} className="group">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 px-6 py-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background"
          >
            <div className="flex items-center gap-2 min-w-0">
              <div className="p-2 bg-primary/10 rounded-lg shrink-0">
                <Target className="w-5 h-5 text-primary" />
              </div>
              <div className="min-w-0">
                <CardTitle className="text-lg">My Goals</CardTitle>
                <p className="text-xs text-muted-foreground">Dialing and production targets</p>
              </div>
            </div>
            <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-4 border-t border-border/50 pt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <GoalField
                label="Monthly Calls Goal"
                unit="calls"
                value={monthlyCalls}
                onChange={setMonthlyCalls}
                error={errors.monthlyCalls}
                icon={<Phone className="w-4 h-4" />}
              />
              <GoalField
                label="Monthly Policies Goal"
                unit="policies"
                value={monthlyPolicies}
                onChange={setMonthlyPolicies}
                error={errors.monthlyPolicies}
                icon={<FileText className="w-4 h-4" />}
              />
              <GoalField
                label="Monthly Appointments Goal"
                unit="appts"
                value={monthlyAppts}
                onChange={setMonthlyAppts}
                error={errors.monthlyAppts}
                icon={<Briefcase className="w-4 h-4" />}
              />
              <GoalField
                label="Monthly Premium Goal"
                unit="dollars"
                placeholder="1500"
                value={monthlyPremium}
                onChange={setMonthlyPremium}
                error={errors.monthlyPremium}
                icon={<DollarSign className="w-4 h-4" />}
              />
            </div>
            <div className="flex justify-start pt-4 border-t border-border/50">
              <Button onClick={handleSaveGoals} disabled={goalSaving || !isDirty} className="px-6 rounded-lg font-medium">
                {goalSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> Saving...
                  </>
                ) : (
                  "Save Monthly Goals"
                )}
              </Button>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
};

// Sub-component
interface GoalFieldProps {
  label: string;
  unit: string;
  placeholder?: string;
  value: number;
  onChange: (v: number) => void;
  error?: string;
  icon: React.ReactNode;
}

function GoalField({
  label,
  unit,
  placeholder,
  value,
  onChange,
  error,
  icon,
}: GoalFieldProps) {
  return (
    <div className="group relative p-4 rounded-xl border border-border bg-card/50 hover:bg-card hover:border-primary/30 hover:shadow-md transition-all duration-300">
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-primary/10 rounded-md text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors duration-300">
            {icon}
          </div>
          <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">{label}</label>
        </div>
        <span className="text-[10px] font-medium px-2 py-0.5 bg-muted rounded text-muted-foreground">{unit}</span>
      </div>
      <div className="relative">
        <Input
          type="number"
          min={0}
          step={1}
          placeholder={placeholder}
          value={value === 0 && placeholder ? "" : value}
          onChange={(e) => {
            const parsed = parseInt(e.target.value);
            onChange(isNaN(parsed) ? 0 : parsed);
          }}
          className="h-11 pl-4 pr-10 text-base font-semibold bg-background/50 border-border/50 focus-visible:ring-primary/20 focus-visible:border-primary/50 transition-all rounded-lg"
        />
      </div>
      {error && <p className="text-[10px] font-medium text-destructive mt-1.5 ml-1">{error}</p>}
    </div>
  );
}
