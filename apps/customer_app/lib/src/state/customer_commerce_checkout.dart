part of 'customer_commerce_state.dart';

/// Voucher verification, address/cart sync, quote refresh, and COD order placement.
extension CustomerCommerceCheckoutOperations on CustomerCommerceState {
  /// Returns from the voucher or checkout route to the Cart tab.
  void backToCart() {
    _activeScreen = null;
    _suspendedScreen = null;
    _onChanged();
  }

  /// Opens c-19 without showing unverified or paid-placement voucher inventory.
  void openVoucherPicker() {
    _voucherErrorCode = null;
    _activeScreen = CustomerScreenId.c19VoucherPicker;
    _onChanged();
  }

  /// Stores voucher text without accepting it locally.
  void setVoucherInput(String value) {
    if (_pendingOrderIdempotencyKey != null) return;
    _voucherInput = value.length > 32 ? value.substring(0, 32).toUpperCase() : value.toUpperCase();
    _voucherErrorCode = null;
    _onChanged();
  }

  /// Requests authentication or asks W1 to validate the entered voucher code.
  Future<bool> applyVoucher() async {
    if (_pendingOrderIdempotencyKey != null) return false;
    final String code = _voucherInput.trim().toUpperCase();
    if (code.length < 3 || code.length > 32) {
      _voucherErrorCode = 'VOUCHER_INVALID';
      _onChanged();
      return false;
    }
    final CustomerSession? session = _readSession();
    if (session == null) {
      _requestAuthentication(const VoucherPickerIntent());
      return false;
    }
    if (!_api.isConfigured || !_hasLiveSession) {
      _voucherErrorCode = 'VOUCHER_VERIFY_ONLINE';
      _onChanged();
      return false;
    }
    try {
      await _synchronizeCart(session);
      await _api.applyVoucher(accessToken: session.accessToken, code: code);
      _appliedVoucherCode = code;
      _voucherErrorCode = null;
      await refreshServerQuote();
      return true;
    } on CustomerApiProblem catch (error) {
      _voucherErrorCode = error.code;
      _onChanged();
      return false;
    } on Object {
      _voucherErrorCode = 'NETWORK_UNAVAILABLE';
      _onChanged();
      return false;
    }
  }

  /// Removes the voucher from W1 and clears the local code only after success.
  Future<bool> removeVoucher() async {
    if (_pendingOrderIdempotencyKey != null) return false;
    final CustomerSession? session = _readSession();
    if (session == null || !_api.isConfigured || !_hasLiveSession) return false;
    try {
      await _api.removeVoucher(accessToken: session.accessToken);
      _appliedVoucherCode = null;
      _serverQuote = null;
      _voucherErrorCode = null;
      _onChanged();
      return true;
    } on CustomerApiProblem catch (error) {
      _voucherErrorCode = error.code;
      _onChanged();
      return false;
    } on Object {
      _voucherErrorCode = 'NETWORK_UNAVAILABLE';
      _onChanged();
      return false;
    }
  }

  /// Opens c-20 after authentication; the intercepted checkout resumes after sign-in.
  void openCheckout() {
    _commerceErrorCode = null;
    if (!canStartCheckout) {
      _commerceErrorCode = 'LIVE_CHECKOUT_UNAVAILABLE';
      _onChanged();
      return;
    }
    if (_readSession() == null) {
      _activeScreen = null;
      _requestAuthentication(const CheckoutOrderIntent());
      return;
    }
    _activeScreen = CustomerScreenId.c20Checkout;
    _onChanged();
    unawaited(refreshServerQuote());
  }

  /// Resumes c-19 after guest authentication.
  void resumeVoucherPicker() {
    _suspendedScreen = null;
    _activeScreen = CustomerScreenId.c19VoucherPicker;
    _onChanged();
  }

  /// Resumes c-20 after guest authentication and refreshes its current quote.
  void resumeCheckout() {
    _suspendedScreen = null;
    _activeScreen = CustomerScreenId.c20Checkout;
    _onChanged();
    unawaited(refreshServerQuote());
  }

