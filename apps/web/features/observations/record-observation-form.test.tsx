import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { RecordObservationForm } from './record-observation-form';

const mutateMock = vi.fn();

vi.mock('./queries', () => ({
  useRecordObservation: () => ({ mutate: mutateMock, isPending: false, isError: false }),
}));

function renderForm(props: Partial<Parameters<typeof RecordObservationForm>[0]> = {}) {
  return render(
    <LocalizationProvider locale="en">
      <RecordObservationForm gardenId="garden-1" fixedPlantId="plant-1" {...props} />
    </LocalizationProvider>,
  );
}

/** The request the form passed to the mutation, once it has run. */
async function submittedRequest() {
  fireEvent.click(screen.getByRole('button', { name: 'Record observation' }));
  await waitFor(() => expect(mutateMock).toHaveBeenCalled());
  return mutateMock.mock.calls[0]?.[0] as Record<string, unknown>;
}

afterEach(() => {
  window.localStorage.clear();
  mutateMock.mockClear();
  act(() => onlineManager.setOnline(true));
});

describe('RecordObservationForm', () => {
  it('refuses an entry with no note, no summary, and no photograph', async () => {
    renderForm();

    fireEvent.click(screen.getByRole('button', { name: 'Record observation' }));

    expect(
      await screen.findByText('Enter a note or a condition summary, or attach a photograph.'),
    ).toBeTruthy();
    expect(mutateMock).not.toHaveBeenCalled();
  });

  it('accepts a photograph alone as a complete journal entry', async () => {
    // The contract's rule is note OR summary OR photo, and a purpose-labelled
    // photograph with no words is exactly what guided capture produces.
    renderForm({ photos: [{ mediaId: 'media-1', purpose: 'flower' }] });

    const request = await submittedRequest();

    expect(request['photos']).toEqual([{ mediaId: 'media-1', purpose: 'flower' }]);
    expect(request['noteText']).toBeUndefined();
  });

  it('sends the measurements the reader entered', async () => {
    renderForm();

    fireEvent.click(screen.getByRole('button', { name: 'Note' }));
    fireEvent.change(screen.getByLabelText('Note'), {
      target: { value: 'Taller than last month' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Measurements' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add a measurement' }));
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: '42' } });

    expect(await submittedRequest()).toEqual(
      expect.objectContaining({ measurements: [{ kind: 'height', value: 42, unit: 'cm' }] }),
    );
  });

  it('drops a row left without a unit instead of losing the whole observation to it', async () => {
    renderForm();

    fireEvent.click(screen.getByRole('button', { name: 'Note' }));
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Measurements' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add a measurement' }));
    fireEvent.change(screen.getByLabelText('Unit'), { target: { value: '  ' } });

    // `unit` has a `minLength` of 1: sending the blank row would fail the
    // whole request over a row the reader had already abandoned.
    expect(await submittedRequest()).toEqual(expect.objectContaining({ measurements: [] }));
  });

  it('sends the symptoms the observer reported, distinct from any model suggestion', async () => {
    renderForm();

    fireEvent.click(screen.getByRole('button', { name: 'Note' }));
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Spots appeared' } });
    fireEvent.click(screen.getByRole('button', { name: 'What you see' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add a symptom' }));
    fireEvent.change(screen.getByLabelText('How bad'), { target: { value: 'severe' } });

    // The first free symptom, at the severity the observer chose. A model's
    // own vocabulary (`stress`, `disease`) is never offered here.
    expect(await submittedRequest()).toEqual(
      expect.objectContaining({ symptoms: [{ kind: 'leaf_spots', severity: 'severe' }] }),
    );
  });

  it('offers each symptom once and stops offering when all are reported', () => {
    renderForm();

    fireEvent.click(screen.getByRole('button', { name: 'What you see' }));
    const addButton = () => screen.queryByRole('button', { name: 'Add a symptom' });
    for (let index = 0; index < 9; index += 1) {
      fireEvent.click(addButton()!);
    }

    // `observation_symptom_unique_kind` permits one statement per symptom, so
    // a tenth row would be refused by the server for a rule never shown.
    expect(addButton()).toBeNull();
  });

  it('tells the composer the entry was recorded, so it can clear the photographs it owns', async () => {
    const onRecorded = vi.fn();
    renderForm({ photos: [{ mediaId: 'media-1', purpose: 'whole_plant' }], onRecorded });

    await submittedRequest();
    // The mutation reports success through its own callback; nothing is
    // cleared before the server has accepted the entry.
    expect(onRecorded).not.toHaveBeenCalled();

    const options = mutateMock.mock.calls[0]?.[1] as { onSuccess: () => void };
    act(() => options.onSuccess());

    expect(onRecorded).toHaveBeenCalled();
  });
});
