import { AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { safeCarrierLogoUrl, type CarrierDirectoryItem } from "@/lib/carrierResources";
import CarrierResources from "./CarrierResources";

export default function CarrierAccordionCard({ carrier }: { carrier: CarrierDirectoryItem }) {
  const logoUrl = safeCarrierLogoUrl(carrier.logo_url);
  const initial = Array.from(carrier.name.trim())[0]?.toLocaleUpperCase() || "C";

  return (
    <AccordionItem
      value={carrier.id}
      className="overflow-hidden rounded-xl border border-border bg-card shadow-sm motion-reduce:[&_*]:!animate-none motion-reduce:[&_*]:!transition-none"
    >
      <AccordionTrigger className="gap-3 px-4 py-4 text-left hover:bg-accent/40 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-[state=open]:bg-accent/40">
        <span className="flex min-w-0 flex-1 items-center gap-3">
          <Avatar className="h-10 w-10 rounded-lg border border-border" aria-hidden="true">
            {logoUrl && <AvatarImage src={logoUrl} alt="" className="object-contain" />}
            <AvatarFallback className="rounded-lg text-sm font-semibold">{initial}</AvatarFallback>
          </Avatar>
          <span className="min-w-0 break-words text-base font-semibold">{carrier.name}</span>
        </span>
      </AccordionTrigger>
      <AccordionContent className="border-t border-border px-4 pb-4 pt-3">
        <CarrierResources carrier={carrier} />
      </AccordionContent>
    </AccordionItem>
  );
}
