'use strict';
/**
 * End-to-end test inside a real n8n instance (not part of `npm test`).
 *
 *   N8N_BIN=/path/to/node_modules/.bin/n8n \
 *   BBB_URL=https://bbb.example.com/bigbluebutton/ BBB_SECRET=... \
 *   node test/e2e/n8n-e2e.js
 *
 * - starts n8n with this package loaded as community node (N8N_CUSTOM_EXTENSIONS)
 * - creates an owner + API key, credentials (real BBB server + local mock)
 * - runs the credential test through n8n
 * - runs a webhook-triggered workflow: create -> join URL -> join (redirect=false) -> info -> end
 * - activates a BigBlueButton Trigger workflow (hook registration at the mock), sends a
 *   signed callback like bbb-webhooks and checks the execution, then deactivates it
 */
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const { SECRET: MOCK_SECRET, startMockServer } = require('../mock-server');

const ROOT = path.resolve(__dirname, '../..');
const N8N_BIN = process.env.N8N_BIN;
const BBB_URL = process.env.BBB_URL;
const BBB_SECRET = process.env.BBB_SECRET;
const PORT = Number(process.env.N8N_PORT ?? 5690);
const BASE = `http://localhost:${PORT}`;

if (!N8N_BIN || !BBB_URL || !BBB_SECRET) {
	console.error('Set N8N_BIN, BBB_URL and BBB_SECRET');
	process.exit(2);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let cookie = '';

async function rest(method, url, body, headers = {}) {
	const response = await fetch(`${BASE}${url}`, {
		method,
		headers: { 'Content-Type': 'application/json', 'browser-id': 'e2e', cookie, ...headers },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const setCookie = response.headers.get('set-cookie');
	if (setCookie) cookie = setCookie.split(';')[0];
	const text = await response.text();
	let json;
	try {
		json = JSON.parse(text);
	} catch {
		json = text;
	}
	if (!response.ok) throw new Error(`${method} ${url} -> ${response.status}: ${text.slice(0, 500)}`);
	return json?.data ?? json;
}

function step(name) {
	console.log(`\n▶ ${name}`);
}

async function main() {
	// n8n home with our package installed like a community package (~/.n8n/nodes/node_modules)
	const home = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-e2e-'));
	const nodesDir = path.join(home, '.n8n', 'nodes');
	fs.mkdirSync(path.join(nodesDir, 'node_modules'), { recursive: true });
	fs.symlinkSync(ROOT, path.join(nodesDir, 'node_modules', 'n8n-nodes-bigbluebutton'));
	fs.writeFileSync(path.join(nodesDir, 'package.json'), JSON.stringify({ name: 'installed-nodes', private: true, dependencies: { 'n8n-nodes-bigbluebutton': '0.1.0' } }));

	const mock = await startMockServer();
	const logs = [];
	const n8n = spawn(N8N_BIN, ['start'], {
		env: {
			...process.env,
			N8N_USER_FOLDER: home,
			N8N_PORT: String(PORT),
			N8N_HOST: 'localhost',
			N8N_LISTEN_ADDRESS: '127.0.0.1',
			N8N_WEBHOOK_URL: `${BASE}/`,
			WEBHOOK_URL: `${BASE}/`,
			N8N_DIAGNOSTICS_ENABLED: 'false',
			N8N_SECURE_COOKIE: 'false',
			N8N_ENCRYPTION_KEY: 'e2e-test-key',
			DB_SQLITE_POOL_SIZE: '1',
			NODE_FUNCTION_ALLOW_BUILTIN: '*',
		},
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	n8n.stdout.on('data', (chunk) => logs.push(chunk.toString()));
	n8n.stderr.on('data', (chunk) => logs.push(chunk.toString()));
	const cleanup = () => {
		n8n.kill('SIGTERM');
		mock.server.close();
	};

	try {
		step('Start n8n');
		for (let attempt = 0; ; attempt++) {
			try {
				const response = await fetch(`${BASE}/healthz/readiness`);
				if (response.ok) break;
			} catch {}
			if (attempt > 180) throw new Error('n8n did not start');
			await sleep(1000);
		}
		console.log('n8n is ready');

		step('Owner setup + node types loaded');
		await rest('POST', '/rest/owner/setup', { email: 'e2e@example.com', firstName: 'E2E', lastName: 'Test', password: 'E2eTest-Passw0rd!' });
		const loaded = logs.join('').match(/bigBlueButton|BigBlueButton/);
		const types = await rest('POST', '/rest/node-types', { nodeInfos: [
			{ name: 'n8n-nodes-bigbluebutton.bigBlueButton', version: 1 },
			{ name: 'n8n-nodes-bigbluebutton.bigBlueButtonTrigger', version: 1 },
		] }).catch(() => null);
		if (types) {
			assert.equal(types.length, 2, 'both node types are known to n8n');
			console.log('node types:', types.map((type) => type.displayName).join(', '));
		} else {
			console.log('node-types endpoint not available, log mention:', Boolean(loaded));
		}

		step('Credentials');
		const realCredential = await rest('POST', '/rest/credentials', {
			name: 'BBB live', type: 'bigBlueButtonApi',
			data: { url: BBB_URL, secret: BBB_SECRET, checksumAlgorithm: 'sha256' },
		});
		const mockCredential = await rest('POST', '/rest/credentials', {
			name: 'BBB mock', type: 'bigBlueButtonApi',
			data: { url: mock.url, secret: MOCK_SECRET, checksumAlgorithm: 'sha1' },
		});
		console.log('created', realCredential.id, mockCredential.id);

		step('Credential test via n8n');
		const testOk = await rest('POST', '/rest/credentials/test', {
			credentials: { id: realCredential.id, name: 'BBB live', type: 'bigBlueButtonApi', data: { url: BBB_URL, secret: BBB_SECRET, checksumAlgorithm: 'sha256' } },
		});
		console.log('valid:', testOk);
		assert.equal(testOk.status, 'OK');
		const testWrong = await rest('POST', '/rest/credentials/test', {
			credentials: { id: realCredential.id, name: 'BBB live', type: 'bigBlueButtonApi', data: { url: BBB_URL, secret: 'wrong', checksumAlgorithm: 'sha1' } },
		});
		console.log('wrong secret:', testWrong);
		assert.equal(testWrong.status, 'Error');

		step('Action workflow (webhook -> create -> join URL -> join -> get -> end)');
		const meetingID = `n8n-e2e-${Date.now()}`;
		const credentials = { bigBlueButtonApi: { id: realCredential.id, name: 'BBB live' } };
		const bbbNode = (name, x, parameters) => ({
			id: crypto.randomUUID(), name, type: 'n8n-nodes-bigbluebutton.bigBlueButton', typeVersion: 1,
			position: [x, 0], parameters, credentials,
		});
		const actionWorkflow = await rest('POST', '/rest/workflows', {
			name: 'BBB e2e action',
			active: false,
			settings: { executionOrder: 'v1' },
			nodes: [
				{ id: crypto.randomUUID(), name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0], webhookId: crypto.randomUUID(),
					parameters: { httpMethod: 'POST', path: 'bbb-e2e', responseMode: 'lastNode', responseData: 'allEntries', options: {} } },
				bbbNode('Create', 200, { resource: 'meeting', operation: 'create', meetingID: '={{ $json.body.meetingID }}', name: 'n8n E2E – Grüße', additionalFields: { welcome: 'Hallo %%CONFNAME%%', record: false }, metadata: { entry: [{ key: 'origin', value: 'n8n-e2e' }] } }),
				bbbNode('Join URL', 400, { resource: 'meeting', operation: 'getJoinUrl', meetingID: "={{ $('Create').item.json.meetingID }}", fullName: 'Erika Mustermann', role: 'MODERATOR', additionalFields: { createTime: "={{ $('Create').item.json.createTime }}" }, userdata: { entry: [{ key: 'bbb_override_default_locale', value: 'de' }] } }),
				bbbNode('Join', 600, { resource: 'meeting', operation: 'getJoinUrl', meetingID: "={{ $('Create').item.json.meetingID }}", fullName: 'Bot', role: 'VIEWER', executeJoin: true }),
				bbbNode('Info', 800, { resource: 'meeting', operation: 'get', meetingID: "={{ $('Create').item.json.meetingID }}" }),
				bbbNode('End', 1000, { resource: 'meeting', operation: 'end', meetingID: "={{ $('Create').item.json.meetingID }}" }),
				{ id: crypto.randomUUID(), name: 'Collect', type: 'n8n-nodes-base.set', typeVersion: 3.4, position: [1200, 0], parameters: {
					mode: 'raw', jsonOutput: "={{ JSON.stringify({ create: $('Create').item.json, joinUrl: $('Join URL').item.json.url, join: $('Join').item.json, info: $('Info').item.json, end: $json }) }}", options: {} } },
			],
			connections: Object.fromEntries(
				[['Webhook', 'Create'], ['Create', 'Join URL'], ['Join URL', 'Join'], ['Join', 'Info'], ['Info', 'End'], ['End', 'Collect']]
					.map(([from, to]) => [from, { main: [[{ node: to, type: 'main', index: 0 }]] }]),
			),
		});
		await activate(actionWorkflow);
		const response = await fetch(`${BASE}/webhook/bbb-e2e`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ meetingID }) });
		const result = await response.json();
		const data = Array.isArray(result) ? result[0] : result;
		if (!response.ok || !data.create) throw new Error(`workflow failed: ${JSON.stringify(result).slice(0, 1000)}`);
		console.log(JSON.stringify({ create: data.create.returncode, joinUrl: data.joinUrl.slice(0, 80) + '…', join: data.join.messageKey, infoName: data.info.meetingName, metadata: data.info.metadata, end: data.end.messageKey }, null, 1));
		assert.equal(data.create.meetingID, meetingID);
		assert.equal(data.join.messageKey, 'successfullyJoined');
		assert.equal(data.info.meetingName, 'n8n E2E – Grüße');
		assert.equal(data.info.metadata.origin, 'n8n-e2e');
		assert.equal(data.end.returncode, 'SUCCESS');
		const joinUrl = new URL(data.joinUrl);
		assert.equal(joinUrl.searchParams.get('createTime'), String(data.create.createTime));
		// The meeting is already ended here, so the server answers with an error, but it must not be a checksum error
		const joinCheck = await fetch(data.joinUrl, { redirect: 'manual' });
		const joinText = (await joinCheck.text()) + (joinCheck.headers.get('location') ?? '');
		console.log('join URL after end ->', joinCheck.status, joinText.replace(/\s+/g, ' ').slice(0, 160));
		assert.ok(!/checksumError/.test(joinText), 'join URL signature accepted');

		step('Trigger workflow (activation registers hook at mock)');
		const webhookId = crypto.randomUUID();
		const triggerWorkflow = await rest('POST', '/rest/workflows', {
			name: 'BBB e2e trigger',
			active: false,
			settings: { executionOrder: 'v1' },
			nodes: [{
				id: crypto.randomUUID(), name: 'BigBlueButton Trigger', type: 'n8n-nodes-bigbluebutton.bigBlueButtonTrigger', typeVersion: 1,
				position: [0, 0], webhookId, parameters: { events: ['user-joined'], meetingID: '', options: {} },
				credentials: { bigBlueButtonApi: { id: mockCredential.id, name: 'BBB mock' } },
			}],
			connections: {},
		});
		await activate(triggerWorkflow);
		assert.equal(mock.state.hooks.length, 1, 'hook registered');
		const callbackURL = mock.state.hooks[0].callbackURL;
		console.log('registered callbackURL:', callbackURL, 'eventID:', mock.state.hooks[0].eventID);
		assert.equal(callbackURL, `${BASE}/webhook/${webhookId}/webhook`);

		step('Signed callback like bbb-webhooks');
		const event = { data: { type: 'event', id: 'user-joined', attributes: { meeting: { 'internal-meeting-id': 'int-1', 'external-meeting-id': 'ext-1' }, user: { 'internal-user-id': 'w_1', 'external-user-id': 'u1', name: 'Jane Doe', role: 'MODERATOR', presenter: false } }, event: { ts: Date.now() } } };
		const body = new URLSearchParams({ domain: 'bbb.example.com', event: '[' + JSON.stringify(event) + ']', timestamp: Date.now() }).toString();
		const checksum = crypto.createHash('sha1').update(`${callbackURL}${body}${MOCK_SECRET}`).digest('hex');
		const unsigned = await fetch(callbackURL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
		console.log('unsigned callback ->', unsigned.status);
		assert.equal(unsigned.status, 401);
		const signed = await fetch(`${callbackURL}?checksum=${checksum}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
		console.log('signed callback ->', signed.status);
		assert.equal(signed.status, 200);

		let execution;
		for (let attempt = 0; attempt < 30 && !execution; attempt++) {
			await sleep(1000);
			const executions = await rest('GET', `/rest/executions?filter=${encodeURIComponent(JSON.stringify({ workflowId: triggerWorkflow.id }))}`);
			const list = executions.results ?? executions;
			if (list.length) execution = list[0];
		}
		assert.ok(execution, 'trigger execution exists');
		const full = await rest('GET', `/rest/executions/${execution.id}`);
		const dataText = typeof full.data === 'string' ? full.data : JSON.stringify(full.data);
		assert.match(dataText, /user-joined/);
		assert.match(dataText, /ext-1/);
		assert.match(dataText, /Jane Doe/);
		console.log('execution', execution.id, 'status', full.status ?? execution.status, '– contains user-joined event of ext-1');

		step('Deactivate trigger (hook removed at mock)');
		await deactivate(triggerWorkflow);
		assert.equal(mock.state.hooks.length, 0, 'hook removed');

		console.log('\n✅ n8n end-to-end test passed');
	} catch (error) {
		console.error('\n❌ E2E failed:', error);
		console.error('--- n8n log (tail) ---\n' + logs.join('').split('\n').slice(-60).join('\n'));
		process.exitCode = 1;
	} finally {
		cleanup();
	}
}

async function activate(workflow) {
	const full = await rest('GET', `/rest/workflows/${workflow.id}`);
	try {
		await rest('POST', `/rest/workflows/${workflow.id}/activate`, { versionId: full.versionId });
	} catch (error) {
		// older n8n versions
		await rest('PATCH', `/rest/workflows/${workflow.id}`, { ...full, active: true });
	}
	await sleep(1500);
}

async function deactivate(workflow) {
	try {
		await rest('POST', `/rest/workflows/${workflow.id}/deactivate`, {});
	} catch {
		const full = await rest('GET', `/rest/workflows/${workflow.id}`);
		await rest('PATCH', `/rest/workflows/${workflow.id}`, { ...full, active: false });
	}
	await sleep(1500);
}

main();
