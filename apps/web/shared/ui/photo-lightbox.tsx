'use client';

import type { ReactNode } from 'react';
import { useEffect } from 'react';

import { CloseIcon } from './icons';
import styles from './photo-lightbox.module.css';

export interface LightboxPhoto {
  readonly id: string;
  readonly src: string;
  readonly alt: string;
  readonly caption?: ReactNode;
}

export interface PhotoLightboxProps {
  readonly photos: readonly LightboxPhoto[];
  readonly activeIndex: number | null;
  readonly dialogLabel: string;
  readonly closeLabel: string;
  readonly previousLabel: string;
  readonly nextLabel: string;
  readonly onSelect: (index: number) => void;
  readonly onClose: () => void;
}

/** Full-viewport, uncropped photo viewing with captions and keyboard/gallery navigation. */
export function PhotoLightbox({
  photos,
  activeIndex,
  dialogLabel,
  closeLabel,
  previousLabel,
  nextLabel,
  onSelect,
  onClose,
}: PhotoLightboxProps) {
  const photo = activeIndex === null ? undefined : photos[activeIndex];
  const hasMultiple = photos.length > 1;

  useEffect(() => {
    if (photo === undefined || activeIndex === null) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft' && hasMultiple) {
        onSelect((activeIndex - 1 + photos.length) % photos.length);
      }
      if (event.key === 'ArrowRight' && hasMultiple) {
        onSelect((activeIndex + 1) % photos.length);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [activeIndex, hasMultiple, onClose, onSelect, photo, photos.length]);

  if (photo === undefined || activeIndex === null) return null;

  const previousIndex = (activeIndex - 1 + photos.length) % photos.length;
  const nextIndex = (activeIndex + 1) % photos.length;

  return (
    <div
      className={styles['backdrop']}
      role="dialog"
      aria-modal="true"
      aria-label={dialogLabel}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <button
        type="button"
        className={styles['close']}
        onClick={onClose}
        aria-label={closeLabel}
        title={closeLabel}
      >
        <CloseIcon />
      </button>

      {hasMultiple && (
        <button
          type="button"
          className={`${styles['navigation']} ${styles['previous']}`}
          onClick={() => onSelect(previousIndex)}
          aria-label={previousLabel}
          title={previousLabel}
        >
          ←
        </button>
      )}

      <figure className={styles['figure']}>
        <img className={styles['image']} src={photo.src} alt={photo.alt} />
        <figcaption className={styles['caption']}>
          <span className={styles['counter']}>
            {activeIndex + 1} / {photos.length}
          </span>
          {photo.caption}
        </figcaption>
      </figure>

      {hasMultiple && (
        <button
          type="button"
          className={`${styles['navigation']} ${styles['next']}`}
          onClick={() => onSelect(nextIndex)}
          aria-label={nextLabel}
          title={nextLabel}
        >
          →
        </button>
      )}
    </div>
  );
}
