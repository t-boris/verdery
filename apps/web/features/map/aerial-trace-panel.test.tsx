import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { AerialTracePanel } from './aerial-trace-panel';

describe('AerialTracePanel', () => {
  it('places the trace action next to its legal limitation', () => {
    const onTrace = vi.fn();
    render(
      <LocalizationProvider locale="en">
        <AerialTracePanel
          georeferenced
          busy={false}
          error={null}
          result={null}
          proposals={[]}
          selectedId={null}
          onTrace={onTrace}
          onSelect={vi.fn()}
          onUpdate={vi.fn()}
          onReject={vi.fn()}
        />
      </LocalizationProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Trace aerial image' }));

    expect(onTrace).toHaveBeenCalledOnce();
    expect(screen.getByText(/cannot establish a legal property boundary/iu)).toBeDefined();
  });

  it('does not offer a provider call until an address is saved', () => {
    render(
      <LocalizationProvider locale="en">
        <AerialTracePanel
          georeferenced={false}
          busy={false}
          error={null}
          result={null}
          proposals={[]}
          selectedId={null}
          onTrace={vi.fn()}
          onSelect={vi.fn()}
          onUpdate={vi.fn()}
          onReject={vi.fn()}
        />
      </LocalizationProvider>,
    );

    expect(
      screen.getByRole('button', { name: 'Trace aerial image' }).hasAttribute('disabled'),
    ).toBe(true);
  });
});
