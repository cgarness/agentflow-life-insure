import React, { useEffect, useRef } from "react";
import { X, Phone, Mail, MapPin } from "lucide-react";
import { toast } from "sonner";

interface ContactInfo {
  name: string;
  phone: string;
  email: string;
  state: string;
  status: string;
}

const STATUS_COLORS: Record<string, string> = {
  "Hot": "#EF4444",
  "Follow Up": "#F97316",
  "Interested": "#3B82F6",
  "Contacted": "#A855F7",
  "Closed Won": "#22C55E",
  "New": "#14B8A6",
};

interface Props {
  contact: ContactInfo;
  anchorRect: DOMRect | null;
  onClose: () => void;
}

const ContactMiniCard: React.FC<Props> = ({ contact, anchorRect, onClose }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const initials = contact.name.split(" ").map(n => n[0]).join("").slice(0, 2);
  const statusColor = STATUS_COLORS[contact.status] || "#64748B";

  const style: React.CSSProperties = { position: "fixed", zIndex: 210, width: 280 };
  if (anchorRect) {
    style.top = Math.min(anchorRect.bottom + 4, window.innerHeight - 300);
    style.left = Math.min(anchorRect.left, window.innerWidth - 300);
  }

  return (
    <div ref={ref} style={style} className="bg-card border border-border rounded-xl shadow-xl p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold" style={{ backgroundColor: "#3B82F633", color: "#3B82F6" }}>
            {initials}
          </div>
          <div>
            <div className="text-base font-bold text-foreground">{contact.name}</div>
            <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: statusColor + "33", color: statusColor }}>{contact.status}</span>
          </div>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
      </div>
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-foreground"><Phone className="w-3.5 h-3.5 text-muted-foreground" /> {contact.phone}</div>
        <div className="flex items-center gap-2 text-sm text-foreground"><Mail className="w-3.5 h-3.5 text-muted-foreground" /> {contact.email}</div>
        <div className="flex items-center gap-2 text-sm text-foreground"><MapPin className="w-3.5 h-3.5 text-muted-foreground" /> {contact.state}</div>
      </div>
      <button onClick={() => toast.info(`Opening full contact record for ${contact.name}`)}
        className="w-full py-2 rounded-md text-sm font-medium border transition-colors duration-150 hover:bg-accent" style={{ borderColor: "#3B82F6", color: "#3B82F6" }}>
        Full View →
      </button>
    </div>
  );
};

export default ContactMiniCard;
