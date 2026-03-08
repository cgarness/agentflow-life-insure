import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Shield, ShieldAlert, ShieldCheck, Search, Activity, Cpu, Target, Radar, AlertTriangle, CheckCircle2, Server, Zap } from "lucide-react";

interface ReportData {
    phoneNumber: string;
    spamScore: number;
    attestation: "A" | "B" | "C";
    status: "Safe" | "Warning" | "Critical";
    carriers: {
        name: string;
        flagged: boolean;
        reason?: string;
    }[];
    lastChecked: string;
}

const mockCheckNumber = async (phone: string): Promise<ReportData> => {
    return new Promise((resolve) => {
        setTimeout(() => {
            // Mock random generation based on some logic
            const isBad = phone.endsWith("99") || phone.includes("555");
            const score = isBad ? Math.floor(Math.random() * 30) + 70 : Math.floor(Math.random() * 25);
            const attestation = isBad ? "C" : (score > 10 ? "B" : "A");

            resolve({
                phoneNumber: phone,
                spamScore: score,
                attestation: attestation as "A" | "B" | "C",
                status: score > 75 ? "Critical" : (score > 40 ? "Warning" : "Safe"),
                carriers: [
                    { name: "AT&T", flagged: score > 60, reason: score > 60 ? "High frequency of short duration calls" : undefined },
                    { name: "Verizon", flagged: score > 80, reason: score > 80 ? "User spam reports detected" : undefined },
                    { name: "T-Mobile", flagged: isBad, reason: isBad ? "Scam Likely categorization" : undefined }
                ],
                lastChecked: new Date().toISOString()
            });
        }, 2800); // 2.8s delay to show off the animation
    });
};

