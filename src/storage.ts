import type { Env } from "./types";

export interface StorageFile {
  id: string;
  owner_id: string;
  filename: string;
  content: string;
  mime_type: string;
  created_at: number;
  updated_at: number;
}

export class StorageService {
  constructor(private env: Env) {}

  /**
   * Saves a memory fact for a specific owner.
   * If the key already exists for this owner, it updates the value.
   */
  async saveMemory(ownerId: string, key: string, value: string): Promise<string> {
    const now = Date.now();
    const id = crypto.randomUUID();
    
    // Using ON CONFLICT to handle race conditions atomically
    await this.env.DB.prepare(`
      INSERT INTO memories (id, owner_id, key, value, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(owner_id, key) DO UPDATE SET
        value = excluded.value
    `)
    .bind(id, ownerId, key, value, now)
    .run();

    return id;
  }

  /**
   * Retrieves memories for a specific owner.
   * Can filter by key prefix for grouped memories (e.g., 'lesson:').
   */
  async getMemories(ownerId: string, keyPrefix: string = ""): Promise<{ key: string; value: string }[]> {
    const { results } = await this.env.DB.prepare(
      "SELECT key, value FROM memories WHERE owner_id = ? AND key LIKE ? ORDER BY created_at DESC"
    )
    .bind(ownerId, `${keyPrefix}%`)
    .all();

    return results as { key: string; value: string }[];
  }

  /**
   * Deletes a specific memory.
   */
  async deleteMemory(ownerId: string, key: string): Promise<boolean> {
    const result = await this.env.DB.prepare(
      "DELETE FROM memories WHERE owner_id = ? AND key = ?"
    )
    .bind(ownerId, key)
    .run();

    return (result.meta.rows_affected as number) > 0;
  }

  /**
   * Saves a file for a specific owner. 
   * If a file with the same name exists for this owner, it updates the content.
   */
  async saveFile(ownerId: string, filename: string, content: string): Promise<string> {
    const now = Date.now();
    const id = crypto.randomUUID();

    let mimeType = "text/markdown";
    if (filename.endsWith(".pdf")) mimeType = "application/pdf";
    else if (filename.endsWith(".json")) mimeType = "application/json";
    else if (filename.endsWith(".csv")) mimeType = "text/csv";
    else if (filename.endsWith(".png")) mimeType = "image/png";
    else if (filename.endsWith(".jpg") || filename.endsWith(".jpeg")) mimeType = "image/jpeg";
    else if (filename.endsWith(".html")) mimeType = "text/html";
    else if (filename.endsWith(".txt")) mimeType = "text/plain";

    let dbContent = content;
    if (this.env.STORAGE) {
      const r2Key = `files/${ownerId}/${id}_${filename}`;
      await this.env.STORAGE.put(r2Key, content, {
        httpMetadata: { contentType: mimeType }
      });
      dbContent = `r2:${r2Key}`;
    }

    // Using ON CONFLICT to handle race conditions atomically
    await this.env.DB.prepare(`
      INSERT INTO files (id, owner_id, filename, content, mime_type, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(owner_id, filename) DO UPDATE SET
        content = excluded.content,
        mime_type = excluded.mime_type,
        updated_at = excluded.updated_at
    `)
    .bind(id, ownerId, filename, dbContent, mimeType, now, now)
    .run();

    return id;
  }

  /**
   * Lists all files owned by the specified user.
   */
  async listFiles(ownerId: string): Promise<StorageFile[]> {
    const { results } = await this.env.DB.prepare(
      "SELECT * FROM files WHERE owner_id = ? ORDER BY updated_at DESC"
    )
    .bind(ownerId)
    .all();

    return results as unknown as StorageFile[];
  }

  /**
   * Reads a specific file by filename or file ID, ensuring the ownerId matches.
   */
  async readFile(ownerId: string, fileIdOrName: string): Promise<string | null> {
    const file = await this.env.DB.prepare(
      "SELECT content FROM files WHERE (id = ? OR filename = ?) AND owner_id = ?"
    )
    .bind(fileIdOrName, fileIdOrName, ownerId)
    .first<{ content: string }>();

    if (!file) return null;

    let content = file.content;
    if (content.startsWith("r2:")) {
      const r2Key = content.slice(3);
      if (this.env.STORAGE) {
        const obj = await this.env.STORAGE.get(r2Key);
        return obj ? await obj.text() : null;
      }
    }

    return content;
  }

  /**
   * Deletes a specific file by filename or file ID, ensuring the ownerId matches.
   */
  async deleteFile(ownerId: string, fileIdOrName: string): Promise<boolean> {
    const file = await this.env.DB.prepare(
      "SELECT content FROM files WHERE (id = ? OR filename = ?) AND owner_id = ?"
    )
    .bind(fileIdOrName, fileIdOrName, ownerId)
    .first<{ content: string }>();

    if (file && file.content.startsWith("r2:")) {
      const r2Key = file.content.slice(3);
      if (this.env.STORAGE) {
        await this.env.STORAGE.delete(r2Key);
      }
    }

    const result = await this.env.DB.prepare(
      "DELETE FROM files WHERE (id = ? OR filename = ?) AND owner_id = ?"
    )
    .bind(fileIdOrName, fileIdOrName, ownerId)
    .run();

    return (result.meta.rows_affected as number) > 0;
  }
}
