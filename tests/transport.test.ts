import { test } from "bun:test";
import assert from "node:assert/strict";

import { createFetchTransport } from "../src/transport";
import { ApiError } from "../src/types";
import { createRequest } from "./helpers";

type MockFetch = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;

const createTransport = (mockFetch: MockFetch) => {
	return createFetchTransport(mockFetch as typeof fetch);
};

test("createFetchTransport calls fetch and returns parsed response metadata", async () => {
	const request = createRequest({ url: "https://api.example.com/users" });
	const transport = createTransport(async (input, init) => {
		assert.equal(input, request.url);
		assert.equal(init, request);
		return Response.json({ ok: true }, { status: 201, statusText: "Created" });
	});

	const response = await transport<{ ok: true }>(request);

	assert.deepEqual(response.data, { ok: true });
	assert.equal(response.status, 201);
	assert.equal(response.statusText, "Created");
	assert.equal(response.request, request);
	assert.ok(response.response instanceof Response);
	assert.deepEqual(await response.response.json(), { ok: true });
});

test("createFetchTransport normalizes network failures", async () => {
	const request = createRequest({ url: "https://api.example.com/offline" });
	const transport = createTransport(async () => {
		throw new Error("offline");
	});

	await assert.rejects(transport(request), (error: unknown) => {
		assert.ok(error instanceof ApiError);
		assert.equal(error.message, "offline");
		assert.equal(error.status, 0);
		assert.equal(error.request, request);
		return true;
	});
});

test("createFetchTransport normalizes unreadable responses", async () => {
	const request = createRequest({
		url: "https://api.example.com/bad-json",
		responseType: "json",
	});
	const transport = createTransport(
		async () =>
			new Response("not-json", {
				headers: { "Content-Type": "application/json" },
			}),
	);

	await assert.rejects(transport(request), (error: unknown) => {
		assert.ok(error instanceof ApiError);
		assert.equal(error.status, 200);
		assert.equal(error.request, request);
		assert.ok(error.message.length > 0);
		return true;
	});
});

test("createFetchTransport normalizes non-2xx responses with parsed data", async () => {
	const request = createRequest({ url: "https://api.example.com/missing" });
	const transport = createTransport(
		async () =>
			new Response(JSON.stringify({ detail: "missing" }), {
				status: 404,
				headers: { "Content-Type": "application/json" },
			}),
	);

	let caught: unknown;
	try {
		await transport(request);
	} catch (error) {
		caught = error;
	}

	assert.ok(caught instanceof ApiError);
	assert.equal(caught.message, "missing");
	assert.equal(caught.status, 404);
	assert.deepEqual(caught.data, { detail: "missing" });
	assert.deepEqual(await caught.response?.json(), { detail: "missing" });
});
