import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAdapter, isAdapterCompliant, AdapterComplianceError } from '../src/adapter/validateAdapter.ts';
import { MockAdapter } from './mocks/MockAdapter.ts';
import type { ChatAdapter } from '../src/index.ts';

test('a complete adapter passes validation', () => {
  assert.doesNotThrow(() => validateAdapter(new MockAdapter()));
  assert.equal(isAdapterCompliant(new MockAdapter()), true);
});

test('a partial adapter fails with the missing methods listed', () => {
  const broken = { connect: () => {}, sendMessage: () => {} } as unknown as ChatAdapter;
  assert.throws(
    () => validateAdapter(broken),
    (e: unknown) => {
      assert.ok(e instanceof AdapterComplianceError);
      assert.ok(e.missing.includes('uploadAttachment'));
      assert.ok(e.missing.includes('subscribeMessages'));
      return true;
    }
  );
});

test('uploadAttachment is part of the required contract', () => {
  // Shadow the prototype method with undefined to simulate a missing impl.
  const noUpload = new MockAdapter() as unknown as Record<string, unknown>;
  noUpload.uploadAttachment = undefined;
  assert.equal(isAdapterCompliant(noUpload as unknown as ChatAdapter), false);
});
