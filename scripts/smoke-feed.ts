#!/usr/bin/env tsx
/** Smoke test: pull launch feed and print one MIGRATED mint to use as F2 fixture. */
import { bags } from "../app/lib/bags-client.server";

async function main() {
  const feed = await bags.launchFeed();
  const migrated = feed.filter((t) => t.status === "MIGRATED");
  console.log(`feed total: ${feed.length}  MIGRATED: ${migrated.length}`);
  const pick = migrated[0] ?? feed[0];
  if (pick) {
    console.log(JSON.stringify(pick, null, 2));
  } else {
    console.log("(empty feed)");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
