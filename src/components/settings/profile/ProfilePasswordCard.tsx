import React, { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { KeyRound, ChevronDown, Loader2, Eye, EyeOff, Check, X } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { z } from "zod";

const passwordFormSchema = z.object({
  currentPw: z.string().min(1, "Current password is required"),
  newPw: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .refine((val) => /[A-Z]/.test(val), "Must contain at least one uppercase letter")
    .refine((val) => /[0-9]/.test(val), "Must contain at least one number")
    .refine((val) => /[!@#$%^&*]/.test(val), "Must contain at least one special character (!@#$%^&*)"),
  confirmPw: z.string(),
}).refine((data) => data.newPw === data.confirmPw, {
  message: "Passwords do not match",
  path: ["confirmPw"],
});

export const ProfilePasswordCard: React.FC = () => {
  const { user } = useAuth();
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");

  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);

  const [pwSaving, setPwSaving] = useState(false);

  // Requirements
  const hasMinLength = newPw.length >= 8;
  const hasUppercase = /[A-Z]/.test(newPw);
  const hasNumber = /[0-9]/.test(newPw);
  const hasSpecial = /[!@#$%^&*]/.test(newPw);
  const matchesConfirm = confirmPw === newPw && confirmPw.length > 0;
  const hasCurrent = currentPw.length > 0;

  const isPasswordValid =
    hasMinLength && hasUppercase && hasNumber && hasSpecial && matchesConfirm && hasCurrent;

  const handleUpdatePassword = async () => {
    if (!user?.email) {
      toast({
        title: "Error",
        description: "User session email not found. Please log in again.",
        variant: "destructive",
      });
      return;
    }

    const parseResult = passwordFormSchema.safeParse({
      currentPw,
      newPw,
      confirmPw,
    });

    if (!parseResult.success) {
      toast({
        title: "Validation failed",
        description: parseResult.error.errors[0]?.message || "Please check password requirements.",
        variant: "destructive",
      });
      return;
    }

    setPwSaving(true);
    try {
      // 1. Reauthenticate user using current password
      const { error: reauthError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPw,
      });

      if (reauthError) {
        throw new Error("Incorrect current password. Reauthentication failed.");
      }

      // 2. Perform the update with new password
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPw,
      });

      if (updateError) throw updateError;

      // 3. Clear fields
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");

      toast({
        title: "Password updated successfully.",
        className: "bg-success text-success-foreground",
      });
    } catch (err: any) {
      toast({
        title: "Failed to update password",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setPwSaving(false);
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
                <KeyRound className="w-5 h-5 text-primary" />
              </div>
              <div className="min-w-0">
                <CardTitle className="text-lg">Change Password</CardTitle>
                <p className="text-xs text-muted-foreground">Update the password you use to sign in</p>
              </div>
            </div>
            <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-4 max-w-md border-t border-border/50 pt-6">
            <PasswordField
              label="Current Password"
              value={currentPw}
              onChange={setCurrentPw}
              show={showCurrentPw}
              onToggle={() => setShowCurrentPw(!showCurrentPw)}
            />

            <div>
              <PasswordField
                label="New Password"
                value={newPw}
                onChange={setNewPw}
                show={showNewPw}
                onToggle={() => setShowNewPw(!showNewPw)}
              />

              <div className="mt-3 p-3 rounded-lg bg-accent/30 border border-border/50 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Password Requirements
                </p>
                <ul className="space-y-1.5 text-xs text-foreground/80">
                  <li className="flex items-center gap-2">
                    {hasMinLength ? (
                      <Check className="w-3.5 h-3.5 text-success shrink-0" />
                    ) : (
                      <X className="w-3.5 h-3.5 text-destructive shrink-0" />
                    )}
                    <span>At least 8 characters</span>
                  </li>
                  <li className="flex items-center gap-2">
                    {hasUppercase ? (
                      <Check className="w-3.5 h-3.5 text-success shrink-0" />
                    ) : (
                      <X className="w-3.5 h-3.5 text-destructive shrink-0" />
                    )}
                    <span>At least one uppercase letter</span>
                  </li>
                  <li className="flex items-center gap-2">
                    {hasNumber ? (
                      <Check className="w-3.5 h-3.5 text-success shrink-0" />
                    ) : (
                      <X className="w-3.5 h-3.5 text-destructive shrink-0" />
                    )}
                    <span>At least one number</span>
                  </li>
                  <li className="flex items-center gap-2">
                    {hasSpecial ? (
                      <Check className="w-3.5 h-3.5 text-success shrink-0" />
                    ) : (
                      <X className="w-3.5 h-3.5 text-destructive shrink-0" />
                    )}
                    <span>At least one special character (!@#$%^&*)</span>
                  </li>
                  <li className="flex items-center gap-2">
                    {matchesConfirm ? (
                      <Check className="w-3.5 h-3.5 text-success shrink-0" />
                    ) : (
                      <X className="w-3.5 h-3.5 text-destructive shrink-0" />
                    )}
                    <span>Passwords must match</span>
                  </li>
                </ul>
              </div>
            </div>

            <PasswordField
              label="Confirm New Password"
              value={confirmPw}
              onChange={setConfirmPw}
              show={showConfirmPw}
              onToggle={() => setShowConfirmPw(!showConfirmPw)}
            />

            <div className="flex justify-start pt-2 border-t border-border/50">
              <Button
                type="button"
                onClick={handleUpdatePassword}
                disabled={!isPasswordValid || pwSaving}
                className="px-6 rounded-lg font-medium"
              >
                {pwSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> Updating...
                  </>
                ) : (
                  "Update Password"
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
interface PasswordFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggle: () => void;
}

function PasswordField({ label, value, onChange, show, onToggle }: PasswordFieldProps) {
  return (
    <div>
      <label className="text-sm font-medium text-foreground block mb-1.5">{label}</label>
      <div className="relative">
        <Input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="pr-10"
        />
        <button
          type="button"
          onClick={onToggle}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
