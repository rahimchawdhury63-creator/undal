/// Config-driven Worker and Supabase public settings for the Partner app.
///
/// Values are supplied by GitHub Actions `--dart-define`; the APK contains no service-role,
/// Cloudinary, ImgBB, payout-key, or other server secrets.
library;

import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

/// Immutable public build configuration (`UNDAL_*` repository variables only).
final class PartnerAppConfig {
  /// Creates a configuration from public build-time variables or explicit test overrides.
  const PartnerAppConfig({
    this.apiBaseUrl = const String.fromEnvironment('UNDAL_API_BASE_URL'),
    this.realtimeBaseUrl = const String.fromEnvironment('UNDAL_REALTIME_BASE_URL'),
    this.supabaseUrl = const String.fromEnvironment('UNDAL_SUPABASE_URL'),
    this.supabaseAnonKey = const String.fromEnvironment('UNDAL_SUPABASE_ANON_KEY'),
    this.appEnv = const String.fromEnvironment('UNDAL_APP_ENV', defaultValue: 'production'),
    this.enableNetworkOsmTiles = const bool.fromEnvironment('UNDAL_OSM_TILES_ENABLED', defaultValue: true),
  });

  /// Configured W1 Worker base URL, for example `https://api.undal.app`.
  final String apiBaseUrl;

  /// Configured W2 Worker base URL for privacy-cached geocoding search.
  final String realtimeBaseUrl;

  /// Public Supabase project URL used only for GoTrue user authentication.
  final String supabaseUrl;

  /// Public RLS-enforced Supabase anon/publishable key; never a secret service key.
  final String supabaseAnonKey;

  /// Logical environment label displayed in the app's configuration warning.
  final String appEnv;

  /// Enables W1-proxied OSM map tiles when the API endpoint is configured.
  final bool enableNetworkOsmTiles;

  /// Reports whether the W1 onboarding API is configured.
  bool get hasApi => apiBaseUrl.trim().isNotEmpty;

  /// Reports whether Supabase GoTrue can authenticate a Partner account.
  bool get hasAuth => supabaseUrl.trim().isNotEmpty && supabaseAnonKey.trim().isNotEmpty;

  /// Returns the configured API base URL for map tile proxying, or null when disabled.
  String? get tileProxyBaseUrl => hasApi && enableNetworkOsmTiles ? apiBaseUrl.trim() : null;
}

/// JSON response snapshot returned by [PartnerHttpTransport].
final class PartnerHttpResponse {
  /// Creates a decoded HTTP response.
  const PartnerHttpResponse({required this.statusCode, required this.body});

  /// HTTP status received from the Worker or Supabase Auth endpoint.
  final int statusCode;

  /// Decoded JSON object; non-object JSON is represented under `items`.
  final Map<String, Object?> body;

  /// True for HTTP success responses.
  bool get isOk => statusCode >= 200 && statusCode < 300;
}

/// Injectable JSON transport for production requests and deterministic app tests.
abstract interface class PartnerHttpTransport {
  /// Sends a JSON request to [uri], preserving caller authorization/idempotency headers.
  Future<PartnerHttpResponse> sendJson({
    required String method,
    required Uri uri,
    Map<String, String> headers = const <String, String>{},
    Map<String, Object?>? jsonBody,
  });
}

/// Production `dart:io` transport with bounded connection and response timeouts.
abstract interface class PartnerMultipartTransport {
  /// Sends file bytes and Cloudinary ticket fields as a private upload request.
  Future<Map<String, Object?>> upload({
    required Uri uri,
    required Map<String, String> fields,
    required List<int> bytes,
    required String filename,
    required String contentType,
  });
}

/// Production multipart transport for signed Cloudinary authenticated uploads.
final class DartIoPartnerMultipartTransport implements PartnerMultipartTransport {
  /// Creates a multipart uploader with bounded connection and response timeouts.
  const DartIoPartnerMultipartTransport();

  @override
  Future<Map<String, Object?>> upload({
    required Uri uri,
    required Map<String, String> fields,
    required List<int> bytes,
    required String filename,
    required String contentType,
  }) async {
    final String boundary = 'undal-${DateTime.now().microsecondsSinceEpoch}-${math.Random.secure().nextInt(1 << 32)}';
    final HttpClient client = HttpClient()..connectionTimeout = const Duration(seconds: 8);
    try {
      final HttpClientRequest request = await client.postUrl(uri);
      request.headers.contentType = ContentType('multipart', 'form-data', parameters: <String, String>{'boundary': boundary});
      for (final MapEntry<String, String> field in fields.entries) {
        request.add(utf8.encode('--$boundary\r\nContent-Disposition: form-data; name="${field.key}"\r\n\r\n${field.value}\r\n'));
      }
      final String safeName = filename.replaceAll('"', '_').replaceAll('\\', '_').replaceAll('/', '_').replaceAll('\r', '_').replaceAll('\n', '_');
      request.add(utf8.encode('--$boundary\r\nContent-Disposition: form-data; name="file"; filename="$safeName"\r\nContent-Type: $contentType\r\n\r\n'));
      request.add(bytes);
      request.add(utf8.encode('\r\n--$boundary--\r\n'));
      final HttpClientResponse response = await request.close().timeout(const Duration(seconds: 30));
      final String raw = await utf8.decodeStream(response);
      final Object? decoded = raw.trim().isEmpty ? <String, Object?>{} : jsonDecode(raw);
      if (response.statusCode < 200 || response.statusCode >= 300 || decoded is! Map<String, Object?>) {
        throw HttpException('PRIVATE_UPLOAD_FAILED_${response.statusCode}');
      }
      return decoded;
    } finally {
      client.close(force: true);
    }
  }
}

/// Production `dart:io` transport with bounded connection and response timeouts.
final class DartIoPartnerHttpTransport implements PartnerHttpTransport {
  /// Creates a transport backed by the platform `HttpClient`.
  const DartIoPartnerHttpTransport();

  @override
  Future<PartnerHttpResponse> sendJson({
    required String method,
    required Uri uri,
    Map<String, String> headers = const <String, String>{},
    Map<String, Object?>? jsonBody,
  }) async {
    final HttpClient client = HttpClient()..connectionTimeout = const Duration(seconds: 8);
    try {
      final HttpClientRequest request = await client.openUrl(method.toUpperCase(), uri);
      request.headers.set(HttpHeaders.acceptHeader, ContentType.json.mimeType);
      request.headers.set(HttpHeaders.userAgentHeader, 'UndalPartnerAndroid/0.16.0');
      headers.forEach(request.headers.set);
      if (jsonBody != null) {
        request.headers.contentType = ContentType.json;
        request.add(utf8.encode(jsonEncode(jsonBody)));
      }
      final HttpClientResponse response = await request.close().timeout(const Duration(seconds: 12));
      final String raw = await utf8.decodeStream(response);
      if (raw.trim().isEmpty) return PartnerHttpResponse(statusCode: response.statusCode, body: const <String, Object?>{});
      final Object? decoded = jsonDecode(raw);
      return PartnerHttpResponse(
        statusCode: response.statusCode,
        body: decoded is Map<String, Object?> ? decoded : <String, Object?>{'items': decoded},
      );
    } finally {
      client.close(force: true);
    }
  }
}
