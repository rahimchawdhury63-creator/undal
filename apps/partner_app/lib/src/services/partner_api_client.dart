/// Typed Supabase GoTrue + W1 onboarding client for `apps/partner_app`.
///
/// The app never talks to Supabase PostgREST directly. Private uploads use only W1-issued,
/// five-minute Cloudinary authenticated tickets and are bound back to the applicant through W1.
library;

import 'dart:math' as math;

import '../config/partner_app_config.dart';
import '../models/partner_models.dart';

/// Safe API error containing only the public error code and non-sensitive field details.
final class PartnerApiException implements Exception {
  /// Creates an API exception without retaining request bodies or credentials.
  const PartnerApiException(this.code, {this.details = const <String, Object?>{}});

  /// Stable W1 / GoTrue error code.
  final String code;

  /// Sanitized field names and validation reasons returned by the server.
  final Map<String, Object?> details;

  @override
  String toString() => 'PartnerApiException($code)';
}

/// Auth and onboarding repository backed exclusively by configured production endpoints.
final class PartnerApiClient {
  /// Creates the repository with injectable transports for widget and integration tests.
  PartnerApiClient({
    PartnerAppConfig config = const PartnerAppConfig(),
    PartnerHttpTransport http = const DartIoPartnerHttpTransport(),
    PartnerMultipartTransport multipart = const DartIoPartnerMultipartTransport(),
  })  : _config = config,
        _http = http,
        _multipart = multipart;

  final PartnerAppConfig _config;
  final PartnerHttpTransport _http;
  final PartnerMultipartTransport _multipart;
  final math.Random _random = math.Random.secure();

  /// Exposes public configuration for app readiness checks and W1-proxied maps.
  PartnerAppConfig get config => _config;

  /// Authenticates an existing applicant through Supabase GoTrue email/password.
  Future<PartnerSession> signIn({required String email, required String password}) async {
    _requireAuthConfig();
    final PartnerHttpResponse response = await _http.sendJson(
      method: 'POST',
      uri: Uri.parse('${_config.supabaseUrl.replaceFirst(RegExp(r'/+$'), '')}/auth/v1/token?grant_type=password'),
      headers: <String, String>{'apikey': _config.supabaseAnonKey},
      jsonBody: <String, Object?>{'email': email.trim().toLowerCase(), 'password': password},
    );
    if (!response.isOk) throw PartnerApiException(_authErrorCode(response.body));
    return _sessionFromAuth(response.body, email.trim().toLowerCase());
  }

  /// Registers a new applicant through GoTrue and returns a session only when email confirmation is disabled.
  Future<PartnerSession> signUp({required String email, required String password, required String fullName}) async {
    _requireAuthConfig();
    final PartnerHttpResponse response = await _http.sendJson(
      method: 'POST',
      uri: Uri.parse('${_config.supabaseUrl.replaceFirst(RegExp(r'/+$'), '')}/auth/v1/signup'),
      headers: <String, String>{'apikey': _config.supabaseAnonKey},
      jsonBody: <String, Object?>{
        'email': email.trim().toLowerCase(),
        'password': password,
        'data': <String, Object?>{'full_name': fullName.trim()},
      },
    );
    if (!response.isOk) throw PartnerApiException(_authErrorCode(response.body));
    if (response.body['access_token'] is! String) throw const PartnerApiException('EMAIL_CONFIRMATION_REQUIRED');
    return _sessionFromAuth(response.body, email.trim().toLowerCase());
  }

  /// Loads the signed-in profile's private Partner draft, KYC checklist, schedule, and masked payout view.
  Future<Map<String, Object?>?> readApplication(PartnerSession session) async {
    final Map<String, Object?> data = await _request(method: 'GET', path: '/v1/partner/application', session: session);
    final Object? raw = data['application'];
    return raw is Map<String, Object?> ? raw : null;
  }

