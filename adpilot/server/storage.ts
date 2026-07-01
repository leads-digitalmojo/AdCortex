import { 
  clients, type Client, type ClientCredential, clientCredentials,
  actionLogs, type ActionLog,
  analysisSnapshots, type AnalysisSnapshot,
  apiConfigs, type ApiConfig
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc } from "drizzle-orm";
import fs from "fs";
import path from "path";

export interface IStorage {
  // Clients
  getClient(id: string): Promise<Client | undefined>;
  getAllClients(userId?: string): Promise<Client[]>;
  getExecutionLogs(userId?: string, clientIds?: string[]): Promise<any[]>;
  createClient(client: any): Promise<Client>;
  updateClient(id: string, client: any): Promise<Client>;
  deleteClient(id: string): Promise<void>;

  // Credentials
  getCredentials(clientId: string): Promise<ClientCredential | undefined>;
  saveCredentials(clientId: string, data: any): Promise<ClientCredential>;
  deleteCredentials(clientId: string): Promise<void>;

  // Analysis Snapshots
  saveAnalysisSnapshot(clientId: string, platform: string, cadence: string, data: any): Promise<AnalysisSnapshot>;
  loadAnalysisSnapshot(clientId: string, platform: string, cadence?: string): Promise<AnalysisSnapshot | undefined>;

  // API Configs
  getApiConfig(): Promise<ApiConfig | undefined>;
  updateApiConfig(config: any): Promise<ApiConfig>;
}

export class DatabaseStorage implements IStorage {
  // Clients
  async getClient(id: string): Promise<Client | undefined> {
    const [client] = await db.select().from(clients).where(eq(clients.id, id));
    return client;
  }

  async getAllClients(userId?: string): Promise<Client[]> {
    try {
      let query = db.select().from(clients);
      if (userId) {
        return await query.where(eq(clients.createdBy, userId));
      }
      return await query;
    } catch (err) {
      console.warn("[Storage] getAllClients DB failed, falling back to registry JSON:", err);
    }

    try {
      const DATA_BASE = path.resolve(import.meta.dirname, "../../ads_agent/data");
      const REGISTRY_FILE = path.join(DATA_BASE, "clients_registry.json");
      if (!fs.existsSync(REGISTRY_FILE)) return [];
      const raw = JSON.parse(fs.readFileSync(REGISTRY_FILE, "utf-8"));
      if (!Array.isArray(raw)) return [];
      let registry = raw as Client[];
      if (userId) {
        registry = registry.filter((c) => c.createdBy === userId);
      }
      return registry;
    } catch (err) {
      console.warn("[Storage] getAllClients registry fallback failed:", err);
      return [];
    }
  }

  async getExecutionLogs(userId?: string, clientIds?: string[]): Promise<any[]> {
    // Note: implementation of executionLogs table query
    // This is used for standard JSON response if needed, 
    // but the SSE endpoint /api/events also needs scoping.
    return []; // Placeholder until used by a standard GET route
  }

  async createClient(insertClient: any): Promise<Client> {
    const [client] = await db.insert(clients).values(insertClient).returning();
    return client;
  }

  async updateClient(id: string, updateData: any): Promise<Client> {
    const [client] = await db
      .update(clients)
      .set({ ...updateData, updatedAt: new Date() })
      .where(eq(clients.id, id))
      .returning();
    return client;
  }

  async deleteClient(id: string): Promise<void> {
    await db.delete(clients).where(eq(clients.id, id));
  }

  // Credentials
  async getCredentials(clientId: string): Promise<ClientCredential | undefined> {
    try {
      const [creds] = await db
        .select()
        .from(clientCredentials)
        .where(eq(clientCredentials.clientId, clientId));
      if (creds) return creds;
    } catch (err) {
      // Local dev frequently starts with a DB that hasn't been bootstrapped yet.
      // Fall back to the legacy JSON credential store so "Run Agent" still works.
      console.warn(`[Storage] getCredentials DB failed for '${clientId}', falling back to JSON:`, err);
    }

    try {
      const DATA_BASE = path.resolve(import.meta.dirname, "../../ads_agent/data");
      const CREDENTIALS_FILE = path.join(DATA_BASE, "clients_credentials.json");
      if (!fs.existsSync(CREDENTIALS_FILE)) return undefined;
      const raw = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, "utf-8"));
      const found = Array.isArray(raw) ? raw.find((x: any) => x?.clientId === clientId) : null;
      if (!found) return undefined;
      return {
        clientId,
        meta: found.meta ?? null,
        google: found.google ?? null,
        updatedAt: new Date(),
      } as unknown as ClientCredential;
    } catch (err) {
      console.warn(`[Storage] getCredentials JSON fallback failed for '${clientId}':`, err);
      return undefined;
    }
  }

  async saveCredentials(clientId: string, data: any): Promise<ClientCredential> {
    const existing = await this.getCredentials(clientId);
    
    // Remove updatedAt from the payload to prevent Drizzle string-to-timestamp type errors
    const payload = { ...data };
    delete payload.updatedAt;

    if (existing) {
      const [updated] = await db
        .update(clientCredentials)
        .set({ ...payload, updatedAt: new Date() })
        .where(eq(clientCredentials.clientId, clientId))
        .returning();
      return updated;
    } else {
      const [inserted] = await db
        .insert(clientCredentials)
        .values({ clientId, ...payload })
        .returning();
      return inserted;
    }
  }

  async deleteCredentials(clientId: string): Promise<void> {
    await db.delete(clientCredentials).where(eq(clientCredentials.clientId, clientId));
  }

  // Analysis Snapshots
  async saveAnalysisSnapshot(clientId: string, platform: string, cadence: string, data: any): Promise<AnalysisSnapshot> {
    const [snap] = await db
      .insert(analysisSnapshots)
      .values({ clientId, platform, cadence, data })
      .onConflictDoUpdate({
        target: [analysisSnapshots.clientId, analysisSnapshots.platform, analysisSnapshots.cadence],
        set: { data, createdAt: new Date() }
      })
      .returning();
    return snap;
  }

  async loadAnalysisSnapshot(clientId: string, platform: string, cadence: string = "twice_weekly"): Promise<AnalysisSnapshot | undefined> {
    const [snap] = await db
      .select()
      .from(analysisSnapshots)
      .where(and(
        eq(analysisSnapshots.clientId, clientId),
        eq(analysisSnapshots.platform, platform),
        eq(analysisSnapshots.cadence, cadence)
      ))
      .limit(1);
    return snap;
  }

  // API Configs
  async getApiConfig(): Promise<ApiConfig | undefined> {
    const [config] = await db.select().from(apiConfigs).limit(1);
    return config;
  }

  async updateApiConfig(config: any): Promise<ApiConfig> {
    const existing = await this.getApiConfig();
    if (existing) {
      const [updated] = await db
        .update(apiConfigs)
        .set({ ...config, updatedAt: new Date() })
        .where(eq(apiConfigs.id, existing.id))
        .returning();
      return updated;
    } else {
      const [inserted] = await db.insert(apiConfigs).values(config).returning();
      return inserted;
    }
  }
}

export const storage = new DatabaseStorage();
