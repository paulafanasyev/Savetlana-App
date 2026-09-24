/**
 * REAL EXECUTION VERIFICATION for the external AI provider (spec §48).
 *
 * Runs the FULL Svetlana pipeline — privacy guard -> gateway -> provider ->
 * tool call -> verified answer — exactly as /api/ai/chat does, then reports
 * honestly whether a live model answered or the deterministic MOCK did.
 *
 * Run:  npx tsx scripts/verify-external-ai.ts
 *
 * Exit codes:
 *   0  pipeline answered, report printed
 *   1  external key configured but the live call FAILED (real blocker)
 *
 * This script never prints secrets. It reads config through the same `env`
 * module as production, so what it reports is what the app actually does.
 */
import { prisma } from "../src/lib/prisma";
import { env, hasExternalAiCredentials, integrationStatus } from "../src/lib/env";
import { aiMode } from "../src/lib/ai/gateway";
import { masterAgent } from "../src/lib/ai/agents/master";

const PROBES = [
  "Найди подарок маме до 10000 рублей",
  "Какие ноутбуки до 100 тысяч подходят для работы?",
];

async function main(): Promise<void> {
  console.log("=== Svetlana AI provider verification ===\n");

  // --- Config report (no secret values ever printed) --------------------
  console.log(`AI_GATEWAY_BASE_URL = ${env.aiGatewayBaseUrl}`);
  console.log(`AI_GATEWAY_MODEL    = ${env.aiGatewayModel}`);
  console.log(`AI_GATEWAY_API_KEY  = ${env.aiGatewayApiKey ? "<set, " + env.aiGatewayApiKey.length + " chars>" : "<EMPTY>"}`);
  console.log(`PROVIDER_ORDER      = ${env.aiProviderOrder.join(" -> ")}`);
  console.log(`mode                = ${aiMode().mode} (provider: ${aiMode().provider})`);
  console.log(`externalAi status   = ${integrationStatus.externalAi}\n`);

  if (!hasExternalAiCredentials) {
    console.log(
      "No external key configured. The gateway will route to the deterministic\n" +
        "MOCK provider and every answer is labelled MOCK VERIFIED. This is correct\n" +
        "sandbox behaviour, not a bug.\n",
    );
  }

  // --- Pick a real buyer so memory/permissions/role resolve --------------
  const buyer = await prisma.user.findFirst({
    where: { role: "BUYER" },
    select: { id: true, name: true },
  });
  if (!buyer) {
    console.log("No buyer user in the database — nothing to probe.");
    return;
  }
  console.log(`Probing as buyer: ${buyer.name ?? buyer.id}\n`);

  let anyLiveFailure = false;

  for (const message of PROBES) {
    console.log(`user> ${message}`);
    try {
      const result = await masterAgent.run({ userId: buyer.id, message, role: "buyer" });
      console.log(`svetlana> ${result.answer.slice(0, 400)}${result.answer.length > 400 ? "…" : ""}`);
      console.log(
        `  agent=${result.agent} liveModel=${result.liveModel} verification=${result.verification} ` +
          `tools=[${result.steps.map((s) => s.toolName).join(",") || "none"}] trace=${result.traceId}`,
      );
      if (hasExternalAiCredentials && !result.liveModel) {
        // Key present but the live provider did not answer -> real blocker.
        anyLiveFailure = true;
        console.log("  ! external key is set but the answer was NOT produced by a live model");
      }
    } catch (error) {
      anyLiveFailure = true;
      console.log(`  !! pipeline threw: ${error instanceof Error ? error.message : String(error)}`);
    }
    console.log();
  }

  // --- Verdict ----------------------------------------------------------
  if (anyLiveFailure) {
    console.log("VERDICT: FAIL — external credentials are configured but the live model did not answer.");
    process.exitCode = 1;
    return;
  }
  console.log(
    hasExternalAiCredentials
      ? "VERDICT: VERIFIED — a live external model answered through the full pipeline."
      : "VERDICT: MOCK VERIFIED — sandbox mode works end-to-end; set AI_GATEWAY_API_KEY for a live model.",
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
