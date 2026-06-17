import { test } from "bun:test";
import assert from "node:assert/strict";

import { normalizeApiError, runResponseErrorInterceptors } from "../src/errors";
import { createInterceptorManager } from "../src/interceptors";
import { ApiError, type ApiResponse } from "../src/types";
import { createRequest } from "./helpers";

test("ApiError serializes safely and redacts sensitive request headers", () => {
	const error = new ApiError({
		message: "Forbidden",
		status: 403,
		data: { detail: "nope" },
		request: createRequest({
			headers: new Headers({
				Authorization: "Bearer secret",
				"x-api-key": "secret",
				"x-safe": "visible",
			}),
		}),
	});

	assert.deepEqual(error.toJSON(), {
		name: "ApiError",
		message: "Forbidden",
		status: 403,
		data: { detail: "nope" },
		request: {
			url: "/resource",
			method: "GET",
			headers: {
				authorization: "[REDACTED]",
				"x-api-key": "[REDACTED]",
				"x-safe": "visible",
			},
		},
	});
});

test("normalizeApiError preserves existing ApiError instances", () => {
	const original = new ApiError({
		message: "Original",
		status: 418,
		data: null,
		request: createRequest(),
	});

	assert.equal(
		normalizeApiError({
			error: original,
			fallbackMessage: "fallback",
			request: createRequest(),
		}),
		original,
	);
});

test("normalizeApiError resolves useful messages from common error payloads", () => {
	const request = createRequest();
	const cases: Array<[unknown, string]> = [
		[new DOMException("aborted", "AbortError"), "Request aborted"],
		[new Error("offline"), "offline"],
		["plain message", "plain message"],
		[{ error: "error field" }, "error field"],
		[{ message: "message field" }, "message field"],
		[{ detail: "detail field" }, "detail field"],
		[{ title: "title field" }, "title field"],
		[{ errors: ["first error"] }, "first error"],
		[{ errors: [{ message: "nested message" }] }, "nested message"],
		[{ errors: [{ code: "invalid" }] }, "fallback"],
		[{}, "fallback"],
	];

	for (const [input, message] of cases) {
		const error = normalizeApiError({
			error: input,
			fallbackMessage: "fallback",
			request,
		});
		assert.equal(error.message, message);
		assert.equal(error.status, 0);
		assert.equal(error.request, request);
	}
});

test("normalizeApiError uses response status, explicit status, data, response, and cause", () => {
	const request = createRequest();
	const response = Response.json({ detail: "bad" }, { status: 400 });
	const cause = new Error("cause");
	const error = normalizeApiError({
		error: cause,
		data: { detail: "bad" },
		status: 422,
		response,
		fallbackMessage: "fallback",
		request,
	});

	assert.equal(error.message, "bad");
	assert.equal(error.status, 422);
	assert.deepEqual(error.data, { detail: "bad" });
	assert.equal(error.response, response);
	assert.equal(error.cause, cause);
});

test("runResponseErrorInterceptors recovers or re-normalizes thrown interceptor errors", async () => {
	const request = createRequest();
	const recoveryManager = createInterceptorManager<ApiResponse>();
	recoveryManager.use(undefined, (error) => ({
		data: { recovered: true },
		status: 200,
		statusText: "OK",
		headers: new Headers(),
		request: (error as ApiError).request,
		response: Response.json({ recovered: true }),
	}));

	assert.deepEqual(
		(
			await runResponseErrorInterceptors(
				recoveryManager,
				{ message: "boom" },
				request,
				"fallback",
			)
		).data,
		{ recovered: true },
	);

	const throwingManager = createInterceptorManager<ApiResponse>();
	throwingManager.use(undefined, () => {
		throw { detail: "interceptor boom" };
	});

	await assert.rejects(
		runResponseErrorInterceptors(
			throwingManager,
			new Error("offline"),
			request,
			"fallback",
		),
		(error: unknown) => {
			assert.ok(error instanceof ApiError);
			assert.equal(error.message, "interceptor boom");
			assert.equal(error.status, 0);
			return true;
		},
	);
});
