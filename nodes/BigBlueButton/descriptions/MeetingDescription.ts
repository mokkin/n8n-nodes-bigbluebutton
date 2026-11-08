import type { INodeProperties } from 'n8n-workflow';

import { DISABLED_FEATURES, MEDIA_BRIDGES, MEETING_LAYOUTS } from '../constants';
import {
	booleanField,
	keyValueCollection,
	numberField,
	presentationsCollection,
	sortByDisplayName,
	stringField,
} from './shared';

export const meetingOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['meeting'] } },
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a meeting (idempotent: an existing meeting is returned unchanged)',
				action: 'Create a meeting',
			},
			{
				name: 'End',
				value: 'end',
				description: 'End a running meeting and kick all participants',
				action: 'End a meeting',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get information about a running meeting incl. attendees.',
				action: 'Get a meeting',
			},
			{
				name: 'Get Join URL',
				value: 'getJoinUrl',
				description: 'Generate a signed URL a user can open to join a meeting',
				action: 'Get a join URL',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Get many meetings currently on the server',
				action: 'Get many meetings',
			},
			{
				name: 'Insert Document',
				value: 'insertDocument',
				description: 'Upload presentations into a running meeting',
				action: 'Insert a document into a meeting',
			},
			{
				name: 'Is Running',
				value: 'isRunning',
				description: 'Check whether a meeting is running (someone has joined)',
				action: 'Check if a meeting is running',
			},
			{
				name: 'Send Chat Message',
				value: 'sendChatMessage',
				description: 'Send a message to the public chat of a meeting (BBB 3.0+)',
				action: 'Send a chat message to a meeting',
			},
		],
		default: 'create',
	},
];

