import LegalPageLayout from "@/components/legal/LegalPageLayout";
import { privacySections } from "@/content/legal";
export default function PrivacyPolicyPage() { return <LegalPageLayout title="Privacy Policy" sections={privacySections} />; }
