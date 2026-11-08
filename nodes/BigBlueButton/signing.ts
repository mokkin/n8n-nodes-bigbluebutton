import { createHash, timingSafeEqual } from 'crypto';

/**
 * Pure helpers to sign BigBlueButton API calls. Shared by the credential
 * (authenticate) and the nodes. No n8n runtime imports on purpose.
 */

export type ChecksumAlgorithm = 'sha1' | 'sha256' | 'sha384' | 'sha512';

export interface BigBlueButtonCredentials {
	url: string;
	secret: string;
	checksumAlgorithm: ChecksumAlgorithm;
}

export type QueryValue = string | number | boolean | string[] | undefined | null;
export type QueryParameters = { [key: string]: QueryValue };

const CHECKSUM_LENGTHS: Record<number, ChecksumAlgorithm> = {
	40: 'sha1',
	64: 'sha256',
	96: 'sha384',
	128: 'sha512',
};

/**
 * Normalizes the configured server URL to the API base URL
 * (e.g. `https://bbb.example.com/bigbluebutton/api`).
 */
export function getApiBaseUrl(url: string): string {
	let base = url.trim().replace(/\/+$/, '');
	if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
	if (/\/api$/i.test(base)) return base;
	const { pathname } = new URL(base);
	if (pathname === '' || pathname === '/') return `${base}/bigbluebutton/api`;
	return `${base}/api`;
}

/** Percent-encodes a value like PHP's rawurlencode (RFC 3986). */
export function encodeParameter(value: string): string {
	return encodeURIComponent(value).replace(
		/[!'()*]/g,
		(char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
	);
}

/**
 * Builds a query string, skipping empty values (except for `meta_*` parameters, where an
 * empty value is meaningful, e.g. to remove metadata in updateRecordings).
 * Order of keys is preserved.
 */
export function buildQueryString(parameters: QueryParameters): string {
	const parts: string[] = [];
	for (const [key, rawValue] of Object.entries(parameters)) {
		if (rawValue === undefined || rawValue === null) continue;
		let value: string;
		if (Array.isArray(rawValue)) {
			if (rawValue.length === 0) continue;
			value = rawValue.join(',');
		} else if (typeof rawValue === 'boolean') {
			value = rawValue ? 'true' : 'false';
		} else {
			value = String(rawValue);
		}
		if (value === '' && !key.startsWith('meta_')) continue;
		parts.push(`${encodeParameter(key)}=${encodeParameter(value)}`);
	}
	return parts.join('&');
}

export function hashHex(value: string, algorithm: ChecksumAlgorithm): string {
	return createHash(algorithm).update(value, 'utf8').digest('hex');
}

/** BigBlueButton API checksum: hash(callName + queryString + sharedSecret). */
export function computeChecksum(
	callName: string,
	queryString: string,
	secret: string,
	algorithm: ChecksumAlgorithm,
): string {
	return hashHex(`${callName}${queryString}${secret}`, algorithm);
}

/** Builds a fully signed API URL for the given call. */
export function buildSignedUrl(
	credentials: BigBlueButtonCredentials,
	callName: string,
	parameters: QueryParameters = {},
): string {
	const queryString = buildQueryString(parameters);
	const checksum = computeChecksum(
		callName,
		queryString,
		credentials.secret,
		credentials.checksumAlgorithm || 'sha256',
	);
	const separator = queryString ? `${queryString}&` : '';
	return `${getApiBaseUrl(credentials.url)}/${callName}?${separator}checksum=${checksum}`;
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
	const bufferA = Buffer.from(a);
	const bufferB = Buffer.from(b);
	if (bufferA.length !== bufferB.length) return false;
	return timingSafeEqual(bufferA, bufferB);
}

/**
 * Verifies a checksum sent by bbb-webhooks to a callback URL:
 * hash(callbackURL + rawBody + sharedSecret), algorithm detected by length.
 */
export function verifyCallbackChecksum(
	callbackUrl: string,
	rawBody: string,
	secret: string,
	checksum: string,
): boolean {
	const algorithm = CHECKSUM_LENGTHS[checksum.length];
	if (!algorithm) return false;
	const expected = hashHex(`${callbackUrl}${rawBody}${secret}`, algorithm);
	return safeEqual(expected, checksum.toLowerCase());
}
