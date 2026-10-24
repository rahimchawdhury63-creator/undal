/// Commerce auth intents kept in the customer domain model library.
part of 'customer_models.dart';

/// Resumes the COD checkout screen after a guest completes authentication.
final class CheckoutOrderIntent extends PendingAuthIntent {
  /// Creates the intercepted checkout action.
  const CheckoutOrderIntent();
}

/// Resumes the voucher picker after a guest completes authentication.
final class VoucherPickerIntent extends PendingAuthIntent {
  /// Creates the intercepted voucher-picking action.
  const VoucherPickerIntent();
}
