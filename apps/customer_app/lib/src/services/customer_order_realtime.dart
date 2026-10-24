/// Lease-aware Firebase RTDB SSE client for one active customer order (`Build Response 15`).
///
/// The client receives a short-lived W2-minted Firebase custom token, exchanges it using the public
/// Web API key, listens only on the participant-authorized order path, and can be closed promptly.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import '../config/app_config.dart';
import '../models/customer_experience_models.dart';

/// Opens one authenticated Firebase RTDB event stream and decodes compact order-room snapshots.
final class CustomerOrderRealtimeClient {
  /// Creates a client using only configured public Firebase project data and a W2 custom token.
  CustomerOrderRealtimeClient({
    required CustomerAppConfig config,
    required CustomerHttpTransport transport,
  })  : _config = config,
        _transport = transport;

  final CustomerAppConfig _config;
  final CustomerHttpTransport _transport;
  HttpClient? _httpClient;
  StreamSubscription<String>? _lineSubscription;
  StreamController<Map<String, Object?>>? _eventController;
  Timer? _keepAlive;

  /// Authenticates and connects to `o/{orderId}`; throws to activate W1 polling fallback.
  Future<Stream<Map<String, Object?>>> connect({
    required String customToken,
    required String databaseUrl,
    required String databasePath,
  }) async {
    if (_config.firebaseWebApiKey.trim().isEmpty) {
      throw const FormatException('FIREBASE_WEB_API_KEY_MISSING');
    }
    final CustomerHttpResponse tokenResponse = await _transport.sendJson(
      method: 'POST',
      uri: Uri.parse('https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken')
          .replace(queryParameters: <String, String>{'key': _config.firebaseWebApiKey}),
      jsonBody: <String, Object?>{'token': customToken, 'returnSecureToken': true},
    );
    final Object? idToken = tokenResponse.body['idToken'];
    if (!tokenResponse.isOk || idToken is! String || idToken.isEmpty) {
      throw const FormatException('FIREBASE_CUSTOM_TOKEN_EXCHANGE_FAILED');
    }

    final String cleanPath = databasePath.split('/').where((String p) => p.isNotEmpty)
        .map(Uri.encodeComponent).join('/');
    final Uri uri = Uri.parse('${databaseUrl.replaceFirst(RegExp(r'/$'), '')}/$cleanPath.json')
        .replace(queryParameters: <String, String>{'auth': idToken});
    final HttpClient client = HttpClient()..connectionTimeout = const Duration(seconds: 8);
    final HttpClientRequest request = await client.getUrl(uri);
    request.headers.set(HttpHeaders.acceptHeader, 'text/event-stream');
    request.headers.set(HttpHeaders.cacheControlHeader, 'no-cache');
    final HttpClientResponse response = await request.close().timeout(const Duration(seconds: 12));
    if (response.statusCode != HttpStatus.ok) {
      client.close(force: true);
      throw FormatException('FIREBASE_STREAM_HTTP_${response.statusCode}');
    }

    await close();
    _httpClient = client;
    _eventController = StreamController<Map<String, Object?>>.broadcast();
    final RtdbSseDecoder decoder = RtdbSseDecoder();
    _lineSubscription = response.transform(utf8.decoder).transform(const LineSplitter()).listen(
      (String line) {
        final Map<String, Object?>? event = decoder.addLine(line);
        if (event != null && !_eventController!.isClosed) _eventController!.add(event);
      },
      onError: (Object error, StackTrace stack) {
        if (!_eventController!.isClosed) _eventController!.addError(error, stack);
      },
      onDone: () {
        if (!_eventController!.isClosed) _eventController!.addError(const SocketException('RTDB stream ended'));
      },
      cancelOnError: false,
    );
    _keepAlive = Timer(const Duration(minutes: 14), () => unawaited(close()));
    return _eventController!.stream;
  }

  /// Closes the HTTP stream, response subscription, and token-expiry timer.
  Future<void> close() async {
    _keepAlive?.cancel();
    _keepAlive = null;
    await _lineSubscription?.cancel();
    _lineSubscription = null;
    final StreamController<Map<String, Object?>>? controller = _eventController;
    _eventController = null;
    if (controller != null && !controller.isClosed) await controller.close();
    _httpClient?.close(force: true);
    _httpClient = null;
  }
}

/// Decodes newline-delimited Firebase `put` and `patch` SSE events into small JSON maps.
final class RtdbSseDecoder {
  String _eventType = '';
  final StringBuffer _data = StringBuffer();

  /// Consumes one SSE line and returns a parsed event after a blank-line separator.
  Map<String, Object?>? addLine(String line) {
    if (line.startsWith('event:')) {
      _eventType = line.substring(6).trim();
      return null;
    }
    if (line.startsWith('data:')) {
      if (_data.isNotEmpty) _data.write('\n');
      _data.write(line.substring(5).trimLeft());
      return null;
    }
    if (line.isNotEmpty) return null;
    final String raw = _data.toString();
    final String type = _eventType;
    _data.clear();
    _eventType = '';
    if (raw.isEmpty || (type != 'put' && type != 'patch')) return null;
    try {
      final Object? decoded = jsonDecode(raw);
      if (decoded is! Map<String, Object?>) return null;
      final Object? data = decoded['data'];
      return <String, Object?>{
        'event': decoded['path'] is String ? decoded['path'] : '/',
        'type': type,
        'data': data,
      };
    } on FormatException {
      return null;
    }
  }
}
