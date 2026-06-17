#!/usr/bin/env node
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const projectRoot = process.cwd();
const npmCache = mkdtempSync(join(tmpdir(), "fetch-client-npm-cache-"));
const tscBin = join(projectRoot, "node_modules", ".bin", "tsc");
const typeRoots = join(projectRoot, "node_modules", "@types");

function run(cmd, opts = {}) {
	console.log(`\n> ${cmd}`);
	execSync(cmd, { stdio: "inherit", ...opts });
}

function runNpm(cmd, opts = {}) {
	run(cmd, {
		...opts,
		env: { ...process.env, npm_config_cache: npmCache, ...opts.env },
	});
}

function runGet(cmd, opts = {}) {
	return execSync(cmd, { encoding: "utf8", ...opts }).trim();
}

function fail(msg) {
	console.error(`\n${msg}\n`);
	process.exit(1);
}

// 1) Unit tests
run("bun test");

// 2) Build
run("bun run build");

// 3) Smoke test dist outputs directly (Node ESM + CJS)
run(
	`node --input-type=module -e "import { createApiClient } from './dist/index.mjs'; const client = createApiClient({ transport: async (request) => ({ data: { ok: true, url: request.url }, status: 200, statusText: 'OK', headers: new Headers(), request, response: Response.json({ ok: true }) }) }); const res = await client.get('/health'); console.log(res.data.ok, res.request.method, res.request.url);"`,
);
run(
	`node -e "const { createApiClient } = require('./dist/index.cjs'); const client = createApiClient({ transport: async (request) => ({ data: { ok: true, url: request.url }, status: 200, statusText: 'OK', headers: new Headers(), request, response: Response.json({ ok: true }) }) }); client.post('/users', { name: 'Ada' }).then((res) => console.log(res.data.ok, res.request.method, res.request.url));"`,
);

// 4) Create a tarball (the real artifact users install)
runNpm("npm pack");

const tgz = runGet(
	`node -e "const fs=require('fs'); const files=fs.readdirSync('.').filter(f=>f.endsWith('.tgz')).sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs); console.log(files[0]||'');"`,
);
if (!tgz) fail("npm pack did not produce a .tgz file");

// 5) Install tarball into a temp consumer project and test imports + types
const dir = mkdtempSync(join(tmpdir(), "fetch-client-consumer-"));
console.log(`\nTemp consumer project: ${dir}`);

try {
	runNpm("npm init -y", { cwd: dir });
	runNpm(`npm install ${join(projectRoot, tgz)}`, { cwd: dir });

	writeFileSync(
		join(dir, "esm.mjs"),
		`${`
import { createApiClient } from "@panoscool/fetch-client";

const client = createApiClient({
	baseUrl: "https://api.example.com/v1",
	transport: async (request) => ({
		data: { ok: true, method: request.method, url: request.url },
		status: 200,
		statusText: "OK",
		headers: new Headers(),
		request,
		response: Response.json({ ok: true }),
	}),
});

const res = await client.get("/health");
console.log(res.data.ok, res.data.method, res.data.url);
`.trim()}\n`,
	);
	run("node esm.mjs", { cwd: dir });

	writeFileSync(
		join(dir, "cjs.cjs"),
		`${`
const { createApiClient } = require("@panoscool/fetch-client");

const client = createApiClient({
	baseUrl: "https://api.example.com/v1",
	transport: async (request) => ({
		data: { ok: true, method: request.method, url: request.url },
		status: 200,
		statusText: "OK",
		headers: new Headers(),
		request,
		response: Response.json({ ok: true }),
	}),
});

client.post("/users", { name: "Ada" }).then((res) => {
	console.log(res.data.ok, res.data.method, res.data.url);
});
`.trim()}\n`,
	);
	run("node cjs.cjs", { cwd: dir });

	writeFileSync(
		join(dir, "tsconfig.json"),
		`${JSON.stringify(
			{
				compilerOptions: {
					target: "ESNext",
					module: "ESNext",
					moduleResolution: "Bundler",
					strict: true,
					noEmit: true,
					types: ["node"],
					typeRoots: [typeRoots],
				},
			},
			null,
			2,
		)}\n`,
	);

	writeFileSync(
		join(dir, "types-test.ts"),
		`${`
import { ApiError, createApiClient, type ApiRequestConfig, type ApiResponse } from "@panoscool/fetch-client";

type User = { id: number; name: string };

const client = createApiClient({
	baseUrl: "https://api.example.com",
	headers: { "x-app": "verify" },
	transport: async <TResponse>(request: ApiRequestConfig) => ({
		data: { id: 1, name: "Ada" } as TResponse,
		status: 200,
		statusText: "OK",
		headers: new Headers(),
		request,
		response: Response.json({ id: 1, name: "Ada" }),
	}),
});

const res: ApiResponse<User> = await client.get<User>("/users/1");
const name: string = res.data.name;

try {
	await client.get("/error");
} catch (error) {
	if (error instanceof ApiError) {
		const status: number = error.status;
		console.log(status);
	}
}

console.log(name);
`.trim()}\n`,
	);

	run(`${JSON.stringify(tscBin)} -p tsconfig.json`, { cwd: dir });
} finally {
	rmSync(dir, { recursive: true, force: true });
	rmSync(join(projectRoot, tgz), { force: true });
	rmSync(npmCache, { recursive: true, force: true });
}

console.log("\nAll checks passed!");
