import type { ApiRequestConfig } from "../src/types";

const decoder = new TextDecoder();

const createRequest = (
	overrides: Partial<ApiRequestConfig> = {},
): ApiRequestConfig => ({
	path: "/resource",
	url: "/resource",
	method: "GET",
	headers: new Headers({ Accept: "application/json" }),
	...overrides,
});

const readBodyText = async (body: unknown) => {
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

export { createRequest, decoder, readBodyText };
