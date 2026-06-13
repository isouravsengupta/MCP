import { evaluateCompositeScenario } from "./validator.js";

const sample = evaluateCompositeScenario({
  compositeSkuName: "MuleSoft - MuleSoft Integration SF - Starter",
  forceOrgIds: ["00D111111111111", "00D222222222222"],
  anypointOrgIds: ["US-263fcd88-eedc-4cde-b11f-45f33b8659c2"],
  orderPattern: "multi_order"
});

console.log(JSON.stringify(sample, null, 2));
