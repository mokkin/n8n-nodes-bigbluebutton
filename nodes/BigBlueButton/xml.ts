import type { IDataObject } from 'n8n-workflow';

/**
 * Minimal, dependency-free XML parser tailored to BigBlueButton API responses.
 * Supports elements, attributes, text, CDATA, entities, comments, processing
 * instructions and DOCTYPE declarations. Namespaces are kept as part of the name.
 */
export interface XmlElement {
	name: string;
	attributes: Record<string, string>;
	children: XmlElement[];
	text: string;
}

const NAMED_ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' ',
};

export function decodeEntities(value: string): string {
	return value.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, entity: string) => {
		if (entity[0] === '#') {
			const codePoint =
				entity[1] === 'x' || entity[1] === 'X'
					? parseInt(entity.slice(2), 16)
					: parseInt(entity.slice(1), 10);
			return Number.isNaN(codePoint) ? match : String.fromCodePoint(codePoint);
		}
		return NAMED_ENTITIES[entity] ?? match;
	});
}

export function escapeXml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

function parseAttributes(source: string): Record<string, string> {
	const attributes: Record<string, string> = {};
	const regex = /([^\s=/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
	let match: RegExpExecArray | null;
	while ((match = regex.exec(source)) !== null) {
		attributes[match[1]] = decodeEntities(match[2] ?? match[3] ?? '');
	}
	return attributes;
}

export function parseXml(xml: string): XmlElement {
	const root: XmlElement = { name: '#document', attributes: {}, children: [], text: '' };
	const stack: XmlElement[] = [root];
	let position = 0;
	const length = xml.length;

	const current = () => stack[stack.length - 1];

	while (position < length) {
		const tagStart = xml.indexOf('<', position);
		if (tagStart === -1) {
			current().text += decodeEntities(xml.slice(position));
			break;
		}
		if (tagStart > position) {
			current().text += decodeEntities(xml.slice(position, tagStart));
		}

		if (xml.startsWith('<![CDATA[', tagStart)) {
			const end = xml.indexOf(']]>', tagStart + 9);
			if (end === -1) throw new Error('Malformed XML: unterminated CDATA section');
			current().text += xml.slice(tagStart + 9, end);
			position = end + 3;
			continue;
		}
		if (xml.startsWith('<!--', tagStart)) {
			const end = xml.indexOf('-->', tagStart + 4);
			if (end === -1) throw new Error('Malformed XML: unterminated comment');
			position = end + 3;
			continue;
		}
		if (xml.startsWith('<?', tagStart)) {
			const end = xml.indexOf('?>', tagStart + 2);
			if (end === -1) throw new Error('Malformed XML: unterminated processing instruction');
			position = end + 2;
			continue;
		}
		if (xml.startsWith('<!', tagStart)) {
			const end = xml.indexOf('>', tagStart + 2);
			if (end === -1) throw new Error('Malformed XML: unterminated declaration');
			position = end + 1;
			continue;
		}

		// Find the end of the tag, respecting quoted attribute values
		let tagEnd = tagStart + 1;
		let quote: string | null = null;
		while (tagEnd < length) {
			const char = xml[tagEnd];
			if (quote) {
				if (char === quote) quote = null;
			} else if (char === '"' || char === "'") {
				quote = char;
			} else if (char === '>') {
				break;
			}
			tagEnd++;
		}
		if (tagEnd >= length) throw new Error('Malformed XML: unterminated tag');

		const inner = xml.slice(tagStart + 1, tagEnd);
		position = tagEnd + 1;

		if (inner[0] === '/') {
			const name = inner.slice(1).trim();
			if (stack.length <= 1 || current().name !== name) {
				throw new Error(`Malformed XML: unexpected closing tag </${name}>`);
			}
			stack.pop();
			continue;
		}

		const selfClosing = inner.endsWith('/');
		const body = selfClosing ? inner.slice(0, -1) : inner;
		const nameMatch = /^[^\s/>]+/.exec(body);
		if (!nameMatch) throw new Error('Malformed XML: missing tag name');
		const element: XmlElement = {
			name: nameMatch[0],
			attributes: parseAttributes(body.slice(nameMatch[0].length)),
			children: [],
			text: '',
		};
		current().children.push(element);
		if (!selfClosing) stack.push(element);
	}

	if (stack.length > 1) {
		throw new Error(`Malformed XML: unclosed tag <${current().name}>`);
	}

	const documentElement = root.children[0];
	if (!documentElement) throw new Error('Malformed XML: no root element');
	return documentElement;
}

/** Elements whose children always form a list, even if there is only one child. */
const LIST_CONTAINERS = new Set([
	'attendees',
	'breakoutRooms',
	'hooks',
	'images',
	'meetings',
	'playback',
	'recordings',
]);

/** Elements whose content is never converted to booleans/numbers. */
const STRING_KEYS = new Set([
	'attendeePW',
	'callbackURL',
	'clientType',
	'createDate',
	'dialNumber',
	'externalMeetingID',
	'externalUserID',
	'fullName',
	'internalMeetingID',
	'meetingID',
	'meetingName',
	'message',
	'messageKey',
	'moderatorPW',
	'name',
	'parentMeetingID',
	'recordID',
	'userID',
	'voiceBridge',
	'welcome',
]);

/** Elements whose children are free-form key/value pairs (kept as plain strings). */
const STRING_MAPS = new Set(['metadata', 'customdata', 'userdata']);

function coerce(key: string, value: string): string | number | boolean {
	if (STRING_KEYS.has(key)) return value;
	if (value === 'true') return true;
	if (value === 'false') return false;
	if (/^-?(0|[1-9]\d{0,14})$/.test(value)) return Number(value);
	return value;
}

function elementToValue(element: XmlElement, stringsOnly = false): unknown {
	const hasAttributes = Object.keys(element.attributes).length > 0;
	const text = element.text.trim();

	if (LIST_CONTAINERS.has(element.name)) {
		return element.children.map((child) => elementToValue(child, stringsOnly));
	}

	if (element.children.length === 0) {
		const value = stringsOnly ? text : coerce(element.name, text);
		if (!hasAttributes) return value;
		const result: IDataObject = {};
		for (const [key, attributeValue] of Object.entries(element.attributes)) {
			result[key] = stringsOnly ? attributeValue : coerce(key, attributeValue);
		}
		if (text !== '') result.value = value;
		return result;
	}

	const childrenAsStrings = stringsOnly || STRING_MAPS.has(element.name);
	const result: IDataObject = {};
	for (const [key, attributeValue] of Object.entries(element.attributes)) {
		result[key] = childrenAsStrings ? attributeValue : coerce(key, attributeValue);
	}
	for (const child of element.children) {
		const value = elementToValue(child, childrenAsStrings) as IDataObject[keyof IDataObject];
		if (child.name in result) {
			const existing = result[child.name];
			if (Array.isArray(existing)) {
				(existing as unknown[]).push(value);
			} else {
				result[child.name] = [existing, value] as IDataObject[];
			}
		} else {
			result[child.name] = value;
		}
	}
	return result;
}

/** Converts a BigBlueButton XML response into a plain JSON object. */
export function xmlToJson(xml: string): IDataObject {
	const element = parseXml(xml);
	const value = elementToValue(element);
	if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
		return value as IDataObject;
	}
	return { [element.name]: value as IDataObject[keyof IDataObject] };
}
