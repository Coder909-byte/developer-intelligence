import { fileURLToPath } from 'node:url';
import { verifyAggregatorFixture } from './lib/aggregator-fixture-check.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
console.log(
  JSON.stringify(
    {
      status: 'PASS',
      scope: 'external fixture only, not platform routing',
      ...(await verifyAggregatorFixture(root)),
    },
    null,
    2,
  ),
);
