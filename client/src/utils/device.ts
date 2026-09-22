/**
 * Treat a browser as "PC" when it is driven by a mouse or trackpad, i.e. it can
 * hover and exposes at least one fine pointer. Phones and tablets cannot hover,
 * so they fall through to the touch branch.
 *
 * The check deliberately does not look for `Chrome` in the user agent: Android
 * tablets ship Chrome too, and matching on the browser name alone would
 * misclassify a pad as a PC.
 *
 * iPadOS 13+ reports a Macintosh-like user agent, so the UA test below is only
 * a first-pass filter for obvious mobile browsers — the pointer/hover media
 * queries are what actually separate a pad from a desktop.
 */
export function isDesktopBrowser(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;

  const ua = navigator.userAgent || '';
  if (/Android|iPhone|iPad|iPod|Windows Phone|webOS|BlackBerry|Mobile|Silk/i.test(ua)) {
    return false;
  }

  const canHover = window.matchMedia?.('(hover: hover)').matches ?? false;
  const hasFinePointer = window.matchMedia?.('(any-pointer: fine)').matches ?? false;
  return canHover && hasFinePointer;
}
