// Auto-advance's news rule: the next news comes once at least half of those still working on the chapter (teams, or
// students in a whole-class game) have gone the wait without a right answer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stuckDue } from '../../shared/campaign.ts';

test('news is due once half of those still working have been stuck for the wait', () => {
    assert.equal(stuckDue([], 1000), null, 'nobody working: no news by itself');
    assert.equal(stuckDue([0], 1000), 1000);
    assert.equal(stuckDue([0, 500], 1000), 1000, 'one of two is half');
    assert.equal(stuckDue([0, 500, 900], 1000), 1500, 'two of three');
    assert.equal(stuckDue([900, 0, 500, 200], 1000), 1200, 'two of four, whatever the order');
    assert.equal(stuckDue([0, 0, 0, 5000], 1000), 1000, 'one team answering does not hold back the news from three stuck ones');
});
