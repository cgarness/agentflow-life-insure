import React from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { User } from "lucide-react";
import { ProfileInfoCard } from "./profile/ProfileInfoCard";
import { ProfileStateLicensingNotice } from "./profile/ProfileStateLicensingNotice";
import { ProfileCarriersCard } from "./profile/ProfileCarriersCard";
import { ProfilePreferencesCard } from "./profile/ProfilePreferencesCard";
import { ProfileGoalsCard } from "./profile/ProfileGoalsCard";
import { ProfilePasswordCard } from "./profile/ProfilePasswordCard";

const MyProfile: React.FC = () => {
  const { user } = useAuth();

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="bg-card border border-border rounded-lg p-10 text-center">
          <User className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground mb-4">No profile found</p>
          <Button onClick={() => window.location.reload()}>Reload</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ProfileInfoCard />
      <ProfileStateLicensingNotice />
      <ProfileCarriersCard />
      <ProfilePreferencesCard />
      <ProfileGoalsCard />
      <ProfilePasswordCard />
    </div>
  );
};

export default MyProfile;
