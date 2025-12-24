import { z } from "zod";

export const TagSchema = z.union([
  z.literal("A"),
  z.literal("B"),
  z.literal("C"),
  z.literal("D"),
  z.literal("E"),
]);

// Accept both legacy and v1 type labels
export const TestTypeSchema = z.union([z.literal("forced_pair_v1"), z.literal("forced_pair")]);

export const ForcedPairTestSchema = z.object({
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/i, "slug: только латиница/цифры/дефис"),
  title: z.string().min(2),
  description: z.string().optional(),
  type: TestTypeSchema,
  pricing: z
    .object({
      interpretation_rub: z.number().int().min(0).optional(),
    })
    .optional(),
  // IMPORTANT: interpretation is stored separately in Supabase (table test_interpretations).
  // We still allow it in JSON import for convenience; the server will split it out.
  interpretation: z
    .object({
      note: z.string().optional(),
      styles: z.record(
        TagSchema,
        z.object({
          strong: z.string().min(1),
          weak: z.string().min(1),
        })
      ),
    })
    .optional(),
  questions: z
    .array(
      z.object({
        order: z.number().int().positive(),
        options: z.tuple([
          z.object({ tag: TagSchema, text: z.string().min(1) }),
          z.object({ tag: TagSchema, text: z.string().min(1) }),
        ]),
      })
    )
    .min(1),
  scoring: z.object({
    tags: z.array(TagSchema).length(5),
    tag_to_style: z.record(TagSchema, z.string().min(1)),
    thresholds_percent: z.object({
      strong_gte: z.number().int().min(1).max(100),
      weak_lte: z.number().int().min(0).max(100),
    }),
  }),
});

export type ImportedForcedPairTest = z.infer<typeof ForcedPairTestSchema>;
