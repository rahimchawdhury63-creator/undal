part of 'customer_controller.dart';

/// Commerce-facing root-controller bindings used by the app shell and existing screens.
extension CustomerControllerCommerceBindings on CustomerController {
  /// Commerce overlay when active, otherwise the root onboarding/auth route.
  CustomerScreenId get activeOverlay => commerce.activeScreen ?? _activeOverlay;

  /// Read-only cart rows preserved for the customer tab shell.
  List<BasketLineItem> get basket => commerce.basket;

  /// Total units used by the cart navigation badge.
  int get totalBasketItems => commerce.totalItems;

  /// Canonical screen ID currently visible (`c-01..c-21`).
  CustomerScreenId get currentScreenId {
    final CustomerScreenId? commerceScreen = commerce.activeScreen;
    if (commerceScreen != null) return commerceScreen;
    if (_activeOverlay != CustomerScreenId.c08HomeDelivery) return _activeOverlay;
    if (_selectedTabIndex == 3) return CustomerScreenId.c18Cart;
    if (_selectedTabIndex == 1) {
      return _searchQuery.trim().isEmpty
          ? CustomerScreenId.c11SearchHome
          : CustomerScreenId.c12SearchResults;
    }
    return _fulfilmentMode == UndalFulfilmentMode.pickup
        ? CustomerScreenId.c09HomePickup
        : CustomerScreenId.c08HomeDelivery;
  }

  /// Selects a primary destination and closes any commerce overlay without discarding the basket.
  void selectTab(int index) {
    commerce.closeFlow();
    _selectedTabIndex = index.clamp(0, 4);
    _activeOverlay = CustomerScreenId.c08HomeDelivery;
    notifyListeners();
  }

  /// Changes delivery/pickup mode when the current basket permits it.
  void setFulfilmentMode(UndalFulfilmentMode next) {
    if (!commerce.setFulfilment(next)) return;
    notifyListeners();
  }

  /// Attempts a basket add and reports conflicts so the UI can ask before switching kitchens.
  CartAddResult tryAddDishToBasket(
    CatalogDishItem dish, {
    bool confirmVendorReplacement = false,
  }) {
    final VendorFeedCard? vendor = _catalogPool
        .where((VendorFeedCard row) => row.id == dish.vendorId)
        .firstOrNull;
    return commerce.addCatalogDish(
      dish,
      vendor: vendor,
      confirmVendorReplacement: confirmVendorReplacement,
    );
  }

  /// Adds a simple catalog item; false means offline, stale, or awaiting kitchen confirmation.
  bool addDishToBasket(CatalogDishItem dish) =>
      tryAddDishToBasket(dish) == CartAddResult.added;

  /// Decrements or removes the matching configured basket row.
  void decrementBasketItem(String dishId) => commerce.decrementLine(dishId);

  /// Signs out and clears private cart, voucher, address-link and receipt state.
  void signOut() {
    _session = null;
    commerce.clearSessionData();
    notifyListeners();
  }
}
