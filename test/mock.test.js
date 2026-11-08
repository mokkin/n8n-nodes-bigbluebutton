'use strict';
/**
 * Tests against a local mock server that validates checksums exactly like bbb-web
 * (callName + raw query string without checksum + secret, algorithm detected by length)
 * and bbb-webhooks (hooks/* API and signed callbacks).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { BigBlueButton } = require('../dist/nodes/BigBlueButton/BigBlueButton.node');
const { BigBlueButtonTrigger } = require('../dist/nodes/BigBlueButtonTrigger/BigBlueButtonTrigger.node');
const { createExecuteContext, createHookContext, createWebhookContext } = require('./harness');

const { SECRET, startMockServer } = require('./mock-server');

test('mock server: endpoints not available on the public test server', async (t) => {
	const { server, state, url } = await startMockServer();
	t.after(() => server.close());
	const node = new BigBlueButton();
	const run = async (parameters, items, algorithm = 'sha256') => {
		const context = createExecuteContext({ credentials: { url, secret: SECRET, checksumAlgorithm: algorithm }, parameters, items });
		const [output] = await node.execute.call(context);
		return output.map((item) => item.json);
	};

	await t.test('insertDocument uploads URL and binary documents as XML', async () => {
		const items = [{ json: {}, binary: { slides: { data: Buffer.from('%PDF-1.4 test').toString('base64'), fileName: 'slides.pdf', mimeType: 'application/pdf' } } }];
		const output = await run(
			{
				resource: 'meeting',
				operation: 'insertDocument',
				meetingID: 'm1',
				presentations: {
					url: [{ url: 'https://example.com/a.pdf', filename: '', current: true }],
					binary: [{ binaryPropertyName: 'slides', filename: '', downloadable: true }],
				},
			},
			items,
		);
		assert.equal(output[0].returncode, 'SUCCESS');
		const request = state.requests.at(-1);
		assert.equal(request.method, 'POST');
		assert.equal(request.headers['content-type'], 'application/xml');
		const body = request.body.toString();
		assert.match(body, /<document url="https:\/\/example.com\/a.pdf" current="true"\/>/);
		assert.match(body, new RegExp(`<document name="slides.pdf" downloadable="true">${Buffer.from('%PDF-1.4 test').toString('base64')}</document>`));
	});

	await t.test('create sends clientSettingsOverride as module and JSON fields as parameters', async () => {
		// mock has no create endpoint -> 404 is expected, we only inspect the request
		await assert.rejects(
			run({
				resource: 'meeting',
				operation: 'create',
				meetingID: 'm2',
				name: 'Mock',
				additionalFields: {
					clientSettingsOverride: '{"public":{"app":{"appName":"n8n"}}}',
					groups: [{ id: '1', roster: ['u1'] }],
					pluginManifests: '[]',
					recordingReadyUrl: 'https://n8n.example.com/webhook/rec',
					customParameters: { entry: [{ key: 'futureParam', value: 'x' }] },
				},
				metadata: {},
				presentations: {},
			}),
			/not available on this server/,
		);
		const request = state.requests.at(-1);
		assert.equal(request.callName, 'create');
		assert.equal(request.params.get('groups'), '[{"id":"1","roster":["u1"]}]');
		assert.equal(request.params.get('pluginManifests'), null, 'empty JSON arrays are omitted');
		assert.equal(request.params.get('meta_bbb-recording-ready-url'), 'https://n8n.example.com/webhook/rec');
		assert.equal(request.params.get('futureParam'), 'x');
		assert.equal(request.params.get('clientSettingsOverride'), null);
		assert.match(request.body.toString(), /<module name="clientSettingsOverride"><!\[CDATA\[\{"public":\{"app":\{"appName":"n8n"\}\}\}\]\]><\/module>/);
	});

	await t.test('sendChatMessage validates length and sends userName', async () => {
		const output = await run({ resource: 'meeting', operation: 'sendChatMessage', meetingID: 'm1', message: 'Hallo 👋 & Tschüss', additionalFields: { userName: 'Bot' } });
		assert.equal(output[0].returncode, 'SUCCESS');
		const request = state.requests.at(-1);
		assert.equal(request.params.get('message'), 'Hallo 👋 & Tschüss');
		assert.equal(request.params.get('userName'), 'Bot');
		await assert.rejects(
			run({ resource: 'meeting', operation: 'sendChatMessage', meetingID: 'm1', message: 'x'.repeat(501), additionalFields: {} }),
			/between 1 and 500/,
		);
	});

	await t.test('text tracks: get, upload (multipart) and delete', async () => {
		const tracks = await run({ resource: 'recording', operation: 'getTextTracks', recordID: 'r1' });
		assert.deepEqual(tracks[0], { recordID: 'r1', href: 'https://x/de.vtt', kind: 'subtitles', label: 'Deutsch', lang: 'de-DE', source: 'upload' });

		const vtt = 'WEBVTT\n\n00:00.000 --> 00:01.000\nHallo\n';
		const items = [{ json: {}, binary: { data: { data: Buffer.from(vtt).toString('base64'), fileName: 'de.vtt', mimeType: 'text/vtt' } } }];
		const upload = await run({ resource: 'recording', operation: 'uploadTextTrack', recordID: 'r1', kind: 'subtitles', lang: 'de-DE', binaryPropertyName: 'data', additionalFields: { label: 'Deutsch' } }, items);
		assert.equal(upload[0].messageKey, 'upload_text_track_success');
		const request = state.requests.at(-1);
		assert.equal(request.method, 'POST');
		assert.match(request.headers['content-type'], /^multipart\/form-data; boundary=/);
		assert.ok(request.body.toString().includes(vtt));
		assert.equal(request.params.get('label'), 'Deutsch');

		await run({ resource: 'recording', operation: 'deleteTextTrack', recordID: 'r1', kind: 'captions', lang: 'en-US' });
		const deleteRequest = state.requests.at(-1);
		assert.equal(deleteRequest.params.get('kind'), 'captions');
		assert.ok(!deleteRequest.body.toString().includes('filename='));
	});

	await t.test('publish / unpublish / update metadata with multiple IDs', async () => {
		const published = await run({ resource: 'recording', operation: 'publish', recordID: 'r1, r2' }, undefined, 'sha384');
		assert.equal(published[0].published, true);
		assert.equal(state.requests.at(-1).params.get('recordID'), 'r1,r2');
		const unpublished = await run({ resource: 'recording', operation: 'unpublish', recordID: 'r1' });
		assert.equal(unpublished[0].published, false);
		await run({ resource: 'recording', operation: 'update', recordID: 'r1', metadata: { entry: [{ key: 'title', value: 'Neu' }, { key: 'meta_old', value: '' }] } });
		const request = state.requests.at(-1);
		assert.equal(request.params.get('meta_title'), 'Neu');
		assert.equal(request.params.get('meta_old'), '', 'empty metadata value is sent to remove the key');
	});

	await t.test('hooks: create, list, delete via the action node', async () => {
		const created = await run({ resource: 'hook', operation: 'create', callbackURL: 'https://example.com/cb?a=1', additionalFields: { eventID: ['meeting-created', 'user-joined'], meetingID: 'm1' } });
		assert.equal(typeof created[0].hookID, 'number');
		assert.equal(state.requests.at(-1).params.get('eventID'), 'meeting-created,user-joined');
		const list = await run({ resource: 'hook', operation: 'getAll', filters: {} });
		assert.equal(list[0].callbackURL, 'https://example.com/cb?a=1');
		const removed = await run({ resource: 'hook', operation: 'delete', hookID: String(created[0].hookID) });
		assert.equal(removed[0].removed, true);
		const empty = await run({ resource: 'hook', operation: 'getAll', filters: {} });
		assert.deepEqual(empty, []);
	});

	await t.test('wrong secret yields a helpful checksum error', async () => {
		const context = createExecuteContext({ credentials: { url, secret: 'wrong', checksumAlgorithm: 'sha1' }, parameters: { resource: 'hook', operation: 'getAll', filters: {} } });
		await assert.rejects(node.execute.call(context), (error) => /checksumError/.test(error.message) && /shared secret/.test(error.description));
	});
});

test('trigger: webhook lifecycle and signed callbacks', async (t) => {
	const { server, state, url } = await startMockServer();
	t.after(() => server.close());
	const trigger = new BigBlueButtonTrigger();
	const credentials = { url, secret: SECRET, checksumAlgorithm: 'sha256' };
	const webhookUrl = 'https://n8n.example.com/webhook/1234-abcd/webhook';
	const parameters = { events: ['user-joined'], meetingID: '', options: {} };

	await t.test('checkExists / create / delete', async () => {
		const context = createHookContext({ credentials, parameters, webhookUrl });
		const methods = trigger.webhookMethods.default;
		assert.equal(await methods.checkExists.call(context), false);
		assert.equal(await methods.create.call(context), true);
		assert.equal(context.staticData.hookId, '1');
		assert.equal(state.hooks[0].eventID, 'user-joined');
		assert.equal(state.hooks[0].callbackURL, webhookUrl);
		assert.equal(await methods.checkExists.call(context), true);
		assert.equal(await methods.delete.call(context), true);
		assert.equal(state.hooks.length, 0);
		// deleting a hook that no longer exists is not an error
		context.staticData.hookId = '99';
		assert.equal(await methods.delete.call(context), true);
	});

	// Build a callback exactly like bbb-webhooks callback-emitter.js
	function callback(event, { secret = SECRET, algorithm = 'sha1', bearer = false } = {}) {
		const data = new URLSearchParams({ domain: 'bbb.example.com', event: '[' + JSON.stringify(event) + ']', timestamp: 1700000000123 });
		const rawBody = data.toString();
		if (bearer) return { rawBody, headers: { authorization: `Bearer ${secret}` }, query: {} };
		const checksum = crypto.createHash(algorithm).update(`${webhookUrl}${rawBody}${secret}`).digest('hex');
		return { rawBody, headers: { host: 'n8n.example.com' }, query: { checksum } };
	}
	const joined = { data: { type: 'event', id: 'user-joined', attributes: { meeting: { 'internal-meeting-id': 'i1', 'external-meeting-id': 'm1' }, user: { 'internal-user-id': 'w_1', name: 'Jane' } }, event: { ts: 1700000000100 } } };
	const created = { data: { type: 'event', id: 'meeting-created', attributes: { meeting: { 'external-meeting-id': 'm1' } }, event: { ts: 1 } } };

	await t.test('valid checksum (SHA-1 and SHA-256) emits a simplified item', async () => {
		for (const algorithm of ['sha1', 'sha256']) {
			const context = createWebhookContext({ credentials, parameters, webhookUrl, ...callback(joined, { algorithm }) });
			const result = await trigger.webhook.call(context);
			assert.equal(result.workflowData[0].length, 1, algorithm);
			assert.deepEqual(result.workflowData[0][0].json, {
				event: 'user-joined',
				meetingID: 'm1',
				internalMeetingID: 'i1',
				eventTimestamp: 1700000000100,
				attributes: joined.data.attributes,
				timestamp: 1700000000123,
				domain: 'bbb.example.com',
			});
		}
	});

	await t.test('bearer token authentication is accepted', async () => {
		const context = createWebhookContext({ credentials, parameters, webhookUrl, ...callback(joined, { bearer: true }) });
		const result = await trigger.webhook.call(context);
		assert.equal(result.workflowData[0].length, 1);
	});

	await t.test('invalid signature is rejected with 401', async () => {
		for (const options of [{ secret: 'wrong' }, { secret: 'wrong', bearer: true }]) {
			const context = createWebhookContext({ credentials, parameters, webhookUrl, ...callback(joined, options) });
			const result = await trigger.webhook.call(context);
			assert.deepEqual(result, { noWebhookResponse: true });
			assert.equal(context.sent.status, 401);
		}
		const unsigned = callback(joined);
		const context = createWebhookContext({ credentials, parameters, webhookUrl, rawBody: unsigned.rawBody, headers: {}, query: {} });
		await trigger.webhook.call(context);
		assert.equal(context.sent.status, 401);
	});

	await t.test('verification can be disabled; unselected events are ignored', async () => {
		const noVerify = { ...parameters, options: { verifySignature: false } };
		const unsigned = callback(created);
		const context = createWebhookContext({ credentials, parameters: noVerify, webhookUrl, rawBody: unsigned.rawBody, headers: {}, query: {} });
		assert.deepEqual(await trigger.webhook.call(context), {}, 'meeting-created is not selected');
		const all = createWebhookContext({ credentials, parameters: { events: [], meetingID: 'other', options: { verifySignature: false } }, webhookUrl, rawBody: unsigned.rawBody, headers: {}, query: {} });
		assert.deepEqual(await trigger.webhook.call(all), {}, 'other meeting is filtered');
		const raw = createWebhookContext({ credentials, parameters: { events: [], meetingID: '', options: { verifySignature: false, simplify: false } }, webhookUrl, rawBody: unsigned.rawBody, headers: {}, query: {} });
		const result = await trigger.webhook.call(raw);
		assert.deepEqual(result.workflowData[0][0].json.data, created.data);
	});
});
