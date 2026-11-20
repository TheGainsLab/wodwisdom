/**
 * Tests for the pure pieces of visit tracking (src/lib/visitorSource).
 * Run: npm run test:calculators
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deviceOf, isLikelyBot, sourceFrom } from '../src/lib/visitorSource';

const HOST = 'www.thegainslab.com';

test('source: campaign tags and an external referrer host', () => {
  assert.deepEqual(
    sourceFrom('?utm_source=instagram&utm_medium=social&utm_campaign=calc', 'https://l.instagram.com/?u=abc', HOST),
    { source: 'instagram', medium: 'social', campaign: 'calc', content: undefined, referrer: 'l.instagram.com' },
  );
  assert.equal(sourceFrom('', 'https://www.google.com/search?q=private', HOST).referrer, 'www.google.com');
});

test('source: same-site navigation and a direct visit are not a source', () => {
  assert.equal(sourceFrom('', `https://${HOST}/pricing`, HOST).referrer, undefined);
  assert.deepEqual(sourceFrom('', '', HOST), { source: undefined, medium: undefined, campaign: undefined, content: undefined });
  assert.equal(sourceFrom('', 'not a url', HOST).referrer, undefined);
});

test('source: only the host is kept, and long values are clipped', () => {
  const s = sourceFrom('?utm_source=' + 'x'.repeat(200), 'https://example.com/a/very/private/path?token=secret', HOST);
  assert.equal(s.referrer, 'example.com');
  assert.equal(s.source?.length, 60);
});

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const ANDROID_PHONE = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
const ANDROID_TABLET = 'Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const IPAD_OLD = 'Mozilla/5.0 (iPad; CPU OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

test('device: phone, tablet, desktop', () => {
  assert.equal(deviceOf(IPHONE, 390, true), 'phone');
  assert.equal(deviceOf(ANDROID_PHONE, 412, true), 'phone');
  assert.equal(deviceOf(ANDROID_TABLET, 800, true), 'tablet');
  assert.equal(deviceOf(IPAD_OLD, 810, true), 'tablet');
  assert.equal(deviceOf(MAC, 1024, true), 'tablet'); //   iPadOS reports a Mac user agent, but has touch
  assert.equal(deviceOf(MAC, 1440, false), 'desktop');
  assert.equal(deviceOf(WINDOWS, 1366, false), 'desktop');
  assert.equal(deviceOf(WINDOWS, 1366, true), 'desktop'); // a touchscreen laptop is still a desktop
});

test('bots: crawlers and automated browsers that say so are not counted', () => {
  for (const ua of [
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/124.0 Safari/537.36',
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    'Mozilla/5.0 (Linux; Android 11; moto g power) Chrome/109 Mobile Safari/537.36 Chrome-Lighthouse',
    'curl/8.5.0',
    'python-requests/2.31.0',
    '',
  ]) assert.equal(isLikelyBot(ua, false), true, ua || '(empty)');
  assert.equal(isLikelyBot(WINDOWS, true), true); // navigator.webdriver
});

test('bots: real browsers are counted', () => {
  for (const ua of [IPHONE, ANDROID_PHONE, ANDROID_TABLET, IPAD_OLD, MAC, WINDOWS]) {
    assert.equal(isLikelyBot(ua, false), false, ua);
  }
});
