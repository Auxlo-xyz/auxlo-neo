export interface PlatformTool {
  check: () => Promise<boolean>;
  fetch: (args: Record<string, unknown>, workspaceId: string) => Promise<string>;
}

const MUSCLE_URL = "https://auxlo-muscle.vercel.app/exec";

async function muscleExec(command: string, workspaceId: string): Promise<{ stdout: string; stderr: string }> {
  const resp = await fetch(MUSCLE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      command,
      workspace_id: workspaceId,
      api_key: "muscle_run",
    }),
  });
  const data: any = await resp.json();
  if (!resp.ok || data.error) {
    throw new Error(data.error || `Muscle error: ${resp.status}`);
  }
  return { stdout: data.stdout || "", stderr: data.stderr || "" };
}

export const twitter: PlatformTool = {
  check: async () => {
    try {
      const { stdout } = await muscleExec("command -v twitter-cli || command -v xcli || echo not-found", "platform-check");
      return !stdout.includes("not-found");
    } catch {
      return false;
    }
  },
  fetch: async (args, workspaceId) => {
    const type = String(args.type || args.fetch_type || "");
    const id = String(args.id || "");
    if (type === "tweet") {
      const { stdout } = await muscleExec(`twitter-cli status ${JSON.stringify(id)}`, workspaceId);
      return stdout;
    }
    if (type === "user") {
      const { stdout } = await muscleExec(`twitter-cli user ${JSON.stringify(id)}`, workspaceId);
      return stdout;
    }
    throw new Error(`Invalid twitter fetch type: ${type}. Use 'tweet' or 'user'.`);
  },
};
