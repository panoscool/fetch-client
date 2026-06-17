import { test } from "bun:test";
import assert from "node:assert/strict";

import { parseResponse } from "../src/response";
import { decoder } from "./helpers";

test("parseResponse returns raw responses and null for 204", async () => {
	const raw = new Response("raw-value");

	assert.equal(await parseResponse(raw, "raw"), raw);
	assert.equal(await parseResponse(new Response(null, { status: 204 })), null);
});

test("parseResponse auto-detects JSON by content type and text otherwise", async () => {
	assert.deepEqual(await parseResponse(Response.json({ ok: true })), {
		ok: true,
	});
	assert.equal(
		await parseResponse(
			new Response("plain-text", { headers: { "Content-Type": "text/plain" } }),
		),
		"plain-text",
	);
});

test("parseResponse supports explicit response types", async () => {
	assert.equal(await parseResponse(new Response("text"), "text"), "text");
	assert.deepEqual(await parseResponse(Response.json({ mode: "json" }), "json"), {
		mode: "json",
	});

	const blob = await parseResponse(new Response("blob-value"), "blob");
	assert.ok(blob instanceof Blob);
	assert.equal(await blob.text(), "blob-value");

	const arrayBuffer = await parseResponse(new Response("array-buffer"), "arrayBuffer");
	assert.ok(arrayBuffer instanceof ArrayBuffer);
	assert.equal(decoder.decode(new Uint8Array(arrayBuffer)), "array-buffer");

	const formData = await parseResponse(
		new Response(new URLSearchParams({ q: "1", mode: "form" }), {
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
		}),
		"formData",
	);
	assert.ok(formData instanceof FormData);
	assert.equal(formData.get("q"), "1");
	assert.equal(formData.get("mode"), "form");
});
