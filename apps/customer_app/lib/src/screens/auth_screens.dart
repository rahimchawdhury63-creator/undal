/// Customer Authentication Hub (`c-06`) & 3-Step Resumable Sign-Up Wizard (`c-07`, `File 16 §16.1`).
///
/// Key guarantees:
/// - Guest browsing never blocks exploration; login resumes the exact intercepted intent (`Favourite`,
///   `Address`, or `Checkout`) instead of dumping the customer back at a blank Home screen.
/// - Supports `Continue with Google`, `BD Phone (01[3-9]XXXXXXXX) + Password`, and `Email + Password`.
/// - 3-step `c-07` Sign-Up (`Credentials -> Profile -> Address Note`) preserves draft state on `Resume later`.
library;

import 'package:flutter/material.dart';
import 'package:undal_core/undal_core.dart';

import '../i18n/customer_copy.dart';
import '../models/customer_models.dart';
import '../services/customer_api_client.dart';
import '../state/customer_controller.dart';

/// Full-screen responsive authentication surface for `c-06` and `c-07`.
class CustomerAuthScreen extends StatefulWidget {
  const CustomerAuthScreen({
    super.key,
    required this.controller,
  });

  final CustomerController controller;

  @override
  State<CustomerAuthScreen> createState() => _CustomerAuthScreenState();
}

class _CustomerAuthScreenState extends State<CustomerAuthScreen> {
  late final TextEditingController _identifierCtrl = TextEditingController(
    text: widget.controller.signUpDraft.phone.isNotEmpty
        ? widget.controller.signUpDraft.phone
        : '01712345678',
  );
  final TextEditingController _passwordCtrl = TextEditingController(
    text: 'undal2026',
  );
  late final TextEditingController _nameCtrl = TextEditingController(
    text: widget.controller.signUpDraft.fullName,
  );
  late final TextEditingController _landmarkCtrl = TextEditingController(
    text: widget.controller.signUpDraft.landmarkNote.isNotEmpty
        ? widget.controller.signUpDraft.landmarkNote
        : widget.controller.activeAddress.landmarkNote,
  );
  String? _localStepError;

