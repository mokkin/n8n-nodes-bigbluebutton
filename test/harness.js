'use strict';
/**
 * Minimal stand-in for the n8n execution context, so the compiled nodes can be
 * executed in plain Node.js. httpRequestWithAuthentication runs the credential's
 * real `authenticate` function and performs the request with fetch.
 */
const { BigBlueButtonApi } = require('../dist/credentials/BigBlueButtonApi.credentials');

const credentialType = new BigBlueButtonApi();

function getPath(object, path) {
	return path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), object);
}

async function performRequest(options, log) {
	const response = await fetch(options.url, {
		method: options.method ?? 'GET',
		headers: options.headers,
		body: options.body,
	});
	const text = await response.text();
	log.push({ method: options.method ?? 'GET', url: options.url, status: response.status, body: options.body });
	if (response.status >= 400) {
		const error = new Error(`Request failed with status code ${response.status}`);
		error.httpCode = String(response.status);
		error.response = { status: response.status, data: text };
		throw error;
	}
	return text;
}

function createExecuteContext({ credentials, parameters, items = [{ json: {} }], continueOnFail = false }) {
	const log = [];
	const node = { name: 'BigBlueButton', type: 'n8n-nodes-bigbluebutton.bigBlueButton', typeVersion: 1, parameters: {} };
	const parameterFor = (index) => (Array.isArray(parameters) ? parameters[index] : parameters);
	const context = {
		log,
		getInputData: () => items,
		getNode: () => node,
		continueOnFail: () => continueOnFail,
		getCredentials: async () => credentials,
		getNodeParameter(name, itemIndex, fallback) {
			const value = getPath(parameterFor(itemIndex ?? 0), name);
			if (value === undefined) {
				if (fallback !== undefined) return fallback;
				throw new Error(`Missing parameter "${name}"`);
			}
			return value;
		},
		helpers: {
			async httpRequestWithAuthentication(credentialName, options) {
				if (credentialName !== 'bigBlueButtonApi') throw new Error('Unexpected credential');
				const signed = await credentialType.authenticate(credentials, { ...options });
				return performRequest(signed, log);
			},
			returnJsonArray(data) {
				return (Array.isArray(data) ? data : [data]).map((json) => ({ json }));
			},
			constructExecutionMetaData(data, { itemData }) {
				return data.map((entry) => ({ ...entry, pairedItem: itemData }));
			},
			assertBinaryData(itemIndex, propertyName) {
				const binary = items[itemIndex].binary?.[propertyName];
				if (!binary) throw new Error(`No binary data "${propertyName}"`);
				return binary;
			},
			async getBinaryDataBuffer(itemIndex, propertyName) {
				return Buffer.from(items[itemIndex].binary[propertyName].data, 'base64');
			},
		},
	};
	return context;
}

function createHookContext({ credentials, parameters, webhookUrl, staticData = {} }) {
	const log = [];
	return {
		log,
		staticData,
		getNode: () => ({ name: 'BigBlueButton Trigger', type: 'trigger', typeVersion: 1, parameters: {} }),
		getNodeWebhookUrl: () => webhookUrl,
		getWorkflowStaticData: () => staticData,
		getCredentials: async () => credentials,
		getNodeParameter(name, fallback) {
			const value = getPath(parameters, name);
			return value === undefined ? fallback : value;
		},
		logger: { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} },
		helpers: {
			async httpRequestWithAuthentication(credentialName, options) {
				const signed = await credentialType.authenticate(credentials, { ...options });
				return performRequest(signed, log);
			},
		},
	};
}

function createWebhookContext({ credentials, parameters, webhookUrl, rawBody, headers = {}, query = {}, body }) {
	const sent = {};
	const request = {
		headers,
		rawBody: Buffer.from(rawBody, 'utf8'),
		protocol: 'https',
		originalUrl: new URL(webhookUrl).pathname + (query.checksum ? `?checksum=${query.checksum}` : ''),
	};
	const response = {
		status(code) {
			sent.status = code;
			return this;
		},
		send(text) {
			sent.body = text;
			return this;
		},
	};
	return {
		sent,
		getRequestObject: () => request,
		getResponseObject: () => response,
		getBodyData: () => body ?? Object.fromEntries(new URLSearchParams(rawBody)),
		getQueryData: () => query,
		getHeaderData: () => headers,
		getNodeWebhookUrl: () => webhookUrl,
		getCredentials: async () => credentials,
		getNode: () => ({ name: 'BigBlueButton Trigger' }),
		getNodeParameter(name, fallback) {
			const value = getPath(parameters, name);
			return value === undefined ? fallback : value;
		},
	};
}

module.exports = { createExecuteContext, createHookContext, createWebhookContext, credentialType };
