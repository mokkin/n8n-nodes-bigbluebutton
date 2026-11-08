import type {
	ICredentialDataDecryptedObject,
	ICredentialType,
	IHttpRequestOptions,
	INodeProperties,
	Icon,
} from 'n8n-workflow';

import {
	type BigBlueButtonCredentials,
	type ChecksumAlgorithm,
	computeChecksum,
	getApiBaseUrl,
} from '../nodes/BigBlueButton/signing';

export class BigBlueButtonApi implements ICredentialType {
	name = 'bigBlueButtonApi';

	displayName = 'BigBlueButton API';

	icon: Icon = {
		light: 'file:../icons/bigbluebutton.svg',
		dark: 'file:../icons/bigbluebutton.dark.svg',
	};

	documentationUrl = 'https://docs.bigbluebutton.org/development/api/';

	properties: INodeProperties[] = [
		{
			displayName: 'Server URL',
			name: 'url',
			type: 'string',
			default: '',
			placeholder: 'https://bbb.example.com/bigbluebutton/',
			required: true,
			description:
				'The BigBlueButton API URL as printed by <code>bbb-conf --secret</code>. The path <code>/bigbluebutton/api</code> is appended automatically if it is missing. Scalelite load balancers work as well.',
		},
		{
			displayName: 'Shared Secret',
			name: 'secret',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'The shared secret (securitySalt) as printed by <code>bbb-conf --secret</code>',
		},
		{
			displayName: 'Checksum Algorithm',
			name: 'checksumAlgorithm',
			type: 'options',
			options: [
				{ name: 'SHA-1', value: 'sha1' },
				{ name: 'SHA-256', value: 'sha256' },
				{ name: 'SHA-384', value: 'sha384' },
				{ name: 'SHA-512', value: 'sha512' },
			],
			default: 'sha256',
			description:
				'Hash algorithm used to sign API calls. Must be allowed by <code>supportedChecksumAlgorithms</code> on the server (all are allowed by default; SHA-384/512 need BigBlueButton 2.5+).',
		},
	];

	/**
	 * Signs the request: the node passes `<callName>?<queryString>` as URL, this function
	 * turns it into `<baseUrl>/<callName>?<queryString>&checksum=<hash>`.
	 */
	async authenticate(
		credentials: ICredentialDataDecryptedObject,
		requestOptions: IHttpRequestOptions,
	): Promise<IHttpRequestOptions> {
		const { url, secret, checksumAlgorithm } = credentials as unknown as BigBlueButtonCredentials;
		const target = String(requestOptions.url ?? '');
		if (/^https?:\/\//i.test(target)) return requestOptions;

		const questionMark = target.indexOf('?');
		const callName = (questionMark === -1 ? target : target.slice(0, questionMark)).replace(
			/^\/+/,
			'',
		);
		const queryString = questionMark === -1 ? '' : target.slice(questionMark + 1);
		const checksum = computeChecksum(
			callName,
			queryString,
			secret,
			(checksumAlgorithm || 'sha256') as ChecksumAlgorithm,
		);
		const query = queryString ? `${queryString}&checksum=${checksum}` : `checksum=${checksum}`;

		const signed: IHttpRequestOptions = {
			...requestOptions,
			url: `${getApiBaseUrl(url)}/${callName}?${query}`,
		};
		delete signed.baseURL;
		delete signed.qs;
		return signed;
	}
}
