/// Order chat, support tickets, rating, and account-close operations.
part of 'customer_experience_state.dart';

extension CustomerExperienceSocialOperations on CustomerExperienceState {
  /// Opens a W1-polled conversation for the current customer and assigned participant.
  Future<void> openChat(String orderId, {required bool withRider}) async {
    final CustomerSession? session = _readSession();
    if (session == null) return;
    final int generation = _sessionGeneration;
    await stopTracking();
    if (!_sessionStillCurrent(session, generation)) return;
    _chatOrderId = orderId;
    _chatPair = withRider ? 'customer_rider' : 'customer_vendor';
    _chatMessages = <CustomerChatMessage>[];
    _chatLoading = false;
    _chatSending = false;
    _chatError = null;
    _navigate(withRider ? CustomerScreenId.c24RiderChat : CustomerScreenId.c25KitchenChat);
    await loadChatMessages();
  }

  /// Refreshes the selected participant chat from W1.
  Future<void> loadChatMessages() async {
    final CustomerSession? session = _readSession();
    final String? orderId = _chatOrderId;
    if (session == null || orderId == null) {
      _setChatError('SESSION_REQUIRED');
      return;
    }
    final int generation = _sessionGeneration;
    final String pair = _chatPair;
    _chatLoading = true;
    _chatError = null;
    _onChanged();
    try {
      final List<CustomerChatMessage> messages = await _api.listChatMessages(
        accessToken: session.accessToken,
        orderId: orderId,
        pair: pair,
      );
      if (_sessionStillCurrent(session, generation) && _chatOrderId == orderId && _chatPair == pair) _chatMessages = messages;
    } on CustomerApiProblem catch (error) {
      if (_sessionStillCurrent(session, generation) && _chatOrderId == orderId && _chatPair == pair) _chatError = error.code;
    } on Object {
      if (_sessionStillCurrent(session, generation) && _chatOrderId == orderId && _chatPair == pair) _chatError = 'NETWORK_UNAVAILABLE';
    } finally {
      if (generation == _sessionGeneration && _chatOrderId == orderId && _chatPair == pair) {
        _chatLoading = false;
        _onChanged();
      }
    }
  }

  /// Sends one real order-chat message and refreshes the message timeline.
  Future<bool> sendChatMessage(String body) async {
    final CustomerSession? session = _readSession();
    final String? orderId = _chatOrderId;
    if (session == null || orderId == null || body.trim().isEmpty) return false;
    final int generation = _sessionGeneration;
    final String pair = _chatPair;
    _chatSending = true;
    _chatError = null;
    _onChanged();
    try {
      await _api.sendChatMessage(
        accessToken: session.accessToken,
        orderId: orderId,
        pair: pair,
        body: body,
      );
      if (!_sessionStillCurrent(session, generation) || _chatOrderId != orderId || _chatPair != pair) return false;
      await loadChatMessages();
      return _sessionStillCurrent(session, generation) && _chatOrderId == orderId && _chatPair == pair;
    } on CustomerApiProblem catch (error) {
      if (_sessionStillCurrent(session, generation) && _chatOrderId == orderId && _chatPair == pair) _chatError = error.code;
      return false;
    } on Object {
      if (_sessionStillCurrent(session, generation) && _chatOrderId == orderId && _chatPair == pair) _chatError = 'NETWORK_UNAVAILABLE';
      return false;
    } finally {
      if (generation == _sessionGeneration && _chatOrderId == orderId && _chatPair == pair) {
        _chatSending = false;
        _onChanged();
      }
    }
  }

  /// Loads privacy-filtered server favourite kitchens.
  Future<void> loadFavourites() async {
    final CustomerSession? session = _readSession();
    if (session == null) {
      _setFavouritesError('SESSION_REQUIRED');
      return;
    }
    final int generation = _sessionGeneration;
    _favouritesLoading = true;
    _favouritesError = null;
    _onChanged();
    try {
      final List<CustomerFavouriteEntry> rows = (await _api.listFavourites(accessToken: session.accessToken))
          .map(CustomerFavouriteEntry.fromJson)
          .where((CustomerFavouriteEntry row) => row.vendorId.isNotEmpty)
          .toList(growable: false);
      if (_sessionStillCurrent(session, generation)) _favourites = rows;
    } on CustomerApiProblem catch (error) {
      if (_sessionStillCurrent(session, generation)) _favouritesError = error.code;
    } on Object {
      if (_sessionStillCurrent(session, generation)) _favouritesError = 'NETWORK_UNAVAILABLE';
    } finally {
      if (generation == _sessionGeneration) {
        _favouritesLoading = false;
        _onChanged();
      }
    }
  }

