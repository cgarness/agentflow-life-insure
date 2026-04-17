import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { format as dateFnsFormat, parseISO, isValid } from 'date-fns';

export interface BrandingState {
    companyName: string;
    logoUrl: string | null;
    logoName: string | null;
    faviconUrl: string | null;
    faviconName: string | null;
    timezone: string;
    timeFormat: string;
    companyPhone: string;
    websiteUrl: string;
}

const DEFAULTS: BrandingState = {
    companyName: "AgentFlow",
    logoUrl: null,
    logoName: null,
    faviconUrl: null,
    faviconName: null,
    timezone: "America/Chicago",
    timeFormat: "12",
    companyPhone: "",
    websiteUrl: "",
};

interface BrandingContextType {
    branding: BrandingState;
    isLoading: boolean;
    refreshBranding: () => Promise<void>;
    formatDateTime: (date: string | Date | null | undefined, options?: { hideTime?: boolean; hideDate?: boolean }) => string;
    formatDate: (date: string | Date | null | undefined) => string;
    formatTime: (date: string | Date | null | undefined) => string;
}

const BrandingContext = createContext<BrandingContextType | undefined>(undefined);

export const BrandingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [branding, setBranding] = useState<BrandingState>({ ...DEFAULTS });
    const [isLoading, setIsLoading] = useState(true);

    const refreshBranding = useCallback(async () => {
        try {
            const { data: authData } = await supabase.auth.getUser();
            const userId = authData.user?.id;
            if (!userId) {
                applyBrandingToDocument(DEFAULTS);
                return;
            }

            const { data: profile } = await supabase
                .from('profiles')
                .select('organization_id')
                .eq('id', userId)
                .maybeSingle();

            const orgId = profile?.organization_id;
            if (!orgId) {
                applyBrandingToDocument(DEFAULTS);
                return;
            }

            const { data, error } = await supabase
                .from('company_settings')
                .select('*')
                .eq('organization_id', orgId)
                .maybeSingle();

            if (error) throw error;

            if (data) {
                const loadedState: BrandingState = {
                    companyName: data.company_name || DEFAULTS.companyName,
                    logoUrl: data.logo_url,
                    logoName: data.logo_name,
                    faviconUrl: data.favicon_url,
                    faviconName: data.favicon_name,
                    timezone: data.timezone || DEFAULTS.timezone,
                    timeFormat: data.time_format || DEFAULTS.timeFormat,
                    companyPhone: data.company_phone || DEFAULTS.companyPhone,
                    websiteUrl: (data as { website_url?: string | null }).website_url || DEFAULTS.websiteUrl,
                };
                setBranding(loadedState);
                applyBrandingToDocument(loadedState);
            } else {
                applyBrandingToDocument(DEFAULTS);
            }
        } catch (error) {
            console.error('Error fetching company branding:', error);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        refreshBranding();
    }, [refreshBranding]);

    const formatDateTime = useCallback((date: string | Date | null | undefined, options?: { hideTime?: boolean; hideDate?: boolean }) => {
        if (!date) return "";
        const d = typeof date === 'string' ? parseISO(date) : date;
        if (!isValid(d)) return typeof date === 'string' ? date : "";

        const dFormat = "MM/dd/yyyy";
        const tFormat = branding.timeFormat === "12" ? "h:mm a" : "HH:mm";

        if (options?.hideTime) return dateFnsFormat(d, dFormat);
        if (options?.hideDate) return dateFnsFormat(d, tFormat);

        return dateFnsFormat(d, `${dFormat} ${tFormat}`);
    }, [branding.timeFormat]);

    const formatDate = useCallback((date: string | Date | null | undefined) => {
        return formatDateTime(date, { hideTime: true });
    }, [formatDateTime]);

    const formatTime = useCallback((date: string | Date | null | undefined) => {
        return formatDateTime(date, { hideDate: true });
    }, [formatDateTime]);

    return (
        <BrandingContext.Provider value={{ branding, isLoading, refreshBranding, formatDateTime, formatDate, formatTime }}>
            {children}
        </BrandingContext.Provider>
    );
};

export const useBranding = () => {
    const context = useContext(BrandingContext);
    if (context === undefined) {
        throw new Error('useBranding must be used within a BrandingProvider');
    }
    return context;
};

function applyBrandingToDocument(branding: BrandingState) {
    document.title = branding.companyName || "AgentFlow";

    if (branding.faviconUrl) {
        let link: HTMLLinkElement | null = document.querySelector("link[rel~='icon']");
        if (!link) {
            link = document.createElement('link');
            link.rel = 'icon';
            document.getElementsByTagName('head')[0].appendChild(link);
        }
        link.href = branding.faviconUrl;
    }
}
