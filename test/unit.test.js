'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const signing = require('../dist/nodes/BigBlueButton/signing');
const { xmlToJson } = require('../dist/nodes/BigBlueButton/xml');
const { buildModulesXml, parseResponse, buildMultipartBody } = require('../dist/nodes/BigBlueButton/GenericFunctions');
const { parseEvents, simplifyEvent } = require('../dist/nodes/BigBlueButtonTrigger/BigBlueButtonTrigger.node');
const { credentialType } = require('./harness');

test('checksum matches the example from the BigBlueButton documentation', () => {
	const checksum = signing.computeChecksum(
		'create',
		'name=Test+Meeting&meetingID=abc123&attendeePW=111222&moderatorPW=333444',
		'639259d4-9dd8-4b25-bf01-95f9567eaf4b',
		'sha1',
	);
	assert.equal(checksum, '1fcbb0c4fc1f039f73aa6d697d2db9ba7f803f17');
});

test('checksum supports all algorithms', () => {
	for (const [algorithm, length] of [['sha1', 40], ['sha256', 64], ['sha384', 96], ['sha512', 128]]) {
		const checksum = signing.computeChecksum('getMeetings', '', 'secret', algorithm);
		assert.equal(checksum.length, length);
		assert.equal(checksum, crypto.createHash(algorithm).update('getMeetingssecret').digest('hex'));
	}
});

test('server URL is normalized to the API base URL', () => {
	const cases = {
		'https://bbb.example.com/bigbluebutton/': 'https://bbb.example.com/bigbluebutton/api',
		'https://bbb.example.com/bigbluebutton': 'https://bbb.example.com/bigbluebutton/api',
		'https://bbb.example.com/bigbluebutton/api/': 'https://bbb.example.com/bigbluebutton/api',
		'https://bbb.example.com': 'https://bbb.example.com/bigbluebutton/api',
		'bbb.example.com/': 'https://bbb.example.com/bigbluebutton/api',
		'https://lb.example.com/scalelite/bigbluebutton/': 'https://lb.example.com/scalelite/bigbluebutton/api',
	};
	for (const [input, expected] of Object.entries(cases)) {
		assert.equal(signing.getApiBaseUrl(input), expected, input);
	}
});

test('query string encodes values strictly and skips empty values', () => {
	const query = signing.buildQueryString({
		name: "Team (Q4) — Planung & Review's!",
		meetingID: 'abc',
		record: true,
		duration: 0,
		empty: '',
		missing: undefined,
		list: ['chat', 'polls'],
		emptyList: [],
		meta_removed: '',
	});
	assert.equal(
		query,
		'name=Team%20%28Q4%29%20%E2%80%94%20Planung%20%26%20Review%27s%21&meetingID=abc&record=true&duration=0&list=chat%2Cpolls&meta_removed=',
	);
});

test('credential authenticate signs relative URLs and keeps absolute ones', async () => {
	const credentials = { url: 'https://bbb.example.com/bigbluebutton/', secret: 's3cret', checksumAlgorithm: 'sha256' };
	const signed = await credentialType.authenticate(credentials, { url: 'hooks/create?callbackURL=x', qs: { a: 1 }, baseURL: 'y' });
	const expected = crypto.createHash('sha256').update('hooks/createcallbackURL=xs3cret').digest('hex');
	assert.equal(signed.url, `https://bbb.example.com/bigbluebutton/api/hooks/create?callbackURL=x&checksum=${expected}`);
	assert.equal(signed.qs, undefined);
	assert.equal(signed.baseURL, undefined);

	const noQuery = await credentialType.authenticate(credentials, { url: '/getMeetings' });
	assert.match(noQuery.url, /\/api\/getMeetings\?checksum=[0-9a-f]{64}$/);

	const absolute = await credentialType.authenticate(credentials, { url: 'https://other/x' });
	assert.equal(absolute.url, 'https://other/x');
});

test('XML responses are converted to clean JSON', () => {
	const xml = `<?xml version="1.0"?>
<response>
  <returncode>SUCCESS</returncode>
  <meetingName>Demo &amp; Test</meetingName>
  <meetingID>123</meetingID>
  <voiceBridge>70066</voiceBridge>
  <createTime>1531241258036</createTime>
  <running>true</running>
  <participantCount>2</participantCount>
  <attendees>
    <attendee>
      <userID>w_1</userID>
      <fullName><![CDATA[Jane <Doe>]]></fullName>
      <role>MODERATOR</role>
      <isPresenter>true</isPresenter>
      <customdata/>
    </attendee>
  </attendees>
  <metadata>
    <count>42</count>
    <flag>true</flag>
  </metadata>
  <breakoutRooms><breakout>abc-1</breakout></breakoutRooms>
  <isBreakout>false</isBreakout>
</response>`;
	const json = xmlToJson(xml);
	assert.deepEqual(json, {
		returncode: 'SUCCESS',
		meetingName: 'Demo & Test',
		meetingID: '123',
		voiceBridge: '70066',
		createTime: 1531241258036,
		running: true,
		participantCount: 2,
		attendees: [
			{ userID: 'w_1', fullName: 'Jane <Doe>', role: 'MODERATOR', isPresenter: true, customdata: '' },
		],
		metadata: { count: '42', flag: 'true' },
		breakoutRooms: ['abc-1'],
		isBreakout: false,
	});
});

