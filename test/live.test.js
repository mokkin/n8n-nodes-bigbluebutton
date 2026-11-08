'use strict';
/**
 * Live tests against a real BigBlueButton server. Opt-in:
 *   BBB_URL=https://bbb.example.com/bigbluebutton/ BBB_SECRET=... npm test
 * Only creates/ends its own test meetings. Recording mutations are tested with
 * a non-existent recording ID so existing recordings are never touched.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { BigBlueButton } = require('../dist/nodes/BigBlueButton/BigBlueButton.node');
const { bigBlueButtonApiTest } = require('../dist/nodes/BigBlueButton/credentialTest');
const { createExecuteContext } = require('./harness');

const BBB_URL = process.env.BBB_URL;
const BBB_SECRET = process.env.BBB_SECRET;
const skip = !BBB_URL || !BBB_SECRET ? 'BBB_URL / BBB_SECRET not set' : false;

const node = new BigBlueButton();
const meetingID = `n8n-node-test-${Date.now()}`;

/** Runs fn; a 404 (call not available on this server) is reported as diagnostic instead of failing. */
async function tolerateUnsupported(t, fn) {
	try {
		return await fn();
	} catch (error) {
		if (error.httpCode === '404' && /is not available on this server/.test(error.message)) {
			t.diagnostic(`skipped: ${error.message}`);
			return undefined;
		}
		throw error;
	}
}

function credentials(algorithm = 'sha256', secret = BBB_SECRET) {
	return { url: BBB_URL, secret, checksumAlgorithm: algorithm };
}

async function run(parameters, options = {}) {
	const context = createExecuteContext({ credentials: credentials(options.algorithm), parameters, ...options });
	const [output] = await node.execute.call(context);
	return { output: output.map((item) => item.json), log: context.log };
}

