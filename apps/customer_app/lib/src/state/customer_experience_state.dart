/// Server-backed customer after-checkout state for screens `c-22..c-40` (`Build Response 15`).
///
/// Orders, account data, chat, support, and mutations are loaded from W1/W2 only. A compact W2 RTDB
/// lease is explicitly released when tracking is left; W1 ETag polling is the safe fallback.
library;

import 'dart:async';

import 'package:undal_core/undal_core.dart';

import '../models/customer_experience_models.dart';
import '../models/customer_models.dart';
import '../services/customer_experience_api.dart';
import '../services/customer_order_realtime.dart';
import '../services/customer_commerce_api.dart';

part 'customer_experience_state_orders.dart';
part 'customer_experience_state_social.dart';
part 'customer_experience_state_account.dart';

/// Reads the active Supabase session without exposing authentication internals to screens.
typedef CustomerExperienceSessionReader = CustomerSession? Function();

/// Holds live W1/W2 data used by the customer order and account surfaces.
final class CustomerExperienceState {
  /// Creates state using authenticated API clients and root-controller callbacks.
  CustomerExperienceState({
    required CustomerExperienceApi api,
    required CustomerOrderRealtimeClient realtime,
    required CustomerExperienceSessionReader readSession,
    required void Function(CustomerScreenId) navigate,
    required void Function() onChanged,
  })  : _api = api,
        _realtime = realtime,
        _readSession = readSession,
        _navigate = navigate,
        _onChanged = onChanged;

  final CustomerExperienceApi _api;
  final CustomerOrderRealtimeClient _realtime;
  final CustomerExperienceSessionReader _readSession;
  final void Function(CustomerScreenId) _navigate;
  final void Function() _onChanged;

  bool _sessionStillCurrent(CustomerSession session, int generation) =>
      generation == _sessionGeneration && _readSession()?.accessToken == session.accessToken;

  List<CustomerOrderCard> _orders = <CustomerOrderCard>[];
  bool _ordersLoading = false;
  String? _ordersError;
  CustomerOrderDetail? _orderDetail;
  bool _orderLoading = false;
  String? _orderError;
  List<CustomerReviewSnapshot> _orderReviews = <CustomerReviewSnapshot>[];
  bool _orderReviewsLoading = false;
  String? _orderReviewsError;
  String? _orderReviewsOrderId;
  String? _orderReference;
  List<CustomerFavouriteEntry> _favourites = <CustomerFavouriteEntry>[];
  final Set<String> _favouritePending = <String>{};
  bool _favouritesLoading = false;
  String? _favouritesError;
  List<CustomerAddressEntry> _addresses = <CustomerAddressEntry>[];
  CustomerAddressEntry? _addressBeingEdited;
  bool _addressesLoading = false;
  String? _addressesError;
  List<CustomerInboxNotification> _notifications = <CustomerInboxNotification>[];
  bool _notificationsLoading = false;
  String? _notificationsError;
  CustomerProfileSnapshot? _profile;
  bool _profileLoading = false;
  String? _profileError;
  List<CustomerChatMessage> _chatMessages = <CustomerChatMessage>[];
  bool _chatLoading = false;
  bool _chatSending = false;
  String? _chatError;
  String? _chatOrderId;
  String _chatPair = 'customer_rider';
  List<CustomerSupportThread> _supportThreads = <CustomerSupportThread>[];
  List<Map<String, Object?>> _supportMessages = <Map<String, Object?>>[];
  bool _supportLoading = false;
  bool _supportSending = false;
  String? _supportError;
  String? _supportThreadId;
  String? _supportOrderId;

  Timer? _trackingPollTimer;
  Timer? _trackingReconcileTimer;
  int _trackingGeneration = 0;
  int _sessionGeneration = 0;
  int _ordersRequestGeneration = 0;
  int _orderRequestGeneration = 0;
  StreamSubscription<Map<String, Object?>>? _trackingSubscription;
  String? _trackingOrderId;
  String? _trackingFallbackPath;
  String? _trackingEtag;
  int _trackingPollIntervalMs = 5000;
  Map<String, Object?> _room = <String, Object?>{};
  bool _trackingActive = false;
  bool _trackingPolling = false;
  List<GeoPoint> _routePoints = <GeoPoint>[];
  String? _trackingError;

  /// Immutable current order history; no local or sample orders are included.
  List<CustomerOrderCard> get orders => List<CustomerOrderCard>.unmodifiable(_orders);

