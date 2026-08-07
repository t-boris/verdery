import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LanguageSwitcher } from './language-switcher';
import { LocalizationProvider } from './localization-provider';

const refresh = vi.fn();

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

describe('LanguageSwitcher', () => {
  beforeEach(() => {
    refresh.mockReset();
    document.cookie = 'verdery_locale=; Path=/; Max-Age=0';
  });

  it('stores an explicit language preference and refreshes server-rendered copy', () => {
    render(
      <LocalizationProvider locale="en">
        <LanguageSwitcher />
      </LocalizationProvider>,
    );

    expect(screen.getByRole('button', { name: 'Use English' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Use Russian' }));

    expect(document.cookie).toContain('verdery_locale=ru');
    expect(refresh).toHaveBeenCalledOnce();
  });
});
