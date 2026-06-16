# @panoscool/fetch-client

A tiny, typed HTTP client built on the native `fetch` API. It adds the ergonomics you usually reach for — a base URL, default and dynamic headers, automatic JSON handling, request/response interceptors, and structured errors — without pulling in a heavy dependency.

## Features

- **Thin wrapper over `fetch`**: No polyfills, no transport magic. Uses the platform `fetch`, `Headers`, and `Response`.
- **Typed responses**: `client.get<User>('/me')` resolves to a fully typed `{ data, status, statusText, headers, request, response }`.
- **Smart bodies**: Plain objects are serialized to JSON with the right `Content-Type`; `string`, `FormData`, `URLSearchParams`, `Blob`, and `ArrayBuffer` pass through untouched.
- **Flexible response parsing**: `auto` (JSON/text by content type), or force `json`, `text`, `blob`, `arrayBuffer`, `formData`, or `raw`.
- **Interceptors**: Mutate the outgoing request draft, transform responses, or recover from errors.
- **Dynamic headers**: Provide static headers or an (async) resolver that sees the finalized request — handy for signing/auth.
- **Structured errors**: Every failure becomes an `ApiError` with `status`, `data`, `request`, and `response`, plus a redacting `toJSON()` that's safe to log.
- **Pluggable transport**: Inject a custom `fetch` implementation for testing or advanced control.
- **ESM & CJS**: Ships both, with TypeScript types.

## Installation

```bash
npm install @panoscool/fetch-client
```

**Requirements:** Node 20+ (or any runtime with a global `fetch`). The published types rely only on fetch's globals — `@types/node` is enough; you do **not** need the `"DOM"` lib in your `tsconfig`.

## Quick start

```typescript
import { createApiClient } from '@panoscool/fetch-client';

const api = createApiClient({ baseUrl: 'https://api.example.com' });

type User = { id: number; name: string };

const { data, status } = await api.get<User>('/users/1');
console.log(status, data.name);

await api.post('/users', { name: 'Ada' });
```

### CommonJS

```javascript
const { createApiClient } = require('@panoscool/fetch-client');
```

## Creating a client

```typescript
const api = createApiClient({
  baseUrl: 'https://api.example.com', // optional; prepended to each path
  headers: { 'x-app': 'web' },        // static headers, or a resolver (see below)
  transport: createFetchTransport(),  // optional; override the fetch transport
});
```

| Option | Type | Description |
| --- | --- | --- |
| `baseUrl` | `string` | Prepended to request paths, preserving any base path (e.g. `/v1`). A trailing `/` on the base and a leading `/` on the path are normalized. A path that is itself an absolute URL (`https://…` or `//…`) overrides `baseUrl`. |
| `headers` | `HeadersInit` \| `(request) => HeadersInit \| Promise<HeadersInit>` | Default headers, or a resolver invoked per request. |
| `transport` | `ApiTransport` | Custom transport. Defaults to a `fetch`-based transport. |

## Request methods

```typescript
api.request<TResponse, TBody>(path, options?)
api.get<TResponse>(path, options?)
api.post<TResponse, TBody>(path, body?, options?)
api.put<TResponse, TBody>(path, body?, options?)
api.patch<TResponse, TBody>(path, body?, options?)
api.delete<TResponse, TBody>(path, body?, options?)
```

`options` extends the standard `RequestInit` (so `signal`, `credentials`, `mode`, `cache`, … all pass through), plus:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `headers` | `HeadersInit` | — | Per-request headers. Override client headers. |
| `responseType` | `'auto' \| 'json' \| 'text' \| 'blob' \| 'arrayBuffer' \| 'formData' \| 'raw'` | `'auto'` | How to read the response body. |

## The response

Every successful call resolves to the full response (not just the body):

```typescript
const res = await api.get<User>('/users/1');

res.data;        // parsed body, typed as User
res.status;      // 200
res.statusText;  // 'OK'
res.headers;     // Headers
res.request;     // the finalized request config (url, method, headers, body)
res.response;    // the raw Response (body still readable — parsing uses a clone)
```

## Bodies

Plain objects are JSON-serialized and get `Content-Type: application/json` automatically:

