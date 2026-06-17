import type { ApiResponseType } from "./types";

export const parseResponse = async (
	response: Response,
	responseType: ApiResponseType = "auto",
) => {
	if (responseType === "raw") {
		return response;
	}

	if (response.status === 204) {
		return null;
	}

	switch (responseType) {
		case "arrayBuffer":
			return response.arrayBuffer();
		case "blob":
			return response.blob();
		case "formData":
			return response.formData();
		case "json":
			return response.json();
		case "text":
			return response.text();
	}

	const contentType = response.headers.get("Content-Type") ?? "";
	if (contentType.includes("application/json")) {
		return response.json();
	}

	return response.text();
};
