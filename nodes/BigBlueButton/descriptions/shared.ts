import type { INodeProperties } from 'n8n-workflow';

export function booleanField(
	displayName: string,
	name: string,
	description: string,
	defaultValue = false,
): INodeProperties {
	const field: INodeProperties = {
		displayName,
		name,
		type: 'boolean',
		default: false,
		description,
	};
	field.default = defaultValue;
	return field;
}

export function stringField(
	displayName: string,
	name: string,
	description: string,
	extra: Partial<INodeProperties> = {},
): INodeProperties {
	return { displayName, name, type: 'string', default: '', description, ...extra };
}

export function numberField(
	displayName: string,
	name: string,
	description: string,
	defaultValue = 0,
): INodeProperties {
	return {
		displayName,
		name,
		type: 'number',
		typeOptions: { minValue: 0 },
		default: defaultValue,
		description,
	};
}

export function sortByDisplayName(fields: INodeProperties[]): INodeProperties[] {
	return [...fields].sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export function keyValueCollection(
	displayName: string,
	name: string,
	description: string,
	keyPlaceholder: string,
	extra: Partial<INodeProperties> = {},
): INodeProperties {
	return {
		displayName,
		name,
		type: 'fixedCollection',
		placeholder: 'Add Entry',
		typeOptions: { multipleValues: true },
		default: {},
		description,
		options: [
			{
				displayName: 'Entry',
				name: 'entry',
				values: [
					{
						displayName: 'Key',
						name: 'key',
						type: 'string',
						default: '',
						placeholder: keyPlaceholder,
					},
					{
						displayName: 'Value',
						name: 'value',
						type: 'string',
						default: '',
					},
				],
			},
		],
		...extra,
	};
}

/** Presentation documents (by URL or from binary data) for `create` and `insertDocument`. */
export function presentationsCollection(
	displayOptions: INodeProperties['displayOptions'],
): INodeProperties {
	const flags: INodeProperties[] = [
		booleanField(
			'Current',
			'current',
			'Whether this document is shown first. The first document marked as current is loaded.',
		),
		booleanField('Downloadable', 'downloadable', 'Whether participants may download the document'),
		booleanField('Removable', 'removable', 'Whether presenters may remove the document', true),
	];
	return {
		displayName: 'Presentations',
		name: 'presentations',
		type: 'fixedCollection',
		placeholder: 'Add Presentation',
		typeOptions: { multipleValues: true },
		default: {},
		displayOptions,
		description:
			'Documents to upload. By default at most 10 documents per request and 2 MB request body are accepted by the server (inline uploads count towards the body size).',
		options: [
			{
				displayName: 'From URL',
				name: 'url',
				values: [
					{
						displayName: 'URL',
						name: 'url',
						type: 'string',
						default: '',
						required: true,
						placeholder: 'https://example.com/slides.pdf',
						description: 'Publicly reachable URL the BigBlueButton server downloads the file from',
					},
					{
						displayName: 'Filename',
						name: 'filename',
						type: 'string',
						default: '',
						placeholder: 'slides.pdf',
						description: 'File name incl. extension. Required if the URL has no file extension.',
					},
					...flags,
				],
			},
			{
				displayName: 'From Binary Data',
				name: 'binary',
				values: [
					{
						displayName: 'Input Binary Field',
						name: 'binaryPropertyName',
						type: 'string',
						default: 'data',
						required: true,
						hint: 'The name of the input binary field containing the file to upload',
					},
					{
						displayName: 'Filename',
						name: 'filename',
						type: 'string',
						default: '',
						description: 'Overrides the file name of the binary data',
					},
					...flags,
				],
			},
		],
	};
}
