export type MaybePromise<T> = Promise<T> | T;
export type ApiMethod = "DELETE" | "GET" | "PATCH" | "POST" | "PUT";
export type ApiResponseType =
	| "arrayBuffer"
	| "auto"
	| "blob"
	| "formData"
	| "json"
	| "raw"
	| "text";

// Self-contained equivalents of the DOM-only `HeadersInit`/`BodyInit` aliases,
// so consumers need only fetch's globals (provided by @types/node) — not the DOM lib.
export type HeadersInput =
	| Headers
	| Record<string, string>
	| Array<[string, string]>;
export type BodyInput =
	| string
	| Blob
	| FormData
	| URLSearchParams
	| ArrayBuffer
	| ArrayBufferView<ArrayBuffer>;

export type ApiRequestOptions<TBody = unknown> = Omit<
	RequestInit,
	"body" | "headers" | "method"
> & {
	method?: ApiMethod;
	headers?: HeadersInput;
	body?: TBody;
	responseType?: ApiResponseType;
};

export type ApiRequestDraft<TBody = unknown> = Omit<
	ApiRequestOptions<TBody>,
	"method"
> & {
	path: string;
	url: string;
	method: ApiMethod;
};

export type ApiRequestConfig = Omit<
	ApiRequestOptions<BodyInput | undefined>,
	"method"
> & {
	path: string;
	url: string;
	method: ApiMethod;
	headers: Headers;
	body?: BodyInput;
};

const SENSITIVE_HEADERS = new Set([
	"authorization",
	"cookie",
	"set-cookie",
	"proxy-authorization",
	"x-api-key",
]);

const redactHeaders = (
	headers: Headers | undefined,
): Record<string, string> => {
	const result: Record<string, string> = {};
	if (!headers) return result;

	headers.forEach((value, key) => {
		result[key] = SENSITIVE_HEADERS.has(key.toLowerCase())
			? "[REDACTED]"
			: value;
	});

	return result;
};

export class ApiError extends Error {
	readonly status: number;
	readonly data: unknown;
	readonly request: ApiRequestConfig;
	readonly response?: Response;
	readonly cause?: unknown;

	constructor({
		message,
		status,
		data,
		request,
		response,
		cause,
	}: {
		message: string;
		status: number;
		data: unknown;
		request: ApiRequestConfig;
		response?: Response;
		cause?: unknown;
	}) {
		super(message);
		this.name = "ApiError";
		this.status = status;
		this.data = data;
		this.request = request;
		this.response = response;
		this.cause = cause;
	}

	// Safe to log/serialize: sensitive request headers (auth, cookies) are redacted.
	toJSON() {
		return {
			name: this.name,
			message: this.message,
			status: this.status,
			data: this.data,
			request: {
				url: this.request.url,
				method: this.request.method,
				headers: redactHeaders(this.request.headers),
			},
		};
	}
}

export type ApiResponse<TData = unknown> = {
	data: TData;
	status: number;
	statusText: string;
	headers: Headers;
	request: ApiRequestConfig;
	response: Response;
};

export type ApiHeadersResolver =
	| HeadersInput
	| ((request: ApiRequestConfig) => MaybePromise<HeadersInput>);

export type ApiInterceptor<TValue> = {
	onFulfilled?: (value: TValue) => MaybePromise<TValue>;
	onRejected?: (error: unknown) => MaybePromise<TValue>;
};

export type ApiTransport = <TResponse>(
	request: ApiRequestConfig,
) => Promise<ApiResponse<TResponse>>;

export type ApiInterceptorManager<TValue> = {
	use: (
		onFulfilled?: (value: TValue) => MaybePromise<TValue>,
		onRejected?: (error: unknown) => MaybePromise<TValue>,
	) => number;
	eject: (id: number) => void;
	clear: () => void;
};

export type ApiClient = {
	request: <TResponse, TBody = unknown>(
		path: string,
		options?: ApiRequestOptions<TBody>,
	) => Promise<ApiResponse<TResponse>>;
	get: <TResponse>(
		path: string,
		options?: Omit<ApiRequestOptions<never>, "body" | "method">,
	) => Promise<ApiResponse<TResponse>>;
	post: <TResponse, TBody = unknown>(
		path: string,
		body?: TBody,
		options?: Omit<ApiRequestOptions<TBody>, "body" | "method">,
	) => Promise<ApiResponse<TResponse>>;
	put: <TResponse, TBody = unknown>(
		path: string,
		body?: TBody,
		options?: Omit<ApiRequestOptions<TBody>, "body" | "method">,
	) => Promise<ApiResponse<TResponse>>;
	patch: <TResponse, TBody = unknown>(
		path: string,
		body?: TBody,
		options?: Omit<ApiRequestOptions<TBody>, "body" | "method">,
	) => Promise<ApiResponse<TResponse>>;
	delete: <TResponse, TBody = unknown>(
		path: string,
		body?: TBody,
		options?: Omit<ApiRequestOptions<TBody>, "body" | "method">,
	) => Promise<ApiResponse<TResponse>>;
	interceptors: {
		request: ApiInterceptorManager<ApiRequestDraft>;
		response: ApiInterceptorManager<ApiResponse>;
	};
};

export type ApiClientConfig = {
	baseUrl?: string;
	headers?: ApiHeadersResolver;
	transport?: ApiTransport;
};
