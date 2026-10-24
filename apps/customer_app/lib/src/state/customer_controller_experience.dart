/// Customer order, tracking, chat, and account destination bindings (`Build Response 15`).
part of 'customer_controller.dart';

/// Root-controller navigation helpers for the post-checkout customer screens.
extension CustomerControllerExperienceBindings on CustomerController {
  /// Opens one `c-22..c-40` destination and optionally records its parent navigation tab.
  void openCustomerExperienceScreen(CustomerScreenId screen, {int? parentTab}) {
    unawaited(experience.stopTracking());
    commerce.closeFlow();
    if (parentTab != null) _selectedTabIndex = parentTab.clamp(0, 4);
    _activeOverlay = screen;
    _notifyListenersFromCommerceBindings();
  }

  /// Returns to a primary destination after an order or account flow.
  void returnFromCustomerExperience({int tabIndex = 4}) => this.selectTab(tabIndex);

  /// Updates the selected delivery address from the server-backed address book.
  void selectExperienceAddress(CustomerAddressEntry address, {ZoneResolutionVerdict? serverVerdict}) {
    final int existing = _savedAddresses.indexWhere((SavedCustomerAddress row) => row.id == address.id);
    final SavedCustomerAddress model = SavedCustomerAddress(
      id: address.id,
      label: address.label,
      point: address.point,
      plusCode: address.plusCode,
      addressText: address.addressText,
      landmarkNote: address.landmarkNote,
      verdict: serverVerdict ?? resolveZoneLocal(address.point),
      isDefault: address.isDefault,
    );
    if (existing >= 0) {
      _savedAddresses[existing] = model;
      _activeAddressIndex = existing;
    } else {
      _savedAddresses.add(model);
      _activeAddressIndex = _savedAddresses.length - 1;
    }
    _pickupMapCenter = address.point;
    _notifyListenersFromCommerceBindings();
  }

  /// Loads signed-in profile data and hydrates only the address rows returned by W1.
  Future<void> hydrateCustomerExperience() async {
    final CustomerSession? session = _session;
    if (session == null) return;
    await Future.wait<void>(<Future<void>>[
      experience.loadProfile(),
      experience.loadAddresses(),
      experience.loadFavourites(),
      experience.loadNotifications(),
    ]);
    if (_session?.accessToken != session.accessToken || experience.addresses.isEmpty) return;
    final List<SavedCustomerAddress> hydrated = <SavedCustomerAddress>[];
    for (final CustomerAddressEntry address in experience.addresses) {
      final ZoneResolutionVerdict verdict = await _api.resolveZone(address.point);
      if (_session?.accessToken != session.accessToken) return;
      hydrated.add(SavedCustomerAddress(
        id: address.id,
        label: address.label,
        point: address.point,
        plusCode: address.plusCode,
        addressText: address.addressText,
        landmarkNote: address.landmarkNote,
        verdict: verdict,
        isDefault: address.isDefault,
      ));
    }
    if (_session?.accessToken != session.accessToken) return;
    _savedAddresses
      ..clear()
      ..addAll(hydrated);
    _activeAddressIndex = hydrated.indexWhere((SavedCustomerAddress address) => address.isDefault);
    if (_activeAddressIndex < 0) _activeAddressIndex = 0;
    _pickupMapCenter = activeAddress.point;
    _notifyListenersFromCommerceBindings();
  }

  /// Persists an onboarding/checkout address to W1 for an authenticated customer.
  void persistCustomerAddress(SavedCustomerAddress address) {
    final CustomerSession? session = _session;
    if (session == null || address.addressText.trim().length < 3) return;
    final bool isExistingId = RegExp(r'^[0-9a-f-]{36}$', caseSensitive: false).hasMatch(address.id);
    final CustomerAddressEntry draft = CustomerAddressEntry(
      id: isExistingId ? address.id : '',
      label: address.label,
      point: address.point,
      addressText: address.addressText,
      landmarkNote: address.landmarkNote,
      zoneId: null,
      isDefault: address.isDefault,
    );
    unawaited(this._persistCustomerAddress(draft, isExistingId ? address.id : null, address.id, session.accessToken));
  }

  /// Replaces private local addresses after sign-out with a coarse service-area pin.
  void resetLocalAddressAfterSignOut() {
    final GeoPoint point = kSylhetSadarZone.center;
    _savedAddresses
      ..clear()
      ..add(SavedCustomerAddress(
        id: 'area-sylhet-sadar',
        label: 'Sylhet Sadar',
        point: point,
        plusCode: encodePlusCode(point),
        addressText: 'Sylhet Sadar, Sylhet',
        landmarkNote: '',
        verdict: resolveZoneLocal(point),
        isDefault: true,
      ));
    _activeAddressIndex = 0;
    _pickupMapCenter = point;
  }

  Future<void> _persistCustomerAddress(CustomerAddressEntry draft, String? addressId, String priorLocalId, String sessionToken) async {
    final CustomerAddressEntry? saved = await experience.saveAddress(draft, addressId: addressId, isDefault: draft.isDefault);
    if (saved == null || _session?.accessToken != sessionToken) return;
    final ZoneResolutionVerdict verdict = await _api.resolveZone(saved.point);
    if (_session?.accessToken != sessionToken) return;
    final int localIndex = _savedAddresses.indexWhere((SavedCustomerAddress row) => row.id == priorLocalId);
    if (localIndex >= 0 && priorLocalId != saved.id) {
      _savedAddresses.removeAt(localIndex);
      if (_activeAddressIndex > localIndex) _activeAddressIndex -= 1;
    }
    this.selectExperienceAddress(saved, serverVerdict: verdict);
  }
}
