import { Button } from "@/components/ui/button";
import { Problem } from "./Field";

interface Props {
  /** What could not be loaded, as a plural noun: "Campaigns". */
  what: string;
  onRetry: () => void;
}

/** A failed option lookup. The fields stay usable and the author can ask again. */
export default function OptionsAlert({what, onRetry}: Props) {
  return <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-badge-error-surface p-3">
    <Problem>{what} could not be loaded.</Problem>
    <Button type="button" variant="outline" size="sm" className="h-11 md:h-9" onClick={onRetry}>Try again</Button>
  </div>;
}
