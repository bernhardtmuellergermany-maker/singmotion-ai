/** Public, non-sensitive launch readiness: never imply customer payments or generation work. */
export interface CustomerLaunchReadiness {
  readyForPaidOrders: boolean;
  paymentsConnected: boolean;
  accountsEnabled: boolean;
  customerGenerationEnabled: boolean;
  fulfillmentConnected: boolean;
  deliveryConnected: boolean;
  blockers: string[];
}
export function customerLaunchReadiness(env: Record<string,string|undefined> = process.env): CustomerLaunchReadiness {
  const accountsEnabled = env.CUSTOMER_ACCOUNTS_ENABLED === "true";
  // Until an authenticated gateway and verified webhook adapter ship, this
  // remains false regardless of environment configuration.
  const paymentsConnected = false;
  // A customer payment must never dispatch the private operator workflow.
  const customerGenerationEnabled = false;
  const fulfillmentConnected = false;
  const deliveryConnected = false;
  const blockers = [
    ...(!accountsEnabled ? ["Customer accounts are not enabled."] : []),
    ...(!paymentsConnected ? ["A verified payment provider and inclusive customer price are not connected."] : []),
    ...(!customerGenerationEnabled ? ["Customer-authorized provider dispatch and per-order cost safeguards are not active."] : []),
    ...(!fulfillmentConnected ? ["Idempotent fulfillment, retries and refunds are not connected to customer orders."] : []),
    ...(!deliveryConnected ? ["Private completed-video delivery and email recovery are not activated."] : []),
  ];
  return { readyForPaidOrders: blockers.length === 0, paymentsConnected, accountsEnabled, customerGenerationEnabled, fulfillmentConnected, deliveryConnected, blockers };
}
