import { z } from "zod";

export const personaSchema = z.enum(["transport_manager", "facilities_head", "line_manager"]);

export const filtersSchema = z.object({
  persona: personaSchema.default("transport_manager"),
  businessUnit: z.string().max(80).optional(),
  office: z.string().max(120).optional(),
  month: z.string().regex(/^2026-(05|06|07)$/).optional(),
  vendor: z.string().max(160).optional(),
});

export const chatSchema = z.object({
  message: z.string().min(2).max(1500),
  persona: personaSchema,
  mode: z.enum(["command", "monitoring"]).default("command"),
  filters: filtersSchema.omit({ persona: true }).default({}),
  history: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().max(3000),
  })).max(8).default([]),
});
