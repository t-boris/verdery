/**
 * Browser-safe Zod entry point.
 *
 * Zod 4 probes `new Function` before using its generated validation path.
 * Even though that probe is caught, browsers report it as a Content Security
 * Policy violation. Verdery's production CSP deliberately excludes
 * `unsafe-eval`, so every web form imports this configured instance instead.
 */
import { z } from 'zod';

z.config({ jitless: true });

export { z };
