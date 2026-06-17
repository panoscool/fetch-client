import type {
	ApiHeadersResolver,
	ApiMethod,
	ApiRequestConfig,
	ApiRequestDraft,
	ApiRequestOptions,
	BodyInput,
	HeadersInput,
} from "./types";

type PreparedBody = {
	body?: BodyInput;
	contentType?: string;
};

const DEFAULT_HEADERS: Array<[string, string]> = [
	["Accept", "application/json"],
];

const mergeHeaders = (
	...headersList: Array<HeadersInput | undefined>
): Headers => {
	const merged = new Headers();

	for (const headers of [DEFAULT_HEADERS, ...headersList]) {
		if (!headers) continue;

		new Headers(headers).forEach((value, key) => {
			merged.set(key, value);
		});
	}

	return merged;
};

// Matches "https://…" and protocol-relative "//…" (mirrors axios's isAbsoluteURL).
const ABSOLUTE_URL = /^([a-z][a-z\d+\-.]*?:)?\/\//i;

export const joinUrl = (baseUrl: string, path: string) => {
	// An absolute path overrides baseUrl, so callers can target another host.
	if (ABSOLUTE_URL.test(path)) return path;
	if (!baseUrl) return path;
	return `${baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
};

const resolveHeaders = async (
	headers: ApiHeadersResolver | undefined,
	request: ApiRequestConfig,
) => {
	if (!headers) return {};
	return typeof headers === "function" ? headers(request) : headers;
};

const isBodyInit = (value: unknown): value is BodyInput => {
	return (
		typeof value === "string" ||
		value instanceof Blob ||
		value instanceof FormData ||
		value instanceof URLSearchParams ||
		value instanceof ArrayBuffer ||
		ArrayBuffer.isView(value)
	);
};

const prepareBody = (body: unknown): PreparedBody => {
	if (body == null) {
		return {};
	}

	if (isBodyInit(body)) {
		return { body };
	}

	return {
		body: JSON.stringify(body),
		contentType: "application/json",
	};
};

const applyContentType = (
	headers: Headers,
	contentType: string | undefined,
) => {
	if (contentType && !headers.has("Content-Type")) {
		headers.set("Content-Type", contentType);
	}
};

const createRequestConfig = (
	request: ApiRequestDraft,
	headers: Headers,
	preparedBody: PreparedBody,
): ApiRequestConfig => ({
	...request,
	headers,
	body: preparedBody.body,
});

export const createRequestDraft = <TBody>(
	path: string,
	baseUrl: string,
	method: ApiMethod,
	options: ApiRequestOptions<TBody>,
): ApiRequestDraft<TBody> => ({
	...options,
	path,
	url: joinUrl(baseUrl, path),
	method,
});

export const createErrorRequestConfig = (
	request: ApiRequestDraft,
): ApiRequestConfig => {
	const body = isBodyInit(request.body) ? request.body : undefined;
	return {
		...request,
		headers: mergeHeaders(request.headers),
		body,
	};
};

export const finalizeRequest = async (
	request: ApiRequestDraft,
	clientHeaders: ApiHeadersResolver | undefined,
): Promise<ApiRequestConfig> => {
	const preparedBody = prepareBody(request.body);
	const requestHeaders = mergeHeaders(request.headers);
	applyContentType(requestHeaders, preparedBody.contentType);

	const requestSnapshot = createRequestConfig(
		request,
		requestHeaders,
		preparedBody,
	);
	const resolvedHeaders = await resolveHeaders(clientHeaders, requestSnapshot);
	const headers = mergeHeaders(resolvedHeaders, request.headers);
	applyContentType(headers, preparedBody.contentType);

	return createRequestConfig(request, headers, preparedBody);
};
