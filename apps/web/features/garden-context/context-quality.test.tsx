import type { Garden, GardenContextFact } from '@verdery/api-contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { ContextQuality } from './context-quality';
import { useCallerRole, useGardenContextFacts } from './queries';

const idleMutation = { mutate: vi.fn(), isPending: false, isError: false };

vi.mock('./queries', () => ({
  useGardenContextFacts: vi.fn(),
  useCallerRole: vi.fn(),
  useRecordGardenContextFact: () => idleMutation,
}));

const mockedUseFacts = vi.mocked(useGardenContextFacts);
const mockedUseCallerRole = vi.mocked(useCallerRole);

const TRANSPORT_FAILURE = {
  ok: false as const,
  kind: 'transport' as const,
  code: 'client.transport_failure',
  fallbackMessage: 'The API could not be reached.',
  correlationId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b',
  retryable: true,
  details: [],
  status: null,
};

function mockFacts(fields: Record<string, unknown>): void {
  mockedUseFacts.mockReturnValue(fields as unknown as ReturnType<typeof useGardenContextFacts>);
}

function mockCallerRole(callerRole: Garden['callerRole']): void {
  mockedUseCallerRole.mockReturnValue({
    isPending: false,
    isLoadingError: false,
    isError: false,
    data: { callerRole } as Garden,
    error: null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useCallerRole>);
}

function factsResult(
  items: readonly GardenContextFact[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    isPending: false,
    isLoadingError: false,
    isRefetchError: false,
    isError: false,
    data: { items },
    error: null,
    refetch: vi.fn(),
    ...overrides,
  };
}

function renderSection() {
  return render(
    <LocalizationProvider locale="en">
      <ContextQuality gardenId="garden-1" />
    </LocalizationProvider>,
  );
}

const REVIEWED_FACT: GardenContextFact = {
  id: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c',
  gardenId: 'garden-1',
  contextKind: 'sun_exposure',
  value: 'full_sun',
  source: 'horticulturally_reviewed_default',
  reviewedBy: 'Horticulture Team',
  reviewedOn: '2026-06-01',
  recordedByProfileId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0d',
  recordedAt: '2026-06-01T00:00:00Z',
  revision: 1,
  createdAt: '2026-06-01T00:00:00Z',
  updatedAt: '2026-06-01T00:00:00Z',
};

const DECLARED_FACT: GardenContextFact = {
  id: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0e',
  gardenId: 'garden-1',
  contextKind: 'drainage',
  value: 'well_drained',
  source: 'user_declared',
  recordedByProfileId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0f',
  recordedAt: '2026-06-01T00:00:00Z',
  revision: 1,
  createdAt: '2026-06-01T00:00:00Z',
  updatedAt: '2026-06-01T00:00:00Z',
};

describe('ContextQuality', () => {
  it('announces loading before the first result arrives', () => {
    mockFacts(factsResult([], { isPending: true, data: undefined }));
    mockCallerRole('viewer');
    renderSection();

    expect(screen.getByRole('status').textContent).toBe('Loading garden context.');
  });

  it('shows the failure and a retry action when the first load fails', () => {
    const refetch = vi.fn();
    mockFacts(
      factsResult([], {
        isLoadingError: true,
        isError: true,
        data: undefined,
        error: { failure: TRANSPORT_FAILURE },
        refetch,
      }),
    );
    mockCallerRole('viewer');
    renderSection();

    expect(screen.getByRole('alert')).toBeTruthy();
    screen.getByRole('button', { name: 'Try again' }).click();
    expect(refetch).toHaveBeenCalled();
  });

  it('lists every context kind, even one that has never been declared', () => {
    mockFacts(factsResult([REVIEWED_FACT]));
    mockCallerRole('viewer');
    renderSection();

    // sun_exposure is declared (reviewed); the other five kinds are not.
    expect(screen.getAllByText('Not yet declared')).toHaveLength(5);
  });

  it('shows the reviewer and review date only for a horticulturally reviewed default', () => {
    mockFacts(factsResult([REVIEWED_FACT, DECLARED_FACT]));
    mockCallerRole('viewer');
    renderSection();

    expect(screen.getByText('Full sun')).toBeTruthy();
    expect(screen.getByText('Reviewed by Horticulture Team on 2026-06-01')).toBeTruthy();
    expect(screen.getByText('Well drained')).toBeTruthy();
    // The user-declared fact carries no reviewer line at all — only one
    // "Reviewed by" line exists across both rendered facts.
    expect(screen.getAllByText(/Reviewed by/)).toHaveLength(1);
  });

  it('shows who declared each recorded fact, using the raw profile id (this codebase has no member display-name field)', () => {
    mockFacts(factsResult([DECLARED_FACT]));
    mockCallerRole('viewer');
    renderSection();

    expect(screen.getByText(`Declared by ${DECLARED_FACT.recordedByProfileId}`)).toBeTruthy();
  });

  it('hides every edit affordance for a caller without editGardenContent', () => {
    mockFacts(factsResult([REVIEWED_FACT]));
    mockCallerRole('viewer');
    renderSection();

    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Declare' })).toBeNull();
  });

  it('shows the edit affordance for an editor, and the declare affordance for an undeclared kind', () => {
    mockFacts(factsResult([REVIEWED_FACT]));
    mockCallerRole('editor');
    renderSection();

    expect(screen.getAllByRole('button', { name: 'Edit' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Declare' }).length).toBeGreaterThan(0);
  });

  it('opens the edit panel on toggle, with the panel container present even while collapsed', () => {
    mockFacts(factsResult([DECLARED_FACT]));
    mockCallerRole('owner');
    renderSection();

    const editButtons = screen.getAllByRole('button', { name: 'Edit' });
    const drainageEdit = editButtons[0];
    expect(drainageEdit).toBeDefined();
    expect(drainageEdit?.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(drainageEdit!);

    expect(drainageEdit?.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  });
});
