import { storage } from "./server/storage.js";
import { db } from "./server/db.js";

async function run() {
  try {
    const newClient = {
      id: "test-client-123",
      name: "Test Client",
      shortName: "Test",
      project: "Test",
      location: "Hyderabad",
      targetLocations: [],
      platforms: {},
      targets: {},
      createdAt: new Date().toISOString(),
    };
    console.log("Creating client...");
    await storage.createClient(newClient);
    console.log("Success");
  } catch (err) {
    console.error("Failed:", err);
  }
}
run();
