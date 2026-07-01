import { db } from './server/db';
import { analysisSnapshots } from './shared/schema';
import { desc, eq, and } from 'drizzle-orm';
async function test() {
    const raw = await db.select().from(analysisSnapshots).where(and(eq(analysisSnapshots.clientId, 'amara'), eq(analysisSnapshots.cadence, 'daily'))).limit(1);
    console.log(raw[0]?.data?.summary?.avg_cpl);
    process.exit(0);
}
test();
