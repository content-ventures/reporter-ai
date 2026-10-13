import { z } from "zod";

export const UUID = z.string().uuid();
export const slideSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  body: z.string().trim().min(1).max(20000),
}).strict();
export const articleSchema = z.object({
  title: z.string().trim().min(1).max(500),
  content: z.string().trim().min(1).max(200000),
}).strict();
export const carouselSchema = z.object({
  title: z.string().trim().min(1).max(500),
  slides: z.array(slideSchema).min(1).max(20),
}).strict();
export const createSchema = z.object({ source_id: UUID, input_revision: z.number().int().positive() }).strict();
export const revisionSchema = z.object({ revision: z.number().int().positive() }).strict();
export const articleEditSchema = articleSchema.extend({ revision: z.number().int().positive() });
export const carouselEditSchema = carouselSchema.extend({ revision: z.number().int().positive() });
export type Slide = z.infer<typeof slideSchema>;

