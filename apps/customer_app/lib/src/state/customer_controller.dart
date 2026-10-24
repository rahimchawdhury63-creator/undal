/// Reactive root controller for customer screens `c-01..c-40` (`File 16`).
///
/// Coordinates onboarding/auth/address/search and delegates storefront, basket, voucher, COD, order,
/// tracking, and account state while keeping server-owned data authoritative.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:undal_core/undal_core.dart';

import '../data/sylhet_seed_catalog.dart';
import '../models/customer_cart_models.dart';
import '../models/customer_experience_models.dart';
import '../models/customer_models.dart';
import '../services/customer_api_client.dart';
import '../services/customer_experience_api.dart';
import '../services/customer_order_realtime.dart';
import 'customer_commerce_state.dart';
import 'customer_experience_state.dart';

part 'customer_controller_commerce.dart';
part 'customer_controller_experience.dart';

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
      id: 'area-sylhet-sadar',
      label: 'Sylhet Sadar',
      point: defaultPin,
      plusCode: encodePlusCode(defaultPin),
      addressText: 'Sylhet Sadar, Sylhet',
      landmarkNote: '',
      verdict: resolveZoneLocal(defaultPin),
      isDefault: true,
    );
    _savedAddresses.add(starter);
    _draftPin = starter.point;
    _draftPinVerdict = starter.verdict;
    commerce = CustomerCommerceState(
      apiClient: _api,
      onChanged: notifyListeners,
      readSession: () => _session,
      readAddress: () => activeAddress,
      readFulfilment: () => _fulfilmentMode,
      writeFulfilment: (UndalFulfilmentMode mode) => _fulfilmentMode = mode,
      requestAuthentication: (PendingAuthIntent intent) => openAuthHub(intent: intent),
      readOffline: () => _isOffline,
    );
    experience = CustomerExperienceState(
      api: CustomerExperienceApi(config: _api.config, transport: _api.transport),
      realtime: CustomerOrderRealtimeClient(config: _api.config, transport: _api.transport),
      readSession: () => _session,
      navigate: (CustomerScreenId screen) {
        _activeOverlay = screen;
        notifyListeners();
      },
      onChanged: notifyListeners,
    );
  }

  final CustomerApiClient _api;
  late final CustomerCommerceState commerce;
  /// After-checkout, social, and account state for `c-22..c-40`.
  late final CustomerExperienceState experience;
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
  Timer? _flashTimer;
  int _flashSecondsLeft = kDefaultFlashBoxWindow.remainingMinutes * 60 +
      kDefaultFlashBoxWindow.remainingSeconds;

  CustomerApiClient get api => _api;
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
  Set<String> get favouriteVendorIds => experience.favouriteVendorIds;
  Set<String> get notifyWhenOpenIds =>
      Set<String>.unmodifiable(_notifyWhenOpenIds);
  GeoPoint get pickupMapCenter => _pickupMapCenter;
  String? get selectedPickupVendorId => _selectedPickupVendorId;
  String get searchQuery => _searchQuery;
  SearchScopeTab get searchScope => _searchScope;
  List<String> get recentSearches => List<String>.unmodifiable(_recentSearches);
  int get flashSecondsLeft => _flashSecondsLeft;

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
  void startOnboardingFlow({CustomerScreenId startAt = CustomerScreenId.c01Splash}) {
    commerce.closeFlow();
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
    if (streetAddress.trim().length < 3) return;
    final SavedCustomerAddress created = SavedCustomerAddress(
      id: 'addr-${DateTime.now().microsecondsSinceEpoch}',
      label: label.trim().isEmpty ? 'Home' : label.trim(),
      point: _draftPin,
      plusCode: encodePlusCode(_draftPin),
      addressText: streetAddress.trim(),
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
    if (_session != null) this.persistCustomerAddress(created);
  }

  void selectSavedAddress(int index) {
    if (index < 0 || index >= _savedAddresses.length) return;
    _activeAddressIndex = index;
    _pickupMapCenter = activeAddress.point;
    notifyListeners();
  }

  /// Updates the active delivery pin; c-20 persists it with the next W1 quote.
  void updateActiveAddress({
    required GeoPoint point,
    required String streetAddress,
    required String landmarkNote,
  }) {
    if (streetAddress.trim().length < 3) return;
    final SavedCustomerAddress previous = activeAddress;
    final SavedCustomerAddress updated = SavedCustomerAddress(
      id: previous.id == 'area-sylhet-sadar' ? 'addr-${DateTime.now().microsecondsSinceEpoch}' : previous.id,
      label: previous.label,
      point: point,
      plusCode: encodePlusCode(point),
      addressText: streetAddress.trim(),
      landmarkNote: landmarkNote.trim(),
      verdict: _draftPinVerdict,
      isDefault: previous.isDefault,
    );
    _savedAddresses[_activeAddressIndex] = updated;
    _draftPin = point;
    _pickupMapCenter = point;
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
    commerce.closeFlow();
    _notificationsEnabled = enabled;
    _activeOverlay = CustomerScreenId.c08HomeDelivery;
    notifyListeners();
  }

  void dismissOverlayToShell() {
    _authErrorCode = null;
    commerce.cancelAuthenticationResume();
    _activeOverlay = CustomerScreenId.c08HomeDelivery;
    notifyListeners();
  }

  void openAuthHub({PendingAuthIntent intent = const DirectSignInIntent()}) {
    _pendingIntent = intent;
    _authErrorCode = null;
    _activeOverlay = CustomerScreenId.c06AuthHub;
    commerce.suspendForAuthentication();
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
    if (resumeLater) {
      _activeOverlay = CustomerScreenId.c08HomeDelivery;
      commerce.resumePreviousScreen();
    }
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
      if (_api.config.hasLiveWorkers && resumed is! FavouriteVendorIntent) {
        unawaited(this.hydrateCustomerExperience());
      }
      if (resumed is FavouriteVendorIntent) {
        if (_api.config.hasLiveWorkers) unawaited(_toggleFavouriteAndHydrate(resumed.vendorId));
        commerce.resumePreviousScreen();
      } else if (resumed is CheckoutOrderIntent) {
        commerce.resumeCheckout();
      } else if (resumed is VoucherPickerIntent) {
        commerce.resumeVoucherPicker();
      } else if (resumed is SaveAddressBookIntent) {
        _savedAddresses.add(resumed.address);
        _activeAddressIndex = _savedAddresses.length - 1;
        this.persistCustomerAddress(resumed.address);
        commerce.resumePreviousScreen();
      } else {
        if (_api.config.hasLiveWorkers && activeAddress.id.startsWith('addr-')) {
          this.persistCustomerAddress(activeAddress);
        }
        commerce.resumePreviousScreen();
      }
      notifyListeners();
      return true;
    } on FormatException catch (err) {
      _authErrorCode = err.message;
      notifyListeners();
      return false;
    }
  }

  Future<void> _toggleFavouriteAndHydrate(String vendorId) async {
    await experience.toggleFavourite(vendorId);
    await this.hydrateCustomerExperience();
  }

  void updateFilters(FeedFilterState next) {
    _filters = next;
    notifyListeners();
  }

  void resetAllFilters() => updateFilters(const FeedFilterState());

  /// Toggles a kitchen favourite through authenticated W1; guest taps resume after sign-in.
  void toggleFavouriteVendor(String vendorId) {
    if (!isAuthenticated) {
      openAuthHub(intent: FavouriteVendorIntent(vendorId));
      return;
    }
    unawaited(experience.toggleFavourite(vendorId));
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

  void _notifyListenersFromCommerceBindings() => notifyListeners();

  @override
  void dispose() {
    _flashTimer?.cancel();
    experience.dispose();
    super.dispose();
  }
}