const SpamMonitoring: React.FC = () => {
    const [phoneNumber, setPhoneNumber] = useState("");
    const [isScanning, setIsScanning] = useState(false);
    const [report, setReport] = useState<ReportData | null>(null);

    const handleScan = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!phoneNumber || phoneNumber.length < 10) return;

        setIsScanning(true);
        setReport(null);

        const data = await mockCheckNumber(phoneNumber);

        setIsScanning(false);
        setReport(data);
    };

    const getAttestationColor = (level: string) => {
        switch (level) {
            case "A": return "text-emerald-500 bg-emerald-500/10 border-emerald-500/20";
            case "B": return "text-amber-500 bg-amber-500/10 border-amber-500/20";
            case "C": return "text-rose-500 bg-rose-500/10 border-rose-500/20";
            default: return "text-muted-foreground bg-accent";
        }
    };

    const getScoreColor = (score: number) => {
        if (score < 30) return "text-emerald-500";
        if (score < 60) return "text-amber-500";
        return "text-rose-500";
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
                    <Radar className="w-5 h-5 text-primary" />
                    AI Spam Network Monitoring
                </h2>
            </div>

            <div className="bg-card border rounded-xl p-6 relative overflow-hidden">
                {/* Futuristic Background accents */}
                <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none" />
                <div className="absolute bottom-0 left-0 w-48 h-48 bg-blue-500/5 rounded-full blur-2xl -ml-10 -mb-10 pointer-events-none" />

                <div className="relative z-10 max-w-2xl mx-auto space-y-8">
                    <div className="text-center space-y-2">
                        <h3 className="text-2xl font-bold tracking-tight text-foreground">Number Reputation Check</h3>
                        <p className="text-muted-foreground text-sm">
                            Run a deep neural scan against global carrier databases and STIR/SHAKEN registries.
                        </p>
                    </div>

                    <form onSubmit={handleScan} className="relative group">
                        <div className="absolute -inset-0.5 bg-gradient-to-r from-primary to-blue-500 rounded-xl blur opacity-20 group-hover:opacity-40 transition duration-500"></div>
                        <div className="relative flex items-center bg-background rounded-lg border focus-within:ring-2 focus-within:ring-primary/50 overflow-hidden shadow-sm">
                            <div className="pl-4 pr-2 text-muted-foreground">
                                <Search className="w-5 h-5" />
                            </div>
                            <input
                                type="tel"
                                value={phoneNumber}
                                onChange={(e) => setPhoneNumber(e.target.value)}
                                placeholder="Enter phone number (e.g., 555-123-4567)"
                                className="w-full py-4 px-2 bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none font-mono text-lg"
                                disabled={isScanning}
                            />
                            <button
                                type="submit"
                                disabled={isScanning || !phoneNumber}
                                className="mx-2 px-6 py-2.5 bg-primary text-primary-foreground font-semibold rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                            >
                                {isScanning ? (
                                    <>
                                        <Activity className="w-4 h-4 animate-pulse" />
                                        <span>Analyzing</span>
                                    </>
                                ) : (
                                    <>
                                        <Target className="w-4 h-4" />
                                        <span>Run Scan</span>
                                    </>
                                )}
                            </button>
                        </div>
                    </form>

                    {/* Scanning Animation */}
                    <AnimatePresence mode="wait">
                        {isScanning && (
                            <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: "auto" }}
                                exit={{ opacity: 0, height: 0 }}
                                className="overflow-hidden"
                            >
                                <div className="pt-8 pb-4 flex flex-col items-center justify-center space-y-6">
                                    <div className="relative w-32 h-32">
                                        <motion.div
                                            className="absolute inset-0 border-2 border-primary/20 rounded-full"
                                        />
                                        <motion.div
                                            className="absolute inset-0 border-t-2 border-primary rounded-full"
                                            animate={{ rotate: 360 }}
                                            transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                                        />
                                        <motion.div
                                            className="absolute inset-4 border-b-2 border-blue-500 rounded-full"
                                            animate={{ rotate: -360 }}
                                            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                                        />
                                        <div className="absolute inset-0 flex items-center justify-center">
                                            <Cpu className="w-8 h-8 text-primary animate-pulse" />
                                        </div>

                                        {/* Radar Sweep Effect */}
                                        <motion.div
                                            className="absolute top-1/2 left-1/2 w-16 h-16 origin-top-left bg-gradient-to-br from-primary/30 to-transparent"
                                            style={{ borderRadius: "100% 0 0 0" }}
                                            animate={{ rotate: 360 }}
                                            transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                                        />
                                    </div>

                                    <div className="space-y-2 text-center w-full max-w-xs">
                                        <div className="flex justify-between text-xs text-muted-foreground font-mono">
                                            <span>Querying STIR/SHAKEN matrix</span>
                                            <span className="text-primary animate-pulse">Running...</span>
                                        </div>
                                        <div className="h-1 bg-accent rounded-full overflow-hidden">
                                            <motion.div
                                                className="h-full bg-primary"
                                                initial={{ width: "0%" }}
                                                animate={{ width: "100%" }}
                                                transition={{ duration: 2.5, ease: "easeInOut" }}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </motion.div>
                        )}

                        {/* Results Display */}
                        {report && (
                            <motion.div
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.5, ease: "easeOut" }}
                                className="pt-6 border-t"
                            >
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

                                    {/* Status Card */}
                                    <div className="col-span-1 md:col-span-3 bg-background border rounded-xl p-5 flex items-center justify-between">
                                        <div className="flex items-center gap-4">
                                            <div className={`w-12 h-12 rounded-full flex items-center justify-center ${report.status === "Safe" ? "bg-emerald-500/10 text-emerald-500" :
                                                report.status === "Warning" ? "bg-amber-500/10 text-amber-500" :
                                                    "bg-rose-500/10 text-rose-500 shadow-[0_0_15px_rgba(244,63,94,0.3)]"
                                                }`}>
                                                {report.status === "Safe" ? <ShieldCheck className="w-6 h-6" /> :
                                                    report.status === "Warning" ? <ShieldAlert className="w-6 h-6" /> :
                                                        <Shield className="w-6 h-6" />}
                                            </div>
                                            <div>
                                                <p className="text-sm text-muted-foreground font-medium">Network Consensus</p>
                                                <h4 className={`text-2xl font-bold tracking-tight ${report.status === "Safe" ? "text-emerald-500" :
                                                    report.status === "Warning" ? "text-amber-500" : "text-rose-500"
                                                    }`}>
                                                    {report.status.toUpperCase()}
                                                </h4>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-sm font-mono text-muted-foreground">{report.phoneNumber}</p>
                                            <p className="text-xs text-muted-foreground mt-1 text-opacity-70">
                                                Scanned at {new Date(report.lastChecked).toLocaleTimeString()}
                                            </p>
                                        </div>
                                    </div>

                                    {/* Attestation Score */}
                                    <div className="bg-background border rounded-xl p-5 space-y-4">
                                        <div className="flex items-center justify-between">
                                            <h5 className="text-sm font-medium text-foreground">STIR/SHAKEN</h5>
                                            <Server className="w-4 h-4 text-muted-foreground" />
                                        </div>
                                        <div className="flex flex-col items-center justify-center py-4">
                                            <div className={`w-20 h-20 rounded-full border-4 flex items-center justify-center text-3xl font-bold font-mono ${getAttestationColor(report.attestation)}`}>
                                                {report.attestation}
                                            </div>
                                            <p className="text-xs text-center text-muted-foreground mt-4 leading-relaxed">
                                                {report.attestation === "A" ? "Full Attestation (Caller is verified)" :
                                                    report.attestation === "B" ? "Partial Attestation (Call originates from known network)" :
                                                        "Gateway Attestation (Caller identity unverified)"}
                                            </p>
                                        </div>
                                    </div>

                                    {/* Spam Probability */}
                                    <div className="bg-background border rounded-xl p-5 space-y-4">
                                        <div className="flex items-center justify-between">
                                            <h5 className="text-sm font-medium text-foreground">Spam Confidence</h5>
                                            <Zap className="w-4 h-4 text-muted-foreground" />
                                        </div>
                                        <div className="flex flex-col items-center justify-center py-4 space-y-4">
                                            <div className="relative w-32 h-16 overflow-hidden flex items-end justify-center">
                                                {/* Half circle gauge */}
                                                <div className="absolute top-0 w-32 h-32 rounded-full border-8 border-accent"></div>
                                                <motion.div
                                                    className={`absolute top-0 w-32 h-32 rounded-full border-8 border-b-transparent border-r-transparent rotate-45 transform origin-center ${report.spamScore < 30 ? "border-emerald-500" :
                                                        report.spamScore < 60 ? "border-amber-500" : "border-rose-500"
                                                        }`}
                                                    initial={{ rotate: -135 }}
                                                    animate={{ rotate: -135 + (report.spamScore / 100) * 180 }}
                                                    transition={{ duration: 1, ease: "easeOut" }}
                                                ></motion.div>
                                                <div className="absolute bottom-0 text-3xl font-bold tracking-tight bg-background px-2 -mb-2">
                                                    <span className={getScoreColor(report.spamScore)}>{report.spamScore}</span>
                                                </div>
                                            </div>
                                            <p className="text-xs text-center text-muted-foreground">
                                                Machine learning probability based on call patterns.
                                            </p>
                                        </div>
                                    </div>

                                    {/* Carrier Flags */}
                                    <div className="bg-background border rounded-xl p-5 space-y-4">
                                        <div className="flex items-center justify-between">
                                            <h5 className="text-sm font-medium text-foreground">Carrier Filters</h5>
                                            <Activity className="w-4 h-4 text-muted-foreground" />
                                        </div>
                                        <div className="space-y-3 pt-2">
                                            {report.carriers.map((carrier, idx) => (
                                                <div key={idx} className="flex items-start justify-between text-sm">
                                                    <div className="flex items-center gap-2">
                                                        {carrier.flagged ? (
                                                            <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                                                        ) : (
                                                            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                                                        )}
                                                        <div>
                                                            <p className={`font-medium ${carrier.flagged ? "text-foreground" : "text-muted-foreground"}`}>
                                                                {carrier.name}
                                                            </p>
                                                            {carrier.reason && (
                                                                <p className="text-xs text-rose-500/80 mt-0.5 leading-snug">{carrier.reason}</p>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <span className={`text-xs font-mono font-medium px-2 py-0.5 rounded-full ${carrier.flagged ? "bg-rose-500/10 text-rose-500" : "bg-emerald-500/10 text-emerald-500"
                                                        }`}>
                                                        {carrier.flagged ? "Blocked" : "Clear"}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>

                </div>
            </div>
        </div>
    );
};

export default SpamMonitoring;