  @override
  void dispose() {
    _identifierCtrl.dispose();
    _passwordCtrl.dispose();
    _nameCtrl.dispose();
    _landmarkCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final CustomerController ctrl = widget.controller;
    final bool isSignUp = ctrl.activeOverlay == CustomerScreenId.c07SignUp;

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          key: const ValueKey<String>('auth-close-guest-btn'),
          tooltip: cText(context, 'Continue as guest', 'গেস্ট হিসেবে দেখুন'),
          onPressed: () {
            if (isSignUp) {
              ctrl.saveSignUpDraft(
                ctrl.signUpDraft.copyWith(
                  phone: _identifierCtrl.text.trim(),
                  fullName: _nameCtrl.text.trim(),
                  landmarkNote: _landmarkCtrl.text.trim(),
                ),
                resumeLater: true,
              );
            } else {
              ctrl.dismissOverlayToShell();
            }
          },
          icon: const Icon(Icons.close),
        ),
        title: Text(
          isSignUp
              ? '${UndalLocalizations.of(context).t('auth.signup')} · C-07'
              : '${UndalLocalizations.of(context).t('auth.login')} · C-06',
        ),
        actions: <Widget>[
          TextButton(
            onPressed: ctrl.toggleLocale,
            child: Text(
              UndalLocalizations.of(context).t('app.switch_language'),
            ),
          ),
        ],
      ),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 560),
            child: SingleChildScrollView(
              key: ValueKey<String>(isSignUp ? 'screen-c-07' : 'screen-c-06'),
              padding: const EdgeInsets.all(UndalSpacingTokens.xl),
              child: isSignUp
                  ? _buildSignUpWizard(context, ctrl)
                  : _buildAuthHub(context, ctrl),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildAuthHub(BuildContext context, CustomerController ctrl) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme scheme = theme.colorScheme;
    final UndalSemanticColors semantic =
        theme.extension<UndalSemanticColors>()!;
    final String? errCode = _localStepError ?? ctrl.authErrorCode;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        if (ctrl.pendingIntent is FavouriteVendorIntent)
          Container(
            margin: const EdgeInsets.only(bottom: UndalSpacingTokens.md),
            padding: const EdgeInsets.all(UndalSpacingTokens.md),
            decoration: BoxDecoration(
              color: semantic.infoSoft,
              borderRadius: BorderRadius.circular(UndalRadiusTokens.card),
            ),
            child: Text(
              cText(
                context,
                'Sign in once — we will immediately save this kitchen to your Favourites.',
                'একবার লগইন করুন — সাথে সাথেই রান্নাঘরটি আপনার পছন্দের তালিকায় যুক্ত হবে।',
              ),
              style: theme.textTheme.bodyMedium?.copyWith(color: semantic.info),
            ),
          ),
        OutlinedButton.icon(
          key: const ValueKey<String>('c06-google-btn'),
          style: OutlinedButton.styleFrom(minimumSize: const Size(48, 48)),
          onPressed: () {
            ctrl.submitSignIn(
              identifier: 'foodie@undal.app',
              secretOrOtp: 'oauth_google_pkce',
              method: 'google',
            );
          },
          icon: const Icon(Icons.verified_user_outlined),
          label: Text(UndalLocalizations.of(context).t('auth.google')),
        ),
        const SizedBox(height: UndalSpacingTokens.lg),
        TextField(
          key: const ValueKey<String>('c06-identifier-input'),
          controller: _identifierCtrl,
          decoration: InputDecoration(
            labelText: cText(
              context,
              'BD Mobile (01XXXXXXXXX) or Email',
              'মোবাইল নম্বর (০১XXXXXXXXX) বা ইমেইল',
            ),
            border: const OutlineInputBorder(),
          ),
        ),
        const SizedBox(height: UndalSpacingTokens.md),
        TextField(
          key: const ValueKey<String>('c06-password-input'),
          controller: _passwordCtrl,
          obscureText: true,
          decoration: InputDecoration(
            labelText: cText(context, 'Password / OTP Pin', 'পাসওয়ার্ড / পিন'),
            border: const OutlineInputBorder(),
          ),
        ),
        if (errCode != null) ...<Widget>[
          const SizedBox(height: UndalSpacingTokens.sm),
          Text(
            _translateAuthError(context, errCode),
            key: const ValueKey<String>('auth-error-banner'),
            style: theme.textTheme.bodyMedium?.copyWith(
              color: scheme.error,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
        const SizedBox(height: UndalSpacingTokens.lg),
        FilledButton(
          key: const ValueKey<String>('c06-submit-login-btn'),
          onPressed: () {
            setState(() => _localStepError = null);
            ctrl.submitSignIn(
              identifier: _identifierCtrl.text,
              secretOrOtp: _passwordCtrl.text,
              method: 'password',
            );
          },
          child: Text(UndalLocalizations.of(context).t('auth.login')),
        ),
        const SizedBox(height: UndalSpacingTokens.sm),
        TextButton(
          key: const ValueKey<String>('c06-open-signup-btn'),
          onPressed: ctrl.openSignUpWizard,
          child: Text(
            ctrl.signUpDraft.hasProgress
                ? cText(
                    context,
                    'Resume saved Sign-Up (Step ${ctrl.signUpDraft.stepIndex + 1}/3)',
                    'সংরক্ষিত সাইন-আপ চালিয়ে যান (${ctrl.signUpDraft.stepIndex + 1}/৩)',
                  )
                : cText(
                    context,
                    'New to Undal? Create account (3 steps)',
                    'নতুন ব্যবহারকারী? অ্যাকাউন্ট খুলুন (৩ ধাপে)',
                  ),
          ),
        ),
      ],
    );
  }

  Widget _buildSignUpWizard(BuildContext context, CustomerController ctrl) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme scheme = theme.colorScheme;
    final int step = ctrl.signUpDraft.stepIndex;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Row(
          children: List<Widget>.generate(3, (int idx) {
            final bool done = idx <= step;
            return Expanded(
              child: Container(
                margin: const EdgeInsets.only(right: UndalSpacingTokens.xs),
                height: 6,
                decoration: BoxDecoration(
                  color: done ? scheme.primary : scheme.outline,
                  borderRadius: BorderRadius.circular(UndalRadiusTokens.pill),
                ),
              ),
            );
          }),
        ),
        const SizedBox(height: UndalSpacingTokens.md),
        Text(
          cText(
            context,
            'Step ${step + 1} of 3',
            'ধাপ ${toBengaliDigits('${step + 1}')} / ৩',
          ),
          style: theme.textTheme.labelSmall?.copyWith(color: scheme.primary),
        ),
        const SizedBox(height: UndalSpacingTokens.sm),
        if (step == 0) ...<Widget>[
          Text(
            cText(context, 'Account credentials', 'মোবাইল নম্বর ও পাসওয়ার্ড'),
            style: theme.textTheme.headlineMedium,
          ),
          const SizedBox(height: UndalSpacingTokens.md),
          TextField(
            key: const ValueKey<String>('c07-phone-input'),
            controller: _identifierCtrl,
            decoration: InputDecoration(
              labelText: cText(
                context,
                'Bangladesh Mobile (01[3-9]XXXXXXXX)',
                'বাংলাদেশি মোবাইল নম্বর (০১XXXXXXXXX)',
              ),
              border: const OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: UndalSpacingTokens.md),
          TextField(
            key: const ValueKey<String>('c07-password-input'),
            controller: _passwordCtrl,
            obscureText: true,
            decoration: InputDecoration(
              labelText: cText(
                context,
                'Password (minimum 6 characters)',
                'পাসওয়ার্ড (কমপক্ষে ৬ অক্ষর)',
              ),
              border: const OutlineInputBorder(),
            ),
          ),
        ] else if (step == 1) ...<Widget>[
          Text(
            cText(context, 'Your profile', 'আপনার পরিচয়'),
            style: theme.textTheme.headlineMedium,
          ),
          const SizedBox(height: UndalSpacingTokens.md),
          TextField(
            key: const ValueKey<String>('c07-fullname-input'),
            controller: _nameCtrl,
            decoration: InputDecoration(
              labelText: cText(context, 'Full name', 'পূর্ণ নাম'),
              border: const OutlineInputBorder(),
            ),
          ),
        ] else ...<Widget>[
          Text(
            cText(
              context,
              'Confirm rider landmark note',
              'রাইডারের জন্য ঠিকানা ও ল্যান্ডমার্ক',
            ),
            style: theme.textTheme.headlineMedium,
          ),
          const SizedBox(height: UndalSpacingTokens.sm),
          Text(
            '${ctrl.activeAddress.addressText} (${ctrl.activeAddress.plusCode})',
            style: theme.textTheme.bodyMedium,
          ),
          const SizedBox(height: UndalSpacingTokens.md),
          TextField(
            key: const ValueKey<String>('c07-landmark-input'),
            controller: _landmarkCtrl,
            decoration: InputDecoration(
              labelText: cText(
                context,
                'Gate colour / floor / landmark',
                'গেটের রঙ / তলা / ল্যান্ডমার্ক',
              ),
              border: const OutlineInputBorder(),
            ),
          ),
        ],
        if (_localStepError != null) ...<Widget>[
          const SizedBox(height: UndalSpacingTokens.sm),
          Text(
            _translateAuthError(context, _localStepError!),
            key: const ValueKey<String>('signup-step-error'),
            style: theme.textTheme.bodyMedium?.copyWith(color: scheme.error),
          ),
        ],
        const SizedBox(height: UndalSpacingTokens.lg),
        FilledButton(
          key: const ValueKey<String>('c07-step-next-btn'),
          onPressed: () {
            if (step == 0) {
              if (normalizeBdPhone(_identifierCtrl.text) == null) {
                setState(() => _localStepError = 'INVALID_BD_PHONE');
                return;
              }
              if (_passwordCtrl.text.trim().length < 6) {
                setState(() => _localStepError = 'INVALID_CREDENTIAL_LENGTH');
                return;
              }
              setState(() => _localStepError = null);
              ctrl.saveSignUpDraft(
                ctrl.signUpDraft.copyWith(
                  stepIndex: 1,
                  phone: _identifierCtrl.text.trim(),
                  password: _passwordCtrl.text.trim(),
                ),
              );
              return;
            }
            if (step == 1) {
              if (_nameCtrl.text.trim().length < 2) {
                setState(() => _localStepError = 'NAME_REQUIRED');
                return;
              }
              setState(() => _localStepError = null);
              ctrl.saveSignUpDraft(
                ctrl.signUpDraft.copyWith(
                  stepIndex: 2,
                  fullName: _nameCtrl.text.trim(),
                ),
              );
              return;
            }
            ctrl.submitSignIn(
              identifier: _identifierCtrl.text,
              secretOrOtp: _passwordCtrl.text,
              method: 'signup',
              displayName: _nameCtrl.text.trim(),
              optionalLandmark: _landmarkCtrl.text.trim(),
            );
          },
          child: Text(
            step < 2
                ? UndalLocalizations.of(context).t('common.continue')
                : cText(context, 'Create account', 'অ্যাকাউন্ট সম্পন্ন করুন'),
          ),
        ),
        const SizedBox(height: UndalSpacingTokens.sm),
        OutlinedButton(
          key: const ValueKey<String>('c07-resume-later-btn'),
          onPressed: () {
            ctrl.saveSignUpDraft(
              ctrl.signUpDraft.copyWith(
                phone: _identifierCtrl.text.trim(),
                fullName: _nameCtrl.text.trim(),
                landmarkNote: _landmarkCtrl.text.trim(),
              ),
              resumeLater: true,
            );
          },
          child: Text(
            cText(context, 'Save progress & browse first', 'পরে সম্পন্ন করব'),
          ),
        ),
      ],
    );
  }

  String _translateAuthError(BuildContext context, String code) {
    return switch (code) {
      'INVALID_BD_PHONE' => cText(
          context,
          'Enter a valid 11-digit Bangladesh mobile number (013–019) or email.',
          'সঠিক ১১ সংখ্যার বাংলাদেশি মোবাইল নম্বর (০১৩–০১৯) অথবা ইমেইল দিন।',
        ),
      'NAME_REQUIRED' => cText(
          context,
          'Please enter your name (at least 2 characters).',
          'অনুগ্রহ করে আপনার নাম লিখুন।',
        ),
      _ => cText(
          context,
          'Password or OTP must be at least 6 characters.',
          'পাসওয়ার্ড বা পিন কমপক্ষে ৬ অক্ষরের হতে হবে।',
        ),
    };
  }
}
