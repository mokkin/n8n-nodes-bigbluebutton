import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { WEBHOOK_EVENTS } from '../BigBlueButton/constants';
import { bigBlueButtonApiTest } from '../BigBlueButton/credentialTest';
import { bigBlueButtonApiRequest } from '../BigBlueButton/GenericFunctions';
import {
	type BigBlueButtonCredentials,
	safeEqual,
	verifyCallbackChecksum,
} from '../BigBlueButton/signing';

interface StoredHook {
	hookId?: string;
}

/** Removes the `checksum` query parameter from a URL string. */
function stripChecksum(url: string): string {
	return url
		.replace(/([?&])checksum=[^&]*(&|$)/, (_match, prefix: string, suffix: string) =>
			suffix ? prefix : '',
		)
		.replace(/[?&]$/, '');
}

/** Parses the `event` field sent by bbb-webhooks (a JSON object or array, possibly stringified). */
export function parseEvents(value: unknown): IDataObject[] {
	let parsed: unknown = value;
	if (typeof value === 'string') {
		try {
			parsed = JSON.parse(value);
		} catch {
			return [{ raw: value }];
		}
	}
	if (Array.isArray(parsed)) return parsed as IDataObject[];
	if (parsed && typeof parsed === 'object') return [parsed as IDataObject];
	return [];
}

/** Turns a bbb-webhooks event into a flat, easy to use item. */
export function simplifyEvent(event: IDataObject, extra: IDataObject): IDataObject {
	const data = event.data as IDataObject | undefined;
	if (!data || typeof data !== 'object' || !data.id) return { ...event, ...extra };
	const attributes = (data.attributes as IDataObject) ?? {};
	const meeting = (attributes.meeting as IDataObject) ?? {};
	return {
		event: data.id,
		meetingID: meeting['external-meeting-id'],
		internalMeetingID: meeting['internal-meeting-id'],
		eventTimestamp: (data.event as IDataObject | undefined)?.ts,
		attributes,
		...extra,
	};
}

