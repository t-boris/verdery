import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Component tests share one jsdom document, so a rendered tree must be removed
// before the next test queries the screen.
afterEach(cleanup);
