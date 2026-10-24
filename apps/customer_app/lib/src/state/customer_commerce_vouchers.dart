part of 'customer_commerce_state.dart';

/// Authenticated voucher-wallet loading rules for the c-19 picker.
extension CustomerCommerceVoucherOperations on CustomerCommerceState {
  /// Refreshes active offers; W1 quote/order validation still decides final eligibility.
  Future<void> refreshVoucherWallet() async {
    if (_voucherWalletLoading) return;
    final CustomerSession? session = _readSession();
    if (session == null) {
      _voucherWalletErrorCode = 'SESSION_REQUIRED';
      _voucherWalletLoaded = false;
      _onChanged();
      return;
    }
    if (!_api.isConfigured || !_hasLiveSession) {
      _voucherWalletErrorCode = 'VOUCHER_WALLET_UNAVAILABLE';
      _voucherWalletLoaded = false;
      _onChanged();
      return;
    }
    _voucherWalletLoading = true;
    _voucherWalletErrorCode = null;
    _onChanged();
    try {
      final List<CustomerVoucherOffer> offers = await _api.listVoucherWallet(accessToken: session.accessToken);
      if (_readSession()?.userId != session.userId) return;
      _voucherWallet = offers;
      _voucherWalletLoaded = true;
    } on CustomerApiProblem catch (error) {
      _voucherWalletErrorCode = error.code;
      _voucherWalletLoaded = false;
    } on Object {
      _voucherWalletErrorCode = 'NETWORK_UNAVAILABLE';
      _voucherWalletLoaded = false;
    } finally {
      _voucherWalletLoading = false;
      _onChanged();
    }
  }
}
