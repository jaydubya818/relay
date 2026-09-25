export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initializeProductionFederation } = await import("./lib/v2/production-crypto");
    if (process.env.RELAY_FEDERATION_ENABLED !== "true") return;
    if (process.env.RELAY_QUALIFICATION_MODE === "true") {
      const { qualificationCrypto } = await import("./lib/v2/qualification-crypto");
      initializeProductionFederation(process.env, qualificationCrypto(process.env));
      return;
    }
    if (process.env.NODE_ENV === "production") {
      if (process.env.RELAY_CRYPTO_BACKEND === "vercel-secret") {
        const { productionSecretCrypto } = await import("./lib/v2/production-secret-crypto");
        initializeProductionFederation(process.env, productionSecretCrypto(process.env));
      } else {
        const { productionHostedCrypto } = await import("./lib/v2/production-hosted-crypto");
        initializeProductionFederation(process.env, productionHostedCrypto(process.env));
      }
      return;
    }
    initializeProductionFederation();
  }
}
