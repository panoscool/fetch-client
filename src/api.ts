import { runResponseErrorInterceptors } from "./errors";
import { createInterceptorManager } from "./interceptors";
import {
	createErrorRequestConfig,
	createRequestDraft,
	finalizeRequest,
	joinUrl,
} from "./request";
import { createFetchTransport } from "./transport";
import type {
	ApiClient,
	ApiClientConfig,
	ApiRequestDraft,
	ApiRequestOptions,
	ApiResponse,
} from "./types";

export const createApiClient = ({
	baseUrl = "",
	headers: clientHeaders,
	transport = createFetchTransport(),
}: ApiClientConfig = {}): ApiClient => {
	const requestInterceptors = createInterceptorManager<ApiRequestDraft>();
	const responseInterceptors = createInterceptorManager<ApiResponse>();

	const request = async <TResponse, TBody = unknown>(
		path: string,
		options: ApiRequestOptions<TBody> = {},
	): Promise<ApiResponse<TResponse>> => {
		const method = options.method ?? "GET";
		let requestDraft: ApiRequestDraft = createRequestDraft(
			path,
			baseUrl,
			method,
			options,
		);
		let requestConfig = createErrorRequestConfig(requestDraft);

		try {
			requestDraft = await requestInterceptors.run(requestDraft);
			requestConfig = createErrorRequestConfig(requestDraft);
			requestConfig = await finalizeRequest(requestDraft, clientHeaders);

			const response = await transport<TResponse>(requestConfig);
			const interceptedResponse = await responseInterceptors.run(response);
			return interceptedResponse as ApiResponse<TResponse>;
		} catch (error) {
			const interceptedResponse = await runResponseErrorInterceptors(
				responseInterceptors,
				error,
				requestConfig,
				`${method} ${joinUrl(baseUrl, path)} failed`,
			);
			return interceptedResponse as ApiResponse<TResponse>;
		}
	};

	return {
		request,
		get: (path, options) => request(path, { ...options, method: "GET" }),
		post: (path, body, options) =>
			request(path, { ...options, method: "POST", body }),
		put: (path, body, options) =>
			request(path, { ...options, method: "PUT", body }),
		patch: (path, body, options) =>
			request(path, { ...options, method: "PATCH", body }),
		delete: (path, body, options) =>
			request(path, { ...options, method: "DELETE", body }),
		interceptors: {
			request: requestInterceptors,
			response: responseInterceptors,
		},
	};
};
