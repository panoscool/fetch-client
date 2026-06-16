import { describe, test } from "bun:test";
import assert from "node:assert/strict";

import { createApiClient } from "./index.ts";

const decoder = new TextDecoder();

const withMockFetch = async (mockFetch, run) => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = mockFetch;

	try {
		await run();
	} finally {
		globalThis.fetch = originalFetch;
	}
};

const readBodyText = async (body) => {
	if (body == null) {
		return undefined;
	}

	if (typeof body === "string") {
		return body;
	}

	if (body instanceof URLSearchParams) {
		return body.toString();
	}

	if (body instanceof Blob) {
		return body.text();
	}

	if (body instanceof ArrayBuffer) {
		return decoder.decode(new Uint8Array(body));
	}

	if (ArrayBuffer.isView(body)) {
		return decoder.decode(body);
	}

	throw new Error("Expected a text-readable body");
};

const getHeader = (init, name) => {
	return new Headers(init?.headers).get(name);
};

const createRecoveredResponse = (error, data) => {
	const response = error.response ?? new Response(null, { status: 200 });

	return {
		data,
		status: response.status,
		statusText: response.statusText,
		headers: response.headers,
		request: error.request,
		response,
	};
};

test("serializes falsy JSON bodies and keeps default headers", async () => {
	const calls = [];

	await withMockFetch(
		async (input, init) => {
			calls.push({ input, init });
			return Response.json({ ok: true });
		},
		async () => {
			const client = createApiClient({ baseUrl: "https://example.com" });

			await client.post("/zero", 0);
			await client.post("/flag", false);
		},
	);

	assert.equal(calls.length, 2);
	assert.equal(calls[0]?.input, "https://example.com/zero");
	assert.equal(calls[0]?.init?.method, "POST");
	assert.equal(await readBodyText(calls[0]?.init?.body), "0");
	assert.equal(getHeader(calls[0]?.init, "Content-Type"), "application/json");
	assert.equal(getHeader(calls[0]?.init, "Accept"), "application/json");
	assert.equal(await readBodyText(calls[1]?.init?.body), "false");
	assert.equal(getHeader(calls[1]?.init, "Content-Type"), "application/json");
});

test("preserves the baseUrl path and lets absolute URLs override it", async () => {
	const calls = [];

	await withMockFetch(
		async (input) => {
			calls.push(input);
			return Response.json({ ok: true });
		},
		async () => {
			const client = createApiClient({ baseUrl: "https://api.example.com/v1" });

			await client.get("/users"); // base path /v1 is preserved
			await client.get("users"); // leading slash is optional
			await client.get("https://other.example.com/x"); // absolute overrides baseUrl
			await client.get("//cdn.example.com/y"); // protocol-relative also overrides
		},
	);

	assert.equal(calls[0], "https://api.example.com/v1/users");
	assert.equal(calls[1], "https://api.example.com/v1/users");
	assert.equal(calls[2], "https://other.example.com/x");
	assert.equal(calls[3], "//cdn.example.com/y");
});

test("passes raw string, URLSearchParams, and FormData bodies through unchanged", async () => {
	const calls = [];
	const formData = new FormData();
	formData.set("name", "codex");
	const searchParams = new URLSearchParams({ q: "hello world" });

	await withMockFetch(
		async (input, init) => {
			calls.push({ input, init });
			return new Response("ok");
		},
		async () => {
			const client = createApiClient();

			await client.post("/string", "hello");
			await client.post("/params", searchParams);
			await client.post("/form", formData);
		},
	);

	assert.equal(await readBodyText(calls[0]?.init?.body), "hello");
	assert.equal(getHeader(calls[0]?.init, "Content-Type"), null);
	assert.equal(calls[1]?.init?.body, searchParams);
	assert.equal(getHeader(calls[1]?.init, "Content-Type"), null);
	assert.equal(calls[2]?.init?.body, formData);
	assert.equal(getHeader(calls[2]?.init, "Content-Type"), null);
});

