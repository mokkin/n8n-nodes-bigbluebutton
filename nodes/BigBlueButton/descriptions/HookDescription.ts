import type { INodeProperties } from 'n8n-workflow';

import { WEBHOOK_EVENTS } from '../constants';
import { stringField } from './shared';

export const hookOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['hook'] } },
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Register a callback URL with bbb-webhooks',
				action: 'Create a webhook',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Remove a registered webhook',
				action: 'Delete a webhook',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'List the registered webhooks',
				action: 'Get many webhooks',
			},
		],
		default: 'getAll',
	},
];

export const hookFields: INodeProperties[] = [
	{
		displayName: 'Callback URL',
		name: 'callbackURL',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'https://example.com/bbb-events',
		description: 'URL the events are POSTed to. The same URL can only be registered once.',
		displayOptions: { show: { resource: ['hook'], operation: ['create'] } },
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { resource: ['hook'], operation: ['create'] } },
		options: [
			{
				displayName: 'Events',
				name: 'eventID',
				type: 'multiOptions',
				options: WEBHOOK_EVENTS,
				default: [],
				description: 'Only send these events (BBB 2.5+). Leave empty to receive all events.',
			},
			{
				displayName: 'Raw Data',
				name: 'getRaw',
				type: 'boolean',
				default: false,
				description: 'Whether to receive the raw internal messages instead of the processed events',
			},
			stringField(
				'Meeting ID',
				'meetingID',
				'Only send events of this meeting. Leave empty for a global hook.',
			),
		],
	},
	{
		displayName: 'Hook ID',
		name: 'hookID',
		type: 'string',
		required: true,
		default: '',
		description: 'ID of the webhook as returned by Create or Get Many',
		displayOptions: { show: { resource: ['hook'], operation: ['delete'] } },
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: { resource: ['hook'], operation: ['getAll'] } },
		options: [
			stringField(
				'Meeting ID',
				'meetingID',
				'Only return hooks of this meeting (global hooks are always included)',
			),
		],
	},
];
