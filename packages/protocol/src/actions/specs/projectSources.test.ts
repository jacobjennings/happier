import { describe, expect, it } from 'vitest';
import { getActionSpec, listActionSpecsForSurface } from '../actionSpecs.js';
import { resolveActionApprovalRouting } from '../actionApprovalPolicy.js';
import { createActionExecutor, type ActionExecutorDeps } from '../actionExecutor.js';
import { updatePersonalProjectContextV1 } from '../../projects/projectContextV1.js';
import { ProjectAccountOrganizationV1Schema } from '../../projects/projectAccountRowsV1.js';
import { bindHomeDomainActionHttpRequestV1 } from '../homeDomainActionFamily.js';
import { resolveActionSdkMethodName } from '../actionSdkMethodNames.js';

describe('Project Source Action admission', () => {
  it('sets shared deployment defaults through the registered Home Action and strict content CAS', async () => {
    const id = 'projects.deploymentDefaults.set';
    const spec = getActionSpec(id);
    const input = { serverId: 'home', projectSourceId: 'source', expectedSourceRevision: 3, expectedRevision: 0,
      content: { contentArtifactId: 'defaults', contentHeaderVersion: 1, contentBodyVersion: 1 } };
    const output = { ok: true, projectSourceId: 'source', sourceRevision: 3, revision: 1, content: input.content };
    expect(spec).toMatchObject({ executionPlacement: 'account', safety: 'danger', sideEffectClass: 'write',
      approvalPolicy: { uiConfirmation: 'direct' } });
    expect(spec.inputSchema.parse({ ...input, content: null })).toEqual({ ...input, content: null });
    expect(spec.inputSchema.safeParse({ ...input, expectedRevision: -1 }).success).toBe(false);
    expect(spec.inputSchema.safeParse({ ...input, owner: { kind: 'account', accountId: 'forged' } }).success).toBe(false);
    for (const surface of ['ui', 'agent', 'mcp', 'cli'] as const) {
      expect(listActionSpecsForSurface(surface).filter(row => row.id === id)).toHaveLength(1);
    }
    expect(resolveActionSdkMethodName(spec)).toBe('projects.deploymentDefaults.set');
    expect(resolveActionApprovalRouting({ actionId: id, spec, context: { surface: 'agent' } }).required).toBe(true);
    let request: unknown;
    const executor = createActionExecutor({
      // Only HTTP is substituted; the registered input, placement, approval and binder stay real.
      homeDomainAction: async ({ actionId, input }) => {
        request = bindHomeDomainActionHttpRequestV1(actionId, input);
        return output;
      },
    });
    expect(await executor.execute(id, input, { surface: 'ui', serverId: 'home', authority: 'present_user',
      actionCaller: { kind: 'host' } })).toEqual({ ok: true, result: output });
    expect(request).toEqual({ method: 'PUT', path: '/v1/projects/source/deployment-defaults', body: input });
  });

  it('discovers Move to Team on every calling surface and routes it to the signed-in client', async () => {
    const id = 'projects.sources.moveToTeam';
    const spec = listActionSpecsForSurface('agent').find(row => row.id === id);
    expect(spec).toMatchObject({ executionPlacement: 'client', safety: 'danger', sideEffectClass: 'write', permissionChanging: true });
    if (!spec) throw new Error('Move must be registered in the canonical Action catalog');
    expect(resolveActionApprovalRouting({ actionId: id, spec, context: { surface: 'agent' } }).required).toBe(true);
    const input = { serverId: 'home', sourceId: 'source', expectedRevision: 1, teamId: 'team', requestKey: 'move-1' };
    expect(spec.inputSchema.safeParse({ ...input, owner: { kind: 'team', teamId: 'other' } }).success).toBe(false);
    expect(spec.outputSchema?.safeParse({ kind: 'completed', source: { id: 'source', revision: 1, name: 'Project',
      owner: { kind: 'account', accountId: 'alice' }, audience: [], createdByAccountId: 'alice' }, childOperations: [] }).success).toBe(false);
    for (const surface of ['ui', 'agent', 'mcp', 'cli', 'voice'] as const) {
      expect(listActionSpecsForSurface(surface).some(row => row.id === id)).toBe(true);
    }
    const executor = createActionExecutor({
      // Reverse RPC is the real signed-in-client transport boundary.
      clientActionExecute: async () => ({ ok: false as const, errorCode: 'unavailable', error: 'noClient' }),
    } as ActionExecutorDeps);
    expect(await executor.execute(id, input, { surface: 'cli', authority: 'present_user',
      presentUserConfirmation: { actionId: id } }))
      .toMatchObject({ ok: false, errorCode: 'unavailable', error: 'noClient' });
  });

  it('runs personal context edits through the Account owner without an answering client', async () => {
    const spec = getActionSpec('projects.context.update');
    expect(spec.executionPlacement).toBe('account');
    expect(spec.safety).toBe('safe');
    expect(spec.approval).toEqual({ result: 'required' });
    expect(listActionSpecsForSurface('cli').some(row => row.id === spec.id)).toBe(true);
    const row = ProjectAccountOrganizationV1Schema.parse({
      hidden: true, pinned: true,
      promptStack: [{ id: 'context', ref: { kind: 'doc', artifactId: 'doc', serverId: 'home' }, placement: 'system_append' }],
    });
    const deps = {
      // Reverse RPC and persistent row transport are genuine system boundaries.
      clientActionExecute: async () => ({ ok: false as const, errorCode: 'client_unavailable', error: 'client_unavailable' }),
      projectsContextUpdate: (input, context) => updatePersonalProjectContextV1({
        accountScope: () => ({ serverId: 'home', accountId: 'alice' }),
        readArtifact: async () => null,
        mutateOrganization: async ({ mutate }) => ({ status: 'updated', revision: 1, value: mutate(row) }),
      }, input, context),
    } satisfies Pick<ActionExecutorDeps, 'clientActionExecute' | 'projectsContextUpdate'>;
    // Only this Action's transport ports are reachable in this boundary fixture.
    const executor = createActionExecutor(deps as ActionExecutorDeps);
    expect(await executor.execute(spec.id, {
      target: { serverId: 'home', projectKey: 'repo' }, expectedRevision: 0,
      intent: { kind: 'detach', entryId: 'context' },
    }, { surface: 'cli', authority: 'account_automation', serverId: 'home' })).toMatchObject({
      ok: true, result: { ok: true, revision: 1, row: { hidden: true, pinned: true, promptStack: [] } },
    });
  });

  it('loads the catalog and preserves required results and confirmation for Source writes', () => {
    for (const [id, mutates] of [
      ['projects.sources.list', false],
      ['projects.sources.read', false],
      ['projects.sources.create', true],
      ['projects.sources.update', true],
      ['projects.sources.delete', true],
    ] as const) {
      const spec = getActionSpec(id);
      expect(spec.approval).toEqual({ result: 'required' });
      expect(resolveActionApprovalRouting({ actionId: id, spec, context: { surface: 'agent' } }).required)
        .toBe(mutates);
    }
  });
});
