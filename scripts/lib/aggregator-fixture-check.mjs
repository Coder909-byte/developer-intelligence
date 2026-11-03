import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { connectMcp } from './mcp-reference-client.mjs';

export async function verifyAggregatorFixture(root) {
  const fixture = await connectMcp(
    root,
    {},
    {
      args: ['scripts/fixtures/aggregator-mcp.mjs'],
      clientName: 'udi-fixture-prerequisite-check',
    },
  );
  try {
    assert.equal(fixture.initialized.serverInfo.name, 'udi-acceptance-fixture');
    const { tools } = await fixture.request('tools/list');
    assert.deepEqual(tools.map((tool) => tool.name).sort(), ['fixture_failure', 'fixture_sum']);
    const nonce = `demo-${randomUUID()}`;
    const result = await fixture.tool('fixture_sum', { a: 14, b: 26, nonce });
    assert.deepEqual(result.data, {
      sum: 40,
      nonce,
      receipt: createHash('sha256')
        .update(JSON.stringify([14, 26, nonce]))
        .digest('hex'),
    });
    const invalid = await fixture.request('tools/call', {
      name: 'fixture_sum',
      arguments: { a: 1001, b: 26, nonce },
    });
    assert.equal(invalid.isError, true);
    const failure = await fixture.request('tools/call', { name: 'fixture_failure', arguments: {} });
    assert.equal(failure.isError, true);
    assert.equal(failure.content[0].text, 'FIXTURE_EXPECTED_FAILURE');
    await assert.rejects(
      fixture.request('tools/call', { name: 'unregistered_tool', arguments: {} }),
      /Tool unregistered_tool not found/,
    );
    return {
      protocol: fixture.initialized.protocolVersion,
      tools: tools.map((tool) => tool.name),
      checks: 5,
    };
  } finally {
    await fixture.close();
  }
}