export class BigBlueButtonTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'BigBlueButton Trigger',
		name: 'bigBlueButtonTrigger',
		icon: {
			light: 'file:../../icons/bigbluebutton.svg',
			dark: 'file:../../icons/bigbluebutton.dark.svg',
		},
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["events"].length ? $parameter["events"].join(", ") : "All events"}}',
		description:
			'Starts the workflow on BigBlueButton events (requires bbb-webhooks on the server)',
		defaults: { name: 'BigBlueButton Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'bigBlueButtonApi', required: true, testedBy: 'bigBlueButtonApiTest' }],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName:
					'The webhook is registered automatically via the bbb-webhooks API when the workflow is activated and removed when it is deactivated. The BigBlueButton server must be able to reach your n8n instance.',
				name: 'notice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				options: WEBHOOK_EVENTS,
				default: [],
				description: 'Events to listen to. Leave empty to receive all events.',
			},
			{
				displayName: 'Meeting ID',
				name: 'meetingID',
				type: 'string',
				default: '',
				description:
					'Only receive events of this meeting. Leave empty to receive events of all meetings.',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Raw Data',
						name: 'getRaw',
						type: 'boolean',
						default: false,
						description:
							'Whether to receive the raw internal messages instead of the processed events (no event filtering possible)',
					},
					{
						displayName: 'Simplify',
						name: 'simplify',
						type: 'boolean',
						default: true,
						description:
							'Whether to return a simplified version of the event instead of the raw payload',
					},
					{
						displayName: 'Verify Signature',
						name: 'verifySignature',
						type: 'boolean',
						default: true,
						description:
							'Whether to reject requests without a valid checksum (or bearer token) signed with the shared secret',
					},
				],
			},
		],
	};

	methods = { credentialTest: { bigBlueButtonApiTest } };

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const webhookUrl = this.getNodeWebhookUrl('default') as string;
				const staticData = this.getWorkflowStaticData('node') as StoredHook;
				const response = await bigBlueButtonApiRequest.call(this, 'hooks/list', {});
				const hooks = (response.hooks as IDataObject[]) ?? [];
				const existing = hooks.find((hook) => hook.callbackURL === webhookUrl);
				if (!existing) {
					delete staticData.hookId;
					return false;
				}
				staticData.hookId = String(existing.hookID);
				return true;
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const webhookUrl = this.getNodeWebhookUrl('default') as string;
				const staticData = this.getWorkflowStaticData('node') as StoredHook;
				const events = this.getNodeParameter('events', []) as string[];
				const meetingID = this.getNodeParameter('meetingID', '') as string;
				const options = this.getNodeParameter('options', {}) as IDataObject;

				const response = await bigBlueButtonApiRequest.call(this, 'hooks/create', {
					callbackURL: webhookUrl,
					meetingID,
					eventID: options.getRaw ? [] : events,
					getRaw: options.getRaw ? true : undefined,
				});
				if (response.hookID === undefined) return false;
				staticData.hookId = String(response.hookID);
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node') as StoredHook;
				if (!staticData.hookId) return true;
				const response = await bigBlueButtonApiRequest.call(
					this,
					'hooks/destroy',
					{ hookID: staticData.hookId },
					{ ignoreFailure: true },
				);
				if (response.returncode === 'FAILED' && response.messageKey !== 'destroyMissingHook') {
					this.logger.warn(
						`BigBlueButton Trigger: could not delete hook ${staticData.hookId}: ${String(
							response.message ?? response.messageKey,
						)}`,
					);
					return false;
				}
				delete staticData.hookId;
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const request = this.getRequestObject();
		const response = this.getResponseObject();
		const options = this.getNodeParameter('options', {}) as IDataObject;
		const rawBody = (request as unknown as { rawBody?: Buffer }).rawBody;

		if (options.verifySignature !== false) {
			const credentials = (await this.getCredentials(
				'bigBlueButtonApi',
			)) as unknown as BigBlueButtonCredentials;
			const secret = credentials.secret;
			const authorization = request.headers.authorization ?? '';
			const checksum = this.getQueryData() as IDataObject;

			let valid = false;
			if (authorization.startsWith('Bearer ')) {
				valid = safeEqual(authorization.slice(7).trim(), secret);
			} else if (typeof checksum.checksum === 'string') {
				const body = rawBody ? rawBody.toString('utf8') : '';
				const candidates = new Set<string>([this.getNodeWebhookUrl('default') as string]);
				const forwardedProto = String(request.headers['x-forwarded-proto'] ?? '').split(',')[0];
				const host = request.headers['x-forwarded-host'] ?? request.headers.host;
				if (host) {
					candidates.add(
						stripChecksum(
							`${forwardedProto || request.protocol}://${String(host)}${request.originalUrl}`,
						),
					);
				}
				valid = [...candidates].some((url) =>
					verifyCallbackChecksum(url, body, secret, checksum.checksum as string),
				);
			}

			if (!valid) {
				// bbb-webhooks treats 401 as "delivered but denied" and does not retry
				response.status(401).send('Invalid BigBlueButton checksum');
				return { noWebhookResponse: true };
			}
		}

		let body = this.getBodyData() as IDataObject;
		if ((!body || body.event === undefined) && rawBody) {
			body = Object.fromEntries(new URLSearchParams(rawBody.toString('utf8')));
		}

		const extra: IDataObject = {};
		if (body.timestamp !== undefined) extra.timestamp = Number(body.timestamp) || body.timestamp;
		if (body.domain !== undefined) extra.domain = body.domain;

		const selectedEvents = this.getNodeParameter('events', []) as string[];
		const meetingID = this.getNodeParameter('meetingID', '') as string;
		const simplify = options.simplify !== false;

		const events = parseEvents(body.event ?? body).filter((event) => {
			if (options.getRaw) return true;
			const data = event.data as IDataObject | undefined;
			if (selectedEvents.length && !selectedEvents.includes(String(data?.id))) return false;
			if (meetingID) {
				const meeting = (data?.attributes as IDataObject | undefined)?.meeting as
					| IDataObject
					| undefined;
				if (meeting && meeting['external-meeting-id'] !== meetingID) return false;
			}
			return true;
		});

		if (!events.length) return {};

		const items = events.map((event) => ({
			json: simplify && !options.getRaw ? simplifyEvent(event, extra) : { ...event, ...extra },
		}));
		return { workflowData: [items] };
	}
}
