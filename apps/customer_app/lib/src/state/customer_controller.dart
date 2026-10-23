/// Reactive application controller for `apps/customer_app` Part 1 (`c-01..c-12`, `File 16`).
///
/// Governs sequential unstacked onboarding (`c-01..c-05`, fixing `AP-4`), guest browsing +
/// intercepted-action `c-06` Auth Hub & resumable 3-step `c-07` Sign-Up, active delivery address
/// switcher & live zone verdicts, `c-08` Delivery ⇄ `c-09` Self-Pickup feeds, `c-10` Full-Screen
/// Pickup Map sync, `c-11/c-12` Banglish Search, Cart badge, Favourites & Offline cached mode.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:undal_core/undal_core.dart';

import '../data/sylhet_seed_catalog.dart';
import '../models/customer_models.dart';
import '../services/customer_api_client.dart';

/// Single line entry in the active single-vendor customer basket.
final class BasketLineItem {
  const BasketLineItem({required this.dish, required this.quantity});
  final CatalogDishItem dish;
  final int quantity;
  int get lineTotalPoisha => dish.pricePoisha * quantity;
}

/// Central `ChangeNotifier` state machine driving `UndalCustomerApp`.
final class CustomerController extends ChangeNotifier {
  CustomerController({
    CustomerApiClient? apiClient,
    CustomerScreenId initialOverlay = CustomerScreenId.c08HomeDelivery,
    Locale initialLocale = const Locale('en'),
    ThemeMode initialThemeMode = ThemeMode.light,
  })  : _api = apiClient ?? CustomerApiClient(),
        _activeOverlay = initialOverlay,
        _locale = initialLocale,
        _themeMode = initialThemeMode {
    final GeoPoint defaultPin = kSylhetSadarZone.center;
    final SavedCustomerAddress starter = SavedCustomerAddress(
      id: 'addr-sylhet-default',
      label: 'Home',
      point: defaultPin,
      plusCode: encodePlusCode(defaultPin),
      addressText: 'Zindabazar Water Works Rd, Sylhet',
      landmarkNote: 'Blue gate opposite Water Works tank, 3rd floor',
      verdict: resolveZoneLocal(defaultPin),
      isDefault: true,
    );
    _savedAddresses.add(starter);
    _draftPin = starter.point;
    _draftPinVerdict = starter.verdict;
  }

  final CustomerApiClient _api;
  CustomerScreenId _activeOverlay;
  Locale _locale;
  ThemeMode _themeMode;
  int _selectedTabIndex = 0;
  UndalFulfilmentMode _fulfilmentMode = UndalFulfilmentMode.delivery;
  bool _isOffline = false;
  bool _notificationsEnabled = false;
  int _carouselIndex = 0;

  CustomerSession? _session;
  PendingAuthIntent? _pendingIntent;
  SignUpDraft _signUpDraft = const SignUpDraft();
  String? _authErrorCode;

  final List<SavedCustomerAddress> _savedAddresses = <SavedCustomerAddress>[];
  int _activeAddressIndex = 0;
  GeoPoint _draftPin = kSylhetSadarZone.center;
  late ZoneResolutionVerdict _draftPinVerdict;
  List<GeoPlaceSuggestion> _landmarkSuggestions = kSylhetLandmarkSuggestions;

  FeedFilterState _filters = const FeedFilterState();
  final List<VendorFeedCard> _catalogPool = kSeededSylhetVendors;
  final Set<String> _favouriteVendorIds = <String>{};
  final Set<String> _notifyWhenOpenIds = <String>{};

  GeoPoint _pickupMapCenter = kSylhetSadarZone.center;
  double _pickupRadiusKm = 3.5;
  String? _selectedPickupVendorId;

  String _searchQuery = '';
  SearchScopeTab _searchScope = SearchScopeTab.all;
  final List<String> _recentSearches = <String>[
    'Kacchi Biryani',
    'Shutki Bhorta',
    'Malai Cha',
  ];
  final List<BasketLineItem> _basket = <BasketLineItem>[];
  Timer? _flashTimer;
  int _flashSecondsLeft = kDefaultFlashBoxWindow.remainingMinutes * 60 +
      kDefaultFlashBoxWindow.remainingSeconds;

