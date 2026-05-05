import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { User, Phone, Mail, MapPin, Calendar, ExternalLink, ShieldCheck, Tag } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { formatPhoneNumber } from "@/utils/phoneUtils";

interface ContactBriefViewProps {
  contactId: string;
  contactType: 'lead' | 'client' | 'recruit';
}

const ContactBriefView: React.FC<ContactBriefViewProps> = ({
  contactId,
  contactType,
}) => {
  const navigate = useNavigate();
  const [contact, setContact] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (contactId) {
      loadContact();
    }
  }, [contactId, contactType]);

  const loadContact = async () => {
    setLoading(true);
    try {
      const table = contactType === 'lead' ? 'leads' : contactType === 'client' ? 'clients' : 'recruits';
      const { data, error } = await supabase.from(table).select("*").eq("id", contactId).single();
      if (error) throw error;
      setContact(data);
    } catch (err) {
      console.error("Error loading contact:", err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="w-[300px] border-l border-border p-6 flex flex-col items-center gap-6 animate-pulse">
        <div className="w-24 h-24 rounded-full bg-muted" />
        <div className="w-full space-y-3">
          <div className="h-4 bg-muted rounded w-3/4 mx-auto" />
          <div className="h-3 bg-muted rounded w-1/2 mx-auto" />
        </div>
        <div className="w-full space-y-4 pt-6">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="flex gap-3">
              <div className="w-4 h-4 bg-muted rounded" />
              <div className="h-3 bg-muted rounded flex-1" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!contact) return null;

  const name = `${contact.first_name || ''} ${contact.last_name || ''}`;

  return (
    <div className="w-[300px] border-l border-border bg-card/20 flex flex-col overflow-y-auto">
      <div className="p-8 flex flex-col items-center text-center border-b border-border">
        <div className="w-24 h-24 rounded-3xl bg-primary/10 flex items-center justify-center text-primary font-bold text-2xl shadow-inner mb-4 transform rotate-3 hover:rotate-0 transition-transform">
          {name.split(" ").map(n => n[0]).join("").slice(0, 2)}
        </div>
        <h3 className="font-bold text-lg text-foreground">{name}</h3>
        <span className={cn(
          "mt-2 text-[10px] px-2.5 py-1 rounded-full font-bold uppercase tracking-widest",
          contactType === 'lead' ? 'bg-blue-500/10 text-blue-500 border border-blue-500/20' :
          contactType === 'client' ? 'bg-green-500/10 text-green-500 border border-green-500/20' :
          'bg-orange-500/10 text-orange-500 border border-orange-500/20'
        )}>
          {contactType}
        </span>
      </div>

      <div className="p-6 space-y-6">
        <div className="space-y-4">
          <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Contact Information</h4>
          
          <div className="space-y-3">
            <div className="flex items-center gap-3 text-sm group cursor-pointer">
              <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center text-muted-foreground group-hover:text-primary transition-colors">
                <Phone className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-muted-foreground leading-none mb-1">Phone</p>
                <p className="font-medium truncate">{formatPhoneNumber(contact.phone)}</p>
              </div>
            </div>

            <div className="flex items-center gap-3 text-sm group cursor-pointer">
              <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center text-muted-foreground group-hover:text-primary transition-colors">
                <Mail className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-muted-foreground leading-none mb-1">Email</p>
                <p className="font-medium truncate">{contact.email || 'No email'}</p>
              </div>
            </div>

            <div className="flex items-center gap-3 text-sm group">
              <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center text-muted-foreground">
                <MapPin className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-muted-foreground leading-none mb-1">Location</p>
                <p className="font-medium truncate">{contact.state || 'Unknown'}</p>
              </div>
            </div>
          </div>
        </div>

        <button 
          onClick={() => navigate(`/contacts?contact=${contactId}&contactType=${contactType}`)}
          className="w-full bg-accent hover:bg-accent/80 text-foreground text-xs font-bold py-3 rounded-xl flex items-center justify-center gap-2 transition-all mt-4"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          View Contact
        </button>
      </div>
    </div>
  );
};

export default ContactBriefView;
