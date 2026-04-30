import { z } from "zod";

const linkingKeySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("entity-id"),
    entityType: z.string().min(1),
    value: z.string().min(1),
  }),
  z.object({
    type: z.literal("http-correlation"),
    value: z.string().min(1),
  }),
  z.object({
    type: z.literal("kafka-message-id"),
    value: z.string().min(1),
  }),
]);

const timeWindowSchema = z
  .object({
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
  })
  .refine((w) => new Date(w.from) < new Date(w.to), {
    message: "timeWindow.from must be before timeWindow.to",
  })
  .refine((w) => new Date(w.to) <= new Date(), {
    message: "timeWindow.to must not be in the future",
  });

export const investigationRequestSchema = z.object({
  serviceId: z.string().min(1),
  environment: z.enum(["production", "staging", "canary"]),
  linkingKeys: z.array(linkingKeySchema).min(1),
  timeWindow: timeWindowSchema.optional(),
  observationDescription: z.string().max(500).optional(),
  options: z
    .object({
      maxIterations: z.number().int().positive().optional(),
      scanBudgetBytes: z.number().int().positive().optional(),
      maxResultsPerQuery: z.number().int().positive().optional(),
    })
    .optional(),
});

export type ValidatedInvestigationRequest = z.infer<typeof investigationRequestSchema>;
