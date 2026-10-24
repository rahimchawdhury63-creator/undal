/// Order history, live tracking, Spark lease, and W1 fallback operations.
part of 'customer_experience_state.dart';

extension CustomerExperienceOrderOperations on CustomerExperienceState {
  /// Refreshes the authenticated customer's server order history.
  Future<void> loadOrders() async {
    final CustomerSession? session = _readSession();
    if (session == null) {
      _setOrdersError('SESSION_REQUIRED');
      return;
    }
    final int generation = _sessionGeneration;
    final int request = ++_ordersRequestGeneration;
    _ordersLoading = true;
    _ordersError = null;
    _onChanged();
    try {
      final List<CustomerOrderCard> orders = await _api.listOrders(accessToken: session.accessToken);
      if (_sessionStillCurrent(session, generation) && request == _ordersRequestGeneration) _orders = orders;
    } on CustomerApiProblem catch (error) {
      if (_sessionStillCurrent(session, generation) && request == _ordersRequestGeneration) _ordersError = error.code;
    } on Object {
      if (_sessionStillCurrent(session, generation) && request == _ordersRequestGeneration) _ordersError = 'NETWORK_UNAVAILABLE';
    } finally {
      if (request == _ordersRequestGeneration) {
        _ordersLoading = false;
        _onChanged();
      }
    }
  }

  /// Opens a server order at the correct active, pickup-ready, or terminal destination.
  Future<void> openOrder(CustomerOrderCard order) async {
    final CustomerSession? session = _readSession();
    if (session == null) return;
    final int generation = _sessionGeneration;
    await stopTracking();
    if (!_sessionStillCurrent(session, generation)) return;
    _orderReference = order.publicCode;
    _orderDetail = null;
    _orderReviews = <CustomerReviewSnapshot>[];
    _orderReviewsOrderId = null;
    _routePoints = <GeoPoint>[];
    _navigate(order.isTerminal
        ? CustomerScreenId.c27OrderReceipt
        : order.fulfilment == 'pickup' && order.status == 'READY_FOR_PICKUP'
            ? CustomerScreenId.c23PickupReady
            : CustomerScreenId.c22LiveTracking);
    await loadOrder(order.publicCode);
    if (!_sessionStillCurrent(session, generation) || _orderDetail?.summary.id != order.id) return;
    if (_orderDetail!.summary.isTerminal) {
      if (order.status != _orderDetail!.summary.status) _navigate(CustomerScreenId.c27OrderReceipt);
      return;
    }
    if (_orderDetail!.summary.fulfilment == 'pickup' && _orderDetail!.summary.status == 'READY_FOR_PICKUP') {
      _navigate(CustomerScreenId.c23PickupReady);
      return;
    }
    await startTracking();
  }

  /// Loads a participant-scoped order detail and its immutable receipt snapshots.
  Future<void> loadOrder(String reference) async {
    final CustomerSession? session = _readSession();
    if (session == null) {
      _setOrderError('SESSION_REQUIRED');
      return;
    }
    final int generation = _sessionGeneration;
    final int request = ++_orderRequestGeneration;
    _orderReference = reference;
    _orderLoading = true;
    _orderError = null;
    _orderDetail = null;
    _orderReviews = <CustomerReviewSnapshot>[];
    _orderReviewsOrderId = null;
    _trackingEtag = null;
    _onChanged();
    try {
      final CustomerOrderDetail detail = await _api.loadOrder(accessToken: session.accessToken, orderReference: reference);
      if (_sessionStillCurrent(session, generation) && request == _orderRequestGeneration && _orderReference == reference) {
        _orderDetail = detail;
        _routePoints = <GeoPoint>[];
        unawaited(_loadRoadRoute());
      }
    } on CustomerApiProblem catch (error) {
      if (_sessionStillCurrent(session, generation) && request == _orderRequestGeneration) _orderError = error.code;
    } on Object {
      if (_sessionStillCurrent(session, generation) && request == _orderRequestGeneration) _orderError = 'NETWORK_UNAVAILABLE';
    } finally {
      if (request == _orderRequestGeneration) {
        _orderLoading = false;
        _onChanged();
      }
    }
  }

