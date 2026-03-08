import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface BrandingState {
    companyName: string;
    logoUrl: string | null;
    logoName: string | null;
    faviconUrl: string | null;
    faviconName: string | null;
    timezone: string;
    dateFormat: string;
    timeFormat: string;
    primaryColor: string;
    companyPhone: string;
}

const DEFAULTS: BrandingState = {
    companyName: "AgentFlow",
    logoUrl: null,
    logoName: null,
    faviconUrl: null,
    faviconName: null,
    timezone: "America/Chicago",
    dateFormat: "MM/DD/YYYY",
    timeFormat: "12",
    primaryColor: "#3B82F6",
    companyPhone: "",
};

const SINGLETON_ID = "00000000-0000-0000-0000-000000000000";

interface BrandingContextType {
    branding: BrandingState;
    isLoading: boolean;
    refreshBranding: () => Promise<void>;
}

const BrandingContext = createContext<BrandingContextType | undefined>(undefined);

export const BrandingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [branding, setBranding] = useState<BrandingState>({ ...DEFAULTS });
    const [isLoading, setIsLoading] = useState(true);

    const refreshBranding = async () => {
        try {
            const { data, error } = await supabase
                .from('company_settings')
                .select('*')
                .eq('id', SINGLETON_ID)
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
                    dateFormat: data.date_format || DEFAULTS.dateFormat,
                    timeFormat: data.time_format || DEFAULTS.timeFormat,
                    primaryColor: data.primary_color || DEFAULTS.primaryColor,
                    companyPhone: data.company_phone || DEFAULTS.companyPhone,
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
    };

    useEffect(() => {
        refreshBranding();
    }, []);

    return (
        <BrandingContext.Provider value={{ branding, isLoading, refreshBranding }}>
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

// Helper function to update the DOM based on branding
function applyBrandingToDocument(branding: BrandingState) {
    // Update document title
    document.title = branding.companyName || "AgentFlow";

    // Update favicon
    if (branding.faviconUrl) {
        let link: HTMLLinkElement | null = document.querySelector("link[rel~='icon']");
        if (!link) {
            link = document.createElement('link');
            link.rel = 'icon';
            document.getElementsByTagName('head')[0].appendChild(link);
        }
        link.href = branding.faviconUrl;
    }

    // Set CSS Variables for primary colors
    // To handle shadcn UI correctly, we need the HSL value for the primary variable
    // For simplicity here, we'll try applying the raw hex color directly to
    // the specific elements that need it, or standard CSS vars.
    // In a more robust system you'd convert HEX to HSL and set --primary.

    // Example for a direct style override on root (if using simple variables):
    const root = document.documentElement;
    // If your design system uses hex for primary:
    // root.style.setProperty('--primary', branding.primaryColor);

    // For shadcn (which uses HSL), we can inject a style block if needed,
    // but let's provide the raw hex value as a special theme variable for now.
    root.style.setProperty('--brand-primary', branding.primaryColor);
}
