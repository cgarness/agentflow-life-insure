import React from "react";
import { LucideIcon, ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";

interface ComingSoonProps {
  icon: LucideIcon;
  title: string;
  description: string;
  featureName: string;
}

const ComingSoon: React.FC<ComingSoonProps> = ({
  icon: Icon,
  title,
  description,
  featureName,
}) => {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative mb-8"
      >
        <div className="absolute inset-0 bg-primary/20 blur-3xl rounded-full scale-150 animate-pulse" />
        <div className="relative bg-card border shadow-2xl rounded-3xl p-8 backdrop-blur-sm">
          <div className="w-20 h-20 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-6 transform transition-transform hover:scale-110 duration-300">
            <Icon className="w-10 h-10 text-primary" />
          </div>
          
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-bold uppercase tracking-wider mb-4 border border-primary/20">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
            </span>
            Coming Soon
          </div>

          <h1 className="text-3xl md:text-4xl font-bold text-foreground mb-4 tracking-tight">
            {title} <span className="text-primary font-light italic">— Coming Soon</span>
          </h1>
          
          <p className="text-muted-foreground text-lg max-w-md mx-auto mb-8 leading-relaxed">
            {description}
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              to="/dashboard"
              className="flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground font-semibold hover:bg-primary/90 transition-all duration-200 shadow-lg shadow-primary/20"
            >
              <ArrowLeft className="w-4 h-4" />
              Return to Dashboard
            </Link>
            
            <button
              onClick={() => {
                console.log(`Waitlist signup for: ${featureName}`);
                // In a real scenario, this would trigger a notification/telemetry
              }}
              className="px-6 py-3 rounded-xl bg-accent text-foreground font-semibold border border-border/50 hover:bg-accent/80 transition-all duration-200"
            >
              Notify Me
            </button>
          </div>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4, duration: 0.8 }}
        className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl mt-12"
      >
        <div className="p-6 rounded-2xl bg-card/40 border border-border/40 backdrop-blur-sm text-left">
          <h3 className="text-sm font-bold text-foreground mb-2 flex items-center gap-2">
            <div className="w-1 h-4 bg-primary rounded-full" />
            Intelligence-Driven
          </h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Advanced neural networks process your agency's data to reveal hidden opportunities.
          </p>
        </div>
        <div className="p-6 rounded-2xl bg-card/40 border border-border/40 backdrop-blur-sm text-left">
          <h3 className="text-sm font-bold text-foreground mb-2 flex items-center gap-2">
            <div className="w-1 h-4 bg-primary rounded-full" />
            Unified Engine
          </h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Every module is deep-linked into your core CRM for zero-latency workflows.
          </p>
        </div>
        <div className="p-6 rounded-2xl bg-card/40 border border-border/40 backdrop-blur-sm text-left">
          <h3 className="text-sm font-bold text-foreground mb-2 flex items-center gap-2">
            <div className="w-1 h-4 bg-primary rounded-full" />
            Enterprise Grade
          </h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Built for 100% telemetry accuracy and high-velocity agency operations.
          </p>
        </div>
      </motion.div>
    </div>
  );
};

export default ComingSoon;