  /// Reconciles the authenticated cart and requests the latest W1 `price_order()` quote.
  Future<bool> refreshServerQuote() async {
    if (_pendingOrderIdempotencyKey != null) {
      _commerceErrorCode = 'ORDER_RESULT_UNKNOWN';
      _onChanged();
      return false;
    }
    final CustomerSession? session = _readSession();
    if (session == null || !_api.isConfigured || !_hasLiveSession) {
      _commerceErrorCode = 'LIVE_CHECKOUT_UNAVAILABLE';
      _onChanged();
      return false;
    }
    try {
      await _synchronizeCart(session);
      final Map<String, Object?> quote = await _api.validateCart(
        accessToken: session.accessToken,
        priority: _priority,
      );
      if (_serverPoisha(quote['cod_collect_poisha']) == null) {
        throw const CustomerApiProblem('CART_QUOTE_INVALID');
      }
      _serverQuote = quote;
      _commerceErrorCode = null;
      _onChanged();
      return true;
    } on CustomerApiProblem catch (error) {
      _commerceErrorCode = error.code;
      _onChanged();
      return false;
    } on Object {
      _commerceErrorCode = 'NETWORK_UNAVAILABLE';
      _onChanged();
      return false;
    }
  }

  /// Confirms replacement of an older server-side kitchen cart and retries quote validation.
  Future<bool> confirmServerCartReplacement() async {
    _serverCartReplacementConfirmed = true;
    _serverCartConflict = false;
    _commerceErrorCode = null;
    return refreshServerQuote();
  }

  /// Places one atomic COD order; ambiguous network outcomes reuse the same idempotency key.
  Future<bool> placeCodOrder() async {
    if (_checkoutBusy) return false;
    final CustomerSession? session = _readSession();
    if (session == null) {
      _activeScreen = null;
      _requestAuthentication(const CheckoutOrderIntent());
      return false;
    }
    if (!_api.isConfigured || !_hasLiveSession || _basket.isEmpty || !_basket.every((BasketLineItem row) => row.item.isLiveSnapshot && _isUuid(row.dish.id))) {
      _commerceErrorCode = 'LIVE_CHECKOUT_UNAVAILABLE';
      _onChanged();
      return false;
    }
    _checkoutBusy = true;
    _commerceErrorCode = null;
    _onChanged();
    if (_pendingOrderIdempotencyKey != null && _pendingOrderExpectedCodPoisha != null) {
      try {
        final CustomerOrderReceipt confirmed = await _api.placeCodOrder(
          accessToken: session.accessToken,
          priority: _priority,
          expectedCodPoisha: _pendingOrderExpectedCodPoisha!,
          idempotencyKey: _pendingOrderIdempotencyKey!,
        );
        _completeConfirmedOrder(confirmed);
        return true;
      } on CustomerApiProblem catch (error) {
        if (error.statusCode != null && error.statusCode! < 500) {
          _pendingOrderIdempotencyKey = null;
          _pendingOrderExpectedCodPoisha = null;
          _serverQuote = null;
          _commerceErrorCode = error.code;
        } else {
          _commerceErrorCode = 'ORDER_RESULT_UNKNOWN';
        }
      } on Object {
        _commerceErrorCode = 'ORDER_RESULT_UNKNOWN';
      }
      _checkoutBusy = false;
      _onChanged();
      return false;
    }
    try {
      await _synchronizeCart(session);
      final Map<String, Object?> quote = await _api.validateCart(
        accessToken: session.accessToken,
        priority: _priority,
      );
      final int? expectedCodPoisha = _serverPoisha(quote['cod_collect_poisha']);
      if (expectedCodPoisha == null) throw const CustomerApiProblem('CART_QUOTE_INVALID');
      _serverQuote = quote;
      _pendingOrderIdempotencyKey = _newOrderIdempotencyKey();
      _pendingOrderExpectedCodPoisha = expectedCodPoisha;
      final CustomerOrderReceipt confirmed = await _api.placeCodOrder(
        accessToken: session.accessToken,
        priority: _priority,
        expectedCodPoisha: expectedCodPoisha,
        idempotencyKey: _pendingOrderIdempotencyKey!,
      );
      _completeConfirmedOrder(confirmed);
      return true;
    } on CustomerApiProblem catch (error) {
      if (_pendingOrderIdempotencyKey != null && error.statusCode != null && error.statusCode! >= 500) {
        _commerceErrorCode = 'ORDER_RESULT_UNKNOWN';
      } else {
        _pendingOrderIdempotencyKey = null;
        _pendingOrderExpectedCodPoisha = null;
        _commerceErrorCode = error.code;
      }
    } on Object {
      _commerceErrorCode = _pendingOrderIdempotencyKey == null
          ? 'NETWORK_UNAVAILABLE'
          : 'ORDER_RESULT_UNKNOWN';
    }
    _checkoutBusy = false;
    _onChanged();
    return false;
  }