  /// Refreshes server tracking on the current order and selects W2 RTDB or W1 polling.
  Future<void> startTracking() async {
    final CustomerOrderDetail? detail = _orderDetail;
    final CustomerSession? session = _readSession();
    if (detail == null || session == null || detail.summary.isTerminal) return;
    if (_trackingActive && _trackingOrderId == detail.summary.id) return;
    await stopTracking();
    if (_orderDetail?.summary.id != detail.summary.id || _readSession()?.accessToken != session.accessToken) return;
    final int generation = ++_trackingGeneration;
    final String orderId = detail.summary.id;
    _trackingOrderId = orderId;
    _trackingFallbackPath = '/v1/orders/${Uri.encodeComponent(detail.summary.publicCode)}/live';
    _trackingActive = true;
    _trackingPolling = true;
    _trackingError = null;
    _room = <String, Object?>{};
    _onChanged();

    try {
      final Map<String, Object?> grant = await _api.requestRealtimeGrant(
        accessToken: session.accessToken,
        orderId: orderId,
      );
      if (!_ownsTracking(generation, orderId)) {
        await _api.releaseRealtimeLease(accessToken: session.accessToken, orderId: orderId);
        return;
      }
      final String? suppliedPath = customerJsonNullableString(grant['fallbackPath']);
      if (suppliedPath != null && suppliedPath.startsWith('/v1/orders/')) {
        _trackingFallbackPath = suppliedPath;
      }
      final int? interval = customerExactInt(grant['pollIntervalMs']);
      if (interval != null) _trackingPollIntervalMs = interval.clamp(1000, 30000);
      if (grant['mode'] == 'rtdb' && grant['token'] is String && grant['dbUrl'] is String && grant['dbPath'] is String) {
        try {
          final Stream<Map<String, Object?>> stream = await _realtime.connect(
            customToken: grant['token'] as String,
            databaseUrl: grant['dbUrl'] as String,
            databasePath: grant['dbPath'] as String,
          );
          if (!_ownsTracking(generation, orderId)) {
            await _realtime.close();
            await _api.releaseRealtimeLease(accessToken: session.accessToken, orderId: orderId);
            return;
          }
          _trackingPolling = false;
          _trackingSubscription = stream.listen(
            (Map<String, Object?> event) {
              if (_ownsTracking(generation, orderId)) _consumeRealtimeEvent(event);
            },
            onError: (_) {
              if (_ownsTracking(generation, orderId)) unawaited(_switchToPolling(generation, orderId));
            },
            onDone: () {
              if (_ownsTracking(generation, orderId)) unawaited(_switchToPolling(generation, orderId));
            },
          );
          _trackingReconcileTimer = Timer.periodic(
            const Duration(seconds: 60),
            (_) => unawaited(_pollLive(generation)),
          );
        } on Object {
          await _api.releaseRealtimeLease(accessToken: session.accessToken, orderId: orderId);
          if (!_ownsTracking(generation, orderId)) return;
          _trackingPolling = true;
          _schedulePolling(generation);
        }
      } else {
        _trackingPolling = true;
        _schedulePolling(generation);
      }
      await _pollLive(generation);
    } on Object {
      if (!_ownsTracking(generation, orderId)) return;
      _trackingError = 'TRACKING_FALLBACK';
      _trackingPolling = true;
      _schedulePolling(generation);
      await _pollLive(generation);
    }
    if (_ownsTracking(generation, orderId)) _onChanged();
  }

  /// Stops the current tracking stream and releases its Spark lease with W2.
  Future<void> stopTracking() async {
    ++_trackingGeneration;
    final String? orderId = _trackingOrderId;
    final CustomerSession? session = _readSession();
    _trackingOrderId = null;
    _trackingActive = false;
    _trackingPolling = false;
    _trackingError = null;
    _trackingPollTimer?.cancel();
    _trackingPollTimer = null;
    _trackingReconcileTimer?.cancel();
    _trackingReconcileTimer = null;
    await _trackingSubscription?.cancel();
    _trackingSubscription = null;
    await _realtime.close();
    if (orderId != null && session != null) {
      try {
        await _api.releaseRealtimeLease(accessToken: session.accessToken, orderId: orderId);
      } on Object {
        // The lease has a short expiry even if the release request cannot reach W2.
      }
    }
  }

  Future<void> _loadRoadRoute() async {
    final CustomerOrderDetail? detail = _orderDetail;
    final CustomerSession? session = _readSession();
    final GeoPoint? origin = detail?.vendorPoint;
    final GeoPoint? destination = detail?.customerPoint;
    if (detail == null || session == null || detail.summary.fulfilment != 'delivery' || origin == null || destination == null) return;
    final int generation = _sessionGeneration;
    try {
      final Map<String, Object?> result = await _api.estimateRoadRoute(
        accessToken: session.accessToken,
        origin: origin,
        destination: destination,
      );
      final String geometry = customerJsonString(result['geometry']);
      final List<GeoPoint> points = geometry.isEmpty ? <GeoPoint>[] : decodeCustomerRoutePolyline(geometry);
      if (_sessionStillCurrent(session, generation) && _orderDetail?.summary.id == detail.summary.id) {
        _routePoints = points;
        _onChanged();
      }
    } on Object {
      // Without valid road geometry, the map renders pins and rider location without implying a route.
    }
  }

  Future<void> _pollLive(int generation) async {
    if (generation != _trackingGeneration || (_trackingPolling == false && _trackingReconcileTimer == null)) return;
    final String? orderId = _trackingOrderId;
    final String? fallbackPath = _trackingFallbackPath;
    if (!_trackingActive || orderId == null || fallbackPath == null) return;
    final CustomerSession? session = _readSession();
    if (session == null) return;
    try {
      final Map<String, Object?>? data = await _api.loadLiveOrder(
        accessToken: session.accessToken,
        fallbackPath: fallbackPath,
        etag: _trackingEtag,
      );
      if (!_ownsTracking(generation, orderId) || data == null) return;
      _trackingEtag = customerJsonNullableString(data['_etag']) ?? _trackingEtag;
      final Map<String, Object?> order = customerJsonMap(data['order']);
      if (order.isEmpty || _orderDetail?.summary.id != orderId) return;
      final List<Map<String, Object?>> events = customerJsonMaps(data['events']);
      _orderDetail = _replaceOrder(_orderDetail!, order, events, _orderDetail!.riderPoint);
      if (_orderDetail!.summary.isTerminal) unawaited(stopTracking());
      _onChanged();
    } on Object {
      if (!_ownsTracking(generation, orderId)) return;
      if (_trackingPolling) _trackingError = 'TRACKING_RETRYING';
      _onChanged();
    }
  }

