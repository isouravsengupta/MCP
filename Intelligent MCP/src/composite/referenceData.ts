export interface KnownCompositeSku {
  name: string;
  relatedFulfillmentProviders: string[];
}

// This starter list is intentionally small and easy to edit.
// You can keep adding examples from Org62 data exports.
export const KNOWN_COMPOSITE_SKUS: KnownCompositeSku[] = [
  {
    name: "Automation Advanced",
    relatedFulfillmentProviders: ["force.com", "mulesoft", "mulesoft_rpa"]
  },
  {
    name: "Marketing Cloud Personalization+ (AMER)",
    relatedFulfillmentProviders: ["force.com", "exacttarget"]
  },
  {
    name: "Health Cloud Intelligence + Tableau - Enterprise Edition",
    relatedFulfillmentProviders: ["force.com", "tableau"]
  },
  {
    name: "MuleSoft - MuleSoft Integration SF - Starter",
    relatedFulfillmentProviders: ["force.com", "mulesoft"]
  }
];
