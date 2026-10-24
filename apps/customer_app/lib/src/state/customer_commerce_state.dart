/// Reactive commerce state for customer screens `c-13..c-21` (`Build Response 13`).
///
/// Keeps storefront, option validation, the single-vendor basket, vouchers, checkout settings,
/// and server-confirmed COD receipts together. Offline catalog data is browse-only when W1 exists.
library;

import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:undal_core/undal_core.dart';

import '../models/customer_cart_models.dart';
import '../models/customer_models.dart';
import '../models/storefront_menu_models.dart';
import '../models/storefront_vendor_models.dart';
import '../services/customer_api_client.dart';
import '../services/customer_commerce_api.dart';

part 'customer_commerce_storefront.dart';
part 'customer_commerce_customization.dart';
part 'customer_commerce_basket.dart';
part 'customer_commerce_checkout.dart';

/// Outcome of a basket add; destructive kitchen changes always need explicit confirmation.
enum CartAddResult { added, vendorConflict, unavailable, offline, requiresLiveRefresh }

/// Reads the active authenticated customer session.
typedef CustomerSessionReader = CustomerSession? Function();

/// Reads the currently selected delivery address.
typedef CustomerAddressReader = SavedCustomerAddress Function();

/// Reads the current delivery/pickup mode.
typedef CustomerFulfilmentReader = UndalFulfilmentMode Function();

/// Updates the root controller's delivery/pickup mode.
typedef CustomerFulfilmentWriter = void Function(UndalFulfilmentMode mode);

/// Requests a guest sign-in with a resumable commerce intent.
typedef CustomerAuthRequester = void Function(PendingAuthIntent intent);

/// Owns storefront data, customization draft, basket, voucher state, and checkout navigation.
final class CustomerCommerceState {
  /// Creates commerce state using the app's configured API transport and root-state callbacks.
  CustomerCommerceState({
    required CustomerApiClient apiClient,
    required VoidCallback onChanged,
    required CustomerSessionReader readSession,
    required CustomerAddressReader readAddress,
    required CustomerFulfilmentReader readFulfilment,
    required CustomerFulfilmentWriter writeFulfilment,
    required CustomerAuthRequester requestAuthentication,
    required bool Function() readOffline,
  })  : _api = CustomerCommerceApi(config: apiClient.config, transport: apiClient.transport),
        _onChanged = onChanged,
        _readSession = readSession,
        _readAddress = readAddress,
        _readFulfilment = readFulfilment,
        _writeFulfilment = writeFulfilment,
        _requestAuthentication = requestAuthentication,
        _readOffline = readOffline;

  final CustomerCommerceApi _api;
  final VoidCallback _onChanged;
  final CustomerSessionReader _readSession;
  final CustomerAddressReader _readAddress;
  final CustomerFulfilmentReader _readFulfilment;
  final CustomerFulfilmentWriter _writeFulfilment;
  final CustomerAuthRequester _requestAuthentication;
  final bool Function() _readOffline;

  CustomerScreenId? _activeScreen;
  CustomerScreenId? _suspendedScreen;
  VendorFeedCard? _feedVendor;
  VendorStorefront? _storefront;
  bool _storefrontLoading = false;
  bool _storefrontUnavailable = false;
  StorefrontMenuItem? _activeItem;
  final Map<String, String> _variantChoices = <String, String>{};
  final Map<String, Set<String>> _optionChoices = <String, Set<String>>{};
  final Map<String, Set<String>> _bundleChoices = <String, Set<String>>{};
  int _itemQuantity = 1;
  String _itemInstructions = '';
  final List<BasketLineItem> _basket = <BasketLineItem>[];
  final Map<String, String> _liveAddressIds = <String, String>{};
  List<CustomerVendorReview> _reviews = <CustomerVendorReview>[];
  bool _reviewsLoading = false;
  bool _reviewsUnavailable = false;
  bool _reviewsLoaded = false;
  bool _priority = false;
  bool _cutleryRequested = false;
  int _tipPoisha = 0;
  String _customerNote = '';
  String _voucherInput = '';
  String? _appliedVoucherCode;
  String? _voucherErrorCode;
  String? _commerceErrorCode;
  Map<String, Object?>? _serverQuote;
  CustomerOrderReceipt? _receipt;
  String? _pendingOrderIdempotencyKey;
  int? _pendingOrderExpectedCodPoisha;
  bool _checkoutBusy = false;
  bool _serverCartConflict = false;
  bool _serverCartReplacementConfirmed = false;

  /// Current customer screen overlay, or null when the tab shell is visible.
  CustomerScreenId? get activeScreen => _activeScreen;

  /// Closes the active commerce route while preserving the current basket.
  void closeFlow() {
    _activeScreen = null;
    _suspendedScreen = null;
    _activeItem = null;
    _onChanged();
  }

