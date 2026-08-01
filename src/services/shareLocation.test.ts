import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { shareLocationContent } from './shareLocation.ts';

const coord = { latitude: 42.6977, longitude: 23.3219 };

describe('shareLocationContent', () => {
  it('builds an Apple Maps universal link pinned at the exact coordinate', () => {
    // ll drops the pin at the point; q labels it. Recipients on iOS get a rich map
    // bubble in Messages/Mail and the link opens Apple Maps.
    const { url } = shareLocationContent({ name: 'Kaufland Mladost', coordinate: coord });
    assert.equal(url, 'https://maps.apple.com/?ll=42.6977,23.3219&q=Kaufland%20Mladost');
  });

  it('uses the place name as both the share message and the pin label', () => {
    const { message, url } = shareLocationContent({ name: 'Kaufland Mladost', coordinate: coord });
    assert.equal(message, 'Kaufland Mladost');
    assert.match(url, /q=Kaufland%20Mladost$/);
  });

  it('falls back to the coordinate label for a placeholder pin', () => {
    // "Dropped Pin" means nothing to a recipient — share the coordinate instead,
    // exactly as destinationTitle decides for the car.
    const { message, url } = shareLocationContent({ name: 'Dropped Pin', coordinate: coord });
    assert.equal(message, '42.6977, 23.3219');
    assert.equal(url, 'https://maps.apple.com/?ll=42.6977,23.3219&q=42.6977%2C%2023.3219');
  });

  it('encodes names with spaces and unicode safely into the query', () => {
    const name = 'Кап. Петко Войвода';
    const { url } = shareLocationContent({ name, coordinate: coord });
    assert.equal(url, `https://maps.apple.com/?ll=42.6977,23.3219&q=${encodeURIComponent(name)}`);
  });

  it('keeps full coordinate precision in the pin location', () => {
    const precise = { latitude: 42.41738, longitude: 27.69821 };
    const { url } = shareLocationContent({ name: 'X', coordinate: precise });
    assert.match(url, /ll=42\.41738,27\.69821&/);
  });
});
