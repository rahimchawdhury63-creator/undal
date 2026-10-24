/// Server-backed favourites, address book, inbox, and profile operations.
part of 'customer_experience_state.dart';

extension CustomerExperienceAccountOperations on CustomerExperienceState {
  /// Loads server-saved delivery addresses.
  Future<void> loadAddresses() async {
    final CustomerSession? session = _readSession();
    if (session == null) {
      _setAddressesError('SESSION_REQUIRED');
      return;
    }
    final int generation = _sessionGeneration;
    _addressesLoading = true;
    _addressesError = null;
    _onChanged();
    try {
      final List<CustomerAddressEntry> addresses = await _api.listAddresses(accessToken: session.accessToken);
      if (_sessionStillCurrent(session, generation)) _addresses = addresses;
    } on CustomerApiProblem catch (error) {
      if (_sessionStillCurrent(session, generation)) _addressesError = error.code;
    } on Object {
      if (_sessionStillCurrent(session, generation)) _addressesError = 'NETWORK_UNAVAILABLE';
    } finally {
      if (generation == _sessionGeneration) {
        _addressesLoading = false;
        _onChanged();
      }
    }
  }

  /// Persists a new or edited address and returns its canonical W1 row.
  Future<CustomerAddressEntry?> saveAddress(CustomerAddressEntry address, {String? addressId, bool? isDefault}) async {
    final CustomerSession? session = _readSession();
    if (session == null) return null;
    final int generation = _sessionGeneration;
    _addressesError = null;
    try {
      final CustomerAddressEntry saved = await _api.saveAddress(
        accessToken: session.accessToken,
        address: address,
        addressId: addressId,
        isDefault: isDefault,
      );
      if (!_sessionStillCurrent(session, generation)) return null;
      await loadAddresses();
      if (!_sessionStillCurrent(session, generation)) return null;
      return _addresses.firstWhere((CustomerAddressEntry row) => row.id == saved.id, orElse: () => saved);
    } on CustomerApiProblem catch (error) {
      if (_sessionStillCurrent(session, generation)) {
        _addressesError = error.code;
        _onChanged();
      }
      return null;
    } on Object {
      if (_sessionStillCurrent(session, generation)) {
        _addressesError = 'NETWORK_UNAVAILABLE';
        _onChanged();
      }
      return null;
    }
  }

  /// Deletes a saved address only after the owner-scoped W1 request succeeds.
  Future<bool> deleteAddress(String addressId) async {
    final CustomerSession? session = _readSession();
    if (session == null) return false;
    final int generation = _sessionGeneration;
    try {
      await _api.deleteAddress(accessToken: session.accessToken, addressId: addressId);
      if (!_sessionStillCurrent(session, generation)) return false;
      _addresses = _addresses.where((CustomerAddressEntry row) => row.id != addressId).toList(growable: false);
      _onChanged();
      return true;
    } on CustomerApiProblem catch (error) {
      if (_sessionStillCurrent(session, generation)) {
        _addressesError = error.code;
        _onChanged();
      }
      return false;
    } on Object {
      if (_sessionStillCurrent(session, generation)) {
        _addressesError = 'NETWORK_UNAVAILABLE';
        _onChanged();
      }
      return false;
    }
  }

  /// Loads the server-backed bilingual notification inbox.
  Future<void> loadNotifications() async {
    final CustomerSession? session = _readSession();
    if (session == null) {
      _setNotificationsError('SESSION_REQUIRED');
      return;
    }
    final int generation = _sessionGeneration;
    _notificationsLoading = true;
    _notificationsError = null;
    _onChanged();
    try {
      final List<CustomerInboxNotification> rows = await _api.listNotifications(accessToken: session.accessToken);
      if (_sessionStillCurrent(session, generation)) _notifications = rows;
    } on CustomerApiProblem catch (error) {
      if (_sessionStillCurrent(session, generation)) _notificationsError = error.code;
    } on Object {
      if (_sessionStillCurrent(session, generation)) _notificationsError = 'NETWORK_UNAVAILABLE';
    } finally {
      if (generation == _sessionGeneration) {
        _notificationsLoading = false;
        _onChanged();
      }
    }
  }

  /// Marks notification IDs read on W1 and updates the local representation after success.
  Future<bool> markNotificationsRead(List<String> ids) async {
    final CustomerSession? session = _readSession();
    if (session == null) return false;
    final int generation = _sessionGeneration;
    try {
      await _api.markNotificationsRead(accessToken: session.accessToken, ids: ids);
      if (!_sessionStillCurrent(session, generation)) return false;
      final DateTime now = DateTime.now();
      _notifications = _notifications.map((CustomerInboxNotification row) {
        if (ids.isNotEmpty && !ids.contains(row.id)) return row;
        return CustomerInboxNotification(
          id: row.id,
          kind: row.kind,
          titleEn: row.titleEn,
          titleBn: row.titleBn,
          bodyEn: row.bodyEn,
          bodyBn: row.bodyBn,
          createdAt: row.createdAt,
          readAt: now,
        );
      }).toList(growable: false);
      _onChanged();
      return true;
    } on CustomerApiProblem catch (error) {
      if (_sessionStillCurrent(session, generation)) {
        _notificationsError = error.code;
        _onChanged();
      }
      return false;
    } on Object {
      if (_sessionStillCurrent(session, generation)) {
        _notificationsError = 'NETWORK_UNAVAILABLE';
        _onChanged();
      }
      return false;
    }
  }

  /// Loads the authenticated customer's W1 profile.
  Future<void> loadProfile() async {
    final CustomerSession? session = _readSession();
    if (session == null) {
      _setProfileError('SESSION_REQUIRED');
      return;
    }
    final int generation = _sessionGeneration;
    _profileLoading = true;
    _profileError = null;
    _onChanged();
    try {
      final CustomerProfileSnapshot profile = await _api.loadProfile(accessToken: session.accessToken);
      if (_sessionStillCurrent(session, generation)) _profile = profile;
    } on CustomerApiProblem catch (error) {
      if (_sessionStillCurrent(session, generation)) _profileError = error.code;
    } on Object {
      if (_sessionStillCurrent(session, generation)) _profileError = 'NETWORK_UNAVAILABLE';
    } finally {
      if (generation == _sessionGeneration) {
        _profileLoading = false;
        _onChanged();
      }
    }
  }

  /// Saves editable profile fields to W1 and refreshes the canonical profile.
  Future<bool> updateProfile({String? fullName, String? language}) async {
    final CustomerSession? session = _readSession();
    if (session == null) return false;
    final int generation = _sessionGeneration;
    try {
      final CustomerProfileSnapshot profile = await _api.updateProfile(
        accessToken: session.accessToken,
        fullName: fullName,
        language: language,
      );
      if (!_sessionStillCurrent(session, generation)) return false;
      _profile = profile;
      _profileError = null;
      _onChanged();
      return true;
    } on CustomerApiProblem catch (error) {
      if (_sessionStillCurrent(session, generation)) {
        _profileError = error.code;
        _onChanged();
      }
      return false;
    } on Object {
      if (_sessionStillCurrent(session, generation)) {
        _profileError = 'NETWORK_UNAVAILABLE';
        _onChanged();
      }
      return false;
    }
  }


  void _setAddressesError(String value) { _addressesError = value; _onChanged(); }
  void _setNotificationsError(String value) { _notificationsError = value; _onChanged(); }
  void _setProfileError(String value) { _profileError = value; _onChanged(); }
}
