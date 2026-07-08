import { test } from "bun:test";
import assert from "node:assert/strict";

import { createApiClient } from "../src/api";
import type { ApiError, ApiResponse } from "../src/types";
import { readBodyText } from "./helpers";

type FetchCall = {
	input: string | URL | Request;
	init?: RequestInit;
};

type MockFetch = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;

const withMockFetch = async (
	mockFetch: MockFetch,
	run: () => Promise<void>,
) => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = mockFetch as typeof fetch;

	try {
		await run();
	} finally {
		globalThis.fetch = originalFetch;
	}
};

const getHeader = (init: RequestInit | undefined, name: string) => {
	return new Headers(init?.headers).get(name);
};

const createRecoveredResponse = <TData>(
	error: ApiError,
	data: TData,
): ApiResponse<TData> => {
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

test("createApiClient helper methods issue expected HTTP methods and bodies", async () => {
	const methods: string[] = [];
	const calls: FetchCall[] = [];

	await withMockFetch(
		async (input, init) => {
			calls.push({ input, init });
			methods.push(String(init?.method));
			return Response.json({ ok: true });
		},
		async () => {
			const client = createApiClient({ baseUrl: "https://api.example.com" });

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
	assert.equal(calls[0]?.input, "https://api.example.com/get");
	assert.equal(await readBodyText(calls[4]?.init?.body), undefined);
	assert.equal(
		await readBodyText(calls[5]?.init?.body),
		JSON.stringify({ ids: [1, 2] }),
	);
	assert.equal(getHeader(calls[5]?.init, "Content-Type"), "application/json");
});

test("createApiClient request interceptors mutate drafts before finalization", async () => {
	const calls: FetchCall[] = [];
	let seenBody: unknown;

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
	assert.equal(getHeader(calls[0]?.init, "x-from-interceptor"), "yes");
});

test("createApiClient returns full responses and keeps raw response bodies readable", async () => {
	await withMockFetch(
		async () =>
			Response.json({ ok: true }, { status: 201, statusText: "Created" }),
		async () => {
			const client = createApiClient();
			const response = await client.get<{ ok: true }>("/resource");

			assert.deepEqual(response.data, { ok: true });
			assert.equal(response.status, 201);
			assert.equal(response.statusText, "Created");
			assert.ok(response.response instanceof Response);
			assert.deepEqual(await response.response.json(), { ok: true });
		},
	);
});

test("createApiClient response interceptors transform, recover, eject, and clear", async () => {
	await withMockFetch(
		async () => Response.json({ order: [] }),
		async () => {
			const client = createApiClient();
			const touched: string[] = [];

			client.interceptors.request.use((request) => {
				touched.push("request-active");
				return {
					...request,
					body: { order: ["request-active"] },
				};
			});

			const firstResponseInterceptor = client.interceptors.response.use(
				(response) => {
					const data = response.data as { order: string[] };
					touched.push("response-first");
					return {
						...response,
						data: {
							...data,
							order: [...data.order, "response-first"],
						},
					};
				},
			);

			client.interceptors.response.use((response) => {
				const data = response.data as { order: string[] };
				touched.push("response-second");
				return {
					...response,
					data: {
						...data,
						order: [...data.order, "response-second"],
					},
				};
			});

			const transformed = await client.post<{ order: string[] }>(
				"/ordered",
				{},
			);
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
			const afterEject = await client.post<{ order: string[] }>(
				"/after-eject",
				{},
			);
			assert.deepEqual(afterEject.data.order, ["response-second"]);

			client.interceptors.response.clear();
			const afterClear = await client.post<{ order: string[] }>(
				"/after-clear",
				{},
			);
			assert.deepEqual(afterClear.data.order, []);
		},
	);
});

test("createApiClient lets response error interceptors recover setup and transport failures", async () => {
	await withMockFetch(
		async () => Response.json({ ok: true }),
		async () => {
			const requestFailureClient = createApiClient();
			requestFailureClient.interceptors.request.use(() => {
				throw { message: "draft failure" };
			});
			requestFailureClient.interceptors.response.use(undefined, (error) =>
				createRecoveredResponse(error as ApiError, {
					recovered: "request-interceptor",
				}),
			);

			assert.deepEqual(
				(await requestFailureClient.get("/request-interceptor")).data,
				{ recovered: "request-interceptor" },
			);

			const headerFailureClient = createApiClient({
				headers: () => {
					throw new Error("signing failed");
				},
			});
			headerFailureClient.interceptors.response.use(undefined, (error) =>
				createRecoveredResponse(error as ApiError, {
					recovered: "header-resolver",
				}),
			);

			assert.deepEqual(
				(await headerFailureClient.get("/header-failure")).data,
				{
					recovered: "header-resolver",
				},
			);
		},
	);
});

test("createApiClient propagates normalized errors when interceptors throw", async () => {
	await withMockFetch(
		async () => {
			throw new Error("offline");
		},
		async () => {
			const client = createApiClient();

			client.interceptors.response.use(undefined, () => {
				throw { detail: "interceptor boom" };
			});

			await assert.rejects(client.get("/rethrow"), (error: unknown) => {
				assert.equal((error as Error).name, "ApiError");
				assert.equal((error as Error).message, "interceptor boom");
				return true;
			});
		},
	);
});
