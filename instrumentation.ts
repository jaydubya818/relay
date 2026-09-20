export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initializeProductionFederation } = await import("./lib/v2/production-crypto");
    if (process.env.RELAY_FEDERATION_ENABLED === "true" && process.env.RELAY_QUALIFICATION_MODE === "true") {
      const { qualificationCrypto } = await import("./lib/v2/qualification-crypto");
      initializeProductionFederation(process.env, qualificationCrypto(process.env));
    } else {
      initializeProductionFederation();
    }
  }
}