  /// Hides the commerce screen while intercepted authentication is displayed.
  void suspendForAuthentication() {
    _suspendedScreen = _activeScreen;
    _activeScreen = null;
    _onChanged();
  }

  /// Restores the screen suspended when a guest action requested authentication.
  void resumePreviousScreen() {
    _activeScreen = _suspendedScreen;
    _suspendedScreen = null;
    _onChanged();
  }

  /// Drops a suspended route when the guest dismisses authentication.
  void cancelAuthenticationResume() {
    _activeScreen = null;
    _suspendedScreen = null;
    _onChanged();
  }

  /// Clears private cart, voucher and receipt state when the authenticated account changes.
  void clearSessionData() {
    _basket.clear();
    _liveAddressIds.clear();
    _appliedVoucherCode = null;
    _voucherErrorCode = null;
    _serverQuote = null;
    _receipt = null;
    _pendingOrderIdempotencyKey = null;
    _pendingOrderExpectedCodPoisha = null;
    _checkoutBusy = false;
    _activeScreen = null;
    _suspendedScreen = null;
    _onChanged();
  }

  /// Current privacy-filtered storefront snapshot, including browse-only local fallback.
  VendorStorefront? get storefront => _storefront;

  /// Whether W1 is fetching a fresh storefront snapshot.
  bool get storefrontLoading => _storefrontLoading;

  /// Whether W1 could not validate the local menu fallback.
  bool get storefrontUnavailable => _storefrontUnavailable;

  /// Menu item currently being configured on `c-14` or `c-15`.
  StorefrontMenuItem? get activeItem => _activeItem;

  /// Number of item units in the active basket.
  int get totalItems => _basket.fold<int>(0, (int sum, BasketLineItem row) => sum + row.quantity);

  /// Immutable configured basket rows for `c-18`.
  List<BasketLineItem> get basket => List<BasketLineItem>.unmodifiable(_basket);

  /// Food subtotal before discounts and delivery fees, in integer poisha.
  int get itemsSubtotalPoisha => _basket.fold<int>(0, (int sum, BasketLineItem row) => sum + row.lineTotalPoisha);

  /// Visible and moderated verified-buyer reviews only.
  List<CustomerVendorReview> get reviews => List<CustomerVendorReview>.unmodifiable(_reviews);

  /// Whether the verified-review endpoint is loading.
  bool get reviewsLoading => _reviewsLoading;

  /// Whether W1 could not validate reviews.
  bool get reviewsUnavailable => _reviewsUnavailable;

  /// Whether W1 returned a verified review list, including a genuine empty list.
  bool get reviewsLoaded => _reviewsLoaded;

  /// Latest server quote, if available.
  Map<String, Object?>? get serverQuote => _serverQuote == null ? null : Map<String, Object?>.unmodifiable(_serverQuote!);

  /// Server-confirmed receipt; null until atomic W1 placement succeeds.
  CustomerOrderReceipt? get receipt => _receipt;

  /// Whether the user selected priority delivery.
  bool get priority => _priority;

  /// Whether the user requested cutlery (default OFF).
  bool get cutleryRequested => _cutleryRequested;

  /// Cash tip in integer poisha; pickup always normalizes this to zero.
  int get tipPoisha => _readFulfilment() == UndalFulfilmentMode.pickup ? 0 : _tipPoisha;

  /// Bounded customer instructions for the order.
  String get customerNote => _customerNote;

  /// Voucher input string currently being edited.
  String get voucherInput => _voucherInput;

  /// Voucher code accepted by W1 for the current cart.
  String? get appliedVoucherCode => _appliedVoucherCode;

  /// Latest voucher validation error code.
  String? get voucherErrorCode => _voucherErrorCode;

  /// Latest cart, quote, or checkout error code.
  String? get commerceErrorCode => _commerceErrorCode;

  /// Whether order placement is in flight.
  bool get checkoutBusy => _checkoutBusy;

  /// Whether a network-ambiguous order must be retried with the same idempotency key.
  bool get orderResolutionPending => _pendingOrderIdempotencyKey != null;

  /// Whether the current kitchen accepts customer self-pickup.
  bool get pickupAvailable => _storefront?.vendor.acceptsPickup ?? _feedVendor?.acceptsPickup ?? false;

  /// Whether a server-side cart collision needs explicit user confirmation.
  bool get serverCartConflict => _serverCartConflict;

  /// Whether W1 can accept this basket: live API, live snapshot, real session, and UUID-backed IDs.
  bool get canPlaceLiveOrder => _api.isConfigured && _hasLiveSession && _basket.isNotEmpty && _basket.every((BasketLineItem row) => row.item.isLiveSnapshot && _isUuid(row.dish.id));

  /// Whether a live UUID-backed basket can begin checkout before guest authentication.
  bool get canStartCheckout => _api.isConfigured && _basket.isNotEmpty && _basket.every((BasketLineItem row) => row.item.isLiveSnapshot && _isUuid(row.dish.id));

