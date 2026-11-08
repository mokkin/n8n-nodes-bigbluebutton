import type {
	ICredentialsDecrypted,
	ICredentialTestFunctions,
	IDataObject,
	INodeCredentialTestResult,
} from 'n8n-workflow';

import { parseResponse } from './GenericFunctions';
import { type BigBlueButtonCredentials, buildSignedUrl } from './signing';

/**
 * Credential test: calls `getMeetings` and checks the `returncode`.
 * BigBlueButton answers checksum errors with HTTP 200, so the response body must be inspected.
 */
export async function bigBlueButtonApiTest(
	this: ICredentialTestFunctions,
	credential: ICredentialsDecrypted,
): Promise<INodeCredentialTestResult> {
	const credentials = credential.data as unknown as BigBlueButtonCredentials;
	let response: IDataObject;
	try {
		// ICredentialTestFunctions only exposes the legacy request helper
		// eslint-disable-next-line @n8n/community-nodes/no-deprecated-workflow-functions
		const body: unknown = await this.helpers.request({
			method: 'GET',
			uri: buildSignedUrl(credentials, 'getMeetings'),
			json: false,
		});
		response = parseResponse(body);
	} catch (error) {
		return {
			status: 'Error',
			message: `Could not connect to the BigBlueButton server: ${(error as Error).message}`,
		};
	}
	if (response.returncode === 'SUCCESS') {
		return { status: 'OK', message: 'Connection successful' };
	}
	if (response.messageKey === 'checksumError') {
		return {
			status: 'Error',
			message: 'Checksum error: check the shared secret and the checksum algorithm',
		};
	}
	return {
		status: 'Error',
		message:
			(response.message as string) ??
			'Unexpected response. Is the URL pointing to a BigBlueButton API?',
	};
}
