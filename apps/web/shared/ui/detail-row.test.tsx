import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DetailRow } from './detail-row';

describe('DetailRow', () => {
  it('renders the label and value as text', () => {
    render(<DetailRow icon={<svg aria-hidden />} label="Confidence" value="82%" />);

    expect(screen.getByText('Confidence')).toBeDefined();
    expect(screen.getByText('82%')).toBeDefined();
  });
});
