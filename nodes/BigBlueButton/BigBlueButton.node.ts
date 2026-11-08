import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	INode,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { hookFields, hookOperations } from './descriptions/HookDescription';
import { meetingFields, meetingOperations } from './descriptions/MeetingDescription';
import { recordingFields, recordingOperations } from './descriptions/RecordingDescription';
import { bigBlueButtonApiTest } from './credentialTest';
import {
	bigBlueButtonApiRequest,
	buildModulesXml,
	buildMultipartBody,
	cdata,
	keyValuePairsToParameters,
	type PresentationDocument,
	splitList,
} from './GenericFunctions';
import {
	type BigBlueButtonCredentials,
	buildSignedUrl,
	type QueryParameters,
	type QueryValue,
} from './signing';

type KeyValueCollection = { entry?: Array<{ key?: string; value?: string }> };

interface PresentationEntry {
	url?: string;
	binaryPropertyName?: string;
	filename?: string;
	current?: boolean;
	downloadable?: boolean;
	removable?: boolean;
}

/** Additional fields of `create` that need special treatment. */
const CREATE_PARAMETER_ALIASES: Record<string, string> = {
	analyticsCallbackUrl: 'meta_analytics-callback-url',
	recordingReadyUrl: 'meta_bbb-recording-ready-url',
};
const CREATE_JSON_FIELDS = new Set(['groups', 'pluginManifests']);

function toQueryValue(value: unknown): QueryValue {
	if (value === undefined || value === null) return undefined;
	if (Array.isArray(value)) return value.map((entry) => String(entry));
	if (typeof value === 'object') return JSON.stringify(value);
	return value as string | number | boolean;
}

function normalizeJson(
	node: INode,
	value: unknown,
	field: string,
	itemIndex: number,
): string | undefined {
	if (value === undefined || value === null || value === '') return undefined;
	const text = typeof value === 'string' ? value : JSON.stringify(value);
	try {
		const parsed = JSON.parse(text) as unknown;
		if (Array.isArray(parsed) && parsed.length === 0) return undefined;
		if (parsed && typeof parsed === 'object' && Object.keys(parsed).length === 0) return undefined;
		return JSON.stringify(parsed);
	} catch {
		throw new NodeOperationError(node, `The field "${field}" does not contain valid JSON`, {
			itemIndex,
		});
	}
}

function splitCustomParameters(additionalFields: IDataObject): {
	fields: IDataObject;
	custom: QueryParameters;
} {
	const { customParameters, ...fields } = additionalFields;
	return {
		fields,
		custom: keyValuePairsToParameters((customParameters as KeyValueCollection)?.entry),
	};
}

async function getPresentationDocuments(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<PresentationDocument[]> {
	const presentations = this.getNodeParameter('presentations', itemIndex, {}) as {
		url?: PresentationEntry[];
		binary?: PresentationEntry[];
	};
	const documents: PresentationDocument[] = [];
	for (const entry of presentations.url ?? []) {
		if (!entry.url) continue;
		documents.push({
			url: entry.url,
			filename: entry.filename || undefined,
			current: entry.current,
			downloadable: entry.downloadable,
			removable: entry.removable,
		});
	}
	for (const entry of presentations.binary ?? []) {
		const propertyName = entry.binaryPropertyName || 'data';
		const binaryData = this.helpers.assertBinaryData(itemIndex, propertyName);
		const buffer = await this.helpers.getBinaryDataBuffer(itemIndex, propertyName);
		documents.push({
			base64: buffer.toString('base64'),
			filename:
				entry.filename || binaryData.fileName || `document.${binaryData.fileExtension ?? 'pdf'}`,
			current: entry.current,
			downloadable: entry.downloadable,
			removable: entry.removable,
		});
	}
	return documents;
}

/** Builds a signed join URL locally (no request to the server). */
async function generateJoinUrl(
	this: IExecuteFunctions,
	parameters: QueryParameters,
): Promise<string> {
	const credentials = (await this.getCredentials(
		'bigBlueButtonApi',
	)) as unknown as BigBlueButtonCredentials;
	return buildSignedUrl(credentials, 'join', parameters);
}

export class BigBlueButton implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'BigBlueButton',
		name: 'bigBlueButton',
		icon: {
			light: 'file:../../icons/bigbluebutton.svg',
			dark: 'file:../../icons/bigbluebutton.dark.svg',
		},
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Manage meetings, recordings and webhooks of a BigBlueButton server',
		defaults: { name: 'BigBlueButton' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'bigBlueButtonApi', required: true, testedBy: 'bigBlueButtonApiTest' }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Meeting', value: 'meeting' },
					{ name: 'Recording', value: 'recording' },
					{
						name: 'Webhook',
						value: 'hook',
						description: 'Requires the bbb-webhooks package on the server',
					},
				],
				default: 'meeting',
			},
			...meetingOperations,
			...meetingFields,
			...recordingOperations,
			...recordingFields,
			...hookOperations,
			...hookFields,
		],
	};

	methods = { credentialTest: { bigBlueButtonApiTest } };

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;

		for (let i = 0; i < items.length; i++) {
			try {
				let result: IDataObject | IDataObject[];

				if (resource === 'meeting') {
					result = await executeMeeting.call(this, operation, i);
				} else if (resource === 'recording') {
					result = await executeRecording.call(this, operation, i);
				} else if (resource === 'hook') {
					result = await executeHook.call(this, operation, i);
				} else {
					throw new NodeOperationError(this.getNode(), `Unknown resource "${resource}"`, {
						itemIndex: i,
					});
				}

				returnData.push(
					...this.helpers.constructExecutionMetaData(this.helpers.returnJsonArray(result), {
						itemData: { item: i },
					}),
				);
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				throw error instanceof NodeApiError || error instanceof NodeOperationError
					? error
					: new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [returnData];
	}
}

