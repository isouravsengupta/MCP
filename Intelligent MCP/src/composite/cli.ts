import { evaluateCompositeScenario } from "./validator.js";

const sampleResult = evaluateCompositeScenario({
  compositeSkuName: "MuleSoft - MuleSoft Integration SF - Starter",
  forceOrgIds: ["00D111111111111", "00D222222222222"],
  anypointOrgIds: ["US-263fcd88-eedc-4cde-b11f-45f33b8659c2"],
  orderPattern: "multi_order",
  accountId: "001-example",
  notes: "POC test run from CLI"
});

console.log(JSON.stringify(sampleResult, null, 2));
