# n8n-nodes-bigbluebutton

This is an [n8n](https://n8n.io/) community node package for the [BigBlueButton API](https://docs.bigbluebutton.org/development/api/). It lets you create and manage BigBlueButton meetings, generate join links, manage recordings and react to live meeting events in your n8n workflows.

[BigBlueButton](https://bigbluebutton.org/) is an open source web conferencing system for online learning.

[Installation](#installation) · [Nodes & Operations](#nodes--operations) · [Credentials](#credentials) · [Compatibility](#compatibility) · [Usage](#usage) · [Development](#development) · [Resources](#resources)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation.

In short: **Settings → Community Nodes → Install** and enter `n8n-nodes-bigbluebutton`.

The package has **no runtime dependencies** (checksums use Node's built-in `crypto`, XML responses are parsed by a small built-in parser).

## Nodes & Operations

### BigBlueButton (action node)

| Resource | Operation | API call |
| --- | --- | --- |
| Meeting | Create | `create` – all documented parameters, metadata (`meta_*`), presentations by URL **or from binary data**, `clientSettingsOverride`, custom parameters |
| Meeting | End | `end` |
| Meeting | Get | `getMeetingInfo` |
| Meeting | Get Join URL | builds a signed `join` URL locally (role, avatar, `userdata-*`, …). Optionally executes the join with `redirect=false` and returns session token + client URL |
| Meeting | Get Many | `getMeetings` (one item per meeting) |
| Meeting | Insert Document | `insertDocument` – URL or binary uploads into a running meeting |
| Meeting | Is Running | `isMeetingRunning` |
| Meeting | Send Chat Message | `sendChatMessage` (BBB 3.0+) |
| Recording | Get Many | `getRecordings` – filter by meeting IDs, record IDs, states, metadata; limit/offset |
| Recording | Publish / Unpublish | `publishRecordings` |
| Recording | Update | `updateRecordings` (metadata; empty value removes a key) |
| Recording | Delete | `deleteRecordings` |
| Recording | Get Text Tracks | `getRecordingTextTracks` |
| Recording | Upload Text Track | `putRecordingTextTrack` (SRT, SSA/ASS, WebVTT from binary data) |
| Recording | Delete Text Track | `putRecordingTextTrack` without file |
| Webhook | Create / Delete / Get Many | `hooks/create`, `hooks/destroy`, `hooks/list` (requires [bbb-webhooks](https://docs.bigbluebutton.org/development/webhooks/)) |

The node is marked as `usableAsTool`, so it can be used as a tool by n8n AI agents.

### BigBlueButton Trigger

Starts a workflow on BigBlueButton events such as `meeting-created`, `meeting-ended`, `user-joined`, `user-left`, `rap-publish-ended` (recording published), `chat-group-message-sent`, … (all events emitted by bbb-webhooks are selectable).

- The webhook is **registered automatically** via `hooks/create` when the workflow is activated and removed via `hooks/destroy` when it is deactivated.
- Optional filter by meeting ID; the event filter is passed to the server (`eventID`, BBB 2.5+) and additionally applied locally.
- **Signature verification** (enabled by default): requests must carry a valid `checksum` (`sha(callbackURL + body + sharedSecret)`, SHA-1/256/384/512 auto-detected) or `Authorization: Bearer <sharedSecret>` (bbb-webhooks `auth2_0` mode). Invalid requests get HTTP 401.
- Output is simplified by default (`event`, `meetingID`, `internalMeetingID`, `attributes`, `timestamp`, …). Disable *Simplify* to get the original payload, or enable *Raw Data* for the raw internal messages.

Requirements: the [bbb-webhooks](https://docs.bigbluebutton.org/development/webhooks/) package must be installed on the BigBlueButton server and the server must be able to reach your n8n webhook URL. Load balancers such as Scalelite do not proxy the hooks API.

## Credentials

Create a **BigBlueButton API** credential:

| Field | Description |
| --- | --- |
| Server URL | The URL printed by `bbb-conf --secret`, e.g. `https://bbb.example.com/bigbluebutton/`. `/bigbluebutton/api` is appended automatically when missing; Scalelite URLs work as well. |
| Shared Secret | The secret printed by `bbb-conf --secret` (`securitySalt` in `bbb-web.properties`). |
| Checksum Algorithm | SHA-1, SHA-256 (default), SHA-384 or SHA-512. Must be allowed by `supportedChecksumAlgorithms` on the server. |

Run on the BigBlueButton server:

```bash
sudo bbb-conf --secret
```

The credential test calls `getMeetings` and reports wrong secrets (`checksumError`) explicitly.

## Compatibility

- n8n: tested with n8n 2.x (`n8nNodesApiVersion: 1`, Node.js 20+)
- BigBlueButton: 2.4 – 3.0 and the 4.0 API documentation. Parameters introduced in newer versions are marked with the version in the parameter description; unknown parameters are ignored by older servers. Calls a server does not provide (e.g. `sendChatMessage` before 3.0 or behind Scalelite) produce a clear error message.
- Deprecated parameters (`attendeePW`, `moderatorPW`, `password`) are still available for old servers but hidden under *Additional Fields*; use the role on *Get Join URL* instead.
- Need a parameter that is not listed? Use **Custom Parameters** on *Create* and *Get Join URL* to send any raw API parameter.

## Usage

**Create a meeting and send personalised join links**

1. *BigBlueButton → Meeting → Create* (meeting ID e.g. `{{ $json.courseId }}`, name, welcome message, record, …)
2. *BigBlueButton → Meeting → Get Join URL* per participant (role `Moderator`/`Viewer`, full name, optional `Create Time` from step 1 so the link only works for this meeting instance)
3. Send the `url` via e-mail/chat.

> The join URL contains a checksum signed with your shared secret. It is safe to hand out to the respective user, but treat it like a personal access link.

**Upload a presentation from another node**: use *Presentations → From Binary Data* on *Create* or *Insert Document* and enter the binary field name (e.g. `data`). Keep the server's 2 MB request body limit in mind for inline uploads; for large files, prefer *From URL*.

**Recording workflow**: set *Recording Ready Callback URL* on *Create* to an n8n webhook URL, or use the *BigBlueButton Trigger* with the event `rap-publish-ended`, then use *Recording → Get Many* filtered by meeting ID.

## Development

```bash
npm install
npm run build
npm run lint
npm test
```

`npm test` runs unit tests and tests against a local mock server that validates checksums like bbb-web and bbb-webhooks. To additionally run the live tests against a real server (only creates and ends its own test meetings):

```bash
BBB_URL=https://bbb.example.com/bigbluebutton/ BBB_SECRET=yoursecret npm test
```

Run n8n locally with the node loaded and hot reload:

```bash
npm run dev
```

### Releasing

Publishing happens via GitHub Actions with npm provenance (required by n8n for verified community nodes). Bump the version in `package.json` (and `CHANGELOG.md`) and push to `main`: the publish workflow releases every version that is not on npm yet and creates the git tag. Pushing a version tag or running `npm run release` locally works as well. See `.github/workflows/publish.yml` for the one-time npm setup (Trusted Publishing or `NPM_TOKEN` secret).

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [BigBlueButton API documentation](https://docs.bigbluebutton.org/development/api/)
- [BigBlueButton webhooks documentation](https://docs.bigbluebutton.org/development/webhooks/)

## Version history

See [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE)
