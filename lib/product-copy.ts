/** Typed locale entry point. English remains the default; no partial language switch. */
type ProductCopy = { steps: readonly [string, string, string, string, string] };
export const productCopy: Record<"en" | "de", ProductCopy> = {
  en: { steps: ["Audio", "Photo", "Format", "Performance", "Generate"] },
  de: { steps: ["Audio", "Foto", "Format", "Performance", "Erstellen"] },
};
