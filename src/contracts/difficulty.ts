import { z } from "zod";

export const difficultySchema = z.enum(["easy", "medium", "advanced"]);
export type Difficulty = z.infer<typeof difficultySchema>;
export const DIFFICULTIES = {
  easy: {
    label: "简单",
    description: "小学、初中基础",
    guidance:
      "高频生活词汇，简短句子，基础时态和简单疑问句；每次只要求表达一个主要意思，中文帮助清晰具体。",
  },
  medium: {
    label: "中等",
    description: "高中、大学日常英语",
    guidance:
      "更丰富的常用词汇，适量定语/宾语从句、条件句和时态变化；练习解释原因、描述需求及比较选择，仍保持自然日常交流。",
  },
  advanced: {
    label: "高级",
    description: "面向雅思、托福学习者",
    guidance:
      "更精准、多样的词汇和复杂句式，适当使用条件、让步、被动等结构；练习协商、比较方案、解释限制和处理复杂情况。不堆砌生僻词，不模仿考试评分。",
  },
} as const;
