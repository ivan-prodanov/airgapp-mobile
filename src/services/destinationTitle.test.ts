import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { destinationTitle, isPlaceholderTitle } from './destinationTitle.ts';

const coord = { latitude: 42.6977, longitude: 23.3219 };

describe('destinationTitle', () => {
  it('prefers a real name', () => {
    assert.equal(destinationTitle({ name: 'Kaufland Mladost', address: 'ul. Andrey Saharov 1', coordinate: coord }), 'Kaufland Mladost');
  });

  it('falls back to the address when there is no name', () => {
    assert.equal(destinationTitle({ address: 'ul. Andrey Saharov 1', coordinate: coord }), 'ul. Andrey Saharov 1');
  });

  it('falls back to the coordinate when there is neither', () => {
    assert.equal(destinationTitle({ coordinate: coord }), '42.6977, 23.3219');
  });

  it('never sends a display placeholder as a destination name', () => {
    // "Dropped Pin" in the car's route list is worse than a coordinate, which at
    // least says where it is.
    assert.equal(destinationTitle({ name: 'Dropped Pin', coordinate: coord }), '42.6977, 23.3219');
    assert.equal(destinationTitle({ name: 'dropped pin', address: 'ul. Filip Avramov 1', coordinate: coord }), 'ul. Filip Avramov 1');
    assert.equal(destinationTitle({ name: 'Location', coordinate: coord }), '42.6977, 23.3219');
    assert.equal(destinationTitle({ name: 'Shared Location', coordinate: coord }), '42.6977, 23.3219');
  });

  it('treats blank and whitespace-only strings as absent', () => {
    assert.equal(destinationTitle({ name: '   ', address: '', coordinate: coord }), '42.6977, 23.3219');
  });

  it('trims surrounding whitespace off a real title', () => {
    assert.equal(destinationTitle({ name: '  Lidl  ', coordinate: coord }), 'Lidl');
  });

  it('collapses newlines in a multi-line address into one line', () => {
    // Apple postal addresses arrive multi-line; the car shows a single row.
    assert.equal(
      destinationTitle({ address: 'ul. Filip Avramov 1\n1000 Sofia\nBulgaria', coordinate: coord }),
      'ul. Filip Avramov 1, 1000 Sofia, Bulgaria',
    );
  });

  it('exposes the placeholder check for callers that want to warn', () => {
    assert.equal(isPlaceholderTitle('Dropped Pin'), true);
    assert.equal(isPlaceholderTitle('Kaufland'), false);
  });
});
