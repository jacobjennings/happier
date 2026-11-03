import { describe, expect, it } from 'vitest';

import { mountThroughReactNativeWeb } from '../rnwMount.testSupport.js';
import { createHostApiStub, createSurfaceContext } from '../surfaceFixture.testSupport.js';
import { InlineCode, Item, ItemGroup } from '../index.js';
import { PluginUiProvider } from './PluginUiProvider.js';

/** The browser's own spelling of a colour, so a hex token compares with a computed style. */
function cssColor(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

/** The outermost text element whose whole text is `text` (React Native Web draws nested Text as spans). */
function textElement(container: HTMLElement, text: string): HTMLElement {
  const node = [...container.querySelectorAll<HTMLElement>('div, span')].find(
    (element) => element.textContent === text && element.parentElement?.textContent !== text,
  );
  if (!node) throw new Error(`No text element "${text}"`);
  return node;
}

describe('InlineCode and rich ItemGroup descriptions', () => {
  it('sets a localized sentence with an inline command in the same section description text', () => {
    const context = createSurfaceContext({
      translations: { 'acme.scope.description': 'Ce que la revue examine.' },
    });
    const { colors } = context.theme;
    const mount = mountThroughReactNativeWeb(
      <PluginUiProvider hostApi={createHostApiStub(context)} context={context}>
        <ItemGroup
          title="Agents"
          description={<>Run <InlineCode testID="chip">happier</InlineCode> on that computer.</>}
        >
          <Item title="Claude" />
        </ItemGroup>
        <ItemGroup title="Scope" description="What the review covers." descriptionKey="acme.scope.description">
          <Item title="Current review" />
        </ItemGroup>
      </PluginUiProvider>,
    );

    const rich = textElement(mount.container, 'Run happier on that computer.');
    const localized = textElement(mount.container, 'Ce que la revue examine.');
    // One description text owner: the rich sentence reads exactly like a string description.
    expect(rich.style.color).toBe(cssColor(colors.secondaryText));
    expect(rich.style.fontSize).toBe(localized.style.fontSize);
    expect(rich.style.lineHeight).toBe(localized.style.lineHeight);

    const chip = mount.container.querySelector<HTMLElement>('[data-testid="chip"]');
    expect(chip?.textContent).toBe('happier');
    expect(rich.contains(chip)).toBe(true);
    expect(chip?.style.fontFamily).toContain(context.theme.typography.code.fontFamily);
    expect(chip?.style.backgroundColor).toBe(cssColor(colors.elevatedSurface));
    expect(chip?.style.color).toBe(cssColor(colors.text));
    expect(chip?.style.whiteSpace).toBe('nowrap');
    mount.unmount();
  });
});
