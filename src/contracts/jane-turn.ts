import { z } from "zod";
export const continuationSchema = z.object({
  nextQuestionId: z.string().nullable(),
  english: z.string().max(400).nullable(),
  chineseTranslation: z.string().trim().min(1).max(600).nullable().optional(),
  chineseTask: z.string().max(300).nullable(),
  closingMessage: z.string().max(600).nullable(),
});
export const evaluationSchema = z.object({
  learnerIntent: z.enum(["answer", "hint", "explain", "off_topic"]),
  verdict: z.enum([
    "correct",
    "needs_correction",
    "uncertain",
    "not_applicable",
  ]),
  canContinue: z.boolean(),
  correctedAnswer: z.string().max(600).nullable(),
  learnerTranslation: z.string().trim().min(1).max(3000).nullable().optional(),
  correctedTranslation: z
    .string()
    .trim()
    .min(1)
    .max(1200)
    .nullable()
    .optional(),
  explanation: z.string().max(800).nullable(),
  errorTypes: z.array(z.enum(["grammar", "meaning"])).max(2),
  roleplayLine: z.string().max(400),
  roleplayTranslation: z.string().trim().min(1).max(600).optional(),
  tutorFeedback: z.string().min(1).max(600),
  hint: z
    .object({
      level: z.enum(["keywords", "pattern", "example"]),
      text: z.string().min(1).max(600),
    })
    .nullable(),
  continuation: continuationSchema.nullable(),
  coveredEarly: z
    .array(
      z.object({
        questionId: z.string(),
        evidence: z.string().min(1).max(500),
      }),
    )
    .max(14),
  factChanges: z
    .array(
      z.object({
        key: z.string(),
        value: z.string().min(1).max(300),
        evidence: z.string().min(1).max(500),
      }),
    )
    .max(10),
});
// 模型输出必须带翻译字段，持久化仍能读取尚无翻译的历史记录。
export const generatedEvaluationSchema = evaluationSchema.extend({
  learnerTranslation: evaluationSchema.shape.learnerTranslation.unwrap(),
  correctedTranslation: evaluationSchema.shape.correctedTranslation.unwrap(),
  roleplayTranslation: evaluationSchema.shape.roleplayTranslation.unwrap(),
  continuation: continuationSchema.required().nullable(),
});
export type Evaluation = z.infer<typeof evaluationSchema>;
