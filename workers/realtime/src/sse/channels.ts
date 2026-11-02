/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Which streams a connection asked for (`05 §4.3`).
 *
 * `GET /rt/stream?channels=order:UND-7K2M9QX4,rider:self` is the whole grammar. It is small on
 * purpose: a channel is a kind and an id, the kinds are a closed set, and the count is capped so one
 * request cannot ask a Worker to fan out to a thousand rooms. Anything outside the grammar is refused
 * with a `VALIDATION_` code rather than ignored, because an ignored channel is a client that believes
 * it is subscribed and is not.
 */

/** The most channels one stream may carry. */
export const MAX_CHANNELS = 8;

/** The longest id a channel may name. */
export const MAX_CHANNEL_ID_LENGTH = 64;

/** The channel kinds the platform knows. */
export const CHANNEL_KINDS = ["order", "rider", "vendor", "zone", "admin"] as const;

/** A channel kind. */
export type ChannelKind = (typeof CHANNEL_KINDS)[number];

/** One requested channel. */
export interface Channel {
  readonly kind: ChannelKind;
  readonly id: string;
}

/** The id shape: no whitespace, no separators that would break the query string. */
const CHANNEL_ID = /^[A-Za-z0-9_.:-]+$/u;

/** The kinds that may be addressed as `self`, meaning "the caller". */
const SELF_KINDS: readonly ChannelKind[] = ["rider", "vendor", "admin"];

/** A channel as it appears in a map key or a log line. */
export function channelKey(channel: Channel): string {
  return `${channel.kind}:${channel.id}`;
}

/** Whether a value is one of the known kinds. */
export function isChannelKind(value: string): value is ChannelKind {
  return (CHANNEL_KINDS as readonly string[]).includes(value);
}

/**
 * Parse the `channels` parameter.
 *
 * `undefined` and the empty string are both "nothing asked for" and both refuse: a stream with no
 * channels would connect, send keepalives forever and carry nothing, which is a bug that looks like a
 * healthy connection.
 */
export function parseChannels(raw: string | null): readonly Channel[] {
  if (raw === null || raw.trim() === "") {
    throw new RangeError("channels is required");
  }
  const parts = raw.split(",").map((part) => part.trim()).filter((part) => part !== "");
  if (parts.length === 0) throw new RangeError("channels is required");
  if (parts.length > MAX_CHANNELS) {
    throw new RangeError(`at most ${String(MAX_CHANNELS)} channels per stream, got ${String(parts.length)}`);
  }
  const seen = new Set<string>();
  const channels: Channel[] = [];
  for (const part of parts) {
    const separator = part.indexOf(":");
    if (separator <= 0 || separator === part.length - 1) {
      throw new RangeError(`not a channel: ${part}`);
    }
    const kind = part.slice(0, separator);
    const id = part.slice(separator + 1);
    if (!isChannelKind(kind)) throw new RangeError(`not a channel kind: ${kind}`);
    if (id.length > MAX_CHANNEL_ID_LENGTH || !CHANNEL_ID.test(id)) {
      throw new RangeError(`not a channel id: ${id}`);
    }
    if (id === "self" && !SELF_KINDS.includes(kind)) {
      throw new RangeError(`${kind}:self is not a channel a caller can address`);
    }
    const channel: Channel = { kind, id };
    const key = channelKey(channel);
    if (seen.has(key)) throw new RangeError(`duplicate channel: ${key}`);
    seen.add(key);
    channels.push(channel);
  }
  return channels;
}
