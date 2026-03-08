import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
    Phone, Shield, ShieldCheck,
    Settings2, RefreshCw, Trash2,
    ExternalLink, Loader2, Info, Search, ShoppingCart,
    Zap, MessageSquare, Wifi, MapPin, Sparkles, CheckCircle2, Globe, Lock
} from "lucide-react";
import {
    Card, CardContent, CardDescription,
    CardHeader, CardTitle
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

const SINGLETON_ID = "00000000-0000-0000-0000-000000000000";

interface PhoneConfig {
    provider: string;
    account_sid: string;
    auth_token: string;
    api_key: string;
    api_secret: string;
    application_sid: string;
}

interface PhoneNumber {
    id: string;
    phone_number: string;
    friendly_name: string;
    status: string;
    assigned_to: string | null;
}

// Format phone number nicely: +12135551234 → (213) 555-1234
const formatPhone = (num: string) => {
    const cleaned = num.replace(/\D/g, "");
    if (cleaned.length === 11 && cleaned.startsWith("1")) {
        const area = cleaned.slice(1, 4);
        const mid = cleaned.slice(4, 7);
        const last = cleaned.slice(7);
        return `(${area}) ${mid}-${last}`;
    }
    return num;
};

// Derive city from area code (common US area codes)
const areaCodeToCity: Record<string, string> = {
    "201": "Jersey City, NJ", "202": "Washington, DC", "203": "Bridgeport, CT",
    "206": "Seattle, WA", "207": "Portland, ME", "208": "Boise, ID",
    "209": "Stockton, CA", "210": "San Antonio, TX", "212": "New York, NY",
    "213": "Los Angeles, CA", "214": "Dallas, TX", "215": "Philadelphia, PA",
    "216": "Cleveland, OH", "217": "Springfield, IL", "218": "Duluth, MN",
    "219": "Gary, IN", "224": "Chicago, IL", "225": "Baton Rouge, LA",
    "228": "Gulfport, MS", "229": "Albany, GA", "231": "Muskegon, MI",
    "234": "Akron, OH", "239": "Fort Myers, FL", "240": "Rockville, MD",
    "248": "Troy, MI", "251": "Mobile, AL", "252": "Greenville, NC",
    "253": "Tacoma, WA", "254": "Killeen, TX", "256": "Huntsville, AL",
    "260": "Fort Wayne, IN", "262": "Kenosha, WI", "267": "Philadelphia, PA",
    "269": "Kalamazoo, MI", "270": "Bowling Green, KY", "274": "Green Bay, WI",
    "281": "Houston, TX", "301": "Rockville, MD", "302": "Wilmington, DE",
    "303": "Denver, CO", "304": "Charleston, WV", "305": "Miami, FL",
    "307": "Cheyenne, WY", "308": "Grand Island, NE", "309": "Peoria, IL",
    "310": "Los Angeles, CA", "312": "Chicago, IL", "313": "Detroit, MI",
    "314": "St. Louis, MO", "315": "Syracuse, NY", "316": "Wichita, KS",
    "317": "Indianapolis, IN", "318": "Shreveport, LA", "319": "Cedar Rapids, IA",
    "320": "St. Cloud, MN", "321": "Orlando, FL", "323": "Los Angeles, CA",
    "325": "Abilene, TX", "330": "Akron, OH", "331": "Aurora, IL",
    "332": "New York, NY", "334": "Montgomery, AL", "336": "Greensboro, NC",
    "337": "Lafayette, LA", "339": "Lynn, MA", "340": "St. Thomas, VI",
    "346": "Houston, TX", "347": "New York, NY", "351": "Lowell, MA",
    "352": "Gainesville, FL", "360": "Vancouver, WA", "361": "Corpus Christi, TX",
    "385": "Salt Lake City, UT", "386": "Daytona Beach, FL", "401": "Providence, RI",
    "402": "Omaha, NE", "404": "Atlanta, GA", "405": "Oklahoma City, OK",
    "406": "Billings, MT", "407": "Orlando, FL", "408": "San Jose, CA",
    "409": "Beaumont, TX", "410": "Baltimore, MD", "412": "Pittsburgh, PA",
    "413": "Springfield, MA", "414": "Milwaukee, WI", "415": "San Francisco, CA",
    "417": "Springfield, MO", "419": "Toledo, OH", "423": "Chattanooga, TN",
    "424": "Los Angeles, CA", "425": "Bellevue, WA", "430": "Tyler, TX",
    "432": "Midland, TX", "434": "Lynchburg, VA", "435": "St. George, UT",
    "440": "Lorain, OH", "442": "Oceanside, CA", "443": "Baltimore, MD",
    "458": "Eugene, OR", "469": "Dallas, TX", "470": "Atlanta, GA",
    "475": "Bridgeport, CT", "478": "Macon, GA", "479": "Fort Smith, AR",
    "480": "Mesa, AZ", "484": "Allentown, PA", "501": "Little Rock, AR",
    "502": "Louisville, KY", "503": "Portland, OR", "504": "New Orleans, LA",
    "505": "Albuquerque, NM", "507": "Rochester, MN", "508": "Worcester, MA",
    "509": "Spokane, WA", "510": "Oakland, CA", "512": "Austin, TX",
    "513": "Cincinnati, OH", "515": "Des Moines, IA", "516": "Hempstead, NY",
    "517": "Lansing, MI", "518": "Albany, NY", "520": "Tucson, AZ",
    "530": "Redding, CA", "531": "Omaha, NE", "539": "Tulsa, OK",
    "540": "Roanoke, VA", "541": "Eugene, OR", "551": "Jersey City, NJ",
    "559": "Fresno, CA", "561": "West Palm Beach, FL", "562": "Long Beach, CA",
    "563": "Davenport, IA", "567": "Toledo, OH", "571": "Arlington, VA",
    "573": "Jefferson City, MO", "574": "South Bend, IN", "575": "Las Cruces, NM",
    "580": "Lawton, OK", "585": "Rochester, NY", "586": "Warren, MI",
    "601": "Jackson, MS", "602": "Phoenix, AZ", "603": "Manchester, NH",
    "605": "Sioux Falls, SD", "606": "Ashland, KY", "607": "Binghamton, NY",
    "608": "Madison, WI", "609": "Trenton, NJ", "610": "Allentown, PA",
    "612": "Minneapolis, MN", "614": "Columbus, OH", "615": "Nashville, TN",
    "616": "Grand Rapids, MI", "617": "Boston, MA", "618": "Belleville, IL",
    "619": "San Diego, CA", "620": "Dodge City, KS", "623": "Glendale, AZ",
    "626": "Pasadena, CA", "628": "San Francisco, CA", "629": "Nashville, TN",
    "630": "Naperville, IL", "631": "Islip, NY", "636": "O'Fallon, MO",
    "641": "Mason City, IA", "646": "New York, NY", "650": "San Mateo, CA",
    "651": "St. Paul, MN", "657": "Anaheim, CA", "660": "Sedalia, MO",
    "661": "Bakersfield, CA", "662": "Tupelo, MS", "667": "Baltimore, MD",
    "669": "San Jose, CA", "678": "Atlanta, GA", "681": "Charleston, WV",
    "682": "Fort Worth, TX", "689": "Orlando, FL", "701": "Fargo, ND",
    "702": "Las Vegas, NV", "703": "Arlington, VA", "704": "Charlotte, NC",
    "706": "Augusta, GA", "707": "Eureka, CA", "708": "Chicago Heights, IL",
    "710": "US Government", "712": "Sioux City, IA", "713": "Houston, TX",
    "714": "Anaheim, CA", "715": "Wausau, WI", "716": "Buffalo, NY",
    "717": "Lancaster, PA", "718": "New York, NY", "719": "Colorado Springs, CO",
    "720": "Denver, CO", "724": "New Castle, PA", "725": "Las Vegas, NV",
    "727": "St. Petersburg, FL", "731": "Jackson, TN", "732": "New Brunswick, NJ",
    "734": "Ann Arbor, MI", "737": "Austin, TX", "740": "Newark, OH",
    "743": "Greensboro, NC", "747": "Los Angeles, CA", "754": "Fort Lauderdale, FL",
    "757": "Virginia Beach, VA", "760": "Oceanside, CA", "762": "Augusta, GA",
    "763": "Brooklyn Park, MN", "769": "Jackson, MS", "770": "Roswell, GA",
    "772": "Port St. Lucie, FL", "773": "Chicago, IL", "774": "Worcester, MA",
    "775": "Reno, NV", "779": "Rockford, IL", "781": "Lynn, MA",
    "786": "Miami, FL", "801": "Salt Lake City, UT", "802": "Burlington, VT",
    "803": "Columbia, SC", "804": "Richmond, VA", "805": "Oxnard, CA",
    "806": "Lubbock, TX", "808": "Honolulu, HI", "810": "Flint, MI",
    "812": "Evansville, IN", "813": "Tampa, FL", "814": "Erie, PA",
    "815": "Rockford, IL", "816": "Kansas City, MO", "817": "Fort Worth, TX",
    "818": "Los Angeles, CA", "828": "Asheville, NC", "830": "New Braunfels, TX",
    "831": "Salinas, CA", "832": "Houston, TX", "843": "Charleston, SC",
    "845": "New City, NY", "847": "Elgin, IL", "848": "New Brunswick, NJ",
    "850": "Tallahassee, FL", "856": "Camden, NJ", "857": "Boston, MA",
    "858": "San Diego, CA", "859": "Lexington, KY", "860": "Hartford, CT",
    "862": "Newark, NJ", "863": "Lakeland, FL", "864": "Greenville, SC",
    "865": "Knoxville, TN", "870": "Jonesboro, AR", "872": "Chicago, IL",
    "878": "Pittsburgh, PA", "901": "Memphis, TN", "903": "Tyler, TX",
    "904": "Jacksonville, FL", "906": "Sault Ste. Marie, MI", "907": "Anchorage, AK",
    "908": "Elizabeth, NJ", "909": "San Bernardino, CA", "910": "Fayetteville, NC",
    "912": "Savannah, GA", "913": "Kansas City, KS", "914": "White Plains, NY",
    "915": "El Paso, TX", "916": "Sacramento, CA", "917": "New York, NY",
    "918": "Tulsa, OK", "919": "Raleigh, NC", "920": "Green Bay, WI",
    "925": "Concord, CA", "928": "Yuma, AZ", "929": "New York, NY",
    "930": "Columbus, IN", "931": "Clarksville, TN", "936": "Conroe, TX",
    "937": "Dayton, OH", "938": "Huntsville, AL", "940": "Denton, TX",
    "941": "Sarasota, FL", "947": "Troy, MI", "949": "Irvine, CA",
    "951": "Riverside, CA", "952": "Bloomington, MN", "954": "Fort Lauderdale, FL",
    "956": "Laredo, TX", "959": "Hartford, CT", "970": "Fort Collins, CO",
    "971": "Portland, OR", "972": "Dallas, TX", "973": "Newark, NJ",
    "978": "Lowell, MA", "979": "College Station, TX", "980": "Charlotte, NC",
    "984": "Raleigh, NC", "985": "Houma, LA",
};

const getCityFromNumber = (phoneNumber: string) => {
    const cleaned = phoneNumber.replace(/\D/g, "");
    const areaCode = cleaned.startsWith("1") ? cleaned.slice(1, 4) : cleaned.slice(0, 3);
    return areaCodeToCity[areaCode] || "United States";
};

const PhoneSettings: React.FC = () => {
    const { toast } = useToast();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [config, setConfig] = useState<PhoneConfig>({
        provider: "telnyx",
        account_sid: "",
        auth_token: "",
        api_key: "",
        api_secret: "",
        application_sid: "",
    });
    const [numbers, setNumbers] = useState<PhoneNumber[]>([]);
    const [isTesting, setIsTesting] = useState(false);
    const [connectionVerified, setConnectionVerified] = useState(false);

    // Search & Buy State
    const [isBuyingNumber, setIsBuyingNumber] = useState(false);
    const [searchAreaCode, setSearchAreaCode] = useState("");
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [isProvisioning, setIsProvisioning] = useState<string | null>(null);

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        try {
            setLoading(true);
            const { data: configData, error: configError } = await supabase
                .from('phone_settings')
                .select('*')
                .eq('id', SINGLETON_ID)
                .maybeSingle();

            if (configError) throw configError;
            if (configData) {
                setConfig({
                    provider: configData.provider || "telnyx",
                    account_sid: configData.account_sid || "",
                    auth_token: configData.auth_token || "",
                    api_key: configData.api_key || "",
                    api_secret: configData.api_secret || "",
                    application_sid: configData.application_sid || "",
                });
            }

            const { data: numbersData, error: numbersError } = await supabase
                .from('phone_numbers')
                .select('*')
                .order('created_at', { ascending: false });

            if (numbersError) throw numbersError;
            setNumbers(numbersData || []);
        } catch (error) {
            console.error("Error fetching phone settings:", error);
            toast({ title: "Error loading settings", description: "Could not fetch configuration.", variant: "destructive" });
        } finally {
            setLoading(false);
        }
    };

    const handleSaveConfig = async () => {
        try {
            setSaving(true);
            const { error } = await supabase
                .from('phone_settings')
                .upsert({ id: SINGLETON_ID, ...config, updated_at: new Date().toISOString() });
            if (error) throw error;
            toast({ title: "Credentials saved", description: "Your API key has been securely stored." });
        } catch (error) {
            console.error("Error saving config:", error);
            toast({ title: "Save failed", description: "Could not update credentials.", variant: "destructive" });
        } finally {
            setSaving(false);
        }
    };

    const handleTestConnection = async () => {
        if (!config.api_key) {
            toast({ title: "Missing API Key", description: "Please enter your Telnyx API Key first.", variant: "destructive" });
            return;
        }
        setIsTesting(true);
        setConnectionVerified(false);
        try {
            const { data, error } = await supabase.functions.invoke('telnyx-check-connection', {
                body: { api_key: config.api_key },
            });
            if (error) throw error;
            if (data?.success) {
                setConnectionVerified(true);
                toast({ title: "✓ Connected to Telnyx", description: "Your API key is valid and active." });
            } else {
                throw new Error(data?.error || "Connection failed");
            }
        } catch (error: any) {
            console.error("Connection test error:", error);
            toast({ title: "Connection Failed", description: error.message, variant: "destructive" });
        } finally {
            setIsTesting(false);
        }
    };

    const handleSearchNumbers = async () => {
        if (!searchAreaCode || searchAreaCode.length < 3) {
            toast({ title: "Invalid Search", description: "Please enter a valid 3-digit area code.", variant: "destructive" });
            return;
        }
        setIsSearching(true);
        try {
            const { data, error } = await supabase.functions.invoke('telnyx-search-numbers', {
                body: { area_code: searchAreaCode, api_key: config.api_key },
            });
            if (error) throw error;
            if (data?.error) throw new Error(data.error);
            setSearchResults(data?.numbers || []);
            if (data?.numbers?.length === 0) {
                toast({ title: "No numbers found", description: "Try a different area code." });
            }
        } catch (error: any) {
            console.error("Search error:", error);
            toast({ title: "Search Failed", description: error.message, variant: "destructive" });
        } finally {
            setIsSearching(false);
        }
    };

    const handleBuyNumber = async (phoneNumber: string) => {
        setIsProvisioning(phoneNumber);
        try {
            const { data, error } = await supabase.functions.invoke('telnyx-buy-number', {
                body: { phone_number: phoneNumber, api_key: config.api_key },
            });
            if (error) throw error;
            if (data?.error) throw new Error(data.error);
            toast({ title: "🎉 Number Activated!", description: "Auto-configured with HD Voice, SMS, and SIP credentials." });
            setIsBuyingNumber(false);
            setSearchResults([]);
            setSearchAreaCode("");
            fetchData();
        } catch (error: any) {
            console.error("Provisioning error:", error);
            toast({ title: "Purchase Failed", description: error.message, variant: "destructive" });
        } finally {
            setIsProvisioning(null);
        }
    };

    const handleDeleteNumber = async (id: string) => {
        try {
            const { error } = await supabase.from('phone_numbers').delete().eq('id', id);
            if (error) throw error;
            toast({ title: "Number Removed" });
            fetchData();
        } catch (error: any) {
            toast({ title: "Delete failed", description: error.message, variant: "destructive" });
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center p-16">
                <div className="flex flex-col items-center gap-3">
                    <div className="relative">
                        <div className="w-12 h-12 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
                        <Phone className="w-5 h-5 text-primary absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                    </div>
                    <p className="text-sm text-muted-foreground animate-pulse">Loading phone systems...</p>
                </div>
            </div>
        );
    }

    return (
        <TooltipProvider>
            <div className="space-y-8">

                {/* Hero Header */}
                <div className="relative overflow-hidden rounded-xl border bg-gradient-to-br from-background via-background to-primary/5 p-6">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl" />
                    <div className="relative flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20">
                                <Phone className="w-6 h-6 text-primary" />
                            </div>
                            <div>
                                <h3 className="text-xl font-bold text-foreground tracking-tight">Phone Systems</h3>
                                <p className="text-sm text-muted-foreground">Powered by Telnyx · HD Voice · Enterprise SMS</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                onClick={() => setIsBuyingNumber(true)}
                                className="bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 shadow-lg shadow-primary/20 transition-all duration-300 hover:shadow-primary/40 hover:scale-[1.02]"
                            >
                                <ShoppingCart className="w-4 h-4 mr-2" /> Buy Number
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={handleTestConnection}
                                disabled={isTesting}
                                className="transition-all duration-300"
                            >
                                {isTesting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> :
                                    connectionVerified ? <CheckCircle2 className="w-4 h-4 mr-2 text-emerald-500" /> :
                                        <RefreshCw className="w-4 h-4 mr-2" />}
                                {connectionVerified ? "Connected" : "Test Connection"}
                            </Button>
                        </div>
                    </div>

                    {/* Feature Pills */}
                    <div className="relative flex flex-wrap gap-2 mt-4">
                        {[
                            { icon: Zap, label: "HD Voice", color: "text-amber-500 bg-amber-500/10 border-amber-500/20" },
                            { icon: MessageSquare, label: "SMS/MMS", color: "text-blue-500 bg-blue-500/10 border-blue-500/20" },
                            { icon: Shield, label: "Spam Shield", color: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20" },
                            { icon: Wifi, label: "WebRTC Dialer", color: "text-violet-500 bg-violet-500/10 border-violet-500/20" },
                            { icon: Globe, label: "Auto-Provisioning", color: "text-cyan-500 bg-cyan-500/10 border-cyan-500/20" },
                            { icon: Lock, label: "Encrypted SIP", color: "text-rose-500 bg-rose-500/10 border-rose-500/20" },
                        ].map((feat) => (
                            <span key={feat.label} className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${feat.color} transition-transform duration-300 hover:scale-105`}>
                                <feat.icon className="w-3 h-3" /> {feat.label}
                            </span>
                        ))}
                    </div>
                </div>

                {/* API Key & Quick Start */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <Card className="border-border/50 shadow-sm hover:shadow-md transition-shadow duration-300">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-sm flex items-center gap-2">
                                <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
                                    <Shield className="w-3.5 h-3.5 text-primary" />
                                </div>
                                API Credentials
                            </CardTitle>
                            <CardDescription>Your master key for the Telnyx integration.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <div className="flex items-center gap-2">
                                    <label className="text-xs font-medium uppercase text-muted-foreground tracking-wider">API Key</label>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            <p className="max-w-xs text-xs">Found in Telnyx Portal under <strong>Account Settings {">"} API Keys</strong>.</p>
                                        </TooltipContent>
                                    </Tooltip>
                                </div>
                                <Input
                                    value={config.api_key}
                                    type="password"
                                    onChange={e => setConfig({ ...config, api_key: e.target.value })}
                                    placeholder="KEY••••••••••••••••••••••••••••"
                                    className="font-mono text-sm bg-muted/30 border-border/50"
                                />
                            </div>
                            <Button
                                className="w-full transition-all duration-300 hover:scale-[1.01]"
                                onClick={handleSaveConfig}
                                disabled={saving}
                            >
                                {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</> : "Save Credentials"}
                            </Button>
                        </CardContent>
                    </Card>

                    <Card className="border-primary/15 bg-gradient-to-br from-primary/[0.03] to-transparent shadow-sm">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-sm flex items-center gap-2 text-primary">
                                <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
                                    <Sparkles className="w-3.5 h-3.5 text-primary" />
                                </div>
                                Quick Start
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm space-y-3 text-foreground/80">
                            {[
                                "Create a Telnyx Account and add a payment method.",
                                "Navigate to Account Settings > API Keys.",
                                "Create an API Key & paste it on the left.",
                                "Click Save, then Test Connection.",
                                "Click Buy Number to instantly provision a line!",
                            ].map((step, i) => (
                                <div key={i} className="flex items-start gap-3 group">
                                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold group-hover:bg-primary group-hover:text-primary-foreground transition-colors duration-300">
                                        {i + 1}
                                    </span>
                                    <span className="text-sm leading-relaxed pt-0.5">{step}</span>
                                </div>
                            ))}
                            <div className="pt-2">
                                <a href="https://portal.telnyx.com" target="_blank" rel="noreferrer"
                                    className="inline-flex items-center gap-1.5 text-primary hover:underline font-medium bg-primary/10 px-3 py-1.5 rounded-lg text-xs transition-all hover:bg-primary/20">
                                    Open Telnyx Portal <ExternalLink className="w-3 h-3" />
                                </a>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Owned Numbers */}
                <div>
                    <div className="flex items-center gap-2 mb-4">
                        <h4 className="text-sm font-semibold text-foreground">Active Lines</h4>
                        <Badge variant="secondary" className="text-xs">{numbers.length} number{numbers.length !== 1 ? "s" : ""}</Badge>
                    </div>

                    {numbers.length === 0 ? (
                        <Card className="border-dashed border-2 border-border/50">
                            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                                <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
                                    <Phone className="w-7 h-7 text-muted-foreground/50" />
                                </div>
                                <p className="text-sm font-medium text-muted-foreground mb-1">No phone numbers yet</p>
                                <p className="text-xs text-muted-foreground/70 mb-4">Buy your first number to start making calls</p>
                                <Button size="sm" variant="outline" onClick={() => setIsBuyingNumber(true)}>
                                    <ShoppingCart className="w-3.5 h-3.5 mr-2" /> Get Your First Number
                                </Button>
                            </CardContent>
                        </Card>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {numbers.map((n, index) => (
                                <Card
                                    key={n.id}
                                    className="group border-border/50 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5 transition-all duration-300"
                                    style={{ animationDelay: `${index * 80}ms` }}
                                >
                                    <CardContent className="p-4">
                                        <div className="flex items-start justify-between mb-3">
                                            <div>
                                                <p className="text-lg font-bold font-mono tracking-tight text-foreground">
                                                    {formatPhone(n.phone_number)}
                                                </p>
                                                <div className="flex items-center gap-1.5 mt-1">
                                                    <MapPin className="w-3 h-3 text-muted-foreground" />
                                                    <span className="text-xs text-muted-foreground">
                                                        {getCityFromNumber(n.phone_number)}
                                                    </span>
                                                </div>
                                            </div>
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8 opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive hover:bg-destructive/10 transition-all duration-200"
                                                        onClick={() => handleDeleteNumber(n.id)}
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </Button>
                                                </TooltipTrigger>
                                                <TooltipContent>Remove Number</TooltipContent>
                                            </Tooltip>
                                        </div>

                                        <div className="flex items-center gap-1.5 mb-3">
                                            <Badge variant="secondary" className="text-[10px] flex items-center gap-1 bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                                                <ShieldCheck className="w-2.5 h-2.5" /> Active
                                            </Badge>
                                            <Badge variant="secondary" className="text-[10px] bg-muted/50">
                                                {n.friendly_name || "Auto Line"}
                                            </Badge>
                                        </div>

                                        <div className="flex flex-wrap gap-1.5">
                                            {[
                                                { icon: Zap, label: "HD Voice", color: "text-amber-600 bg-amber-50 dark:bg-amber-500/10" },
                                                { icon: MessageSquare, label: "SMS", color: "text-blue-600 bg-blue-50 dark:bg-blue-500/10" },
                                                { icon: Shield, label: "Clean", color: "text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10" },
                                            ].map((f) => (
                                                <span key={f.label} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium ${f.color}`}>
                                                    <f.icon className="w-2.5 h-2.5" /> {f.label}
                                                </span>
                                            ))}
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Search & Buy Modal */}
            <Dialog open={isBuyingNumber} onOpenChange={setIsBuyingNumber}>
                <DialogContent className="sm:max-w-[550px] p-0 overflow-hidden">
                    <div className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-6 pb-4">
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2 text-lg">
                                <ShoppingCart className="w-5 h-5 text-primary" />
                                Search & Buy Numbers
                            </DialogTitle>
                            <DialogDescription className="text-sm">
                                Find available numbers by area code. Each number is instantly configured with HD Voice, SMS, SIP credentials, and webhooks.
                            </DialogDescription>
                        </DialogHeader>
                    </div>

                    <div className="p-6 pt-2 space-y-4">
                        <div className="flex gap-2">
                            <div className="relative flex-1">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                <Input
                                    placeholder="Area code (e.g. 213)"
                                    value={searchAreaCode}
                                    onChange={e => setSearchAreaCode(e.target.value)}
                                    className="pl-9 bg-muted/30"
                                    onKeyDown={(e) => e.key === 'Enter' && handleSearchNumbers()}
                                />
                            </div>
                            <Button
                                onClick={handleSearchNumbers}
                                disabled={isSearching || searchAreaCode.length < 3}
                                className="min-w-[100px] transition-all duration-300"
                            >
                                {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : "Search"}
                            </Button>
                        </div>

                        {searchAreaCode.length >= 3 && !isSearching && searchResults.length === 0 && (
                            <div className="text-center py-6 text-sm text-muted-foreground">
                                <Search className="w-8 h-8 mx-auto mb-2 text-muted-foreground/30" />
                                Click Search to find available numbers
                            </div>
                        )}

                        {searchResults.length > 0 && (
                            <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
                                <p className="text-xs text-muted-foreground font-medium">
                                    {searchResults.length} numbers available in {getCityFromNumber(searchResults[0]?.phone_number || "")}
                                </p>
                                {searchResults.map((result, index) => (
                                    <div
                                        key={result.phone_number}
                                        className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-card hover:border-primary/30 hover:shadow-sm transition-all duration-300 group"
                                        style={{ animationDelay: `${index * 50}ms` }}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                                                <Phone className="w-4 h-4 text-primary" />
                                            </div>
                                            <div>
                                                <p className="font-mono text-sm font-semibold">{formatPhone(result.phone_number)}</p>
                                                <div className="flex items-center gap-2 mt-0.5">
                                                    <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                                        <MapPin className="w-2.5 h-2.5" /> {getCityFromNumber(result.phone_number)}
                                                    </span>
                                                    <span className="flex items-center gap-1 text-[10px] text-amber-600">
                                                        <Zap className="w-2.5 h-2.5" /> HD
                                                    </span>
                                                    <span className="flex items-center gap-1 text-[10px] text-blue-600">
                                                        <MessageSquare className="w-2.5 h-2.5" /> SMS
                                                    </span>
                                                    <span className="flex items-center gap-1 text-[10px] text-emerald-600">
                                                        <Shield className="w-2.5 h-2.5" /> Clean
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                        <Button
                                            size="sm"
                                            onClick={() => handleBuyNumber(result.phone_number)}
                                            disabled={isProvisioning !== null}
                                            className="text-xs transition-all duration-300 hover:scale-105"
                                        >
                                            {isProvisioning === result.phone_number ? (
                                                <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> Setting up...</>
                                            ) : (
                                                "$1.00/mo"
                                            )}
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </TooltipProvider>
    );
};

export default PhoneSettings;