test("request interceptors mutate the raw draft before request finalization", async () => {
	const calls = [];
	let seenBody;

	await withMockFetch(
		async (input, init) => {
			calls.push({ input, init });
			return Response.json({ ok: true });
		},
		async () => {
			const client = createApiClient({ baseUrl: "https://example.com" });

			client.interceptors.request.use((request) => {
				seenBody = request.body;
				return {
					...request,
					url: `${request.url}?draft=1`,
					body: { enabled: false, count: 2 },
					headers: { "x-from-interceptor": "yes" },
				};
			});

			await client.post("/rewrite", { enabled: true });
		},
	);

	assert.deepEqual(seenBody, { enabled: true });
	assert.equal(calls[0]?.input, "https://example.com/rewrite?draft=1");
	assert.equal(
		await readBodyText(calls[0]?.init?.body),
		JSON.stringify({ enabled: false, count: 2 }),
	);
	assert.equal(getHeader(calls[0]?.init, "Content-Type"), "application/json");
	assert.equal(getHeader(calls[0]?.init, "x-from-interceptor"), "yes");
});

test("header resolver sees the finalized request snapshot and request headers override client headers", async () => {
	const calls = [];

	await withMockFetch(
		async (input, init) => {
			calls.push({ input, init });
			return Response.json({ ok: true });
		},
		async () => {
			const client = createApiClient({
				baseUrl: "https://example.com",
				headers: (request) => ({
					"x-body": String(request.body),
					"x-content-type": request.headers.get("Content-Type") ?? "missing",
					"x-mode": "client",
				}),
			});

			await client.post(
				"/signed",
				{ amount: 10 },
				{ headers: { "x-mode": "request" } },
			);
		},
	);

	assert.equal(calls[0]?.input, "https://example.com/signed");
	assert.equal(getHeader(calls[0]?.init, "x-body"), '{"amount":10}');
	assert.equal(getHeader(calls[0]?.init, "x-content-type"), "application/json");
	assert.equal(getHeader(calls[0]?.init, "x-mode"), "request");
});

test("helper methods issue the expected HTTP methods and allow DELETE bodies", async () => {
	const methods = [];
	const calls = [];

	await withMockFetch(
		async (input, init) => {
			calls.push({ input, init });
			methods.push(String(init?.method));
			return Response.json({ ok: true });
		},
		async () => {
			const client = createApiClient();

			await client.get("/get");
			await client.post("/post", { ok: true });
			await client.put("/put", { ok: true });
			await client.patch("/patch", { ok: true });
			await client.delete("/delete");
			await client.delete("/delete-with-body", { ids: [1, 2] });
		},
	);

	assert.deepEqual(methods, [
		"GET",
		"POST",
		"PUT",
		"PATCH",
		"DELETE",
		"DELETE",
	]);
	assert.equal(await readBodyText(calls[4]?.init?.body), undefined);
	assert.equal(
		await readBodyText(calls[5]?.init?.body),
		JSON.stringify({ ids: [1, 2] }),
	);
	assert.equal(getHeader(calls[5]?.init, "Content-Type"), "application/json");
});

test("returns the full response with data, status, statusText, and headers", async () => {
	await withMockFetch(
		async () =>
			Response.json({ ok: true }, { status: 201, statusText: "Created" }),
		async () => {
			const client = createApiClient();

			const response = await client.get("/resource");

			assert.deepEqual(response.data, { ok: true });
			assert.equal(response.status, 201);
			assert.equal(response.statusText, "Created");
			assert.ok(
				response.headers.get("Content-Type")?.includes("application/json"),
			);
			assert.ok(response.response instanceof Response);
			// The attached Response body is still readable (parsing used a clone).
			assert.deepEqual(await response.response.json(), { ok: true });
		},
	);
});

test("auto response parsing supports JSON and text responses", async () => {
	const responses = [
		Response.json({ ok: true }),
		new Response("plain-text", {
			headers: { "Content-Type": "text/plain" },
		}),
	];

	await withMockFetch(
		async () => {
			const response = responses.shift();
			assert.ok(response);
			return response;
		},
		async () => {
			const client = createApiClient();

			assert.deepEqual((await client.get("/json")).data, { ok: true });
			assert.equal((await client.get("/text")).data, "plain-text");
		},
	);
});