const createAdditionalFields: INodeProperties[] = sortByDisplayName([
	booleanField(
		'Allow Mods To Eject Cameras',
		'allowModsToEjectCameras',
		'Whether moderators can close the webcams of other users',
	),
	booleanField(
		'Allow Mods To Unmute Users',
		'allowModsToUnmuteUsers',
		'Whether moderators can unmute other users',
	),
	booleanField(
		'Allow Promote Guest To Moderator',
		'allowPromoteGuestToModerator',
		'Whether guests can be promoted to moderator (BBB 2.7.9+)',
	),
	booleanField(
		'Allow Requests Without Session',
		'allowRequestsWithoutSession',
		'Whether the same user can join with multiple sessions from one browser',
	),
	booleanField(
		'Allow Start Stop Recording',
		'allowStartStopRecording',
		'Whether moderators can start and stop the recording',
		true,
	),
	stringField(
		'Analytics Callback URL',
		'analyticsCallbackUrl',
		'URL the server POSTs learning analytics (JSON) to when the meeting ends (sent as <code>meta_analytics-callback-url</code>)',
	),
	stringField(
		'Attendee Password (Deprecated)',
		'attendeePW',
		'Legacy viewer password. Only needed for old integrations, use the role parameter on join instead.',
		{ typeOptions: { password: true } },
	),
	{
		displayName: 'Audio Bridge',
		name: 'audioBridge',
		type: 'options',
		options: MEDIA_BRIDGES,
		default: 'bbb-webrtc-sfu',
		description: 'Media bridge used for audio (BBB 3.0+)',
	},
	booleanField(
		'Auto Start Recording',
		'autoStartRecording',
		'Whether to start recording automatically when the first user joins',
	),
	{
		displayName: 'Banner Color',
		name: 'bannerColor',
		type: 'color',
		default: '#FFFFFF',
		description: 'Background color of the banner',
	},
	stringField('Banner Text', 'bannerText', 'Text shown in a banner at the top of the client'),
	booleanField(
		'Breakout Rooms Capture Notes',
		'breakoutRoomsCaptureNotes',
		'Whether the shared notes of breakout rooms are captured into the parent meeting',
	),
	stringField(
		'Breakout Rooms Capture Notes Filename',
		'breakoutRoomsCaptureNotesFilename',
		'File name for captured breakout room notes',
	),
	booleanField(
		'Breakout Rooms Capture Slides',
		'breakoutRoomsCaptureSlides',
		'Whether the slides of breakout rooms are captured into the parent meeting',
	),
	stringField(
		'Breakout Rooms Capture Slides Filename',
		'breakoutRoomsCaptureSlidesFilename',
		'File name for captured breakout room slides',
	),
	booleanField(
		'Breakout Rooms Private Chat Enabled',
		'breakoutRoomsPrivateChatEnabled',
		'Whether private chat is enabled in breakout rooms',
		true,
	),
	booleanField(
		'Breakout Rooms Record',
		'breakoutRoomsRecord',
		'Whether breakout rooms are recorded',
	),
	{
		displayName: 'Camera Bridge',
		name: 'cameraBridge',
		type: 'options',
		options: MEDIA_BRIDGES,
		default: 'bbb-webrtc-sfu',
		description: 'Media bridge used for webcams (BBB 3.0+)',
	},
	{
		displayName: 'Client Settings Override (JSON)',
		name: 'clientSettingsOverride',
		type: 'json',
		default: '{}',
		description:
			'Client settings sent as <code>clientSettingsOverride</code> module in the request body. Requires <code>allowOverrideClientSettingsOnCreateCall=true</code> on the server.',
	},
	stringField(
		'Client Settings Override JSON URL',
		'clientSettingsOverrideJsonUrl',
		'URL of a JSON file with client settings overrides (BBB 3.0.25+)',
	),
	stringField('Dark Logo URL', 'darklogo', 'Logo shown in dark mode (BBB 3.0+)'),
	stringField('Dial Number', 'dialNumber', 'Phone number for dial-in users'),
	{
		displayName: 'Disabled Features',
		name: 'disabledFeatures',
		type: 'multiOptions',
		options: DISABLED_FEATURES,
		default: [],
		description: 'Features to disable in this meeting',
	},
	{
		displayName: 'Disabled Features Exclude',
		name: 'disabledFeaturesExclude',
		type: 'multiOptions',
		options: DISABLED_FEATURES,
		default: [],
		description:
			'Features to enable even though they are disabled by default on the server (BBB 2.6.9+)',
	},
	numberField(
		'Duration (Minutes)',
		'duration',
		'Maximum length of the meeting in minutes. 0 means unlimited.',
	),
	booleanField(
		'End When No Moderator',
		'endWhenNoModerator',
		'Whether the meeting ends automatically when no moderator is present',
	),
	numberField(
		'End When No Moderator Delay (Minutes)',
		'endWhenNoModeratorDelayInMinutes',
		'Grace period before the meeting ends when no moderator is present',
		1,
	),
	booleanField('Free Join', 'freeJoin', 'Whether users can choose their breakout room themselves'),
	{
		displayName: 'Groups (JSON)',
		name: 'groups',
		type: 'json',
		default: '[]',
		description:
			'Pre-defined groups for breakout rooms, e.g. <code>[{"ID":"1","name":"Group A","roster":["user1"]}]</code>',
	},
	{
		displayName: 'Guest Policy',
		name: 'guestPolicy',
		type: 'options',
		options: [
			{ name: 'Always Accept', value: 'ALWAYS_ACCEPT' },
			{ name: 'Always Deny', value: 'ALWAYS_DENY' },
			{ name: 'Ask Moderator', value: 'ASK_MODERATOR' },
		],
		default: 'ALWAYS_ACCEPT',
		description: 'How guests (users joining with guest=true) are handled',
	},
	booleanField('Is Breakout', 'isBreakout', 'Whether this meeting is a breakout room'),
	numberField(
		'Learning Dashboard Cleanup Delay (Minutes)',
		'learningDashboardCleanupDelayInMinutes',
		'How long the learning dashboard stays available after the meeting ended',
		2,
	),
	booleanField(
		'Lock: Disable Cam',
		'lockSettingsDisableCam',
		'Whether viewers cannot share webcams',
	),
	booleanField(
		'Lock: Disable Mic',
		'lockSettingsDisableMic',
		'Whether viewers can only join in listen-only mode',
	),
	booleanField(
		'Lock: Disable Notes',
		'lockSettingsDisableNotes',
		'Whether viewers cannot edit the shared notes',
	),
	booleanField(
		'Lock: Disable Private Chat',
		'lockSettingsDisablePrivateChat',
		'Whether viewers cannot use private chat',
	),
	booleanField(
		'Lock: Disable Public Chat',
		'lockSettingsDisablePublicChat',
		'Whether viewers cannot use the public chat',
	),
	booleanField(
		'Lock: Hide User List',
		'lockSettingsHideUserList',
		'Whether viewers cannot see other viewers in the user list',
	),
	booleanField(
		'Lock: Hide Viewers Annotation',
		'lockSettingsHideViewersAnnotation',
		'Whether whiteboard annotations of viewers are hidden from other viewers (BBB 2.7+)',
	),
	booleanField(
		'Lock: Hide Viewers Cursor',
		'lockSettingsHideViewersCursor',
		'Whether whiteboard cursors of viewers are hidden from other viewers (BBB 2.5+)',
	),
	booleanField(
		'Lock: Lock On Join',
		'lockSettingsLockOnJoin',
		'Whether the lock settings are applied when users join',
		true,
	),
	booleanField(
		'Lock: Lock On Join Configurable',
		'lockSettingsLockOnJoinConfigurable',
		'Whether moderators can change the lock-on-join setting',
	),
	{
		displayName: 'Lock: Presenter Policy',
		name: 'lockSettingsPresenterPolicy',
		type: 'options',
		options: [
			{ name: 'Free for All', value: 'freeForAll' },
			{ name: 'Moderator Only', value: 'moderatorOnly' },
			{ name: 'Require Approval', value: 'requireApproval' },
		],
		default: 'requireApproval',
		description: 'Who may take the presenter role (BBB 4.0+)',
	},
	stringField('Login URL', 'loginURL', 'URL users are sent to for authentication (BBB 3.0+)'),
	stringField('Logo URL', 'logo', 'URL of a logo shown in the client'),
	stringField('Logout URL', 'logoutURL', 'URL users are redirected to after leaving the meeting'),
	numberField(
		'Max Number Of Pages',
		'maxNumPages',
		'Maximum number of pages per presentation',
		200,
	),
	numberField(
		'Max Participants',
		'maxParticipants',
		'Maximum number of participants. 0 means unlimited.',
	),
	numberField('Max Pinned Cameras', 'maxPinnedCameras', 'Maximum number of pinned webcams', 3),
	numberField(
		'Meeting Camera Cap',
		'meetingCameraCap',
		'Maximum number of webcams in the meeting. 0 means unlimited.',
	),
	stringField(
		'Meeting Ended Callback URL',
		'meetingEndedURL',
		'URL the server calls (GET) when the meeting ends. <code>meetingID</code> and <code>recordingmarks</code> are appended.',
	),
	numberField(
		'Meeting Expire If No User Joined (Minutes)',
		'meetingExpireIfNoUserJoinedInMinutes',
		'Minutes until the meeting is removed if nobody joins',
		5,
	),
	numberField(
		'Meeting Expire When Last User Left (Minutes)',
		'meetingExpireWhenLastUserLeftInMinutes',
		'Minutes until the meeting ends after the last user left. 0 ends it immediately.',
		1,
	),
	booleanField(
		'Meeting Keep Events',
		'meetingKeepEvents',
		'Whether meeting events are kept even if the meeting is not recorded',
	),
	{
		displayName: 'Meeting Layout',
		name: 'meetingLayout',
		type: 'options',
		options: MEETING_LAYOUTS,
		default: 'UNIFIED_LAYOUT',
		description: 'Initial layout of the meeting',
	},
	stringField(
		'Moderator Only Message',
		'moderatorOnlyMessage',
		'Message shown only to moderators in the public chat',
		{ typeOptions: { rows: 3 } },
	),
	stringField(
		'Moderator Password (Deprecated)',
		'moderatorPW',
		'Legacy moderator password. Only needed for old integrations, use the role parameter on join instead.',
		{ typeOptions: { password: true } },
	),
	booleanField(
		'Multi User Whiteboard Enabled',
		'multiUserWhiteboardEnabled',
		'Whether all users can draw on the whiteboard from the start (BBB 3.0+)',
	),
	booleanField('Mute On Start', 'muteOnStart', 'Whether users are muted when they join'),
	booleanField(
		'Notify Recording Is On',
		'notifyRecordingIsOn',
		'Whether users must consent to the recording when joining',
	),
	stringField(
		'Parent Meeting ID',
		'parentMeetingID',
		'Meeting ID of the parent meeting (required for breakout rooms)',
	),
	{
		displayName: 'Plugin Manifests (JSON)',
		name: 'pluginManifests',
		type: 'json',
		default: '[]',
		description:
			'Client plugins to load, e.g. <code>[{"URL":"https://example.com/manifest.JSON"}]</code>',
	},
	stringField(
		'Plugin Manifests Fetch URL',
		'pluginManifestsFetchUrl',
		'URL returning a JSON array of plugin manifests (BBB 3.0+)',
	),
	booleanField(
		'Presentation Conversion Cache Enabled',
		'presentationConversionCacheEnabled',
		'Whether converted presentations are cached on the server (BBB 3.0+)',
	),
	stringField(
		'Presentation Upload External Description',
		'presentationUploadExternalDescription',
		'Description for the external upload link (must be used together with the URL)',
	),
	stringField(
		'Presentation Upload External URL',
		'presentationUploadExternalUrl',
		'Link shown in the upload dialog pointing to an external file source',
	),
	stringField(
		'Pre-Uploaded Presentation Name',
		'preUploadedPresentationName',
		'Display name for the pre-uploaded presentation',
	),
	booleanField(
		'Pre-Uploaded Presentation Override Default',
		'preUploadedPresentationOverrideDefault',
		'Whether the pre-uploaded presentation replaces the default presentation',
		true,
	),
	stringField(
		'Pre-Uploaded Presentation URL',
		'preUploadedPresentation',
		'URL of a presentation that is uploaded in the background (BBB 2.7.2+)',
	),
	booleanField('Record', 'record', 'Whether the meeting can be recorded'),
	booleanField(
		'Record Full Duration Media',
		'recordFullDurationMedia',
		'Whether media is recorded for the full meeting duration, regardless of recording marks',
	),
	stringField(
		'Recording Ready Callback URL',
		'recordingReadyUrl',
		'URL the server POSTs to when a recording is ready (sent as <code>meta_bbb-recording-ready-url</code>)',
	),
	booleanField(
		'Require User Consent Before Unmuting',
		'requireUserConsentBeforeUnmuting',
		'Whether users must confirm when a moderator unmutes them (BBB 4.0+)',
	),
	{
		displayName: 'Screen Share Bridge',
		name: 'screenShareBridge',
		type: 'options',
		options: MEDIA_BRIDGES,
		default: 'bbb-webrtc-sfu',
		description: 'Media bridge used for screen sharing (BBB 3.0+)',
	},
	numberField(
		'Sequence',
		'sequence',
		'Sequence number of the breakout room (required for breakouts)',
	),
	stringField(
		'Shared Notes Initial Content (Markdown)',
		'sharedNotesInitialContentMarkdown',
		'Initial content of the shared notes (BBB 3.0.33+)',
		{ typeOptions: { rows: 4 } },
	),
	stringField(
		'Shared Notes Initial Content Markdown URL',
		'sharedNotesInitialContentMarkdownUrl',
		'HTTPS URL of a Markdown file with the initial shared notes (BBB 3.0.33+)',
	),
	numberField(
		'User Camera Cap',
		'userCameraCap',
		'Maximum number of webcams a single user can share. 0 means unlimited.',
		3,
	),
	stringField('Voice Bridge', 'voiceBridge', 'Five digit voice conference number (must be unique)'),
	booleanField(
		'Webcams Only For Moderator',
		'webcamsOnlyForModerator',
		'Whether webcams of viewers are only visible to moderators',
	),
	stringField(
		'Welcome Message',
		'welcome',
		'Welcome message shown in the chat. Supports %%CONFNAME%%, %%DIALNUM%% and %%CONFNUM%%.',
		{ typeOptions: { rows: 3 } },
	),
]);

