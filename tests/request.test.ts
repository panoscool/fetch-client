import { test } from "bun:test";
import assert from "node:assert/strict";

import {
	createErrorRequestConfig,
	createRequestDraft,
	finalizeRequest,
	joinUrl,
} from "../src/request";
import type { ApiRequestDraft } from "../src/types";
import { readBodyText } from "./helpers";

test("joinUrl preserves base paths and lets absolute URLs override the base", () => {
	assert.equal(
		joinUrl("https://api.example.com/v1", "/users"),
		"https://api.example.com/v1/users",
	);
	assert.equal(
		joinUrl("https://api.example.com/v1/", "users"),
		"https://api.example.com/v1/users",
	);
	assert.equal(
		joinUrl("https://api.example.com", "https://other.example.com/x"),
		"https://other.example.com/x",
	);
	assert.equal(
		joinUrl("https://api.example.com", "//cdn.example.com/y"),
		"//cdn.example.com/y",
	);
	assert.equal(joinUrl("", "/local"), "/local");
});

test("createRequestDraft keeps options and computes path, url, and method", () => {
	const draft = createRequestDraft(
		"/users",
		"https://api.example.com",
		"POST",
		{
			headers: { "x-request": "yes" },
			body: { name: "Ada" },
			responseType: "json",
		},
	);

	assert.equal(draft.path, "/users");
	assert.equal(draft.url, "https://api.example.com/users");
	assert.equal(draft.method, "POST");
	assert.deepEqual(draft.body, { name: "Ada" });
	assert.equal(draft.responseType, "json");
});

test("createErrorRequestConfig keeps only already-valid body values", async () => {
	const stringConfig = createErrorRequestConfig({
		path: "/raw",
		url: "/raw",
		method: "POST",
		body: "raw",
	});
	const objectConfig = createErrorRequestConfig({
		path: "/json",
		url: "/json",
		method: "POST",
		body: { ok: true },
	});

	assert.equal(await readBodyText(stringConfig.body), "raw");
	assert.equal(objectConfig.body, undefined);
	assert.equal(stringConfig.headers.get("Accept"), "application/json");
});

test("finalizeRequest serializes JSON bodies and applies header precedence", async () => {
	const draft: ApiRequestDraft = {
		path: "/signed",
		url: "https://api.example.com/signed",
		method: "POST",
		headers: { "x-mode": "request" },
		body: { amount: 10 },
	};

	const config = await finalizeRequest(draft, (request) => ({
		"x-body": String(request.body),
		"x-content-type": request.headers.get("Content-Type") ?? "missing",
		"x-mode": "client",
	}));

	assert.equal(await readBodyText(config.body), '{"amount":10}');
	assert.equal(config.headers.get("Accept"), "application/json");
	assert.equal(config.headers.get("Content-Type"), "application/json");
	assert.equal(config.headers.get("x-body"), '{"amount":10}');
	assert.equal(config.headers.get("x-content-type"), "application/json");
	assert.equal(config.headers.get("x-mode"), "request");
});

test("finalizeRequest passes native body values through without forcing content type", async () => {
	const searchParams = new URLSearchParams({ q: "hello world" });
	const formData = new FormData();
	formData.set("name", "Ada");

	const paramsConfig = await finalizeRequest(
		{ path: "/params", url: "/params", method: "POST", body: searchParams },
		undefined,
	);
	const formConfig = await finalizeRequest(
		{ path: "/form", url: "/form", method: "POST", body: formData },
		undefined,
	);

	assert.equal(paramsConfig.body, searchParams);
	assert.equal(paramsConfig.headers.get("Content-Type"), null);
	assert.equal(formConfig.body, formData);
	assert.equal(formConfig.headers.get("Content-Type"), null);
});