  CustomerApiClient get api => _api;
  CustomerScreenId get activeOverlay => _activeOverlay;
  Locale get locale => _locale;
  ThemeMode get themeMode => _themeMode;
  int get selectedTabIndex => _selectedTabIndex;
  UndalFulfilmentMode get fulfilmentMode => _fulfilmentMode;
  bool get isOffline => _isOffline;
  bool get notificationsEnabled => _notificationsEnabled;
  int get carouselIndex => _carouselIndex;
  CustomerSession? get session => _session;
  bool get isAuthenticated => _session != null;
  PendingAuthIntent? get pendingIntent => _pendingIntent;
  SignUpDraft get signUpDraft => _signUpDraft;
  String? get authErrorCode => _authErrorCode;
  List<SavedCustomerAddress> get savedAddresses =>
      List<SavedCustomerAddress>.unmodifiable(_savedAddresses);
  SavedCustomerAddress get activeAddress =>
      _savedAddresses[_activeAddressIndex.clamp(0, _savedAddresses.length - 1)];
  GeoPoint get draftPin => _draftPin;
  ZoneResolutionVerdict get draftPinVerdict => _draftPinVerdict;
  List<GeoPlaceSuggestion> get landmarkSuggestions => _landmarkSuggestions;
  FeedFilterState get filters => _filters;
  Set<String> get favouriteVendorIds =>
      Set<String>.unmodifiable(_favouriteVendorIds);
  Set<String> get notifyWhenOpenIds =>
      Set<String>.unmodifiable(_notifyWhenOpenIds);
  GeoPoint get pickupMapCenter => _pickupMapCenter;
  String? get selectedPickupVendorId => _selectedPickupVendorId;
  String get searchQuery => _searchQuery;
  SearchScopeTab get searchScope => _searchScope;
  List<String> get recentSearches => List<String>.unmodifiable(_recentSearches);
  List<BasketLineItem> get basket => List<BasketLineItem>.unmodifiable(_basket);
  int get totalBasketItems =>
      _basket.fold<int>(0, (int sum, BasketLineItem i) => sum + i.quantity);
  int get flashSecondsLeft => _flashSecondsLeft;

  /// Canonical screen ID currently visible (`c-01..c-12`).
  CustomerScreenId get currentScreenId {
    if (_activeOverlay != CustomerScreenId.c08HomeDelivery) {
      return _activeOverlay;
    }
    if (_selectedTabIndex == 1) {
      return _searchQuery.trim().isEmpty
          ? CustomerScreenId.c11SearchHome
          : CustomerScreenId.c12SearchResults;
    }
    return _fulfilmentMode == UndalFulfilmentMode.pickup
        ? CustomerScreenId.c09HomePickup
        : CustomerScreenId.c08HomeDelivery;
  }

  List<VendorFeedCard> get rankedFeed => !activeAddress.verdict.inServiceArea
      ? const <VendorFeedCard>[]
      : _api.rankAndFilterFeed(
          pool: _catalogPool,
          mode: _fulfilmentMode,
          filters: _filters,
        );

  List<VendorFeedCard> get orderAgainVendors => _catalogPool
      .where((VendorFeedCard v) =>
          v.orderedBefore &&
          (_fulfilmentMode != UndalFulfilmentMode.pickup || v.acceptsPickup))
      .toList();

  List<VendorFeedCard> get pickupMapVendors {
    final List<VendorFeedCard> list = _catalogPool
        .where(
          (VendorFeedCard v) =>
              v.acceptsPickup &&
              v.pickupPoint != null &&
              haversineKm(_pickupMapCenter, v.pickupPoint!) <= _pickupRadiusKm,
        )
        .toList();
    if (_selectedPickupVendorId == null && list.isNotEmpty) {
      _selectedPickupVendorId = list.first.id;
    }
    return list;
  }

  SearchQueryResult get searchResults => _api.searchLocalCatalog(
        rawQuery: _searchQuery,
        pool: _catalogPool,
        mode: _fulfilmentMode,
      );

