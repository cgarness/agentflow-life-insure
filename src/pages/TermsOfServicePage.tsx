import LegalPageLayout from "@/components/legal/LegalPageLayout";
import { termsSections } from "@/content/legal";
export default function TermsOfServicePage() { return <LegalPageLayout title="Terms of Service" sections={termsSections} />; }
