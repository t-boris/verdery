import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Button } from './button';

describe('Button', () => {
  it('exposes its label as the accessible name', () => {
    render(<Button>Check again</Button>);

    expect(screen.getByRole('button', { name: 'Check again' })).toBeDefined();
  });

  it('defaults to type "button" so it never submits a surrounding form', () => {
    render(<Button>Check again</Button>);

    expect(screen.getByRole('button').getAttribute('type')).toBe('button');
  });

  it('stays focusable while busy so the state change is announced', () => {
    render(<Button busy>Check again</Button>);
    const button = screen.getByRole('button', { name: 'Check again' });

    button.focus();

    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.hasAttribute('disabled')).toBe(false);
  });

  it('ignores activation while busy', () => {
    const onClick = vi.fn();
    render(
      <Button busy onClick={onClick}>
        Check again
      </Button>,
    );

    screen.getByRole('button').click();

    expect(onClick).not.toHaveBeenCalled();
  });

  it('invokes the handler when it is not busy', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Check again</Button>);

    screen.getByRole('button').click();

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