test("explicit response types cover text, json, blob, arrayBuffer, formData, and raw", async () => {
	const responses = [
		new Response("explicit-text", {
			headers: { "Content-Type": "text/plain" },
		}),
		Response.json({ mode: "json" }),
		new Response("blob-value", {
			headers: { "Content-Type": "application/octet-stream" },
		}),
		new Response("array-buffer", {
			headers: { "Content-Type": "application/octet-stream" },
		}),
		new Response(new URLSearchParams({ q: "1", mode: "form" }), {
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
		}),
		new Response("raw-value", { headers: { "Content-Type": "text/plain" } }),
	];

	await withMockFetch(
		async () => {
			const response = responses.shift();
			assert.ok(response);
			return response;
		},
		async () => {
			const client = createApiClient();

			assert.equal(
				(await client.get("/text", { responseType: "text" })).data,
				"explicit-text",
			);
			assert.deepEqual(
				(await client.get("/json", { responseType: "json" })).data,
				{ mode: "json" },
			);

			const { data: blob } = await client.get("/blob", {
				responseType: "blob",
			});
			assert.equal(await blob.text(), "blob-value");

			const { data: arrayBuffer } = await client.get("/array-buffer", {
				responseType: "arrayBuffer",
			});
			assert.equal(decoder.decode(new Uint8Array(arrayBuffer)), "array-buffer");

			const { data: formData } = await client.get("/form-data", {
				responseType: "formData",
			});
			assert.equal(formData.get("q"), "1");
			assert.equal(formData.get("mode"), "form");

			const { data: rawResponse } = await client.get("/raw", {
				responseType: "raw",
			});
			assert.ok(rawResponse instanceof Response);
			assert.equal(await rawResponse.text(), "raw-value");
		},
	);
});

describe("normalizes HTTP error messages across common payload shapes", () => {
	test("detail payloads become the message", async () => {
		await withMockFetch(
			async () =>
				new Response(JSON.stringify({ detail: "bad request" }), {
					status: 400,
					headers: { "Content-Type": "application/json" },
				}),
			async () => {
				const client = createApiClient();
				await assert.rejects(client.get("/detail"), (error) => {
					assert.equal(error.name, "ApiError");
					assert.equal(error.message, "bad request");
					assert.equal(error.status, 400);
					return true;
				});
			},
		);
	});

	test("nested errors payloads become the message", async () => {
		await withMockFetch(
			async () =>
				new Response(JSON.stringify({ errors: [{ message: "nested boom" }] }), {
					status: 422,
					headers: { "Content-Type": "application/json" },
				}),
			async () => {
				const client = createApiClient();
				await assert.rejects(client.get("/nested"), (error) => {
					assert.equal(error.message, "nested boom");
					assert.equal(error.status, 422);
					return true;
				});
			},
		);
	});

	test("plain text payloads fall back to the text body", async () => {
		await withMockFetch(
			async () =>
				new Response("server exploded", {
					status: 500,
					headers: { "Content-Type": "text/plain" },
				}),
			async () => {
				const client = createApiClient();
				await assert.rejects(client.get("/text-error"), (error) => {
					assert.equal(error.message, "server exploded");
					assert.equal(error.status, 500);
					return true;
				});
			},
		);
	});
});

test("error responses keep a readable body and redact sensitive headers in toJSON", async () => {
	await withMockFetch(
		async () =>
			new Response(JSON.stringify({ detail: "nope" }), {
				status: 403,
				headers: { "Content-Type": "application/json" },
			}),
		async () => {
			const client = createApiClient();

			let caught;
			try {
				await client.get("/secure", {
					headers: { Authorization: "Bearer secret-token" },
				});
			} catch (error) {
				caught = error;
			}

			assert.ok(caught, "expected the request to reject");
			assert.equal(caught.name, "ApiError");
			assert.equal(caught.status, 403);
			// error.data holds the parsed payload...
			assert.deepEqual(caught.data, { detail: "nope" });
			// ...and the attached Response body is still readable.
			assert.deepEqual(await caught.response.json(), { detail: "nope" });

			const serialized = caught.toJSON();
			assert.equal(serialized.status, 403);
			assert.equal(serialized.request.headers.authorization, "[REDACTED]");
		},
	);
});

