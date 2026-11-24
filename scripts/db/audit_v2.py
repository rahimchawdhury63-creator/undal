"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

Independent byte-level reference for the proposed audit v2 format. This module does
not read or write a database, establish an anchor, or verify a legacy audit chain.
"""
from __future__ import annotations

import datetime
import hashlib
import json
import re

MAX_BYTES = 65_536
MAX_STRING_BYTES = 8_192
MAX_NODES = 2_048
MAX_DEPTH = 16
MAX_INTEGER = 9_007_199_254_740_991
ACTORS = {"ADMIN", "VENDOR", "RIDER", "CUSTOMER", "SYSTEM"}
SEVERITIES = {"INFO", "NOTICE", "WARNING", "CRITICAL"}
RECORD_KEYS = {"id", "seq", "occurredAt", "actorId", "actorType", "actorRole", "ip", "userAgent", "requestId",
               "action", "resourceType", "resourceId", "subjectId", "before", "after", "reason", "severity"}
MAX_JSON_BYTES = 400_000


def parse_audit_v2_json(source: str) -> object:
    """Parse raw JSON without converting decimal or oversized number tokens first.

    This deliberately accepts a narrower subset than JSON: every number must be a
    safe integer, negative zero and duplicate keys are refused, and all strings must
    be valid Unicode scalar strings. Pass the original text, not ``json.loads`` output.
    """
    if type(source) is not str or len(source) > MAX_JSON_BYTES:
        raise ValueError("invalid or oversized audit v2 JSON source")
    try:
        encoded_source = source.encode("utf-8", errors="strict")
    except UnicodeEncodeError as error:
        raise ValueError("invalid audit v2 JSON Unicode") from error
    if len(encoded_source) > MAX_JSON_BYTES:
        raise ValueError("audit v2 JSON too large")

    def integer_token(token: str) -> int:
        digits = token[1:] if token.startswith("-") else token
        if token == "-0" or len(digits) > 16:
            raise ValueError("audit v2 JSON integer out of range")
        result = int(token)
        if abs(result) > MAX_INTEGER:
            raise ValueError("audit v2 JSON integer out of range")
        return result

    def unsupported_number(_token: str) -> object:
        raise ValueError("audit v2 JSON numbers must be safe integers")

    def unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
        result: dict[str, object] = {}
        for key, value in pairs:
            _text(key, MAX_STRING_BYTES)
            if key in result:
                raise ValueError("duplicate audit v2 JSON object key")
            result[key] = value
        return result

    try:
        parsed = json.loads(source, parse_int=integer_token, parse_float=unsupported_number,
                            parse_constant=unsupported_number, object_pairs_hook=unique_object)
    except (json.JSONDecodeError, RecursionError) as error:
        raise ValueError("invalid audit v2 JSON syntax or nesting") from error

    nodes = 0

    def check(value: object, depth: int) -> None:
        nonlocal nodes
        nodes += 1
        if nodes > MAX_NODES or depth > MAX_DEPTH:
            raise ValueError("audit v2 JSON too complex")
        if value is None or type(value) is bool:
            return
        if type(value) is int:
            if abs(value) > MAX_INTEGER:
                raise ValueError("audit v2 JSON integer out of range")
            return
        if type(value) is str:
            _text(value, MAX_STRING_BYTES)
            return
        if type(value) is list:
            for child in value:
                check(child, depth + 1)
            return
        if type(value) is dict:
            for key, child in value.items():
                nodes += 1  # Object keys count as values in the canonical grammar.
                if nodes > MAX_NODES or depth + 1 > MAX_DEPTH:
                    raise ValueError("audit v2 JSON too complex")
                _text(key, MAX_STRING_BYTES)
                check(child, depth + 1)
            return
        raise ValueError("invalid audit v2 JSON value")

    check(parsed, 0)
    encode_value(parsed)  # Apply the exact canonical byte-size and structural limits.
    return parsed


def _text(value: object, limit: int, nullable: bool = False) -> str | None:
    if value is None and nullable:
        return None
    if type(value) is not str or len(value) > limit:
        raise ValueError("invalid audit v2 text")
    try:
        data = value.encode("utf-8", errors="strict")
    except UnicodeEncodeError as error:
        raise ValueError("invalid audit v2 Unicode") from error
    if len(data) > MAX_STRING_BYTES:
        raise ValueError("audit v2 text too large")
    return value


def _binary(value: object, sizes: tuple[int, ...], nullable: bool = False) -> str | None:
    if value is None and nullable:
        return None
    if type(value) is not bytes or len(value) not in sizes:
        raise ValueError("invalid audit v2 binary value")
    return value.hex()


def _timestamp(value: object) -> str:
    result = _text(value, 26)
    if result is None or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}", result):
        raise ValueError("invalid audit v2 timestamp")
    try:
        parsed = datetime.datetime.strptime(result, "%Y-%m-%d %H:%M:%S.%f")
    except ValueError as error:
        raise ValueError("invalid audit v2 timestamp") from error
    if parsed.year < 1000:
        raise ValueError("invalid audit v2 timestamp")
    return result


def encode_value(value: object) -> bytes:
    """Encode the documented bounded byte grammar, ordering object keys by UTF-8."""
    chunks: list[bytes] = []
    seen: set[int] = set()
    size = nodes = 0

    def add(data: bytes) -> None:
        nonlocal size
        size += len(data)
        if size > MAX_BYTES:
            raise ValueError("audit v2 payload too large")
        chunks.append(data)

    def visit(item: object, depth: int) -> None:
        nonlocal nodes
        nodes += 1
        if nodes > MAX_NODES or depth > MAX_DEPTH:
            raise ValueError("audit v2 payload too complex")
        if item is None:
            add(b"n")
        elif isinstance(item, bool):
            add(b"t" if item else b"f")
        elif type(item) is int:
            if abs(item) > MAX_INTEGER:
                raise ValueError("invalid audit v2 integer")
            add(f"i{item};".encode("ascii"))
        elif type(item) is str:
            data = _text(item, MAX_STRING_BYTES).encode("utf-8")
            add(f"s{len(data)}:".encode("ascii"))
            add(data)
        elif type(item) in (list, dict):
            if id(item) in seen:
                raise ValueError("invalid audit v2 value")
            if len(item) > MAX_NODES:
                raise ValueError("audit v2 payload too complex")
            seen.add(id(item))
            try:
                if type(item) is list:
                    add(f"a{len(item)}:".encode("ascii"))
                    for child in item:
                        visit(child, depth + 1)
                else:
                    keys = list(item)
                    for key in keys:
                        _text(key, MAX_STRING_BYTES)
                    keys.sort(key=lambda key: key.encode("utf-8"))
                    add(f"o{len(keys)}:".encode("ascii"))
                    for key in keys:
                        visit(key, depth + 1)
                        visit(item[key], depth + 1)
            finally:
                seen.remove(id(item))
        else:
            raise ValueError("invalid audit v2 value")

    visit(value, 0)
    return b"".join(chunks)


def payload(record: dict) -> bytes:
    """Encode the proposed persisted values; binary fields are bytes, not UUID strings."""
    if type(record) is not dict or set(record) != RECORD_KEYS:
        raise ValueError("invalid audit v2 record")
    seq = record["seq"]
    if isinstance(seq, bool) or type(seq) is not int or not 1 <= seq <= MAX_INTEGER:
        raise ValueError("invalid audit v2 sequence")
    if type(record["actorType"]) is not str or type(record["severity"]) is not str or record["actorType"] not in ACTORS or record["severity"] not in SEVERITIES:
        raise ValueError("invalid audit v2 classification")
    return encode_value([
        "undal.audit.v2", _binary(record["id"], (16,)), seq, _timestamp(record["occurredAt"]),
        _binary(record["actorId"], (16,), True), record["actorType"], _text(record["actorRole"], 48, True),
        _binary(record["ip"], (4, 16), True), _text(record["userAgent"], 512, True), _binary(record["requestId"], (16,)),
        _text(record["action"], 64), _text(record["resourceType"], 48), _text(record["resourceId"], 64, True),
        _binary(record["subjectId"], (16,), True), record["before"], record["after"], _text(record["reason"], 512, True),
        record["severity"],
    ])


def hashes(record: dict, previous: bytes | None) -> tuple[bytes, bytes]:
    """Compute domain-separated payload and link hashes; genesis is explicitly tagged."""
    encoded = payload(record)
    if ((record["seq"] == 1 and previous is not None) or (record["seq"] != 1 and previous is None) or
            (previous is not None and (type(previous) is not bytes or len(previous) != 32))):
        raise ValueError("invalid audit v2 predecessor")
    prior = b"\x00" if previous is None else b"\x01" + previous
    digest = hashlib.sha256(b"undal.audit.payload.v2\x00" + encoded).digest()
    return digest, hashlib.sha256(b"undal.audit.link.v2\x00" + prior + digest).digest()