const joinAdditionalFields: INodeProperties[] = sortByDisplayName([
	stringField('Avatar URL', 'avatarURL', 'URL of the avatar image of the user'),
	booleanField('Bot', 'bot', 'Whether the user is a bot (BBB 3.0+)'),
	stringField(
		'Create Time',
		'createTime',
		'Value of <code>createTime</code> from the create response. Prevents the URL from being reused for a later meeting with the same ID.',
	),
	{
		displayName: 'Enforce Layout',
		name: 'enforceLayout',
		type: 'options',
		options: MEETING_LAYOUTS.filter((layout) => !/BBB 3\.0/.test(layout.name)),
		default: 'UNIFIED_LAYOUT',
		description: 'Layout forced for this user (BBB 3.0+)',
	},
	stringField(
		'Error Redirect URL',
		'errorRedirectUrl',
		'URL the user is redirected to if joining fails (BBB 2.7+)',
	),
	booleanField(
		'Exclude From Dashboard',
		'excludeFromDashboard',
		'Whether the user is hidden in the learning dashboard',
	),
	stringField('First Name', 'firstName', 'Used for sorting in the user list (BBB 3.0+)'),
	booleanField(
		'Guest',
		'guest',
		'Whether the user joins as guest (subject to the guest policy of the meeting)',
	),
	stringField('Last Name', 'lastName', 'Used for sorting in the user list (BBB 3.0+)'),
	stringField('Logout URL', 'logoutURL', 'URL this user is redirected to after leaving (BBB 3.0+)'),
	stringField(
		'Password (Deprecated)',
		'password',
		'Legacy attendee/moderator password. Ignored when a role is set.',
		{ typeOptions: { password: true } },
	),
	stringField('User ID', 'userID', 'Your own identifier for the user'),
	stringField(
		'Webcam Background URL',
		'webcamBackgroundURL',
		'URL of a virtual background image for the webcam (BBB 2.7.10+)',
	),
]);

