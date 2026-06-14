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
   * Saves a file for a specific owner. 
   * If a file with the same name exists for this owner, it updates the content.
   */
  async saveFile(ownerId: string, filename: string, content: string): Promise<string> {
    const now = Date.now();
    
    // Check if file already exists for this owner
    const existing = await this.env.DB.prepare(
      "SELECT id FROM files WHERE owner_id = ? AND filename = ? LIMIT 1"
    )
    .bind(ownerId, filename)
    .first<{ id: string }>();

    if (existing) {
      await this.env.DB.prepare(
        "UPDATE files SET content = ?, updated_at = ? WHERE id = ?"
      )
      .bind(content, now, existing.id)
      .run();
      return existing.id;
    }

    const id = crypto.randomUUID();
    await this.env.DB.prepare(
      "INSERT INTO files (id, owner_id, filename, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .bind(id, ownerId, filename, content, now, now)
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

    return results as StorageFile[];
  }

  /**
   * Reads a specific file, ensuring the ownerId matches.
   */
  async readFile(ownerId: string, fileId: string): Promise<string | null> {
    const file = await this.env.DB.prepare(
      "SELECT content FROM files WHERE id = ? AND owner_id = ?"
    )
    .bind(fileId, ownerId)
    .first<{ content: string }>();

    return file?.content ?? null;
  }

  /**
   * Deletes a specific file, ensuring the ownerId matches.
   */
  async deleteFile(ownerId: string, fileId: string): Promise<boolean> {
    const result = await this.env.DB.prepare(
      "DELETE FROM files WHERE id = ? AND owner_id = ?"
    )
    .bind(fileId, ownerId)
    .run();

    return result.meta.rows_affected > 0;
  }
}
