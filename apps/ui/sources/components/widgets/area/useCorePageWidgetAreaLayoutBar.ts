import * as React from 'react';
import type { WidgetAreaLayoutSummaryV1 } from '@happier-dev/protocol/widgets';

import { useWidgetAreaLayouts } from '@/components/projects/overview/useProjectDashboards';
import { Modal } from '@/modal';
import { t } from '@/text';

import type { useCorePageWidgetAreaBinding } from './useCorePageWidgetAreaBinding';
import type { WidgetAreaLayout } from './useWidgetAreaLayout';
import type {
  WidgetAreaLayoutActions,
  WidgetAreaLayoutOption,
} from './WidgetAreaLayoutBar';
import type { WidgetSurfaceContext } from '@/components/widgets/surface/widgetSurfaceSetup';

type CorePageBinding = Pick<
  ReturnType<typeof useCorePageWidgetAreaBinding>,
  'surface' | 'selectLayout' | 'executeLayoutAction'
>;

type ListedLayout = WidgetAreaLayoutOption &
  Readonly<{ summary: WidgetAreaLayoutSummaryV1 | null }>;

/**
 * A core page's named layouts as `WidgetAreaLayoutBar` draws them (AR-4): the page's presets and the viewer's
 * own layouts, with New view, Rename, Move and Delete on the selected one, through the core-page binding's
 * canonical layout Actions. A preset is the page's stock composition: it resets (the page's preset line) rather
 * than going away. Until the inventory answers, the presets hold the bar's place so it never appears late.
 */
export function useCorePageWidgetAreaLayoutBar(
  input: Readonly<{
    binding: CorePageBinding;
    area: WidgetAreaLayout<WidgetSurfaceContext>;
    /** The page's presets in order (the first is the page's default), with the names the page gives them. */
    presets: readonly Readonly<{ id: string; name: string }>[];
    /** Optional sentence under the New view prompt's title. */
    newLayoutBody?: string;
  }>,
): Readonly<{
  layouts: readonly ListedLayout[];
  selectedId: string;
  selectedName: string | null;
  onSelect: (layoutId: string) => void;
  onCreate: (() => void) | null;
  actions: WidgetAreaLayoutActions | null;
}> {
  const { binding, presets } = input;
  const ready = input.area.state.status === 'ready' ? input.area.state : null;
  const owner = ready?.surface.owner ?? binding.surface?.owner ?? null;
  const base = binding.surface;
  const areaSurface = React.useMemo(
    () =>
      base && base.owner.kind === 'corePage'
        ? {
            serverId: base.serverId,
            accountId: base.accountId,
            owner: {
              kind: 'corePage' as const,
              pageId: base.owner.pageId,
              area: base.owner.area,
            },
          }
        : null,
    [
      base?.serverId,
      base?.accountId,
      base?.owner.kind === 'corePage' ? base.owner.pageId : null,
      base?.owner.kind === 'corePage' ? base.owner.area : null,
    ],
  );
  const layouts = useWidgetAreaLayouts({
    surface: areaSurface,
    execute: binding.executeLayoutAction,
  });
  const defaultId = presets[0]?.id ?? '';
  // An unnamed area starts from the first preset, as the binding reads it.
  const selectedId =
    (owner?.kind === 'corePage' ? owner.layoutId : undefined) ?? defaultId;
  const listed = layouts.state.dashboards;
  const options = React.useMemo((): readonly ListedLayout[] => {
    const presetNames = new Map(
      presets.map((preset) => [preset.id, preset.name]),
    );
    const rows = listed.map((row): ListedLayout => {
      const layoutId =
        row.surface.owner.kind === 'corePage'
          ? (row.surface.owner.layoutId ?? defaultId)
          : row.artifactId;
      return {
        id: layoutId,
        name: row.isPreset ? (presetNames.get(layoutId) ?? row.name) : row.name,
        isPreset: row.isPreset,
        edited: row.isEdited,
        summary: row,
      };
    });
    return rows.length
      ? rows
      : presets.map((preset) => ({
          id: preset.id,
          name: preset.name,
          isPreset: true,
          edited: false,
          summary: null,
        }));
  }, [defaultId, listed, presets]);
  const selectLayout = binding.selectLayout;
  const newLayoutBody = input.newLayoutBody;
  const create = React.useCallback(async () => {
    const source = ready?.surface;
    const name = (
      await Modal.prompt(t('usage.board.page.newViewTitle'), newLayoutBody, {
        placeholder: t('usage.board.page.newViewPlaceholder'),
        confirmText: t('common.create'),
      })
    )?.trim();
    if (!name || !source) return;
    const created = await layouts.create(name, source);
    const layoutId =
      created.ok && created.dashboard?.surface.owner.kind === 'corePage'
        ? created.dashboard.surface.owner.layoutId
        : undefined;
    if (layoutId) await selectLayout(layoutId);
  }, [layouts, newLayoutBody, ready?.surface, selectLayout]);
  const selected = options.find((option) => option.id === selectedId) ?? null;
  const actions = React.useMemo((): WidgetAreaLayoutActions | null => {
    const summary = selected?.summary;
    if (!selected || !summary || !ready?.canEdit) return null;
    const index = options.findIndex((option) => option.id === selected.id);
    const before = options[index - 1];
    const after = options[index + 1];
    return {
      rename: async () => {
        const name = (
          await Modal.prompt(t('usage.board.page.renameViewTitle'), undefined, {
            defaultValue: selected.name,
            confirmText: t('common.save'),
          })
        )?.trim();
        if (name && name !== selected.name) await layouts.rename(summary, name);
      },
      ...(before?.summary
        ? {
            moveBefore: {
              name: before.name,
              onPress: () => {
                void layouts.reorder(summary, {
                  anchorId: before.summary!.artifactId,
                  placement: 'before',
                });
              },
            },
          }
        : {}),
      ...(after?.summary
        ? {
            moveAfter: {
              name: after.name,
              onPress: () => {
                void layouts.reorder(summary, {
                  anchorId: after.summary!.artifactId,
                  placement: 'after',
                });
              },
            },
          }
        : {}),
      delete: summary.isPreset
        ? { disabledReason: t('projects.dashboard.defaultProtected') }
        : {
            onPress: async () => {
              const removed = await layouts.remove(summary);
              if (removed.ok && !removed.approvalPending)
                await selectLayout(defaultId);
            },
          },
    };
  }, [defaultId, layouts, options, ready?.canEdit, selected, selectLayout]);
  const onSelect = React.useCallback(
    (layoutId: string) => {
      void selectLayout(layoutId);
    },
    [selectLayout],
  );
  const onCreate = React.useMemo(
    () =>
      ready?.canEdit
        ? () => {
            void create();
          }
        : null,
    [create, ready?.canEdit],
  );
  return {
    layouts: options,
    selectedId,
    selectedName: selected?.name ?? null,
    onSelect,
    onCreate,
    actions,
  };
}
