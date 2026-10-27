import type { SheetsContext } from "./schema";

/**
 * Mapping v2 feature gate — BOTH halves are required:
 *   G1 (operator intent): the build flag VITE_GOOGLE_SHEETS_MAPPING_V2 === "true" (absent by default);
 *   G2 (compatibility):   the server catalog advertises mapping version 2, which happens only when the new Edge code
 *                         AND the typed catalog migration are both deployed.
 * Otherwise the legacy mapping screen runs unchanged.
 */
export const mappingV2FlagOn = (): boolean => import.meta.env.VITE_GOOGLE_SHEETS_MAPPING_V2 === "true";

export function serverSupportsMappingV2(context: Pick<SheetsContext, "mapping_versions"> | null | undefined): boolean {
  return Array.isArray(context?.mapping_versions) && context!.mapping_versions!.includes(2);
}

export function mappingV2Active(flagOn: boolean, context: Pick<SheetsContext, "mapping_versions"> | null | undefined): boolean {
  return flagOn && serverSupportsMappingV2(context);
}
