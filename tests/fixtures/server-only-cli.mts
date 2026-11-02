import { createAdminClient } from "../../src/lib/supabase/admin";
import { appSecretProof } from "../../src/lib/meta/appsecret-proof";
import { getProductionPaymentConfig } from "../../src/lib/payments/production-config";
import { createGeminiProvider } from "../../src/lib/llm/providers/gemini";
import { generateImage } from "../../src/lib/imageGen";

const exports = [createAdminClient, appSecretProof, getProductionPaymentConfig, createGeminiProvider, generateImage];
if (!exports.every((value) => typeof value === "function")) throw new Error("Missing server exports");
process.stdout.write("server-only-cli-ready\n");
