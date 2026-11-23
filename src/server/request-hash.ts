import { createHash } from "node:crypto";

// 保留原始字段顺序的哈希语义，已提交的请求仍可幂等重试。
export const inputHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
