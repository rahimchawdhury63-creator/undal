/// Config-driven environment & pluggable HTTP transport for `apps/customer_app` (`Build Response 12`).
///
/// All endpoints resolve from `--dart-define` GitHub Repository Variables (`UNDAL_API_BASE_URL`,
/// `UNDAL_REALTIME_BASE_URL`, `UNDAL_SUPABASE_URL`, `UNDAL_SUPABASE_ANON_KEY`) with zero secrets
/// embedded in Dart or APK binaries (`Decision D-03` & `24-github-actions-cicd-secrets.md`).
library;

import 'dart:convert';
import 'dart:io';

/// Compile-time environment configuration supplied via `--dart-define` in CI release workflows.
final class CustomerAppConfig {
  /// Constructs an immutable [CustomerAppConfig].
  const CustomerAppConfig({
    this.apiBaseUrl = const String.fromEnvironment('UNDAL_API_BASE_URL'),
    this.realtimeBaseUrl =
        const String.fromEnvironment('UNDAL_REALTIME_BASE_URL'),
    this.supabaseUrl = const String.fromEnvironment('UNDAL_SUPABASE_URL'),
    this.supabaseAnonKey =
        const String.fromEnvironment('UNDAL_SUPABASE_ANON_KEY'),
    this.firebaseWebApiKey =
        const String.fromEnvironment('UNDAL_FIREBASE_WEB_API_KEY'),
    this.appEnv =
        const String.fromEnvironment('UNDAL_APP_ENV', defaultValue: 'local'),
    this.enableNetworkOsmTiles = const bool.fromEnvironment(
      'UNDAL_OSM_TILES_ENABLED',
      defaultValue: true,
    ),
  });

  /// `W1 undal-api` base URL (e.g. `https://api.undal.app`). Empty in offline/CI runs.
  final String apiBaseUrl;

  /// `W2 undal-realtime` base URL (e.g. `https://rt.undal.app`). Empty in offline/CI runs.
  final String realtimeBaseUrl;

  /// Public Supabase project URL for GoTrue Phone OTP / Email auth.
  final String supabaseUrl;

  /// Public RLS-enforced Supabase anon key (`sb_publishable_*`). Never a secret role key.
  final String supabaseAnonKey;

  /// Firebase public Web API key used only to exchange a W2-minted RTDB custom token for an ID token.
  final String firebaseWebApiKey;

  /// Logical runtime stage (`local`, `staging`, `production`).
  final String appEnv;

  /// Enables fetching `/v1/tiles/{z}/{x}/{y}.png` over network inside `UndalOsmMap`.
  final bool enableNetworkOsmTiles;

  /// True when live Cloudflare Worker endpoints were provided at build time.
  bool get hasLiveWorkers => apiBaseUrl.trim().isNotEmpty;

  /// Effective tile proxy URL passed to `UndalOsmMap`, or `null` in headless tests/offline mode.
  String? get effectiveTileProxyUrl =>
      enableNetworkOsmTiles && hasLiveWorkers ? apiBaseUrl : null;
}

/// Decoded HTTP response envelope returned by [CustomerHttpTransport].
final class CustomerHttpResponse {
  /// Creates an immutable HTTP response snapshot.
  const CustomerHttpResponse({
    required this.statusCode,
    required this.body,
    this.headers = const <String, String>{},
  });

  final int statusCode;
  final Map<String, Object?> body;
  final Map<String, String> headers;

  bool get isOk => statusCode >= 200 && statusCode < 300;
}

/// Pluggable HTTP transport interface allowing live `dart:io` execution and deterministic tests.
abstract interface class CustomerHttpTransport {
  /// Sends an HTTP JSON request and decodes the response body as `Map<String, Object?>`.
  Future<CustomerHttpResponse> sendJson({
    required String method,
    required Uri uri,
    Map<String, String> headers = const <String, String>{},
    Map<String, Object?>? jsonBody,
  });
}

/// Production `dart:io` `HttpClient` JSON transport with strict `8s` timeout.
final class DartIoCustomerHttpTransport implements CustomerHttpTransport {
  /// Creates a transport using standard platform `HttpClient`.
  const DartIoCustomerHttpTransport();

  @override
  Future<CustomerHttpResponse> sendJson({
    required String method,
    required Uri uri,
    Map<String, String> headers = const <String, String>{},
    Map<String, Object?>? jsonBody,
  }) async {
    final HttpClient client = HttpClient()
      ..connectionTimeout = const Duration(seconds: 8);
    try {
      final HttpClientRequest request =
          await client.openUrl(method.toUpperCase(), uri);
      request.headers.set(
        HttpHeaders.acceptHeader,
        ContentType.json.mimeType,
      );
      request.headers.set(
        HttpHeaders.userAgentHeader,
        'UndalCustomerAndroid/0.12.0',
      );
      headers.forEach(request.headers.set);
      if (jsonBody != null) {
        request.headers.contentType = ContentType.json;
        request.add(utf8.encode(jsonEncode(jsonBody)));
      }
      final HttpClientResponse response =
          await request.close().timeout(const Duration(seconds: 8));
      final String raw = await utf8.decodeStream(response);
      if (raw.trim().isEmpty) {
        return CustomerHttpResponse(
          statusCode: response.statusCode,
          body: const <String, Object?>{},
          headers: _responseHeaders(response),
        );
      }
      final Object? decoded = jsonDecode(raw);
      return CustomerHttpResponse(
        statusCode: response.statusCode,
        body: decoded is Map<String, Object?>
            ? decoded
            : <String, Object?>{'items': decoded},
        headers: _responseHeaders(response),
      );
    } finally {
      client.close(force: true);
    }
  }

  Map<String, String> _responseHeaders(HttpClientResponse response) {
    final Map<String, String> result = <String, String>{};
    response.headers.forEach((String name, List<String> values) {
      result[name.toLowerCase()] = values.join(',');
    });
    return result;
  }
}