  void startFlashCountdownTicker() {
    _flashTimer?.cancel();
    _flashTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (_flashSecondsLeft > 0) {
        _flashSecondsLeft -= 1;
        notifyListeners();
      }
    });
  }

  void toggleLocale() {
    _locale =
        _locale.languageCode == 'en' ? const Locale('bn') : const Locale('en');
    notifyListeners();
  }

  void setLocale(Locale next) { _locale = next; notifyListeners(); }
  void toggleThemeMode() {
    _themeMode = _themeMode == ThemeMode.light ? ThemeMode.dark : ThemeMode.light;
    notifyListeners();
  }
  void toggleOfflineSimulation() { _isOffline = !_isOffline; notifyListeners(); }
  void selectTab(int index) {
    _selectedTabIndex = index.clamp(0, 4);
    _activeOverlay = CustomerScreenId.c08HomeDelivery;
    notifyListeners();
  }
  void setFulfilmentMode(UndalFulfilmentMode next) { _fulfilmentMode = next; notifyListeners(); }
  void startOnboardingFlow({CustomerScreenId startAt = CustomerScreenId.c01Splash}) {
    _carouselIndex = 0;
    _activeOverlay = startAt;
    notifyListeners();
  }
  void advanceSplashToCarousel() { _activeOverlay = CustomerScreenId.c02Carousel; notifyListeners(); }
  void setCarouselIndex(int index) { _carouselIndex = index.clamp(0, 2); notifyListeners(); }

  void advanceCarouselOrPrimeLocation() {
    if (_carouselIndex < 2) {
      _carouselIndex += 1;
    } else {
      _activeOverlay = CustomerScreenId.c03LocationPrime;
    }
    notifyListeners();
  }

  void openAddressPinScreen({GeoPoint? initialPoint}) {
    _draftPin = initialPoint ?? activeAddress.point;
    _draftPinVerdict = resolveZoneLocal(_draftPin);
    _activeOverlay = CustomerScreenId.c04AddressPin;
    notifyListeners();
  }

  Future<void> updateDraftPin(GeoPoint nextPoint) async {
    _draftPin = nextPoint;
    _draftPinVerdict = resolveZoneLocal(nextPoint);
    notifyListeners();
    final ZoneResolutionVerdict remote = await _api.resolveZone(nextPoint);
    if (_draftPin == nextPoint) {
      _draftPinVerdict = remote;
      notifyListeners();
    }
  }

  Future<void> filterLandmarks(String query) async {
    _landmarkSuggestions = await _api.searchLandmarks(query);
    notifyListeners();
  }

  void savePinnedAddress({
    required String label,
    required String streetAddress,
    required String landmarkNote,
    bool proceedToNotificationPrime = false,
  }) {
    final SavedCustomerAddress created = SavedCustomerAddress(
      id: 'addr-${DateTime.now().microsecondsSinceEpoch}',
      label: label.trim().isEmpty ? 'Home' : label.trim(),
      point: _draftPin,
      plusCode: encodePlusCode(_draftPin),
      addressText: streetAddress.trim().isEmpty
          ? 'Pinned Road (${encodePlusCode(_draftPin)})'
          : streetAddress.trim(),
      landmarkNote: landmarkNote.trim(),
      verdict: _draftPinVerdict,
      isDefault: true,
    );
    _savedAddresses.add(created);
    _activeAddressIndex = _savedAddresses.length - 1;
    _pickupMapCenter = created.point;
    _activeOverlay = proceedToNotificationPrime
        ? CustomerScreenId.c05NotificationPrime
        : CustomerScreenId.c08HomeDelivery;
    notifyListeners();
  }

  void selectSavedAddress(int index) {
    if (index < 0 || index >= _savedAddresses.length) return;
    _activeAddressIndex = index;
    _pickupMapCenter = activeAddress.point;
    notifyListeners();
  }

  void deleteSavedAddress(String id) {
    if (_savedAddresses.length <= 1) return;
    _savedAddresses.removeWhere((SavedCustomerAddress a) => a.id == id);
    _activeAddressIndex =
        _activeAddressIndex.clamp(0, _savedAddresses.length - 1);
    notifyListeners();
  }

  void completeNotificationPrime({required bool enabled}) {
    _notificationsEnabled = enabled;
    _activeOverlay = CustomerScreenId.c08HomeDelivery;
    notifyListeners();
  }

  void dismissOverlayToShell() {
    _authErrorCode = null;
    _activeOverlay = CustomerScreenId.c08HomeDelivery;
    notifyListeners();
  }

  void openAuthHub({PendingAuthIntent intent = const DirectSignInIntent()}) {
    _pendingIntent = intent;
    _authErrorCode = null;
    _activeOverlay = CustomerScreenId.c06AuthHub;
    notifyListeners();
  }

  void openSignUpWizard() {
    _authErrorCode = null;
    _activeOverlay = CustomerScreenId.c07SignUp;
    notifyListeners();
  }

  void saveSignUpDraft(SignUpDraft next, {bool resumeLater = false}) {
    _signUpDraft = next;
    _authErrorCode = null;
    if (resumeLater) _activeOverlay = CustomerScreenId.c08HomeDelivery;
    notifyListeners();
  }

  Future<bool> submitSignIn({
    required String identifier,
    required String secretOrOtp,
    required String method,
    String? displayName,
    String? optionalLandmark,
  }) async {
    _authErrorCode = null;
    try {
      _session = await _api.signIn(
        identifier: identifier,
        secretOrOtp: secretOrOtp,
        method: method,
        displayNameOverride: displayName,
      );
      if (optionalLandmark != null && optionalLandmark.trim().isNotEmpty) {
        _savedAddresses[_activeAddressIndex] = activeAddress.copyWith(
          landmarkNote: optionalLandmark.trim(),
        );
      }
      _signUpDraft = const SignUpDraft();
      final PendingAuthIntent? resumed = _pendingIntent;
      _pendingIntent = null;
      _activeOverlay = CustomerScreenId.c08HomeDelivery;
      if (resumed is FavouriteVendorIntent) {
        _toggleFavouriteInternal(resumed.vendorId);
      } else if (resumed is SaveAddressBookIntent) {
        _savedAddresses.add(resumed.address);
        _activeAddressIndex = _savedAddresses.length - 1;
      }
      notifyListeners();
      return true;
    } on FormatException catch (err) {
      _authErrorCode = err.message;
      notifyListeners();
      return false;
    }
  }

  void signOut() {
    _session = null;
    notifyListeners();
  }

  void updateFilters(FeedFilterState next) {
    _filters = next;
    notifyListeners();
  }

  void resetAllFilters() => updateFilters(const FeedFilterState());

  void toggleFavouriteVendor(String vendorId) {
    if (!isAuthenticated) {
      openAuthHub(intent: FavouriteVendorIntent(vendorId));
      return;
    }
    _toggleFavouriteInternal(vendorId);
    notifyListeners();
  }

  void _toggleFavouriteInternal(String vendorId) {
    if (!_favouriteVendorIds.remove(vendorId)) _favouriteVendorIds.add(vendorId);
  }

  void toggleNotifyWhenOpen(String vendorId) {
    if (!_notifyWhenOpenIds.remove(vendorId)) _notifyWhenOpenIds.add(vendorId);
    notifyListeners();
  }

  void openPickupFullMap({String? initialVendorId}) {
    _fulfilmentMode = UndalFulfilmentMode.pickup;
    _pickupMapCenter = activeAddress.point;
    _selectedPickupVendorId = initialVendorId;
    _activeOverlay = CustomerScreenId.c10PickupMap;
    notifyListeners();
  }

  void movePickupMapCamera(GeoPoint center) {
    _pickupMapCenter = center;
    notifyListeners();
  }

  void searchPickupArea({double radiusKm = 4.5}) {
    _pickupRadiusKm = radiusKm;
    final List<VendorFeedCard> hits = pickupMapVendors;
    _selectedPickupVendorId = hits.isNotEmpty ? hits.first.id : null;
    notifyListeners();
  }

  void selectPickupMarker(String vendorId) {
    _selectedPickupVendorId = vendorId;
    final VendorFeedCard? match =
        _catalogPool.where((VendorFeedCard v) => v.id == vendorId).firstOrNull;
    if (match?.pickupPoint != null) _pickupMapCenter = match!.pickupPoint!;
    notifyListeners();
  }

  void setSearchQuery(String query, {bool recordRecent = false}) {
    _searchQuery = query;
    if (recordRecent && query.trim().length >= 2) {
      final String clean = query.trim();
      _recentSearches.removeWhere((String p) => p.toLowerCase() == clean.toLowerCase());
      _recentSearches.insert(0, clean);
      if (_recentSearches.length > 6) _recentSearches.removeLast();
    }
    notifyListeners();
  }

  void setSearchScope(SearchScopeTab scope) {
    _searchScope = scope;
    notifyListeners();
  }

  void clearRecentSearches() {
    _recentSearches.clear();
    notifyListeners();
  }

  bool addDishToBasket(CatalogDishItem dish) {
    if (_isOffline) return false;
    if (_basket.isNotEmpty && _basket.first.dish.vendorId != dish.vendorId) {
      _basket.clear();
    }
    final int idx =
        _basket.indexWhere((BasketLineItem line) => line.dish.id == dish.id);
    if (idx >= 0) {
      _basket[idx] =
          BasketLineItem(dish: dish, quantity: _basket[idx].quantity + 1);
    } else {
      _basket.add(BasketLineItem(dish: dish, quantity: 1));
    }
    notifyListeners();
    return true;
  }

  void decrementBasketItem(String dishId) {
    final int idx =
        _basket.indexWhere((BasketLineItem line) => line.dish.id == dishId);
    if (idx < 0) return;
    if (_basket[idx].quantity <= 1) {
      _basket.removeAt(idx);
    } else {
      _basket[idx] = BasketLineItem(
        dish: _basket[idx].dish,
        quantity: _basket[idx].quantity - 1,
      );
    }
    notifyListeners();
  }

  @override
  void dispose() {
    _flashTimer?.cancel();
    super.dispose();
  }
}