const customParameters = keyValueCollection(
	'Custom Parameters',
	'customParameters',
	'Additional raw API parameters (e.g. parameters of newer BigBlueButton versions)',
	'parameterName',
);

export const meetingFields: INodeProperties[] = [
	/* -------------------------------------------------------------------------- */
	/*                          Fields shared by many ops                         */
	/* -------------------------------------------------------------------------- */
	{
		displayName: 'Meeting ID',
		name: 'meetingID',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'my-meeting-123',
		description: 'Your unique identifier of the meeting (2-256 characters, no commas)',
		displayOptions: {
			show: {
				resource: ['meeting'],
				operation: [
					'create',
					'end',
					'get',
					'getJoinUrl',
					'insertDocument',
					'isRunning',
					'sendChatMessage',
				],
			},
		},
	},

	/* -------------------------------------------------------------------------- */
	/*                               meeting:create                               */
	/* -------------------------------------------------------------------------- */
	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'Weekly Team Meeting',
		description: 'Name of the meeting',
		displayOptions: { show: { resource: ['meeting'], operation: ['create'] } },
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { resource: ['meeting'], operation: ['create'] } },
		options: [...createAdditionalFields, customParameters],
	},
	keyValueCollection(
		'Metadata',
		'metadata',
		'Metadata stored with the meeting and its recordings. Keys are sent as <code>meta_&lt;key&gt;</code>.',
		'presenter',
		{ displayOptions: { show: { resource: ['meeting'], operation: ['create'] } } },
	),
	presentationsCollection({ show: { resource: ['meeting'], operation: ['create'] } }),

	/* -------------------------------------------------------------------------- */
	/*                                 meeting:end                                */
	/* -------------------------------------------------------------------------- */
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { resource: ['meeting'], operation: ['end'] } },
		options: [
			stringField(
				'Password (Deprecated)',
				'password',
				'Moderator password, only required by BigBlueButton versions before 2.6',
				{ typeOptions: { password: true } },
			),
		],
	},

	/* -------------------------------------------------------------------------- */
	/*                             meeting:getJoinUrl                             */
	/* -------------------------------------------------------------------------- */
	{
		displayName: 'Full Name',
		name: 'fullName',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'Jane Doe',
		description: 'Display name of the user (max. 255 characters).',
		displayOptions: { show: { resource: ['meeting'], operation: ['getJoinUrl'] } },
	},
	{
		displayName: 'Role',
		name: 'role',
		type: 'options',
		options: [
			{ name: 'Moderator', value: 'MODERATOR' },
			{ name: 'Viewer', value: 'VIEWER' },
		],
		default: 'VIEWER',
		description: 'Role of the user in the meeting',
		displayOptions: { show: { resource: ['meeting'], operation: ['getJoinUrl'] } },
	},
	{
		displayName: 'Execute Join Request',
		name: 'executeJoin',
		type: 'boolean',
		default: false,
		description:
			'Whether to call the join API with <code>redirect=false</code> and return session token and client URL instead of only generating the signed URL. Note: this creates the user session on the server.',
		displayOptions: { show: { resource: ['meeting'], operation: ['getJoinUrl'] } },
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { resource: ['meeting'], operation: ['getJoinUrl'] } },
		options: [...joinAdditionalFields, customParameters],
	},
	keyValueCollection(
		'User Data',
		'userdata',
		'Client settings for this user, sent as <code>userdata-&lt;key&gt;</code>, e.g. <code>bbb_auto_join_audio</code> = <code>true</code>, <code>bbb_skip_check_audio</code>, <code>bbb_override_default_locale</code> = <code>de</code>',
		'bbb_auto_join_audio',
		{ displayOptions: { show: { resource: ['meeting'], operation: ['getJoinUrl'] } } },
	),

	/* -------------------------------------------------------------------------- */
	/*                           meeting:insertDocument                           */
	/* -------------------------------------------------------------------------- */
	presentationsCollection({ show: { resource: ['meeting'], operation: ['insertDocument'] } }),

	/* -------------------------------------------------------------------------- */
	/*                          meeting:sendChatMessage                           */
	/* -------------------------------------------------------------------------- */
	{
		displayName: 'Message',
		name: 'message',
		type: 'string',
		required: true,
		default: '',
		typeOptions: { rows: 3 },
		description: 'Message to post to the public chat (1-500 characters)',
		displayOptions: { show: { resource: ['meeting'], operation: ['sendChatMessage'] } },
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { resource: ['meeting'], operation: ['sendChatMessage'] } },
		options: [
			stringField('Sender Name', 'userName', 'Name shown as sender. Defaults to "System".'),
		],
	},
];