  /// Whether all required/min/max groups for the current customizer draft are satisfied.
  bool get itemConfigurationValid => _activeItem != null && _groupsValid;

  /// Current item unit price from exact integer-poisha base, variant, option, and bundle deltas.
  int get itemUnitPricePoisha {
    final StorefrontMenuItem? item = _activeItem;
    if (item == null) return 0;
    int amount = item.dish.pricePoisha;
    for (final StorefrontVariantGroup group in item.variantGroups) {
      final String? id = _variantChoices[group.id];
      for (final StorefrontChoice choice in group.variants) {
        if (choice.id == id) amount += choice.priceDeltaPoisha;
      }
    }
    for (final StorefrontChoiceGroup group in item.optionGroups) {
      for (final StorefrontChoice choice in group.choices) {
        if (_optionChoices[group.id]?.contains(choice.id) == true) amount += choice.priceDeltaPoisha;
      }
    }
    for (final BundleSlot slot in item.bundleSlots) {
      for (final BundleSlotChoice choice in slot.choices) {
        if (_bundleChoices[slot.id]?.contains(choice.itemId) == true) amount += choice.priceDeltaPoisha;
      }
    }
    return amount;
  }

  /// Computes the canonical base `priceOrder()` preview; W1 confirms the final COD amount.
  OrderMoneySnapshot get displayQuote {
    final UndalFulfilmentMode mode = _readFulfilment();
    final int deliveryFee = mode == UndalFulfilmentMode.pickup ? 0 : _vendorStandardDeliveryFee;
    return priceOrder(OrderPricingInput(
      fulfilment: mode,
      itemsPoisha: itemsSubtotalPoisha,
      discountVendorPoisha: 0,
      discountPlatformPoisha: 0,
      deliveryFeePoisha: deliveryFee + (_priority && mode == UndalFulfilmentMode.delivery ? 1000 : 0),
      platformFeePoisha: 500,
      tipPoisha: tipPoisha,
    ));
  }

  int get _vendorStandardDeliveryFee => _feedVendor?.standardDeliveryFeePoisha ?? 4000;
  bool get _hasLiveSession => _readSession()?.accessToken.split('.').length == 3;
  bool get _storefrontLive => _storefront?.isLiveSnapshot == true;
  String? get _cartVendorId => _basket.isEmpty ? null : _basket.first.dish.vendorId;

  bool get _groupsValid {
    final StorefrontMenuItem? item = _activeItem;
    if (item == null || item.variantGroups.length > 1) return false;
    for (final StorefrontVariantGroup group in item.variantGroups) {
      if (group.minSelect > 1 || group.maxSelect != 1) return false;
      final int count = _variantChoices.containsKey(group.id) ? 1 : 0;
      if (count < group.minSelect || count > group.maxSelect || count > 1) return false;
    }
    if (_variantChoices.length > 1) return false;
    for (final StorefrontChoiceGroup group in item.optionGroups) {
      final int count = _optionChoices[group.id]?.length ?? 0;
      if (count < group.minSelect || count > group.maxSelect) return false;
    }
    for (final BundleSlot slot in item.bundleSlots) {
      final int count = _bundleChoices[slot.id]?.length ?? 0;
      if (count < slot.minPick || count > slot.maxPick) return false;
    }
    return true;
  }

  CartAddResult _addLine({
    required StorefrontMenuItem item,
    required int quantity,
    required int unitPricePoisha,
    required String? variantId,
    required List<Map<String, Object?>> selections,
    required String note,
    required bool confirmVendorReplacement,
  }) {
    if (_pendingOrderIdempotencyKey != null) return CartAddResult.unavailable;
    final bool conflict = _basket.isNotEmpty && _basket.first.dish.vendorId != item.dish.vendorId;
    if (conflict && !confirmVendorReplacement) return CartAddResult.vendorConflict;
    if (conflict) {
      _basket.clear();
      _appliedVoucherCode = null;
      _serverQuote = null;
      _serverCartReplacementConfirmed = true;
    }
    final BasketLineItem next = BasketLineItem(
      item: item,
      quantity: quantity,
      unitPricePoisha: unitPricePoisha,
      variantId: variantId,
      selections: selections,
      specialInstructions: note,
    );
    final int existingIndex = _basket.indexWhere((BasketLineItem row) => row.lineKey == next.lineKey);
    if (existingIndex < 0) {
      _basket.add(next);
    } else {
      final int mergedQuantity = (_basket[existingIndex].quantity + quantity).clamp(1, 50);
      _basket[existingIndex] = next.copyWith(quantity: mergedQuantity);
    }
    _serverQuote = null;
    _receipt = null;
    _onChanged();
    return CartAddResult.added;
  }

  static bool _isUuid(String value) => RegExp(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', caseSensitive: false).hasMatch(value);
}
