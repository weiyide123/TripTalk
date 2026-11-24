import { z } from "zod";
export const factSchema = z.object({
  key: z.string().min(1).max(80),
  value: z.string().min(1).max(300),
});
export const questionContentSchema = z.object({
  english: z.string().min(1).max(400),
  // 旧记录允许缺失；新的模型计划必须生成对应英文的中文翻译。
  chineseTranslation: z.string().trim().min(1).max(600).optional(),
  chineseTask: z.string().min(1).max(300),
  referenceAnswer: z.string().min(1).max(400),
  goal: z.string().min(1).max(60),
});
export const generatedPlanSchema = z.object({
  topicId: z.string().min(1).max(80),
  scenario: z.string().min(1).max(600),
  facts: z.array(factSchema).min(1).max(20),
  questions: z.array(questionContentSchema.required()).min(8).max(15),
});
export const questionSchema = questionContentSchema.extend({ id: z.string() });
export const planSchema = generatedPlanSchema.extend({
  id: z.string(),
  questions: z.array(questionSchema).min(8).max(15),
});
export type Question = z.infer<typeof questionSchema>;
export const visibleQuestionSchema = questionSchema.omit({
  referenceAnswer: true,
});
export type VisibleQuestion = z.infer<typeof visibleQuestionSchema>;