  /// Whether W1 is currently loading order history.
  bool get ordersLoading => _ordersLoading;

  /// Latest order-list API error code, if any.
  String? get ordersError => _ordersError;

  /// Focused server order details for tracking, pickup, receipt, or review routes.
  CustomerOrderDetail? get orderDetail => _orderDetail;

  /// Whether the focused server order is being loaded.
  bool get orderLoading => _orderLoading;

  /// Latest order-detail error code, if any.
  String? get orderError => _orderError;

  /// Existing vendor/rider reviews belonging to the current customer and order.
  List<CustomerReviewSnapshot> get orderReviews => List<CustomerReviewSnapshot>.unmodifiable(_orderReviews);

  /// Whether W1 is loading the customer's saved ratings.
  bool get orderReviewsLoading => _orderReviewsLoading;

  /// Latest customer-rating request error.
  String? get orderReviewsError => _orderReviewsError;

  /// Immutable server favourite list.
  List<CustomerFavouriteEntry> get favourites => List<CustomerFavouriteEntry>.unmodifiable(_favourites);

  /// Server-confirmed favourite kitchen IDs for feed hearts and quick-menu actions.
  Set<String> get favouriteVendorIds => _favourites.map((CustomerFavouriteEntry row) => row.vendorId).toSet();

  /// Whether W1 is loading favourites.
  bool get favouritesLoading => _favouritesLoading;

  /// Whether a server favourite mutation is pending for a kitchen.
  bool isFavouritePending(String vendorId) => _favouritePending.contains(vendorId);

  /// Latest favourites API error code, if any.
  String? get favouritesError => _favouritesError;

  /// Immutable authenticated address list.
  List<CustomerAddressEntry> get addresses => List<CustomerAddressEntry>.unmodifiable(_addresses);

  /// Address currently being edited in c-31, or null when creating a new one.
  CustomerAddressEntry? get addressBeingEdited => _addressBeingEdited;

  /// Whether W1 is loading saved addresses.
  bool get addressesLoading => _addressesLoading;

  /// Latest address-book API error code, if any.
  String? get addressesError => _addressesError;

  /// Immutable inbox notifications returned by W1.
  List<CustomerInboxNotification> get notifications => List<CustomerInboxNotification>.unmodifiable(_notifications);

  /// Whether W1 is loading notifications.
  bool get notificationsLoading => _notificationsLoading;

  /// Latest notification API error code, if any.
  String? get notificationsError => _notificationsError;

  /// Server-backed profile, when loaded.
  CustomerProfileSnapshot? get profile => _profile;

  /// Whether the profile request is in flight.
  bool get profileLoading => _profileLoading;

  /// Latest profile API error code, if any.
  String? get profileError => _profileError;

  /// Immutable order conversation history.
  List<CustomerChatMessage> get chatMessages => List<CustomerChatMessage>.unmodifiable(_chatMessages);

  /// Whether a chat history request is in flight.
  bool get chatLoading => _chatLoading;

  /// Whether a chat send request is in flight.
  bool get chatSending => _chatSending;

  /// Latest chat API error code, if any.
  String? get chatError => _chatError;

  /// Whether support threads or messages are loading.
  bool get supportLoading => _supportLoading;

  /// Whether a support message is being submitted.
  bool get supportSending => _supportSending;

  /// Latest support API error code, if any.
  String? get supportError => _supportError;

  /// Immutable customer-owned support ticket list.
  List<CustomerSupportThread> get supportThreads => List<CustomerSupportThread>.unmodifiable(_supportThreads);

  /// Immutable, customer-visible messages for the open support ticket.
  List<Map<String, Object?>> get supportMessages => List<Map<String, Object?>>.unmodifiable(_supportMessages);

  /// ID of the support ticket currently open in c-37.
  String? get supportThreadId => _supportThreadId;

  /// Currently selected order-chat pair (`customer_rider` or `customer_vendor`).
  String get chatPair => _chatPair;

  /// Whether active-order tracking is running over RTDB or W1 polling.
  bool get trackingActive => _trackingActive;

  /// True while W1 polling is the current live tracking transport.
  bool get trackingPolling => _trackingPolling;

  /// Latest tracking connection error, if the fallback could not recover.
  String? get trackingError => _trackingError;

  /// OSRM route geometry returned by W2, if a road estimate is available.
  List<GeoPoint> get routePoints => List<GeoPoint>.unmodifiable(_routePoints);
}
