'use strict';
/** Local mock of bbb-web / bbb-webhooks that validates checksums like the real servers. */
const crypto = require('node:crypto');
const http = require('node:http');

const SECRET = 'mock-secret-0123456789';
const ALGORITHMS = { 40: 'sha1', 64: 'sha256', 96: 'sha384', 128: 'sha512' };

function xml(fields) {
	return `<response><returncode>SUCCESS</returncode>${fields}</response>`;
}

function startMockServer(port = 0) {
	const state = { requests: [], hooks: [], nextHookId: 1 };
	const server = http.createServer((req, res) => {
		const chunks = [];
		req.on('data', (chunk) => chunks.push(chunk));
		req.on('end', () => {
			const body = Buffer.concat(chunks);
			const url = new URL(req.url, 'http://localhost');
			const prefix = '/bigbluebutton/api/';
			const callName = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : '';
			const rawQuery = url.search.slice(1);
			// Same approach as bbb-webhooks utils.queryFromUrl
			const query = rawQuery.replace(/&checksum=[^&]*/, '').replace(/^checksum=[^&]*&?/, '');
			const checksum = url.searchParams.get('checksum') ?? '';
			const algorithm = ALGORITHMS[checksum.length];
			const expected = algorithm && crypto.createHash(algorithm).update(callName + query + SECRET).digest('hex');
			state.requests.push({ method: req.method, callName, params: url.searchParams, headers: req.headers, body });

			const send = (payload, type = 'application/xml') => {
				res.writeHead(200, { 'Content-Type': type });
				res.end(payload);
			};
			if (!expected || expected !== checksum) {
				return send('<response><returncode>FAILED</returncode><messageKey>checksumError</messageKey><message>Checksums do not match</message></response>');
			}
			const p = url.searchParams;
			switch (callName) {
				case 'insertDocument':
					return send(xml('<messageKey>success</messageKey><message>Presentation is being uploaded</message>'));
				case 'sendChatMessage':
					return send(xml('<messageKey>chatMessageSent</messageKey>'));
				case 'getRecordingTextTracks':
					return send(JSON.stringify({ response: { returncode: 'SUCCESS', tracks: [{ href: 'https://x/de.vtt', kind: 'subtitles', label: 'Deutsch', lang: 'de-DE', source: 'upload' }] } }), 'application/json');
				case 'putRecordingTextTrack':
					return send(JSON.stringify({ response: { returncode: 'SUCCESS', messageKey: 'upload_text_track_success', recordId: p.get('recordID') } }), 'application/json');
				case 'publishRecordings':
					return send(xml(`<published>${p.get('publish')}</published>`));
				case 'updateRecordings':
					return send(xml('<updated>true</updated>'));
				case 'hooks/create': {
					const existing = state.hooks.find((hook) => hook.callbackURL === p.get('callbackURL'));
					if (existing) return send(xml(`<hookID>${existing.hookID}</hookID><messageKey>duplicateWarning</messageKey>`));
					const hook = { hookID: state.nextHookId++, callbackURL: p.get('callbackURL'), meetingID: p.get('meetingID'), eventID: p.get('eventID'), getRaw: p.get('getRaw') };
					state.hooks.push(hook);
					return send(xml(`<hookID>${hook.hookID}</hookID><permanentHook>false</permanentHook><rawData>false</rawData>`));
				}
				case 'hooks/list':
					return send(xml(`<hooks>${state.hooks.map((hook) => `<hook><hookID>${hook.hookID}</hookID><callbackURL><![CDATA[${hook.callbackURL}]]></callbackURL><permanentHook>false</permanentHook><rawData>false</rawData></hook>`).join('')}</hooks>`));
				case 'hooks/destroy': {
					const index = state.hooks.findIndex((hook) => String(hook.hookID) === p.get('hookID'));
					if (index === -1) return send('<response><returncode>FAILED</returncode><messageKey>destroyMissingHook</messageKey><message>The hook informed was not found.</message></response>');
					state.hooks.splice(index, 1);
					return send(xml('<removed>true</removed>'));
				}
				default:
					res.writeHead(404);
					return res.end();
			}
		});
	});
	return new Promise((resolve) => {
		server.listen(port, '127.0.0.1', () => resolve({ server, state, url: `http://127.0.0.1:${server.address().port}/bigbluebutton/` }));
	});
}

module.exports = { SECRET, startMockServer };

if (require.main === module) {
	// Standalone mode: node test/mock-server.js <port>
	const port = Number(process.argv[2] ?? 0);
	startMockServer(port).then(({ url }) => console.log(`mock BigBlueButton listening on ${url}`));
}
