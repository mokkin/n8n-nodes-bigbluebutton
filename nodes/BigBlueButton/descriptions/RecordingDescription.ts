import type { INodeProperties } from 'n8n-workflow';

import { RECORDING_STATES } from '../constants';
import { keyValueCollection, stringField } from './shared';

export const recordingOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['recording'] } },
		options: [
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete one or more recordings',
				action: 'Delete recordings',
			},
			{
				name: 'Delete Text Track',
				value: 'deleteTextTrack',
				description: 'Remove subtitles/captions of a recording for a language',
				action: 'Delete a text track of a recording',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Get recordings, optionally filtered by meeting, state or metadata',
				action: 'Get many recordings',
			},
			{
				name: 'Get Text Tracks',
				value: 'getTextTracks',
				description: 'Get the subtitles/captions of a recording',
				action: 'Get text tracks of a recording',
			},
			{
				name: 'Publish',
				value: 'publish',
				description: 'Publish one or more recordings',
				action: 'Publish recordings',
			},
			{
				name: 'Unpublish',
				value: 'unpublish',
				description: 'Unpublish one or more recordings',
				action: 'Unpublish recordings',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update the metadata of one or more recordings',
				action: 'Update recordings',
			},
			{
				name: 'Upload Text Track',
				value: 'uploadTextTrack',
				description: 'Upload subtitles/captions (SRT, SSA/ASS or WebVTT) for a recording',
				action: 'Upload a text track to a recording',
			},
		],
		default: 'getAll',
	},
];

export const recordingFields: INodeProperties[] = [
	{
		displayName: 'Recording IDs',
		name: 'recordID',
		type: 'string',
		required: true,
		default: '',
		placeholder: '183f0bf3a0982a127bdb8161e0c44eb696b3e75c-1531240585189',
		description: 'One recording ID or a comma-separated list of recording IDs',
		displayOptions: {
			show: { resource: ['recording'], operation: ['delete', 'publish', 'unpublish', 'update'] },
		},
	},
	{
		displayName: 'Recording ID',
		name: 'recordID',
		type: 'string',
		required: true,
		default: '',
		placeholder: '183f0bf3a0982a127bdb8161e0c44eb696b3e75c-1531240585189',
		description: 'The ID of a single recording',
		displayOptions: {
			show: {
				resource: ['recording'],
				operation: ['deleteTextTrack', 'getTextTracks', 'uploadTextTrack'],
			},
		},
	},

	/* -------------------------------------------------------------------------- */
	/*                              recording:getAll                              */
	/* -------------------------------------------------------------------------- */
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: { show: { resource: ['recording'], operation: ['getAll'] } },
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1, maxValue: 100 },
		default: 50,
		description: 'Max number of results to return',
		displayOptions: {
			show: { resource: ['recording'], operation: ['getAll'], returnAll: [false] },
		},
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: { resource: ['recording'], operation: ['getAll'] } },
		options: [
			stringField(
				'Meeting IDs',
				'meetingID',
				'One meeting ID or a comma separated list of meeting IDs',
			),
			{
				displayName: 'Metadata',
				name: 'metadata',
				type: 'fixedCollection',
				placeholder: 'Add Metadata Filter',
				typeOptions: { multipleValues: true },
				default: {},
				description:
					'Only return recordings whose metadata matches (sent as <code>meta_&lt;key&gt;</code>)',
				options: [
					{
						displayName: 'Entry',
						name: 'entry',
						values: [
							{ displayName: 'Key', name: 'key', type: 'string', default: '' },
							{ displayName: 'Value', name: 'value', type: 'string', default: '' },
						],
					},
				],
			},
			{
				displayName: 'Offset',
				name: 'offset',
				type: 'number',
				typeOptions: { minValue: 0 },
				default: 0,
				description: 'Number of recordings to skip (BBB 2.6+)',
			},
			stringField(
				'Recording IDs',
				'recordID',
				'One recording ID or a comma separated list. A prefix matches all recordings starting with it.',
			),
			{
				displayName: 'States',
				name: 'state',
				type: 'multiOptions',
				options: RECORDING_STATES,
				default: [],
				description:
					'Only return recordings in these states. Defaults to published and unpublished.',
			},
		],
	},

	/* -------------------------------------------------------------------------- */
	/*                              recording:update                              */
	/* -------------------------------------------------------------------------- */
	keyValueCollection(
		'Metadata',
		'metadata',
		'Metadata to set on the recordings. An empty value removes the key.',
		'presenter',
		{ displayOptions: { show: { resource: ['recording'], operation: ['update'] } } },
	),

	/* -------------------------------------------------------------------------- */
	/*                     recording:uploadTextTrack/deleteTextTrack              */
	/* -------------------------------------------------------------------------- */
	{
		displayName: 'Kind',
		name: 'kind',
		type: 'options',
		options: [
			{
				name: 'Captions',
				value: 'captions',
				description: 'Transcription incl. sound effects, for hearing impaired users.',
			},
			{
				name: 'Subtitles',
				value: 'subtitles',
				description: 'Transcription or translation of speech',
			},
		],
		default: 'subtitles',
		displayOptions: {
			show: { resource: ['recording'], operation: ['deleteTextTrack', 'uploadTextTrack'] },
		},
	},
	{
		displayName: 'Language',
		name: 'lang',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'de-DE',
		description: 'BCP 47 language tag of the text track',
		displayOptions: {
			show: { resource: ['recording'], operation: ['deleteTextTrack', 'uploadTextTrack'] },
		},
	},
	{
		displayName: 'Input Binary Field',
		name: 'binaryPropertyName',
		type: 'string',
		required: true,
		default: 'data',
		hint: 'The name of the input binary field containing the SRT, SSA/ASS or WebVTT file',
		displayOptions: { show: { resource: ['recording'], operation: ['uploadTextTrack'] } },
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { resource: ['recording'], operation: ['uploadTextTrack'] } },
		options: [
			stringField(
				'Label',
				'label',
				'Label shown in the player. Defaults to the name of the language.',
			),
		],
	},
];
