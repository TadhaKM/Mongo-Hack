// Loads the repo-root .env (git-ignored) into process.env without overriding variables that are already set.
// Imported for its side effect by every CLI entry point, so `npm run ...` picks up MONGODB_URI automatically.
import { fileURLToPath } from "node:url";
export function loadEnv() {
  try { process.loadEnvFile(fileURLToPath(new URL("../../.env", import.meta.url))); } catch { /* no .env: use the real environment */ }
  // an empty MONGODB_URI= line means "not set yet", so fall back to the local default instead of failing on ""
  for (const k of ["MONGODB_URI", "BACKEND_MONGODB_URI"]) if (process.env[k] === "") delete process.env[k];
}
loadEnv();