test('live: BigBlueButton API', { skip, timeout: 120000 }, async (t) => {
	await t.test('credential test succeeds and detects a wrong secret', async () => {
		const requestContext = {
			helpers: {
				request: async ({ uri }) => (await fetch(uri)).text(),
			},
		};
		const ok = await bigBlueButtonApiTest.call(requestContext, { data: credentials() });
		assert.equal(ok.status, 'OK', ok.message);
		const wrong = await bigBlueButtonApiTest.call(requestContext, { data: credentials('sha1', 'wrong') });
		assert.equal(wrong.status, 'Error');
		assert.match(wrong.message, /Checksum error/);
	});

	await t.test('meeting: create (GET) with metadata and options', async () => {
		const { output, log } = await run({
			resource: 'meeting',
			operation: 'create',
			meetingID,
			name: 'n8n Node Test – Größe & Umlaute',
			additionalFields: {
				welcome: 'Willkommen bei %%CONFNAME%%!',
				record: false,
				duration: 15,
				muteOnStart: true,
				guestPolicy: 'ALWAYS_ACCEPT',
				disabledFeatures: ['polls', 'externalVideos'],
				meetingExpireIfNoUserJoinedInMinutes: 5,
			},
			metadata: { entry: [{ key: 'source', value: 'n8n' }, { key: 'bbb-origin', value: 'n8n-test' }] },
			presentations: {},
		});
		assert.equal(log[0].method, 'GET');
		assert.equal(output.length, 1);
		assert.equal(output[0].returncode, 'SUCCESS');
		assert.equal(output[0].meetingID, meetingID);
		assert.ok(output[0].internalMeetingID);
		assert.equal(typeof output[0].createTime, 'number');
	});

	await t.test('meeting: create is idempotent (duplicateWarning)', async () => {
		const { output } = await run({
			resource: 'meeting',
			operation: 'create',
			meetingID,
			name: 'n8n Node Test – Größe & Umlaute',
			additionalFields: {},
			metadata: {},
			presentations: {},
		});
		assert.equal(output[0].returncode, 'SUCCESS');
		assert.equal(output[0].messageKey, 'duplicateWarning');
	});

	await t.test('meeting: create (POST) with presentation module, SHA-1 and SHA-512', async () => {
		for (const algorithm of ['sha1', 'sha512']) {
			const id = `${meetingID}-${algorithm}`;
			const { output, log } = await run(
				{
					resource: 'meeting',
					operation: 'create',
					meetingID: id,
					name: `n8n POST ${algorithm}`,
					additionalFields: {},
					metadata: {},
					presentations: {
						url: [{ url: 'https://test-install.blindsidenetworks.com/default.pdf', filename: 'default.pdf', current: true }],
					},
				},
				{ algorithm },
			);
			assert.equal(log[0].method, 'POST');
			assert.match(log[0].body, /<module name="presentation"><document url=/);
			assert.equal(output[0].returncode, 'SUCCESS', algorithm);
			await run({ resource: 'meeting', operation: 'end', meetingID: id, additionalFields: {} });
		}
	});

	await t.test('meeting: get join URL (signed locally) is accepted by the server', async () => {
		const { output, log } = await run({
			resource: 'meeting',
			operation: 'getJoinUrl',
			meetingID,
			fullName: 'Jane Doe',
			role: 'MODERATOR',
			executeJoin: false,
			additionalFields: { userID: 'jane-1', guest: false },
			userdata: { entry: [{ key: 'bbb_auto_join_audio', value: 'false' }] },
		});
		assert.equal(log.length, 0, 'no request expected');
		const url = new URL(output[0].url);
		assert.equal(url.searchParams.get('fullName'), 'Jane Doe');
		assert.equal(url.searchParams.get('userdata-bbb_auto_join_audio'), 'false');
		assert.equal(url.searchParams.get('guest'), null, 'guest=false must not be sent');
		// redirect=false is not part of the signature here, so check by following the redirect manually
		const response = await fetch(output[0].url, { redirect: 'manual' });
		assert.ok([301, 302, 303, 307].includes(response.status), `status ${response.status}`);
		assert.ok(!/checksumError/.test(response.headers.get('location') ?? ''));
	});

	await t.test('meeting: execute join request (redirect=false)', async () => {
		const { output } = await run({
			resource: 'meeting',
			operation: 'getJoinUrl',
			meetingID,
			fullName: 'Max Mustermann',
			role: 'VIEWER',
			executeJoin: true,
			additionalFields: {},
			userdata: {},
		});
		assert.equal(output[0].returncode, 'SUCCESS');
		assert.equal(output[0].messageKey, 'successfullyJoined');
		assert.ok(output[0].session_token);
		assert.match(output[0].url, /^https?:\/\//);
	});

	await t.test('meeting: is running / get / get many', async () => {
		const running = await run({ resource: 'meeting', operation: 'isRunning', meetingID });
		assert.equal(typeof running.output[0].running, 'boolean');

		const info = await run({ resource: 'meeting', operation: 'get', meetingID });
		assert.equal(info.output[0].meetingID, meetingID);
		assert.equal(info.output[0].meetingName, 'n8n Node Test – Größe & Umlaute');
		assert.equal(info.output[0].metadata.source, 'n8n');
		assert.ok(Array.isArray(info.output[0].attendees));

		// Load balancers (e.g. Scalelite) may only list meetings with participants
		const all = await run({ resource: 'meeting', operation: 'getAll' });
		for (const meeting of all.output) assert.ok(meeting.meetingID);
	});

	await t.test('meeting: insert document', async (st) => {
		const result = await tolerateUnsupported(st, () => run({
			resource: 'meeting',
			operation: 'insertDocument',
			meetingID,
			presentations: {
				url: [{ url: 'https://test-install.blindsidenetworks.com/default.pdf', filename: 'extra.pdf', downloadable: true }],
			},
		}));
		if (result) assert.equal(result.output[0].returncode, 'SUCCESS');
	});

	await t.test('meeting: send chat message (BBB 3.0+)', async (st) => {
		const result = await tolerateUnsupported(st, () =>
			run({
				resource: 'meeting',
				operation: 'sendChatMessage',
				meetingID,
				message: 'Hallo aus n8n 👋',
				additionalFields: { userName: 'n8n' },
			}),
		);
		if (result) assert.equal(result.output[0].returncode, 'SUCCESS');
	});

	await t.test('meeting: errors are surfaced and continueOnFail works', async () => {
		await assert.rejects(
			run({ resource: 'meeting', operation: 'get', meetingID: 'does-not-exist-n8n' }),
			(error) => error.constructor.name === 'NodeApiError' && /notFound/.test(error.message),
		);
		const { output } = await run(
			{ resource: 'meeting', operation: 'get', meetingID: 'does-not-exist-n8n' },
			{ continueOnFail: true },
		);
		assert.match(output[0].error, /notFound/);
	});

	await t.test('meeting: end', async () => {
		const { output } = await run({ resource: 'meeting', operation: 'end', meetingID, additionalFields: {} });
		assert.equal(output[0].returncode, 'SUCCESS');
	});

	await t.test('recording: get many with limit, text tracks', async () => {
		const { output } = await run({ resource: 'recording', operation: 'getAll', returnAll: false, limit: 2, filters: {} });
		assert.ok(output.length <= 2);
		if (!output.length) return;
		assert.ok(output[0].recordID);
		assert.ok(Array.isArray(output[0].playback));
		const tracks = await tolerateUnsupported(t, () =>
			run({ resource: 'recording', operation: 'getTextTracks', recordID: output[0].recordID }),
		);
		for (const track of tracks?.output ?? []) assert.equal(track.recordID, output[0].recordID);
	});

	await t.test('recording: filters by meeting ID and state', async () => {
		const { output, log } = await run({
			resource: 'recording',
			operation: 'getAll',
			returnAll: true,
			filters: { meetingID: 'n8n-none-1, n8n-none-2', state: ['published', 'unpublished'] },
		});
		assert.match(log[0].url, /meetingID=n8n-none-1%2Cn8n-none-2&state=published%2Cunpublished/);
		assert.deepEqual(output, []);
	});

	await t.test('recording: mutations on unknown recording return notFound', async () => {
		for (const operation of ['publish', 'unpublish', 'delete', 'update']) {
			await assert.rejects(
				run({
					resource: 'recording',
					operation,
					recordID: 'n8n-does-not-exist-0000',
					metadata: { entry: [{ key: 'foo', value: 'bar' }] },
				}),
				(error) => error.constructor.name === 'NodeApiError' && /notFound/i.test(error.message),
				operation,
			);
		}
	});
});
