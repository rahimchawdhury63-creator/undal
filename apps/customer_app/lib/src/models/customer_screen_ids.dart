/// Canonical customer application destinations from `Appendix N`.
library;

/// Canonical screen route IDs from `Appendix N` (`c-01..c-40`).
enum CustomerScreenId {
  c01Splash('c-01'),
  c02Carousel('c-02'),
  c03LocationPrime('c-03'),
  c04AddressPin('c-04'),
  c05NotificationPrime('c-05'),
  c06AuthHub('c-06'),
  c07SignUp('c-07'),
  c08HomeDelivery('c-08'),
  c09HomePickup('c-09'),
  c10PickupMap('c-10'),
  c11SearchHome('c-11'),
  c12SearchResults('c-12'),
  c13VendorStorefront('c-13'),
  c14ItemCustomizer('c-14'),
  c15BundleBuilder('c-15'),
  c16VendorInfo('c-16'),
  c17VendorReviews('c-17'),
  c18Cart('c-18'),
  c19VoucherPicker('c-19'),
  c20Checkout('c-20'),
  c21OrderConfirmation('c-21'),
  c22LiveTracking('c-22'),
  c23PickupReady('c-23'),
  c24RiderChat('c-24'),
  c25KitchenChat('c-25'),
  c26Orders('c-26'),
  c27OrderReceipt('c-27'),
  c28Rating('c-28'),
  c29Favourites('c-29'),
  c30Addresses('c-30'),
  c31AddressEditor('c-31'),
  c32VoucherWallet('c-32'),
  c33Rewards('c-33'),
  c34InviteFriends('c-34'),
  c35Notifications('c-35'),
  c36HelpCenter('c-36'),
  c37SupportChat('c-37'),
  c38ProfileEdit('c-38'),
  c39Language('c-39'),
  c40DeleteAccount('c-40');

  const CustomerScreenId(this.code);
  final String code;
}

