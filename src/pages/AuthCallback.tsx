import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

const AuthCallback = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const handleAuthCallback = async () => {
      const { data, error } = await supabase.auth.getSession();
      
      if (error) {
        console.error("Auth callback error:", error.message);
        navigate("/login");
        return;
      }

      if (data?.session) {
        navigate("/dashboard");
      } else {
        navigate("/login");
      }
    };

    handleAuthCallback();
  }, [navigate]);

  return (
    <div className="min-h-screen bg-[#020408] flex flex-col items-center justify-center text-white">
      <Loader2 className="w-10 h-10 text-primary animate-spin mb-4" />
      <h2 className="text-xl font-semibold">Verifying your account...</h2>
      <p className="text-gray-400 mt-2 text-sm">You'll be redirected to the dashboard in a moment.</p>
    </div>
  );
};

export default AuthCallback;
