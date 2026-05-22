import React from "react";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Globe, ArrowRight } from "lucide-react";

export const ProfileStateLicensingNotice: React.FC = () => {
  const [, setSearchParams] = useSearchParams();

  const handleNavigate = () => {
    setSearchParams({ section: "state-licenses" });
  };

  return (
    <Card className="bg-card border-border rounded-xl mb-6 overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-primary/10 rounded-lg shrink-0">
            <Globe className="w-5 h-5 text-primary" />
          </div>
          <div>
            <CardTitle className="text-lg">State Licensing</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Manage the states where you are licensed to sell insurance
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-foreground/80 leading-relaxed">
          State licensing has been updated to a centralized management system. You can view, add,
          update, or remove your state licenses (including license numbers and expiration tracking)
          directly within the phone system configuration.
        </p>
        <div className="flex justify-start">
          <Button
            type="button"
            onClick={handleNavigate}
            variant="outline"
            className="flex items-center gap-2 font-medium hover:bg-primary hover:text-primary-foreground transition-all duration-300"
          >
            <span>Go to State Licenses Settings</span>
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
