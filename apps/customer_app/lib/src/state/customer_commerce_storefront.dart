part of 'customer_commerce_state.dart';

/// W1 catalog loading and vendor info/review navigation for commerce state.
extension CustomerCommerceStorefrontOperations on CustomerCommerceState {
  /// Opens c-13 immediately and refreshes it from the privacy-safe W1 storefront endpoint.
  void openVendor(VendorFeedCard vendor) {
    _feedVendor = vendor;
    _storefront = VendorStorefront.fromFeed(vendor);
    _storefrontUnavailable = false;
    _storefrontLoading = _api.isConfigured;
    _activeScreen = CustomerScreenId.c13VendorStorefront;
    _commerceErrorCode = null;
    _onChanged();
    if (_api.isConfigured) unawaited(_refreshStorefront(vendor.slug));
  }

  /// Retries the current vendor's W1 storefront request without creating a substitute vendor.
  void retryStorefront() {
    final VendorFeedCard? vendor = _feedVendor;
    if (vendor != null) openVendor(vendor);
  }

  Future<void> _refreshStorefront(String slug) async {
    final VendorStorefront? live = await _api.loadStorefront(slug);
    if (_feedVendor?.slug != slug) return;
    _storefrontLoading = false;
    if (live == null || live.vendor.id.isEmpty) {
      _storefrontUnavailable = true;
      _commerceErrorCode = 'STOREFRONT_UNAVAILABLE';
    } else {
      _storefront = live;
      _storefrontUnavailable = false;
      _commerceErrorCode = null;
    }
    _onChanged();
  }

  /// Opens c-16 and exposes only public profile, hygiene and weekly-hours data.
  void openVendorInfo() {
    if (_storefront == null) return;
    _activeScreen = CustomerScreenId.c16VendorInfo;
    _onChanged();
  }

  /// Opens c-17 and asynchronously loads visible verified-buyer reviews from W1.
  void openVendorReviews() {
    if (_storefront == null) return;
    _activeScreen = CustomerScreenId.c17VendorReviews;
    _reviewsLoading = _api.isConfigured;
    _reviewsUnavailable = !_api.isConfigured;
    _reviewsLoaded = false;
    _reviews = <CustomerVendorReview>[];
    _onChanged();
    if (_api.isConfigured) unawaited(_refreshReviews(_storefront!.vendor.slug));
  }

  Future<void> _refreshReviews(String slug) async {
    final List<CustomerVendorReview>? result = await _api.loadVendorReviews(slug);
    if (_storefront?.vendor.slug != slug) return;
    _reviewsLoading = false;
    _reviewsLoaded = result != null;
    _reviewsUnavailable = result == null;
    _reviews = result ?? <CustomerVendorReview>[];
    _onChanged();
  }

  /// Returns from an item, kitchen info, or reviews screen to its storefront.
  void backToStorefront() {
    if (_editingLineKey != null) {
      _editingLineKey = null;
      _activeItem = null;
      _activeScreen = null;
    } else {
      _activeScreen = _storefront == null ? null : CustomerScreenId.c13VendorStorefront;
    }
    _onChanged();
  }

}