  void _consumeRealtimeEvent(Map<String, Object?> event) {
    final String path = customerJsonString(event['event'], fallback: '/');
    final Object? incoming = event['data'];
    if (path == '/' && incoming is Map<String, Object?>) {
      _room = <String, Object?>{..._room, ...incoming};
    } else {
      final List<String> parts = path.split('/').where((String value) => value.isNotEmpty).toList();
      if (parts.isNotEmpty) _setRoomPath(parts, incoming, event['type'] == 'patch');
    }
    final CustomerOrderDetail? detail = _orderDetail;
    if (detail == null) return;
    final String status = customerJsonString(_room['s']).toUpperCase();
    final int? eta = customerExactInt(_room['eta']);
    final Map<String, Object?> order = <String, Object?>{
      ...detail.order,
      if (status.isNotEmpty) 'status': status,
      if (eta != null) 'eta_epoch_sec': eta,
    };
    final Map<String, Object?> location = customerJsonMap(_room['loc']);
    final int? locationUpdatedAtMs = customerExactInt(location['ts']);
    final int nowMs = DateTime.now().millisecondsSinceEpoch;
    final bool locationIsFresh = locationUpdatedAtMs != null &&
        locationUpdatedAtMs <= nowMs + 30000 &&
        nowMs - locationUpdatedAtMs <= 90000;
    final GeoPoint? rider = locationIsFresh
        ? customerGeoPoint(location['la'], location['ln'])
        : null;
    _orderDetail = _replaceOrder(detail, order, detail.events, rider);
    if (_orderDetail!.summary.isTerminal) unawaited(stopTracking());
    _onChanged();
  }

  void _setRoomPath(List<String> parts, Object? incoming, bool merge) {
    final Map<String, Object?> root = <String, Object?>{..._room};
    Map<String, Object?> cursor = root;
    for (final String part in parts.take(parts.length - 1)) {
      final Object? child = cursor[part];
      cursor[part] = child is Map<String, Object?> ? <String, Object?>{...child} : <String, Object?>{};
      cursor = cursor[part] as Map<String, Object?>;
    }
    final String leaf = parts.last;
    final Object? previous = cursor[leaf];
    cursor[leaf] = merge && previous is Map<String, Object?> && incoming is Map<String, Object?>
        ? <String, Object?>{...previous, ...incoming}
        : incoming;
    _room = root;
  }

  CustomerOrderDetail _replaceOrder(
    CustomerOrderDetail detail,
    Map<String, Object?> order,
    List<Map<String, Object?>> events,
    GeoPoint? rider,
  ) => CustomerOrderDetail(
        summary: CustomerOrderCard.fromJson(order),
        order: Map<String, Object?>.unmodifiable(order),
        items: detail.items,
        events: events,
        pickupQrToken: detail.pickupQrToken,
        pickupCode4: detail.pickupCode4,
        vendorPoint: detail.vendorPoint,
        customerPoint: detail.customerPoint,
        riderPoint: rider,
      );

  Future<void> _switchToPolling(int generation, String orderId) async {
    if (!_ownsTracking(generation, orderId) || _trackingPolling) return;
    await _trackingSubscription?.cancel();
    if (!_ownsTracking(generation, orderId)) return;
    _trackingSubscription = null;
    await _realtime.close();
    if (!_ownsTracking(generation, orderId)) return;
    final CustomerSession? session = _readSession();
    if (session != null) {
      try {
        await _api.releaseRealtimeLease(accessToken: session.accessToken, orderId: orderId);
      } on Object {
        // W2 expires every lease even if the explicit release races a network failure.
      }
    }
    if (!_ownsTracking(generation, orderId)) return;
    _trackingPolling = true;
    _trackingError = null;
    _schedulePolling(generation);
    await _pollLive(generation);
    if (_ownsTracking(generation, orderId)) _onChanged();
  }

  void _schedulePolling(int generation) {
    _trackingPollTimer?.cancel();
    _trackingPollTimer = Timer.periodic(
      Duration(milliseconds: _trackingPollIntervalMs),
      (_) => unawaited(_pollLive(generation)),
    );
  }

  bool _ownsTracking(int generation, String orderId) =>
      generation == _trackingGeneration && _trackingActive && _trackingOrderId == orderId;

  void _setOrdersError(String value) { _ordersError = value; _onChanged(); }
  void _setOrderError(String value) { _orderError = value; _onChanged(); }
}
