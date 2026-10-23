# Appendix G · Error Code Catalogue (EN/BN user copy — extend, never reuse codes)

**Codes: 35 seed entries.** Every API error uses this envelope (Appendix E); clients map code->localised copy, never show raw server text.

| Code | HTTP | English | বাংলা |
|---|---:|---|---|
| `AUTH_INVALID_CREDENTIALS` | 401 | Email/phone or password is incorrect. | ইমেইল/ফোন বা পাসওয়ার্ড সঠিক নয়। |
| `AUTH_ACCOUNT_SUSPENDED` | 403 | Your account is suspended. Contact support. | আপনার অ্যাকাউন্ট সাময়িকভাবে বন্ধ আছে। সাপোর্টে যোগাযোগ করুন। |
| `AUTH_ROLE_MISMATCH` | 403 | This account cannot use this app. | এই অ্যাকাউন্ট দিয়ে এই অ্যাপ ব্যবহার করা যাবে না। |
| `VALIDATION_FAILED` | 422 | Some information needs fixing. | কিছু তথ্য ঠিক করতে হবে। |
| `PHONE_INVALID_BD` | 422 | Enter a valid Bangladeshi mobile number. | সঠিক বাংলাদেশি মোবাইল নম্বর দিন। |
| `CART_STALE` | 409 | Prices changed. Please review your cart. | দাম বদলে গেছে। কার্ট আবার দেখুন। |
| `CART_VENDOR_CONFLICT` | 409 | Your cart has items from another kitchen. | আপনার কার্টে অন্য রেস্টুরেন্টের আইটেম আছে। |
| `ITEM_UNAVAILABLE` | 409 | An item just went unavailable. | একটি আইটেম এখন পাওয়া যাচ্ছে না। |
| `VENDOR_CLOSED` | 409 | This kitchen is closed right now. | এই রেস্টুরেন্ট এখন বন্ধ আছে। |
| `OUTSIDE_ZONE` | 422 | Delivery is not available at this pin yet. | এই লোকেশনে এখন ডেলিভারি হয় না। |
| `VOUCHER_INVALID` | 422 | This voucher cannot be used here. | এই ভাউচার এখানে চলবে না। |
| `VOUCHER_MIN_ORDER` | 422 | Add a little more to use this voucher. | ভাউচার ব্যবহার করতে আরেকটু যোগ করুন। |
| `MIN_ORDER_NOT_MET` | 422 | Minimum order is not met. | সর্বনিম্ন অর্ডারের শর্ত পূরণ হয়নি। |
| `ORDER_STATE_ILLEGAL` | 409 | That action is not possible for this order now. | এই অর্ডারে এখন এই কাজ করা যাবে না। |
| `VENDOR_UNREACHABLE` | 410 | The kitchen could not be reached, so the order was cancelled. | রেস্টুরেন্টকে পাওয়া যায়নি, তাই অর্ডার বাতিল হয়েছে। |
| `NO_RIDER_AVAILABLE` | 503 | No rider is available nearby right now. | কাছে এখন কোনো রাইডার নেই। |
| `OFFER_EXPIRED` | 410 | This offer has expired. | এই অফারের সময় শেষ। |
| `OFFER_NOT_REJECTABLE` | 409 | No backup rider nearby — request reassign instead. | কাছে বিকল্প রাইডার নেই — রিঅ্যাসাইন অনুরোধ করুন। |
| `QR_INVALID` | 422 | QR code is invalid or expired. | QR কোড সঠিক নয় বা মেয়াদ শেষ। |
| `QR_ALREADY_USED` | 409 | This pickup code was already used. | এই পিকআপ কোড ব্যবহার হয়ে গেছে। |
| `CASH_CEILING_REACHED` | 403 | Cash-in-hand limit reached. Remit to continue. | হাতের নগদ সীমা শেষ। চালিয়ে যেতে জমা দিন। |
| `CASH_GATE_ACTIVE` | 403 | Complete your cash remittance to start a new session. | নতুন সেশন শুরু করতে নগদ জমা সম্পন্ন করুন। |
| `TRXID_DUPLICATE` | 409 | This transaction ID was already submitted. | এই ট্রান্সাকশন আইডি আগে জমা হয়েছে। |
| `KYC_INCOMPLETE` | 403 | Complete verification to continue. | চালিয়ে যেতে যাচাই সম্পন্ন করুন। |
| `DOC_TOO_LARGE` | 413 | File is too large (max 5 MB). | ফাইল খুব বড় (সর্বোচ্চ ৫ MB)। |
| `IMAGE_UPLOAD_FAILED` | 502 | Image upload failed. We will retry automatically. | ছবি আপলোড হয়নি। অটো আবার চেষ্টা হবে। |
| `RATE_LIMITED` | 429 | Too many attempts. Wait a moment. | অনেকবার চেষ্টা হয়েছে। একটু অপেক্ষা করুন। |
| `LOCATION_REQUIRED` | 422 | Turn on location to continue. | চালিয়ে যেতে লোকেশন চালু করুন। |
| `GPS_INACCURATE` | 422 | GPS signal is weak. Move to an open area. | GPS সিগন্যাল দুর্বল। খোলা জায়গায় যান। |
| `NETWORK_OFFLINE` | 0 | You are offline. Actions will sync when back. | আপনি অফলাইনে আছেন। ফিরলে সিঙ্ক হবে। |
| `SERVER_BUSY` | 503 | We are busy for a moment. Try again. | আমরা এখন একটু ব্যস্ত। আবার চেষ্টা করুন। |
| `SESSION_EXPIRED` | 401 | Please log in again. | আবার লগইন করুন। |
| `APP_UPDATE_REQUIRED` | 426 | Please update Undal to continue. | চালিয়ে যেতে Undal আপডেট করুন। |
| `PAYOUT_ACCOUNT_REQUIRED` | 422 | Add a payout account (bKash recommended). | পেআউট অ্যাকাউন্ট যোগ করুন (বিকাশ প্রস্তাবিত)। |
| `INVOICE_NOT_PAYABLE` | 409 | This invoice is not ready to pay. | এই ইনভয়েস এখন পরিশোধযোগ্য নয়। |