import { test } from "bun:test";
import assert from "node:assert/strict";

import { createInterceptorManager } from "../src/interceptors";

test("createInterceptorManager runs fulfilled interceptors in registration order", async () => {
	const manager = createInterceptorManager<{ order: string[] }>();

	manager.use((value) => ({ order: [...value.order, "first"] }));
	manager.use((value) => ({ order: [...value.order, "second"] }));

	assert.deepEqual(await manager.run({ order: [] }), {
		order: ["first", "second"],
	});
});

test("createInterceptorManager can eject and clear interceptors", async () => {
	const manager = createInterceptorManager<string[]>();

	const first = manager.use((value) => [...value, "first"]);
	manager.use((value) => [...value, "second"]);
	manager.eject(first);

	assert.deepEqual(await manager.run([]), ["second"]);

	manager.clear();
	assert.deepEqual(await manager.run([]), []);
});

test("createInterceptorManager routes rejected values through rejection handlers", async () => {
	const manager = createInterceptorManager<string>();

	manager.use(undefined, (error) => `recovered:${String(error)}`);
	manager.use((value) => `${value}:next`);

	assert.equal(await manager.runRejected("boom"), "recovered:boom:next");
});