```typescript
await api.post('/users', { name: 'Ada' });
// body: '{"name":"Ada"}', Content-Type: application/json
```

`string`, `FormData`, `URLSearchParams`, `Blob`, and `ArrayBuffer`/typed-array bodies are sent as-is, and `Content-Type` is left to the platform:

```typescript
const form = new FormData();
form.set('file', file);
await api.post('/upload', form); // no Content-Type forced; boundary handled by fetch
```

## Response types

```typescript
await api.get('/data', { responseType: 'json' });        // res.data: parsed JSON
await api.get('/page', { responseType: 'text' });         // res.data: string
await api.get('/file', { responseType: 'blob' });         // res.data: Blob
await api.get('/buf', { responseType: 'arrayBuffer' });   // res.data: ArrayBuffer
await api.get('/form', { responseType: 'formData' });     // res.data: FormData
await api.get('/raw', { responseType: 'raw' });           // res.data: Response (unread)
```

With `auto` (the default), `application/json` responses are parsed as JSON, everything else as text. A `204 No Content` resolves with `data: null`.

## Headers

Precedence, from lowest to highest: built-in defaults (`Accept: application/json`) → client headers → per-request headers.

The client `headers` resolver receives the finalized request (URL, method, serialized body, and headers), which makes request signing straightforward:

```typescript
const api = createApiClient({
  baseUrl: 'https://api.example.com',
  headers: async (request) => ({
    Authorization: `Bearer ${await getToken()}`,
    'x-signature': sign(request.method, request.url, String(request.body ?? '')),
  }),
});
```

## Interceptors

### Request interceptors

Run against the raw request **draft** before it is finalized (before JSON serialization and header merging). Mutate the URL, body, or headers:

```typescript
const id = api.interceptors.request.use((draft) => ({
  ...draft,
  url: `${draft.url}?trace=1`,
  headers: { 'x-trace-id': crypto.randomUUID() },
}));

api.interceptors.request.eject(id); // remove a single interceptor
api.interceptors.request.clear();   // remove all
```

### Response interceptors

Run against the full response, in registration order:

```typescript
api.interceptors.response.use((res) => {
  console.log(`${res.request.method} ${res.request.url} -> ${res.status}`);
  return res;
});
```

### Recovering from errors

A response interceptor's second argument handles errors. Return a response to recover, or throw to propagate:

```typescript
api.interceptors.response.use(undefined, (error) => {
  if (error.status === 401) {
    return refreshAndRetry(error.request); // must return a response-shaped object
  }
  throw error;
});
```

## Errors

Any non-2xx status, network failure, or unreadable body is thrown as an `ApiError`:

```typescript
import { ApiError } from '@panoscool/fetch-client';

try {
  await api.get('/missing');
} catch (error) {
  if (error instanceof ApiError) {
    error.status;   // HTTP status, or 0 for network/abort failures
    error.data;     // parsed error payload, when present
    error.request;  // the finalized request config
    error.response; // the raw Response (body still readable)
    error.cause;    // the original thrown error
  }
}
```

`ApiError` extracts a useful `message` from common payload shapes (`{ detail }`, `{ message }`, `{ error }`, `{ errors: [{ message }] }`, plain text). Aborted requests report `"Request aborted"` with `status: 0`.

`error.toJSON()` returns a log-safe view with sensitive request headers (`Authorization`, `Cookie`, `Set-Cookie`, `Proxy-Authorization`, `X-Api-Key`) redacted.

## Cancellation

Pass an `AbortSignal` like any other `fetch` call:

```typescript
const controller = new AbortController();
const promise = api.get('/slow', { signal: controller.signal });
controller.abort();
// rejects with an ApiError: "Request aborted"
```

## Custom transport

`createFetchTransport` lets you inject a `fetch` implementation — useful in tests or to wrap fetch:

```typescript
import { createApiClient, createFetchTransport } from '@panoscool/fetch-client';

const api = createApiClient({
  transport: createFetchTransport(myFetch),
});
```

## Development

```bash
bun install
bun run lint    # biome
bun test        # bun test runner
bun run build   # ESM + CJS + type declarations into dist/
```

## License

MIT — see [LICENSE](LICENSE)