  /// Loads active cuisine names from the canonical Appendix D taxonomy via W1.
  Future<List<Map<String, Object?>>> listCuisines(PartnerSession session) async {
    final Map<String, Object?> data = await _request(method: 'GET', path: '/v1/partner/cuisines', session: session);
    final Object? raw = data['cuisines'];
    if (raw is! List<Object?>) return <Map<String, Object?>>[];
    return raw.whereType<Map<String, Object?>>().toList(growable: false);
  }

  /// Searches place names through the configured W2 Nominatim proxy, never directly from the app.
  Future<List<Map<String, Object?>>> searchLandmarks(String query) async {
    final String base = _config.realtimeBaseUrl.trim().replaceFirst(RegExp(r'/+$'), '');
    if (base.isEmpty || query.trim().length < 2) return <Map<String, Object?>>[];
    final Uri uri = Uri.parse('$base/v1/geo/search').replace(queryParameters: <String, String>{'q': query.trim()});
    final PartnerHttpResponse response = await _http.sendJson(method: 'GET', uri: uri);
    if (!response.isOk) throw const PartnerApiException('GEO_SEARCH_UNAVAILABLE');
    final Object? envelope = response.body['data'];
    final Map<String, Object?> data = envelope is Map<String, Object?> ? envelope : response.body;
    final Object? raw = data['results'];
    if (raw is! List<Object?>) return <Map<String, Object?>>[];
    return raw.whereType<Map<String, Object?>>().where((Map<String, Object?> row) {
      final Object? lat = row['lat'];
      final Object? lng = row['lng'];
      return lat is num && lng is num && lat.isFinite && lng.isFinite &&
          row['display_name'] is String;
    }).take(8).toList(growable: false);
  }

  /// Resolves a map pin against active service polygons through the authoritative W1 endpoint.
  Future<Map<String, Object?>> resolveZone(PartnerSession session, {required double lat, required double lng}) async {
    final String query = Uri(queryParameters: <String, String>{'lat': lat.toStringAsFixed(6), 'lng': lng.toStringAsFixed(6)}).query;
    return await _request(method: 'GET', path: '/v1/zones/resolve?$query', session: session);
  }

  /// Records owner-bound outside-zone interest without sending the private street address to W1.
  Future<Map<String, Object?>> requestZoneWaitlist(PartnerSession session, Map<String, Object?> values) async {
    return await _request(method: 'POST', path: '/v1/partner/waitlist', session: session, body: values, idempotent: true);
  }

  /// Loads the exact versioned partner terms and server-computed content hash.
  Future<Map<String, Object?>> readAgreement(PartnerSession session) async {
    return await _request(method: 'GET', path: '/v1/partner/application/terms', session: session);
  }

  /// Creates an owner-bound draft after W1 verifies the point lies inside an active service zone.
  Future<Map<String, Object?>> createApplication(PartnerSession session, Map<String, Object?> values) async {
    return await _request(method: 'POST', path: '/v1/partner/application', session: session, body: values, idempotent: true);
  }

  /// Autosaves editable owner-only application fields through W1.
  Future<Map<String, Object?>> patchApplication(PartnerSession session, Map<String, Object?> values) async {
    return await _request(method: 'PATCH', path: '/v1/partner/application', session: session, body: values, idempotent: true);
  }

  /// Saves a complete seven-day schedule validated by W1 against the `4h × 5 days` rule.
  Future<Map<String, Object?>> saveHours(PartnerSession session, List<Map<String, Object?>> hours) async {
    return await _request(method: 'POST', path: '/v1/partner/application/hours', session: session, body: <String, Object?>{'hours': hours}, idempotent: true);
  }

  /// Saves a payout beneficiary after client-side transport encryption by W1's public RSA key.
  Future<Map<String, Object?>> savePayout(
    PartnerSession session, {
    required String method,
    required String holderName,
    required String accountNumber,
  }) async {
    return await _request(method: 'POST', path: '/v1/partner/application/payout', session: session, body: <String, Object?>{
      'method': method,
      'holder_name': holderName,
      'account_number': accountNumber,
    }, idempotent: true);
  }