  void _completeConfirmedOrder(CustomerOrderReceipt confirmed) {
    _receipt = confirmed;
    _pendingOrderIdempotencyKey = null;
    _pendingOrderExpectedCodPoisha = null;
    _basket.clear();
    _serverQuote = null;
    _appliedVoucherCode = null;
    _activeScreen = CustomerScreenId.c21OrderConfirmation;
    _checkoutBusy = false;
    _onChanged();
  }

  Future<void> _synchronizeCart(CustomerSession session) async {
    if (_basket.isEmpty) throw const CustomerApiProblem('CART_EMPTY');
    final String? vendorId = _cartVendorId;
    if (vendorId == null || !_isUuid(vendorId) ||
        _basket.any((BasketLineItem row) => !row.item.isLiveSnapshot || !_isUuid(row.dish.id))) {
      throw const CustomerApiProblem('MENU_REFRESH_REQUIRED');
    }
    if (_readFulfilment() == UndalFulfilmentMode.pickup &&
        (_storefront?.vendor.acceptsPickup == false || (_storefront == null && _feedVendor?.acceptsPickup == false))) {
      throw const CustomerApiProblem('PICKUP_DISABLED');
    }
    final SavedCustomerAddress address = _readAddress();
    String? remoteAddressId;
    if (_readFulfilment() == UndalFulfilmentMode.delivery) {
      remoteAddressId = _liveAddressIds[address.id];
      if (remoteAddressId == null) {
        remoteAddressId = await _api.saveAddress(accessToken: session.accessToken, address: address);
        _liveAddressIds[address.id] = remoteAddressId;
      }
    }
    final Map<String, Object?> previous = await _api.loadCart(accessToken: session.accessToken);
    final Object? previousCart = previous['cart'];
    final bool switchedVendor = previousCart is Map<String, Object?> && previousCart['vendor_id'] != vendorId;
    final List<Map<String, Object?>> oldItems = _jsonMaps(previous['items']);
    if (switchedVendor && oldItems.isNotEmpty && !_serverCartReplacementConfirmed) {
      _serverCartConflict = true;
      _commerceErrorCode = 'CART_VENDOR_CONFLICT';
      _onChanged();
      throw const CustomerApiProblem('CART_VENDOR_CONFLICT');
    }
    await _api.upsertCart(
      accessToken: session.accessToken,
      vendorId: vendorId,
      addressId: remoteAddressId,
      fulfilment: _readFulfilment() == UndalFulfilmentMode.pickup ? 'pickup' : 'delivery',
      tipPoisha: tipPoisha,
      cutleryRequested: _cutleryRequested,
      customerNote: _customerNote,
      confirmClear: switchedVendor && _serverCartReplacementConfirmed,
    );
    _serverCartReplacementConfirmed = false;
    _serverCartConflict = false;
    if (!switchedVendor) {
      for (final Map<String, Object?> row in oldItems) {
        final Object? menuId = row['menu_item_id'];
        if (menuId is! String) continue;
        await _api.mutateCartLine(
          accessToken: session.accessToken,
          menuItemId: menuId,
          variantId: row['variant_id'] is String ? row['variant_id'] as String : null,
          quantity: 0,
          selections: _jsonMaps(row['selections']),
          note: row['note'] is String ? row['note'] as String : null,
        );
      }
    }
    for (final BasketLineItem row in _basket) {
      await _api.mutateCartLine(
        accessToken: session.accessToken,
        menuItemId: row.dish.id,
        variantId: row.variantId,
        quantity: row.quantity,
        selections: row.selections,
        note: row.specialInstructions,
      );
    }
    if (_appliedVoucherCode != null) {
      await _api.applyVoucher(accessToken: session.accessToken, code: _appliedVoucherCode!);
    }
  }

  static String _newOrderIdempotencyKey() {
    final DateTime now = DateTime.now().toUtc();
    return 'cod-${now.microsecondsSinceEpoch}-${now.millisecondsSinceEpoch}';
  }
}

int? _serverPoisha(Object? raw) {
  if (raw is int && raw >= 0) return raw;
  if (raw is String) {
    final int? parsed = int.tryParse(raw);
    if (parsed != null && parsed >= 0) return parsed;
  }
  return null;
}

List<Map<String, Object?>> _jsonMaps(Object? raw) => raw is List<Object?>
    ? raw.whereType<Map<String, Object?>>().toList(growable: false)
    : const <Map<String, Object?>>[];
