import type {
	ApiInterceptorManager,
	ApiRequestConfig,
	ApiResponse,
} from "./types";
import { ApiError } from "./types";

const getNonEmptyString = (value: unknown) => {
	return typeof value === "string" && value.trim() ? value : undefined;
};

function resolveErrorMessage(input: unknown, fallback: string): string {
	if (input instanceof DOMException && input.name === "AbortError") {
		return "Request aborted";
	}

	if (input instanceof Error) {
		const message = getNonEmptyString(input.message);
		if (message) return message;
	}

	const directMessage = getNonEmptyString(input);
	if (directMessage) {
		return directMessage;
	}

	if (input && typeof input === "object") {
		const obj = input as Record<string, unknown>;

		for (const key of ["error", "message", "detail", "title"] as const) {
			const message = getNonEmptyString(obj[key]);
			if (message) return message;
		}

		if (Array.isArray(obj.errors) && obj.errors.length > 0) {
			const [first] = obj.errors;
			const message = getNonEmptyString(first);
			if (message) return message;

			if (first && typeof first === "object") {
				const nested = first as Record<string, unknown>;

				for (const key of ["message", "error", "detail"] as const) {
					const nestedMessage = getNonEmptyString(nested[key]);
					if (nestedMessage) return nestedMessage;
				}
			}
		}
	}

	return fallback;
}

export const normalizeApiError = ({
	error,
	fallbackMessage,
	request,
	response,
	data,
	status,
}: {
	error: unknown;
	fallbackMessage: string;
	request: ApiRequestConfig;
	response?: Response;
	data?: unknown;
	status?: number;
}) => {
	if (error instanceof ApiError) {
		return error;
	}

	const errorData = data ?? error;

	return new ApiError({
		message: resolveErrorMessage(errorData, fallbackMessage),
		status: status ?? response?.status ?? 0,
		data: errorData,
		request,
		response,
		cause: error,
	});
};

export const runResponseErrorInterceptors = async (
	interceptors: ApiInterceptorManager<ApiResponse> & {
		runRejected: (error: unknown) => Promise<ApiResponse>;
	},
	error: unknown,
	request: ApiRequestConfig,
	fallbackMessage: string,
) => {
	const normalizedError = normalizeApiError({
		request,
		error,
		fallbackMessage,
	});

	try {
		return await interceptors.runRejected(normalizedError);
	} catch (interceptorError) {
		throw normalizeApiError({
			request,
			error: interceptorError,
			fallbackMessage,
		});
	}
};
