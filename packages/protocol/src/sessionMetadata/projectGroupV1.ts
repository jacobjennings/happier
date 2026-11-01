import { z } from 'zod';

/** Presentation-only project identity. It never changes the execution directory. */
export function createProjectGroupV1Schema(zod: typeof z) {
  return zod.object({
    v: zod.literal(1),
    path: zod.string().trim().min(1).refine(
      (value) => value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value) || /^\\\\[^\\]+\\[^\\]+/.test(value),
      { message: 'Project path must be absolute' },
    ),
    label: zod.string().trim().min(1).optional(),
  });
}

export const ProjectGroupV1Schema = createProjectGroupV1Schema(z);
export type ProjectGroupV1 = z.infer<typeof ProjectGroupV1Schema>;

export function readProjectGroupV1(value: unknown): ProjectGroupV1 | null {
  if (value == null) return null;
  const parsed = ProjectGroupV1Schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
