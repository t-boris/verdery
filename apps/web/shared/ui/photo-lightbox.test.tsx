import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PhotoLightbox } from './photo-lightbox';

const PHOTOS = [
  { id: 'one', src: 'https://example.org/one.jpg', alt: 'Leaf', caption: 'Alan' },
  { id: 'two', src: 'https://example.org/two.jpg', alt: 'Bark', caption: 'Jo' },
];

describe('PhotoLightbox', () => {
  it('shows the complete active image, caption, and position', () => {
    render(
      <PhotoLightbox
        photos={PHOTOS}
        activeIndex={1}
        dialogLabel="Reference photos"
        closeLabel="Close"
        previousLabel="Previous"
        nextLabel="Next"
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('img', { name: 'Bark' }).getAttribute('src')).toBe(PHOTOS[1]?.src);
    expect(screen.getByText('Jo')).toBeTruthy();
    expect(screen.getByText('2 / 2')).toBeTruthy();
  });

  it('navigates with controls and arrow keys and closes with Escape', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <PhotoLightbox
        photos={PHOTOS}
        activeIndex={0}
        dialogLabel="Reference photos"
        closeLabel="Close"
        previousLabel="Previous"
        nextLabel="Next"
        onSelect={onSelect}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onSelect.mock.calls).toEqual([[1], [1], [1]]);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
