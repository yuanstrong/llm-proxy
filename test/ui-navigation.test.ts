import assert from 'node:assert/strict';
import test from 'node:test';
import { navigationItems } from '../src/ui/lib/navigation';

test('management navigation exposes the four management pages in order', () => {
  assert.deepEqual(
    navigationItems.map((item) => ({ id: item.id, label: item.label })),
    [
      { id: 'overview', label: 'Overview' },
      { id: 'configuration', label: 'Configuration' },
      { id: 'logs', label: 'Logs' },
      { id: 'prompts', label: 'Prompts' },
    ],
  );
});
