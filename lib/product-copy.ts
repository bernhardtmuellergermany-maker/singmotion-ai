/** Typed locale entry point. English remains the default; no partial language switch. */
type ProductCopy = { steps: readonly [string, string, string, string] };
export const productCopy: Record<"en" | "de", ProductCopy> = {
  en: {
    steps: [
      "Add your song",
      "Choose your photo",
      "Describe performance",
      "Generate",
    ],
  },
  de: {
    steps: [
      "Musik hinzufügen",
      "Foto auswählen",
      "Performance beschreiben",
      "Erstellen",
    ],
  },
};
