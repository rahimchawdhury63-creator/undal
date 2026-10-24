part of 'customer_commerce_state.dart';

/// Single-vendor cart operations and checkout preferences for commerce state.
extension CustomerCommerceBasketOperations on CustomerCommerceState {
  /// Adds a simple browse-catalog item without silently switching kitchens.
  CartAddResult addCatalogDish(
    CatalogDishItem dish, {
    VendorFeedCard? vendor,
    bool confirmVendorReplacement = false,
  }) {
    if (_readOffline()) return CartAddResult.offline;
    if (_api.isConfigured) {
      if (vendor != null) openVendor(vendor);
      _commerceErrorCode = 'MENU_REFRESH_REQUIRED';
      _onChanged();
      return CartAddResult.requiresLiveRefresh;
    }
    if (vendor != null) _feedVendor = vendor;
    return _addLine(
      item: StorefrontMenuItem.fromCatalog(dish),
      quantity: 1,
      unitPricePoisha: dish.pricePoisha,
      variantId: null,
      selections: const <Map<String, Object?>>[],
      note: '',
      confirmVendorReplacement: confirmVendorReplacement,
    );
  }

  /// Decrements a configured row by key, removing it when quantity reaches zero.
  void decrementLine(String lineKey) {
    if (_pendingOrderIdempotencyKey != null) return;
    final int index = _basket.indexWhere((BasketLineItem row) => row.lineKey == lineKey || row.dish.id == lineKey);
    if (index < 0) return;
    if (_basket[index].quantity <= 1) {
      _basket.removeAt(index);
    } else {
      _basket[index] = _basket[index].copyWith(quantity: _basket[index].quantity - 1);
    }
    _serverQuote = null;
    _onChanged();
  }

  /// Increments a basket row without exceeding W1's fifty-item line limit.
  void incrementLine(String lineKey) {
    if (_pendingOrderIdempotencyKey != null) return;
    final int index = _basket.indexWhere((BasketLineItem row) => row.lineKey == lineKey);
    if (index < 0 || _basket[index].quantity >= 50) return;
    _basket[index] = _basket[index].copyWith(quantity: _basket[index].quantity + 1);
    _serverQuote = null;
    _onChanged();
  }

  /// Removes a configured line and invalidates any stale quote.
  void removeLine(String lineKey) {
    if (_pendingOrderIdempotencyKey != null) return;
    _basket.removeWhere((BasketLineItem row) => row.lineKey == lineKey);
    _serverQuote = null;
    _onChanged();
  }

  /// Selects delivery or QR pickup; pickup is refused if the kitchen has not enabled it.
  bool setFulfilment(UndalFulfilmentMode mode) {
    if (_pendingOrderIdempotencyKey != null) return false;
    if (mode == UndalFulfilmentMode.pickup && _basket.isNotEmpty && !pickupAvailable) return false;
    _writeFulfilment(mode);
    if (mode == UndalFulfilmentMode.pickup) {
      _tipPoisha = 0;
      _priority = false;
    }
    _serverQuote = null;
    _onChanged();
    return true;
  }

  /// Sets one cash-tip chip amount; pickup always remains zero-tip.
  void setTipPoisha(int amount) {
    if (_pendingOrderIdempotencyKey != null) return;
    _tipPoisha = amount.clamp(0, 100000);
    _serverQuote = null;
    _onChanged();
  }

  /// Turns priority delivery on/off; the fee is shown separately in integer poisha.
  void setPriority(bool value) {
    if (_pendingOrderIdempotencyKey != null) return;
    _priority = value && _readFulfilment() == UndalFulfilmentMode.delivery;
    _serverQuote = null;
    _onChanged();
  }

  /// Updates cutlery preference; the default is off.
  void setCutleryRequested(bool value) {
    if (_pendingOrderIdempotencyKey != null) return;
    _cutleryRequested = value;
    _onChanged();
  }

  /// Updates bounded instructions for delivery or pickup handover.
  void setCustomerNote(String value) {
    if (_pendingOrderIdempotencyKey != null) return;
    _customerNote = value.length > 300 ? value.substring(0, 300) : value;
    _onChanged();
  }
}