  /// Toggles a favourite only after W1 confirms the customer-owned mutation.
  Future<bool> toggleFavourite(String vendorId) async {
    final CustomerSession? session = _readSession();
    if (session == null || vendorId.isEmpty || !_favouritePending.add(vendorId)) return false;
    final int generation = _sessionGeneration;
    _onChanged();
    try {
      await _api.toggleFavourite(accessToken: session.accessToken, vendorId: vendorId);
      if (!_sessionStillCurrent(session, generation)) return false;
      await loadFavourites();
      return _sessionStillCurrent(session, generation);
    } on CustomerApiProblem catch (error) {
      if (_sessionStillCurrent(session, generation)) _favouritesError = error.code;
      return false;
    } on Object {
      if (_sessionStillCurrent(session, generation)) _favouritesError = 'NETWORK_UNAVAILABLE';
      return false;
    } finally {
      _favouritePending.remove(vendorId);
      if (generation == _sessionGeneration) _onChanged();
    }
  }

  /// Opens the c-31 address editor for a new or existing saved address.
  void openAddressEditor(CustomerAddressEntry? address) {
    _addressBeingEdited = address;
    _navigate(CustomerScreenId.c31AddressEditor);
  }

  /// Loads first-party customer support tickets.
  Future<void> loadSupportThreads() async {
    final CustomerSession? session = _readSession();
    if (session == null) {
      _setSupportError('SESSION_REQUIRED');
      return;
    }
    final int generation = _sessionGeneration;
    _supportLoading = true;
    _supportError = null;
    _onChanged();
    try {
      final List<CustomerSupportThread> threads = await _api.listSupportThreads(accessToken: session.accessToken);
      if (_sessionStillCurrent(session, generation)) _supportThreads = threads;
    } on CustomerApiProblem catch (error) {
      if (_sessionStillCurrent(session, generation)) _supportError = error.code;
    } on Object {
      if (_sessionStillCurrent(session, generation)) _supportError = 'NETWORK_UNAVAILABLE';
    } finally {
      if (generation == _sessionGeneration) {
        _supportLoading = false;
        _onChanged();
      }
    }
  }

  /// Opens the customer-owned support chat for an existing ticket.
  Future<void> openSupportThread(String threadId) async {
    final CustomerSession? session = _readSession();
    if (session == null) return;
    final int generation = _sessionGeneration;
    await stopTracking();
    if (!_sessionStillCurrent(session, generation)) return;
    _supportThreadId = threadId;
    _supportMessages = <Map<String, Object?>>[];
    _supportLoading = false;
    _supportSending = false;
    _supportError = null;
    _navigate(CustomerScreenId.c37SupportChat);
    await loadSupportMessages();
  }

  /// Loads public customer-visible messages for the currently selected support ticket.
  Future<void> loadSupportMessages() async {
    final CustomerSession? session = _readSession();
    final String? threadId = _supportThreadId;
    if (session == null || threadId == null) {
      _setSupportError('SESSION_REQUIRED');
      return;
    }
    final int generation = _sessionGeneration;
    _supportLoading = true;
    _supportError = null;
    _onChanged();
    try {
      final List<Map<String, Object?>> messages = await _api.listSupportMessages(accessToken: session.accessToken, threadId: threadId);
      if (_sessionStillCurrent(session, generation) && _supportThreadId == threadId) _supportMessages = messages;
    } on CustomerApiProblem catch (error) {
      if (_sessionStillCurrent(session, generation) && _supportThreadId == threadId) _supportError = error.code;
    } on Object {
      if (_sessionStillCurrent(session, generation) && _supportThreadId == threadId) _supportError = 'NETWORK_UNAVAILABLE';
    } finally {
      if (generation == _sessionGeneration && _supportThreadId == threadId) {
        _supportLoading = false;
        _onChanged();
      }
    }
  }

  /// Starts an order-linked or general W1 support ticket with the supplied category and issue.
  Future<bool> createSupportThread({
    required String category,
    required String subject,
    required String body,
    String? orderId,
  }) async {
    final CustomerSession? session = _readSession();
    if (session == null) return false;
    final int generation = _sessionGeneration;
    try {
      final CustomerSupportThread thread = await _api.createSupportThread(
        accessToken: session.accessToken,
        category: category,
        subject: subject,
        body: body,
        orderId: orderId,
      );
      if (!_sessionStillCurrent(session, generation)) return false;
      _supportThreadId = thread.id;
      _supportOrderId = orderId;
      await loadSupportThreads();
      if (!_sessionStillCurrent(session, generation)) return false;
      await openSupportThread(thread.id);
      return _sessionStillCurrent(session, generation);
    } on CustomerApiProblem catch (error) {
      if (_sessionStillCurrent(session, generation)) {
        _supportError = error.code;
        _onChanged();
      }
      return false;
    } on Object {
      if (_sessionStillCurrent(session, generation)) {
        _supportError = 'NETWORK_UNAVAILABLE';
        _onChanged();
      }
      return false;
    }
  }

