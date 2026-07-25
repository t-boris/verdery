/**
 * English messages added by the accessibility and localization pass
 * (P8-UX-01).
 *
 * A separate module spread into `en.ts` rather than more lines in it, for the
 * same reason `en-today.ts` exists: the main catalogue sits at the
 * repository's 600-line source-file limit, so new message domains arrive as
 * their own modules. Key identity and typing discipline are unchanged — these
 * keys join `englishMessages`, and `ru-accessibility.ts` is typed against this
 * module so it cannot omit or invent one.
 *
 * Source: architecture/web-application-design.md, sections "14. Accessibility"
 * and "15. Localization".
 */
export const englishAccessibilityMessages = {
  /** The stage's own accessible name. */
  'map.canvas.ariaLabel': 'Garden map canvas',

  /**
   * The canvas's keyboard contract, read by assistive technology through the
   * stage's `aria-describedby`. The second half is deliberately an admission:
   * drawing and vertex dragging have no keyboard equivalent in this pass, and
   * saying so is more useful than silence.
   */
  'map.canvas.keyboardHelp':
    'Arrow keys pan the map, or move the selected object; hold Shift for a larger step. Plus and minus zoom. Delete removes the selected object. Escape clears the selection or the tool. Drawing a shape and dragging a vertex need a pointer and have no keyboard equivalent; use the object list beside the map to select, rename, reposition, and delete objects without one.',

  /**
   * Measurement units as translated words rather than literals appended to a
   * formatted number: the abbreviation differs by language, and the decimal
   * separator inside `{value}` is the reader's, not POSIX's.
   */
  'map.units.centimetres': '{value} cm',
  'map.units.metres': '{value} m',

  /**
   * WCAG 2.2 SC 3.3.1 asks that an input error be *described* in text. The
   * email field previously reused `auth.signInFailed` ("Sign-in did not
   * succeed. Try again."), which names neither the field nor the problem —
   * an announcement that tells a screen-reader user nothing actionable.
   */
  'auth.emailInvalid': 'Enter an email address, for example name@example.com.',
} as const;
