import { z } from "zod";

export const rawEventSchema = z.object({
  event_id: z.string().min(1),
  user_id: z.string().min(1),
  ts: z.string().min(1),
  country: z.string(),
  lat: z.number(),
  lon: z.number(),
  asn: z.number().int(),
  ip: z.string(),
  device_id: z.string(),
  device_type: z.string(),
  os: z.string(),
  auth_method: z.string(),
  outcome: z.enum(["success", "fail"]),
  home_country: z.string(),
  home_lat: z.number(),
  home_lon: z.number(),
  account_age_days: z.number(),
  active_start: z.number(),
  active_end: z.number(),
  is_ato: z.number().optional(),
  attack_type: z.string().optional(),
});

export type RawEventInput = z.infer<typeof rawEventSchema>;