  /// Sends a reply to the selected support ticket.
  Future<bool> sendSupportMessage(String body) async {
    final CustomerSession? session = _readSession();
    final String? threadId = _supportThreadId;
    if (session == null || threadId == null || body.trim().isEmpty) return false;
    final int generation = _sessionGeneration;
    _supportSending = true;
    _supportError = null;
    _onChanged();
    try {
      await _api.sendSupportMessage(accessToken: session.accessToken, threadId: threadId, body: body);
      if (!_sessionStillCurrent(session, generation) || _supportThreadId != threadId) return false;
      await loadSupportMessages();
      return _sessionStillCurrent(session, generation) && _supportThreadId == threadId;
    } on CustomerApiProblem catch (error) {
      if (_sessionStillCurrent(session, generation) && _supportThreadId == threadId) _supportError = error.code;
      return false;
    } on Object {
      if (_sessionStillCurrent(session, generation) && _supportThreadId == threadId) _supportError = 'NETWORK_UNAVAILABLE';
      return false;
    } finally {
      if (generation == _sessionGeneration && _supportThreadId == threadId) {
        _supportSending = false;
        _onChanged();
      }
    }
  }

  /// Loads existing vendor/rider ratings owned by this customer for the selected order.
  Future<void> loadOrderReviews(String orderId) async {
    final CustomerSession? session = _readSession();
    if (session == null) {
      _orderReviewsError = 'SESSION_REQUIRED';
      _onChanged();
      return;
    }
    final int generation = _sessionGeneration;
    _orderReviewsOrderId = orderId;
    _orderReviewsLoading = true;
    _orderReviewsError = null;
    _onChanged();
    try {
      final List<CustomerReviewSnapshot> reviews = await _api.listOrderReviews(accessToken: session.accessToken, orderId: orderId);
      if (_sessionStillCurrent(session, generation) && _orderReviewsOrderId == orderId) _orderReviews = reviews;
    } on CustomerApiProblem catch (error) {
      if (_sessionStillCurrent(session, generation) && _orderReviewsOrderId == orderId) _orderReviewsError = error.code;
    } on Object {
      if (_sessionStillCurrent(session, generation) && _orderReviewsOrderId == orderId) _orderReviewsError = 'NETWORK_UNAVAILABLE';
    } finally {
      if (_sessionStillCurrent(session, generation) && _orderReviewsOrderId == orderId) {
        _orderReviewsLoading = false;
        _onChanged();
      }
    }
  }

  /// Submits a verified-order vendor or rider rating with customer-selected aspect tags.
  Future<bool> submitRating({
    required String orderId,
    required int rating,
    required String direction,
    required List<String> aspectTags,
    String? comment,
  }) async {
    final CustomerSession? session = _readSession();
    if (session == null) return false;
    final int generation = _sessionGeneration;
    try {
      await _api.submitOrderReview(
        accessToken: session.accessToken,
        orderId: orderId,
        rating: rating,
        direction: direction,
        aspectTags: aspectTags,
        comment: comment,
      );
      if (!_sessionStillCurrent(session, generation) || _orderDetail?.summary.id != orderId) return false;
      await loadOrderReviews(orderId);
      return _sessionStillCurrent(session, generation) && _orderDetail?.summary.id == orderId;
    } on CustomerApiProblem catch (error) {
      if (_sessionStillCurrent(session, generation) && _orderDetail?.summary.id == orderId) {
        _orderError = error.code;
        _onChanged();
      }
      return false;
    } on Object {
      if (_sessionStillCurrent(session, generation) && _orderDetail?.summary.id == orderId) {
        _orderError = 'NETWORK_UNAVAILABLE';
        _onChanged();
      }
      return false;
    }
  }

  /// Clears private response-15 account state after sign-out or account deletion.
  void clearPrivateState() {
    ++_sessionGeneration;
    ++_ordersRequestGeneration;
    ++_orderRequestGeneration;
    _orders = <CustomerOrderCard>[];
    _ordersLoading = false;
    _ordersError = null;
    _orderDetail = null;
    _orderLoading = false;
    _orderError = null;
    _orderReviews = <CustomerReviewSnapshot>[];
    _orderReviewsLoading = false;
    _orderReviewsError = null;
    _orderReviewsOrderId = null;
    _orderReference = null;
    _favourites = <CustomerFavouriteEntry>[];
    _favouritePending.clear();
    _favouritesLoading = false;
    _favouritesError = null;
    _addresses = <CustomerAddressEntry>[];
    _addressBeingEdited = null;
    _addressesLoading = false;
    _addressesError = null;
    _notifications = <CustomerInboxNotification>[];
    _notificationsLoading = false;
    _notificationsError = null;
    _profile = null;
    _profileLoading = false;
    _profileError = null;
    _chatMessages = <CustomerChatMessage>[];
    _chatLoading = false;
    _chatSending = false;
    _chatError = null;
    _chatOrderId = null;
    _supportThreads = <CustomerSupportThread>[];
    _supportMessages = <Map<String, Object?>>[];
    _supportLoading = false;
    _supportSending = false;
    _supportError = null;
    _supportThreadId = null;
    _supportOrderId = null;
    unawaited(stopTracking());
    _onChanged();
  }

  /// Stops active timers and the RTDB room when the root controller is disposed.
  void dispose() => unawaited(stopTracking());


  void _setChatError(String value) { _chatError = value; _onChanged(); }
  void _setFavouritesError(String value) { _favouritesError = value; _onChanged(); }
  void _setSupportError(String value) { _supportError = value; _onChanged(); }
}