  /// Uploads one ≤5 MiB KYC file to Cloudinary authenticated storage, then binds its asset id in W1.
  Future<Map<String, Object?>> uploadPrivateDocument(
    PartnerSession session, {
    required String docType,
    required List<int> bytes,
    required String filename,
    String? expiresOn,
    String? issuedOn,
  }) async {
    if (bytes.isEmpty || bytes.length > 5 * 1024 * 1024) throw const PartnerApiException('DOC_TOO_LARGE');
    final String extension = filename.split('.').last.toLowerCase();
    if (!const <String>{'jpg', 'jpeg', 'png', 'pdf'}.contains(extension)) {
      throw const PartnerApiException('VALIDATION_FAILED');
    }
    final String format = extension == 'jpeg' ? 'jpg' : extension;
    final Map<String, Object?> ticketData = await _request(
      method: 'POST',
      path: '/v1/images/private-upload-url',
      session: session,
      body: <String, Object?>{'category': 'vendor_kyc', 'bytes': bytes.length, 'format': format},
      idempotent: true,
    );
    final Object? ticketValue = ticketData['ticket'];
    final Object? assetValue = ticketData['asset_id'];
    if (ticketData['provider'] != 'cloudinary' || ticketData['category'] != 'vendor_kyc' ||
        assetValue is! String || ticketValue is! Map<String, Object?>) {
      throw const PartnerApiException('PRIVATE_UPLOAD_TICKET_INVALID');
    }
    final Map<String, Object?> ticket = ticketValue;
    final String uploadUrl = _ticketString(ticket, 'uploadUrl');
    final Uri uri = Uri.parse(uploadUrl);
    if (uri.scheme != 'https' || uri.host != 'api.cloudinary.com' || ticket['mode'] != 'signed_authenticated' ||
        ticket['resourceType'] != 'image' || ticket['deliveryType'] != 'authenticated') {
      throw const PartnerApiException('PRIVATE_UPLOAD_TICKET_INVALID');
    }
    final int ttl = (ticket['expiresInSeconds'] as num?)?.toInt() ?? 0;
    if (ttl < 1 || ttl > 600) throw const PartnerApiException('PRIVATE_UPLOAD_TICKET_INVALID');
    final Map<String, String> fields = <String, String>{
      'api_key': _ticketString(ticket, 'apiKey'),
      'timestamp': _ticketString(ticket, 'timestamp'),
      'signature': _ticketString(ticket, 'signature'),
      'public_id': _ticketString(ticket, 'publicId'),
      'type': 'authenticated',
      'transformation': 'fl_strip_profile',
    };
    final Map<String, Object?> cloudinary = await _multipart.upload(
      uri: uri,
      fields: fields,
      bytes: bytes,
      filename: filename,
      contentType: format == 'pdf' ? 'application/pdf' : 'image/$format',
    );
    if (cloudinary['public_id'] != fields['public_id'] ||
        (cloudinary['resource_type'] != null && cloudinary['resource_type'] != 'image') ||
        (cloudinary['type'] != null && cloudinary['type'] != 'authenticated')) {
      throw const PartnerApiException('PRIVATE_UPLOAD_ASSET_MISMATCH');
    }
    return await _request(method: 'POST', path: '/v1/partner/application/documents', session: session, body: <String, Object?>{
      'asset_id': assetValue,
      'doc_type': docType,
      if (expiresOn != null) 'expires_on': expiresOn,
      if (issuedOn != null) 'issued_on': issuedOn,
    }, idempotent: true);
  }

  /// Requests a W1-minted, audited short-lived view URL for an owner-bound private KYC asset.
  Future<Map<String, Object?>> privateDocumentViewUrl(PartnerSession session, String assetId) async {
    return await _request(method: 'POST', path: '/v1/images/private-view-url', session: session, body: <String, Object?>{'asset_id': assetId}, idempotent: true);
  }