describe("normalizes network and abort failures", () => {
	test("network errors keep their message with status 0", async () => {
		await withMockFetch(
			async () => {
				throw new Error("offline");
			},
			async () => {
				const client = createApiClient();
				await assert.rejects(client.get("/offline"), (error) => {
					assert.equal(error.name, "ApiError");
					assert.equal(error.message, "offline");
					assert.equal(error.status, 0);
					assert.ok(error.cause instanceof Error);
					return true;
				});
			},
		);
	});

	test("abort errors map to Request aborted", async () => {
		await withMockFetch(
			async () => {
				throw new DOMException("The operation was aborted.", "AbortError");
			},
			async () => {
				const client = createApiClient();
				await assert.rejects(client.get("/abort"), (error) => {
					assert.equal(error.message, "Request aborted");
					assert.equal(error.status, 0);
					return true;
				});
			},
		);
	});
});

test("parse failures are normalized and can be recovered by response error interceptors", async () => {
	await withMockFetch(
		async () =>
			new Response("not-json", {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		async () => {
			const client = createApiClient();

			client.interceptors.response.use(undefined, (error) => {
				return createRecoveredResponse(error, { recovered: "parse" });
			});

			assert.deepEqual((await client.get("/parse")).data, {
				recovered: "parse",
			});
		},
	);
});

describe("request setup failures are normalized and can be recovered by response error interceptors", () => {
	test("request interceptor failures are recoverable", async () => {
		await withMockFetch(
			async () => Response.json({ ok: true }),
			async () => {
				const client = createApiClient();

				client.interceptors.request.use(() => {
					throw { message: "draft failure" };
				});
				client.interceptors.response.use(undefined, (error) => {
					return createRecoveredResponse(error, {
						recovered: "request-interceptor",
					});
				});

				assert.deepEqual((await client.get("/request-interceptor")).data, {
					recovered: "request-interceptor",
				});
			},
		);
	});

	test("header resolver failures are recoverable", async () => {
		await withMockFetch(
			async () => Response.json({ ok: true }),
			async () => {
				const client = createApiClient({
					headers: () => {
						throw new Error("signing failed");
					},
				});

				client.interceptors.response.use(undefined, (error) => {
					assert.equal(error.message, "signing failed");
					assert.equal(error.request.url, "/header-failure");
					return createRecoveredResponse(error, {
						recovered: "header-resolver",
					});
				});

				assert.deepEqual((await client.get("/header-failure")).data, {
					recovered: "header-resolver",
				});
			},
		);
	});
});

test("response error interceptors that throw are re-normalized as ApiError", async () => {
	await withMockFetch(
		async () => {
			throw new Error("offline");
		},
		async () => {
			const client = createApiClient();

			client.interceptors.response.use(undefined, () => {
				throw { detail: "interceptor boom" };
			});

			await assert.rejects(client.get("/rethrow"), (error) => {
				assert.equal(error.name, "ApiError");
				assert.equal(error.message, "interceptor boom");
				assert.equal(error.status, 0);
				return true;
			});
		},
	);
});

test("response interceptors support ordered transforms, eject, and clear", async () => {
	await withMockFetch(
		async () => Response.json({ order: [] }),
		async () => {
			const client = createApiClient();
			const touched = [];

			const ejectedRequestInterceptor = client.interceptors.request.use(
				(request) => {
					touched.push("request-ejected");
					return request;
				},
			);
			client.interceptors.request.eject(ejectedRequestInterceptor);

			client.interceptors.request.use((request) => {
				touched.push("request-active");
				return {
					...request,
					body: { order: ["request-active"] },
				};
			});

			const firstResponseInterceptor = client.interceptors.response.use(
				(response) => {
					touched.push("response-first");
					return {
						...response,
						data: {
							...response.data,
							order: [...response.data.order, "response-first"],
						},
					};
				},
			);

			client.interceptors.response.use((response) => {
				touched.push("response-second");
				return {
					...response,
					data: {
						...response.data,
						order: [...response.data.order, "response-second"],
					},
				};
			});

			const transformed = await client.post("/ordered", {});
			assert.deepEqual(transformed.data.order, [
				"response-first",
				"response-second",
			]);
			assert.deepEqual(touched, [
				"request-active",
				"response-first",
				"response-second",
			]);

			client.interceptors.response.eject(firstResponseInterceptor);
			const afterEject = await client.post("/after-eject", {});
			assert.deepEqual(afterEject.data.order, ["response-second"]);

			client.interceptors.response.clear();
			const afterClear = await client.post("/after-clear", {});
			assert.deepEqual(afterClear.data.order, []);
		},
	);
});
