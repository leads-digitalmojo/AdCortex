import { db } from "./server/db";
import { clients } from "@shared/schema";
async function run() {
  const all = await db.select().from(clients);
  console.log(JSON.stringify(all, null, 2));
  process.exit(0);
}
run();
