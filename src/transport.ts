import { normalizeApiError } from "./errors";
import { parseResponse } from "./response";
import type { ApiRequestConfig, ApiTransport } from "./types";

export const createFetchTransport = (
	fetchImpl: typeof fetch = fetch,
): ApiTransport => {
	return async <TResponse>(request: ApiRequestConfig) => {
		let response: Response;
		try {
			response = await fetchImpl(request.url, request);
		} catch (error) {
			throw normalizeApiError({
				request,
				error,
				fallbackMessage: `${request.method} ${request.url} failed`,
			});
		}

		let data: unknown;
		try {
			// Parse a clone so the body of `response` stays readable for callers and
			// for error.response (see ApiError). The clone tees the body stream.
			data = await parseResponse(response.clone(), request.responseType);
		} catch (error) {
			throw normalizeApiError({
				request,
				response,
				error,
				fallbackMessage: `${request.method} ${request.url} returned an unreadable response`,
			});
		}

		if (!response.ok) {
			throw normalizeApiError({
				request,
				response,
				error: data,
				data,
				status: response.status,
				fallbackMessage: `${request.method} ${request.url} failed with ${response.status}`,
			});
		}

		return {
			data: data as TResponse,
			status: response.status,
			statusText: response.statusText,
			headers: response.headers,
			request,
			response,
		};
	};
};
