// #1513: team-supervisor starts every headless Copilot run with ADBRAIN_HEADLESS=1. Releases, applied migrations
// and Meta writes are a person's step, so the scripts that do them refuse here even if the run is told otherwise.
export function refuseHeadless(action, env = process.env) {
  if (env.ADBRAIN_HEADLESS === "1") {
    throw new Error(`${action} is refused in a headless supervisor run (ADBRAIN_HEADLESS=1). A person runs it.`);
  }
}