  /// Sends the final KYC submission request; W1 returns the server's exact incomplete checklist when needed.
  Future<Map<String, Object?>> submitApplication(PartnerSession session) async {
    return await _request(method: 'POST', path: '/v1/partner/application/submit', session: session, body: const <String, Object?>{}, idempotent: true);
  }

  /// Builds one authenticated W1 or GoTrue JSON request and converts failures to safe error codes.
  Future<Map<String, Object?>> _request({
    required String method,
    required String path,
    required PartnerSession session,
    Map<String, Object?>? body,
    bool idempotent = false,
  }) async {
    if (!_config.hasApi) throw const PartnerApiException('API_NOT_CONFIGURED');
    final Map<String, String> headers = <String, String>{'Authorization': 'Bearer ${session.accessToken}'};
    if (idempotent) headers['Idempotency-Key'] = _idempotencyKey();
    final PartnerHttpResponse response = await _http.sendJson(
      method: method,
      uri: Uri.parse('${_config.apiBaseUrl.replaceFirst(RegExp(r'/+$'), '')}$path'),
      headers: headers,
      jsonBody: body,
    );
    if (!response.isOk) throw PartnerApiException(_workerErrorCode(response.body), details: _workerErrorDetails(response.body));
    final Object? data = response.body['data'];
    return data is Map<String, Object?> ? data : <String, Object?>{};
  }

  /// Validates the configured public Supabase GoTrue endpoint before authentication.
  void _requireAuthConfig() {
    if (!_config.hasAuth) throw const PartnerApiException('AUTH_NOT_CONFIGURED');
  }

  /// Converts a GoTrue success envelope to the in-memory Partner session.
  PartnerSession _sessionFromAuth(Map<String, Object?> body, String emailFallback) {
    final Object? userValue = body['user'];
    final Map<String, Object?> user = userValue is Map<String, Object?> ? userValue : const <String, Object?>{};
    final Object? access = body['access_token'];
    final Object? userId = user['id'];
    if (access is! String || userId is! String) throw const PartnerApiException('SESSION_EXPIRED');
    final Object? email = user['email'];
    return PartnerSession(userId: userId, email: email is String ? email : emailFallback, accessToken: access);
  }

  /// Extracts only the stable GoTrue error token without echoing server response text.
  String _authErrorCode(Map<String, Object?> body) {
    final Object? raw = body['error_code'] ?? body['code'];
    return raw is String && raw.isNotEmpty ? raw : 'SESSION_EXPIRED';
  }

  /// Extracts the standard W1 error code without retaining response bodies or private data.
  String _workerErrorCode(Map<String, Object?> body) {
    final Object? errorValue = body['error'];
    if (errorValue is Map<String, Object?> && errorValue['code'] is String) return errorValue['code']! as String;
    return 'SERVER_BUSY';
  }

  /// Extracts harmless server validation details, excluding any unrecognized response fields.
  Map<String, Object?> _workerErrorDetails(Map<String, Object?> body) {
    final Object? errorValue = body['error'];
    if (errorValue is Map<String, Object?> && errorValue['details'] is Map<String, Object?>) {
      return errorValue['details']! as Map<String, Object?>;
    }
    return const <String, Object?>{};
  }

  /// Reads and validates one required short-lived Cloudinary ticket field.
  String _ticketString(Map<String, Object?> ticket, String key) {
    final Object? value = ticket[key];
    if (value is String && value.isNotEmpty) return value;
    if (value is num) return value.toString();
    throw const PartnerApiException('PRIVATE_UPLOAD_TICKET_INVALID');
  }

  /// Generates a unique opaque idempotency value without embedding form data or account numbers.
  String _idempotencyKey() => 'partner-${DateTime.now().microsecondsSinceEpoch}-${_random.nextInt(1 << 32)}';
}
