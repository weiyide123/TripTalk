import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { sceneIdSchema } from "@/contracts/scene-id";
import { convertJsonSnapshot } from "./convert-json";

export async function readJsonSource(directory: string, catalogFile: string) {
  const root = await realpath(directory);
  const manifest: { file: string; sha256: string }[] = [];
  async function read(file: string) {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error("Source must be a regular file");
    const bytes = await readFile(file);
    manifest.push({
      file: resolve(file),
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    return JSON.parse(bytes.toString("utf8")) as unknown;
  }
  const catalog = await read(catalogFile);
  if (!Array.isArray(catalog)) throw new Error("Invalid scene catalog");
  let profile: unknown | null = null;
  try {
    profile = await read(join(root, "profile.json"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const sceneDirectory = join(root, "scenes");
  let files: string[] = [];
  try {
    const info = await lstat(sceneDirectory);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error("Scene directory must not be a symbolic link");
    files = (await readdir(sceneDirectory))
      .filter((file) => file.endsWith(".json"))
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const sceneData: unknown[] = [];
  for (const file of files) {
    const sceneId = sceneIdSchema.parse(file.slice(0, -5));
    const data = await read(join(sceneDirectory, file));
    if (
      !data ||
      typeof data !== "object" ||
      !("sceneId" in data) ||
      data.sceneId !== sceneId
    ) {
      throw new Error("Source filename/scene identity mismatch");
    }
    sceneData.push(data);
  }
  return {
    snapshot: convertJsonSnapshot({ catalog, profile, sceneData }),
    manifest: manifest.sort((left, right) =>
      left.file.localeCompare(right.file),
    ),
  };
}