test('recordings with playback formats and preview images are parsed', () => {
	const xml = `<response><returncode>SUCCESS</returncode><recordings><recording>
<recordID>r1</recordID><published>true</published>
<playback>
<format><type>presentation</type><url>https://x/playback/presentation/2.3/r1</url><length>3</length>
<preview><images>
<image alt="Welcome" height="136" width="176">https://x/1.png</image>
<image alt="Slide 2" height="136" width="176">https://x/2.png</image>
</images></preview></format>
<format><type>video</type><url>https://x/video/r1</url></format>
</playback></recording></recordings></response>`;
	const json = parseResponse(xml);
	assert.equal(json.recordings.length, 1);
	const formats = json.recordings[0].playback;
	assert.equal(formats.length, 2);
	assert.deepEqual(formats[0].preview.images[0], { alt: 'Welcome', height: 136, width: 176, value: 'https://x/1.png' });
	assert.equal(formats[1].type, 'video');
});

test('empty lists, JSON responses and malformed XML', () => {
	assert.deepEqual(parseResponse('<response><returncode>SUCCESS</returncode><meetings/><messageKey>noMeetings</messageKey></response>').meetings, []);
	assert.deepEqual(parseResponse('{"response":{"returncode":"SUCCESS","tracks":[]}}'), { returncode: 'SUCCESS', tracks: [] });
	assert.throws(() => parseResponse('<response><a></response>'), /Malformed XML/);
});

test('presentation module XML is built and escaped correctly', () => {
	const xml = buildModulesXml(
		[
			{ url: 'https://example.com/a.pdf?x=1&y=2', filename: 'a "b".pdf', current: true },
			{ base64: 'SGVsbG8=', filename: 'hello.txt', downloadable: true },
		],
		['<module name="clientSettingsOverride"><![CDATA[{}]]></module>'],
	);
	assert.equal(
		xml,
		'<?xml version="1.0" encoding="UTF-8"?><modules><module name="presentation">' +
			'<document url="https://example.com/a.pdf?x=1&amp;y=2" filename="a &quot;b&quot;.pdf" current="true"/>' +
			'<document name="hello.txt" downloadable="true">SGVsbG8=</document>' +
			'</module><module name="clientSettingsOverride"><![CDATA[{}]]></module></modules>',
	);
	// round trip through our own parser
	const parsed = xmlToJson(xml);
	assert.equal(parsed.module.length, 2);
});

test('multipart body contains the file', () => {
	const { body, contentType } = buildMultipartBody('file', 'de.vtt', 'text/vtt', Buffer.from('WEBVTT\n'));
	const boundary = contentType.split('boundary=')[1];
	const text = body.toString();
	assert.ok(text.startsWith(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="de.vtt"`));
	assert.ok(text.endsWith(`\r\n--${boundary}--\r\n`));
	assert.ok(text.includes('WEBVTT\n'));
});

test('callback checksum verification matches the bbb-webhooks implementation', () => {
	const callbackURL = 'https://n8n.example.com/webhook/abc/webhook';
	const secret = 'topsecret';
	const event = { data: { type: 'event', id: 'meeting-created', attributes: { meeting: { 'external-meeting-id': 'm1' } }, event: { ts: 1 } } };
	// Same construction as bbb-webhooks src/out/webhooks/callback-emitter.js
	const data = new URLSearchParams({ domain: 'bbb.example.com', event: '[' + JSON.stringify(event) + ']', timestamp: 1700000000000 });
	const bodyString = data.toString();
	for (const algorithm of ['sha1', 'sha256', 'sha384', 'sha512']) {
		const checksum = crypto.createHash(algorithm).update(`${callbackURL}${bodyString}${secret}`).digest('hex');
		assert.ok(signing.verifyCallbackChecksum(callbackURL, bodyString, secret, checksum), algorithm);
		assert.ok(!signing.verifyCallbackChecksum(callbackURL, bodyString, 'wrong', checksum), algorithm);
	}
	assert.ok(!signing.verifyCallbackChecksum(callbackURL, bodyString, secret, 'abc'));
});

test('webhook events are parsed and simplified', () => {
	const event = { data: { type: 'event', id: 'user-joined', attributes: { meeting: { 'internal-meeting-id': 'i1', 'external-meeting-id': 'm1' }, user: { name: 'Jane' } }, event: { ts: 5 } } };
	assert.deepEqual(parseEvents('[' + JSON.stringify(event) + ']'), [event]);
	assert.deepEqual(parseEvents(JSON.stringify(event)), [event]);
	assert.deepEqual(simplifyEvent(event, { timestamp: 9 }), {
		event: 'user-joined',
		meetingID: 'm1',
		internalMeetingID: 'i1',
		eventTimestamp: 5,
		attributes: event.data.attributes,
		timestamp: 9,
	});
});