async function executeMeeting(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<IDataObject | IDataObject[]> {
	const request = (call: string, parameters: QueryParameters, options = {}) =>
		bigBlueButtonApiRequest.call(this, call, parameters, { itemIndex: i, ...options });

	if (operation === 'getAll') {
		const response = await request('getMeetings', {});
		return (response.meetings as IDataObject[]) ?? [];
	}

	const meetingID = this.getNodeParameter('meetingID', i) as string;

	switch (operation) {
		case 'create': {
			const name = this.getNodeParameter('name', i) as string;
			const { fields, custom } = splitCustomParameters(
				this.getNodeParameter('additionalFields', i, {}) as IDataObject,
			);
			const metadata = this.getNodeParameter('metadata', i, {}) as KeyValueCollection;

			const parameters: QueryParameters = { name, meetingID };
			let clientSettingsOverride: string | undefined;
			for (const [key, value] of Object.entries(fields)) {
				if (key === 'clientSettingsOverride') {
					clientSettingsOverride = normalizeJson(
						this.getNode(),
						value,
						'Client Settings Override',
						i,
					);
				} else if (CREATE_JSON_FIELDS.has(key)) {
					parameters[key] = normalizeJson(this.getNode(), value, key, i);
				} else {
					parameters[CREATE_PARAMETER_ALIASES[key] ?? key] = toQueryValue(value);
				}
			}
			Object.assign(parameters, keyValuePairsToParameters(metadata.entry, 'meta_'), custom);

			const documents = await getPresentationDocuments.call(this, i);
			const extraModules = clientSettingsOverride
				? [`<module name="clientSettingsOverride">${cdata(clientSettingsOverride)}</module>`]
				: [];
			if (documents.length || extraModules.length) {
				return await request('create', parameters, {
					method: 'POST',
					body: buildModulesXml(documents, extraModules),
					contentType: 'application/xml',
				});
			}
			return await request('create', parameters);
		}

		case 'end': {
			const { password } = this.getNodeParameter('additionalFields', i, {}) as IDataObject;
			return await request('end', { meetingID, password: password as string });
		}

		case 'get':
			return await request('getMeetingInfo', { meetingID });

		case 'isRunning': {
			const response = await request('isMeetingRunning', { meetingID });
			return { meetingID, running: response.running === true };
		}

		case 'getJoinUrl': {
			const fullName = this.getNodeParameter('fullName', i) as string;
			const role = this.getNodeParameter('role', i) as string;
			const executeJoin = this.getNodeParameter('executeJoin', i, false) as boolean;
			const { fields, custom } = splitCustomParameters(
				this.getNodeParameter('additionalFields', i, {}) as IDataObject,
			);
			const userdata = this.getNodeParameter('userdata', i, {}) as KeyValueCollection;

			const parameters: QueryParameters = { fullName, meetingID, role };
			for (const [key, value] of Object.entries(fields)) {
				// guest/bot/excludeFromDashboard should only be sent when enabled
				if (value === false && ['bot', 'excludeFromDashboard', 'guest'].includes(key)) continue;
				parameters[key] = toQueryValue(value);
			}
			Object.assign(parameters, keyValuePairsToParameters(userdata.entry, 'userdata-'), custom);

			if (executeJoin) {
				const response = await request('join', { ...parameters, redirect: 'false' });
				return { meetingID, fullName, role, ...response };
			}
			const url = await generateJoinUrl.call(this, parameters);
			return { meetingID, fullName, role, url };
		}

		case 'insertDocument': {
			const documents = await getPresentationDocuments.call(this, i);
			if (!documents.length) {
				throw new NodeOperationError(this.getNode(), 'Add at least one presentation', {
					itemIndex: i,
				});
			}
			return await request(
				'insertDocument',
				{ meetingID },
				{ method: 'POST', body: buildModulesXml(documents), contentType: 'application/xml' },
			);
		}

		case 'sendChatMessage': {
			const message = this.getNodeParameter('message', i) as string;
			const { userName } = this.getNodeParameter('additionalFields', i, {}) as IDataObject;
			if (message.length < 1 || message.length > 500) {
				throw new NodeOperationError(
					this.getNode(),
					'The message must be between 1 and 500 characters long',
					{ itemIndex: i },
				);
			}
			return await request('sendChatMessage', {
				meetingID,
				message,
				userName: userName as string,
			});
		}
	}

	throw new NodeOperationError(this.getNode(), `Unknown operation "${operation}"`, {
		itemIndex: i,
	});
}

async function executeRecording(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<IDataObject | IDataObject[]> {
	const request = (call: string, parameters: QueryParameters, options = {}) =>
		bigBlueButtonApiRequest.call(this, call, parameters, { itemIndex: i, ...options });

	switch (operation) {
		case 'getAll': {
			const returnAll = this.getNodeParameter('returnAll', i) as boolean;
			const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
			const parameters: QueryParameters = {
				meetingID: splitList(filters.meetingID),
				recordID: splitList(filters.recordID),
				state: (filters.state as string[]) ?? [],
				...keyValuePairsToParameters((filters.metadata as KeyValueCollection)?.entry, 'meta_'),
			};
			if (filters.offset) parameters.offset = filters.offset as number;
			let limit: number | undefined;
			if (!returnAll) {
				limit = this.getNodeParameter('limit', i) as number;
				parameters.limit = limit;
			}
			const response = await request('getRecordings', parameters);
			const recordings = (response.recordings as IDataObject[]) ?? [];
			return limit ? recordings.slice(0, limit) : recordings;
		}

		case 'publish':
		case 'unpublish': {
			const recordID = splitList(this.getNodeParameter('recordID', i));
			return await request('publishRecordings', {
				recordID,
				publish: operation === 'publish',
			});
		}

		case 'delete': {
			const recordID = splitList(this.getNodeParameter('recordID', i));
			return await request('deleteRecordings', { recordID });
		}

		case 'update': {
			const recordID = splitList(this.getNodeParameter('recordID', i));
			const metadata = this.getNodeParameter('metadata', i, {}) as KeyValueCollection;
			return await request('updateRecordings', {
				recordID,
				...keyValuePairsToParameters(metadata.entry, 'meta_'),
			});
		}

		case 'getTextTracks': {
			const recordID = this.getNodeParameter('recordID', i) as string;
			const response = await request('getRecordingTextTracks', { recordID });
			const tracks = (response.tracks as IDataObject[]) ?? [];
			return tracks.map((track) => ({ recordID, ...track }));
		}

		case 'uploadTextTrack':
		case 'deleteTextTrack': {
			const recordID = this.getNodeParameter('recordID', i) as string;
			const kind = this.getNodeParameter('kind', i) as string;
			const lang = this.getNodeParameter('lang', i) as string;
			const parameters: QueryParameters = { recordID, kind, lang };

			let multipart: { body: Buffer; contentType: string };
			if (operation === 'uploadTextTrack') {
				const { label } = this.getNodeParameter('additionalFields', i, {}) as IDataObject;
				if (label) parameters.label = label as string;
				const propertyName = this.getNodeParameter('binaryPropertyName', i) as string;
				const binaryData = this.helpers.assertBinaryData(i, propertyName);
				const buffer = await this.helpers.getBinaryDataBuffer(i, propertyName);
				multipart = buildMultipartBody(
					'file',
					binaryData.fileName ?? `${lang}.vtt`,
					binaryData.mimeType || 'text/plain',
					buffer,
				);
			} else {
				// A request without file removes the matching track
				const boundary = `----n8nBigBlueButton${Date.now().toString(16)}`;
				multipart = {
					body: Buffer.from(`--${boundary}--\r\n`, 'utf8'),
					contentType: `multipart/form-data; boundary=${boundary}`,
				};
			}
			return await request('putRecordingTextTrack', parameters, {
				method: 'POST',
				body: multipart.body,
				contentType: multipart.contentType,
			});
		}
	}

	throw new NodeOperationError(this.getNode(), `Unknown operation "${operation}"`, {
		itemIndex: i,
	});
}

async function executeHook(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<IDataObject | IDataObject[]> {
	const request = (call: string, parameters: QueryParameters) =>
		bigBlueButtonApiRequest.call(this, call, parameters, { itemIndex: i });

	switch (operation) {
		case 'create': {
			const callbackURL = this.getNodeParameter('callbackURL', i) as string;
			const additionalFields = this.getNodeParameter('additionalFields', i, {}) as IDataObject;
			return await request('hooks/create', {
				callbackURL,
				meetingID: additionalFields.meetingID as string,
				eventID: (additionalFields.eventID as string[]) ?? [],
				getRaw: additionalFields.getRaw as boolean | undefined,
			});
		}

		case 'delete': {
			const hookID = this.getNodeParameter('hookID', i) as string;
			return await request('hooks/destroy', { hookID });
		}

		case 'getAll': {
			const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
			const response = await request('hooks/list', { meetingID: filters.meetingID as string });
			return (response.hooks as IDataObject[]) ?? [];
		}
	}

	throw new NodeOperationError(this.getNode(), `Unknown operation "${operation}"`, {
		itemIndex: i,
	});
}
