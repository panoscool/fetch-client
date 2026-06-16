import type { ApiInterceptor, ApiInterceptorManager } from "./types.js";

const createInterceptorManager = <TValue>(): ApiInterceptorManager<TValue> & {
	run: (value: TValue) => Promise<TValue>;
	runRejected: (error: unknown) => Promise<TValue>;
} => {
	const interceptors = new Map<number, ApiInterceptor<TValue>>();
	let currentId = 0;

	const apply = (initial: Promise<TValue>) =>
		Array.from(interceptors.values()).reduce(
			(promise, interceptor) =>
				promise.then(interceptor.onFulfilled, interceptor.onRejected),
			initial,
		);

	return {
		use(onFulfilled, onRejected) {
			const id = currentId;
			currentId += 1;
			interceptors.set(id, { onFulfilled, onRejected });
			return id;
		},
		eject(id) {
			interceptors.delete(id);
		},
		clear() {
			interceptors.clear();
		},
		run(value) {
			return apply(Promise.resolve(value));
		},
		runRejected(error) {
			return apply(Promise.reject(error));
		},
	};
};

export { createInterceptorManager };
