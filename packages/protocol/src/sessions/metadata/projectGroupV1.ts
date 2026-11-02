import { z } from 'zod/mini';

/** Presentation only. Execution and filesystem authority keep their own paths. */
export const ProjectGroupV1Schema = z.object({
  v: z.literal(1),
  path: z.string().check(z.trim(), z.minLength(1), z.refine(
    (value) => value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value) || /^\\\\[^\\]+\\[^\\]+/.test(value),
    'Project path must be absolute',
  )),
  label: z.optional(z.string().check(z.trim(), z.minLength(1))),
});
export type ProjectGroupV1 = z.infer<typeof ProjectGroupV1Schema>;

export function readProjectGroupV1(value: unknown): ProjectGroupV1 | null {
  const parsed = ProjectGroupV1Schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function areProjectGroupsV1Equal(left: ProjectGroupV1 | null | undefined, right: ProjectGroupV1 | null | undefined): boolean {
  return left === right || (left?.path === right?.path && left?.label === right?.label);
}
