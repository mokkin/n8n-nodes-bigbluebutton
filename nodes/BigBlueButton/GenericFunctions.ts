import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	IWebhookFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

import { buildQueryString, type QueryParameters } from './signing';
import { escapeXml, xmlToJson } from './xml';

export type BigBlueButtonContext =
	| IExecuteFunctions
	| IHookFunctions
	| ILoadOptionsFunctions
	| IWebhookFunctions;

/** Parses an API response body (XML or JSON) into an object. */
export function parseResponse(body: unknown): IDataObject {
	if (body === undefined || body === null || body === '') return {};
	if (Buffer.isBuffer(body)) return parseResponse(body.toString('utf8'));
	if (typeof body === 'object') {
		const object = body as IDataObject;
		return (object.response as IDataObject) ?? object;
	}
	const text = String(body).trim();
	if (text.startsWith('<')) return xmlToJson(text);
	try {
		const json = JSON.parse(text) as IDataObject;
		return (json.response as IDataObject) ?? json;
	} catch {
		return { data: text };
	}
}

export interface ApiRequestOptions {
	method?: IHttpRequestMethods;
	body?: string | Buffer;
	contentType?: string;
	/** Return FAILED responses instead of throwing. */
	ignoreFailure?: boolean;
	itemIndex?: number;
}

/**
 * Performs a signed request against the BigBlueButton API and parses the response.
 * The checksum is added by the credential's `authenticate` function.
 */
export async function bigBlueButtonApiRequest(
	this: BigBlueButtonContext,
	callName: string,
	parameters: QueryParameters = {},
	options: ApiRequestOptions = {},
): Promise<IDataObject> {
	const queryString = buildQueryString(parameters);
	const requestOptions: IHttpRequestOptions = {
		method: options.method ?? 'GET',
		url: queryString ? `${callName}?${queryString}` : callName,
		encoding: 'text',
		json: false,
		headers: { Accept: 'application/xml, application/json;q=0.9, */*;q=0.8' },
	};
	if (options.body !== undefined) {
		requestOptions.body = options.body;
		requestOptions.headers = {
			...requestOptions.headers,
			'Content-Type': options.contentType ?? 'application/xml',
		};
	}

	let rawResponse: unknown;
	try {
		rawResponse = await this.helpers.httpRequestWithAuthentication.call(
			this,
			'bigBlueButtonApi',
			requestOptions,
		);
	} catch (error) {
		const status =
			(error as { response?: { status?: number } }).response?.status ??
			Number((error as { httpCode?: string }).httpCode);
		if (status === 404) {
			throw new NodeApiError(this.getNode(), error as JsonObject, {
				message: `The API call "${callName}" is not available on this server`,
				description:
					'The call may require a newer BigBlueButton version, the bbb-webhooks package (hooks/*) or is not supported by a load balancer such as Scalelite. Also check the server URL in the credentials.',
				httpCode: '404',
				itemIndex: options.itemIndex,
			});
		}
		throw new NodeApiError(this.getNode(), error as JsonObject, {
			itemIndex: options.itemIndex,
		});
	}

	let response: IDataObject;
	try {
		response = parseResponse(rawResponse);
	} catch (error) {
		throw new NodeOperationError(
			this.getNode(),
			`Could not parse the BigBlueButton response: ${(error as Error).message}`,
			{ itemIndex: options.itemIndex },
		);
	}

	if (response.returncode === 'FAILED' && !options.ignoreFailure) {
		const messageKey = (response.messageKey as string) ?? 'unknownError';
		const message = (response.message as string) ?? 'The BigBlueButton API returned an error';
		throw new NodeApiError(this.getNode(), response as JsonObject, {
			message: `${messageKey}: ${message}`,
			description:
				messageKey === 'checksumError'
					? 'Check the shared secret and the checksum algorithm in the credentials.'
					: undefined,
			itemIndex: options.itemIndex,
		});
	}
	return response;
}

export interface PresentationDocument {
	url?: string;
	filename?: string;
	/** Base64 encoded file content (inline upload) */
	base64?: string;
	downloadable?: boolean;
	removable?: boolean;
	current?: boolean;
}

/** Builds the `<modules>` XML body used by `create` and `insertDocument`. */
export function buildModulesXml(
	documents: PresentationDocument[],
	extraModules: string[] = [],
): string {
	const modules: string[] = [];
	if (documents.length) {
		const documentXml = documents.map((document) => {
			const attributes: string[] = [];
			if (document.base64) {
				// Inline upload: the file name goes into the "name" attribute
				attributes.push(`name="${escapeXml(document.filename || 'document.pdf')}"`);
			} else {
				if (document.url) attributes.push(`url="${escapeXml(document.url)}"`);
				if (document.filename) attributes.push(`filename="${escapeXml(document.filename)}"`);
			}
			for (const flag of ['downloadable', 'removable', 'current'] as const) {
				if (document[flag] !== undefined) {
					attributes.push(`${flag}="${document[flag] ? 'true' : 'false'}"`);
				}
			}
			return document.base64
				? `<document ${attributes.join(' ')}>${document.base64}</document>`
				: `<document ${attributes.join(' ')}/>`;
		});
		modules.push(`<module name="presentation">${documentXml.join('')}</module>`);
	}
	modules.push(...extraModules);
	return `<?xml version="1.0" encoding="UTF-8"?><modules>${modules.join('')}</modules>`;
}

/** Wraps arbitrary text into a CDATA section (splitting any "]]>" sequences). */
export function cdata(value: string): string {
	return `<![CDATA[${value.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
}

/** Builds a multipart/form-data body with a single file field. */
export function buildMultipartBody(
	fieldName: string,
	fileName: string,
	mimeType: string,
	content: Buffer,
): { body: Buffer; contentType: string } {
	const boundary = `----n8nBigBlueButton${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
	const safeFileName = fileName.replace(/["\r\n]/g, '_');
	const head = Buffer.from(
		`--${boundary}\r\n` +
			`Content-Disposition: form-data; name="${fieldName}"; filename="${safeFileName}"\r\n` +
			`Content-Type: ${mimeType}\r\n\r\n`,
		'utf8',
	);
	const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
	return {
		body: Buffer.concat([head, content, tail]),
		contentType: `multipart/form-data; boundary=${boundary}`,
	};
}

/** Converts a fixedCollection of key/value pairs into prefixed query parameters. */
export function keyValuePairsToParameters(
	pairs: Array<{ key?: string; value?: string }> | undefined,
	prefix = '',
): QueryParameters {
	const parameters: QueryParameters = {};
	for (const pair of pairs ?? []) {
		const key = (pair.key ?? '').trim();
		if (!key) continue;
		const name = prefix && !key.startsWith(prefix) ? `${prefix}${key}` : key;
		parameters[name] = pair.value ?? '';
	}
	return parameters;
}

/** Splits a comma separated string (or array) into a list of trimmed, non-empty values. */
export function splitList(value: unknown): string[] {
	if (Array.isArray(value)) return value.map((entry) => String(entry).trim()).filter(Boolean);
	if (value === undefined || value === null) return [];
	return String(value)
		.split(',')
		.map((entry) => entry.trim())
		.filter(Boolean);
}
