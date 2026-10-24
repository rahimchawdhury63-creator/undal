/// Email/password sign-in and registration for a real Partner applicant session.
library;

import 'package:flutter/material.dart';
import 'package:undal_core/undal_core.dart';

import '../models/partner_models.dart';
import '../services/partner_api_client.dart';

/// Sign-in and GoTrue registration surface shown before any private application data loads.
class PartnerAuthScreen extends StatefulWidget {
  /// Creates the authentication screen with its real API client and session callback.
  const PartnerAuthScreen({
    super.key,
    required this.api,
    required this.isBangla,
    required this.onAuthenticated,
    required this.onToggleLanguage,
  });

  /// Configured Supabase GoTrue and W1 client.
  final PartnerApiClient api;

  /// Whether Bangla labels are active.
  final bool isBangla;

  /// Called only after GoTrue returns a usable access token.
  final ValueChanged<PartnerSession> onAuthenticated;

  /// Toggles the root EN/বাংলা locale without losing the login draft.
  final VoidCallback onToggleLanguage;

  @override
  State<PartnerAuthScreen> createState() => _PartnerAuthScreenState();
}

class _PartnerAuthScreenState extends State<PartnerAuthScreen> {
  final TextEditingController _name = TextEditingController();
  final TextEditingController _email = TextEditingController();
  final TextEditingController _password = TextEditingController();
  bool _registering = false;
  bool _busy = false;
  String? _errorCode;

  String _text(String en, String bn) => widget.isBangla ? bn : en;

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme colors = theme.colorScheme;
    return Scaffold(
      appBar: AppBar(
        title: Text(_text('Partner application', 'পার্টনার আবেদন')),
        actions: <Widget>[
          TextButton(onPressed: widget.onToggleLanguage, child: Text(widget.isBangla ? 'English' : 'বাংলা')),
        ],
      ),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 560),
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(UndalSpacingTokens.xl),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  Icon(Icons.storefront_outlined, size: 56, color: colors.primary),
                  const SizedBox(height: UndalSpacingTokens.md),
                  Text(
                    _text('Apply to become an Undal partner', 'উন্দাল পার্টনার হিসেবে আবেদন করুন'),
                    textAlign: TextAlign.center,
                    style: theme.textTheme.headlineSmall,
                  ),
                  const SizedBox(height: UndalSpacingTokens.sm),
                  Text(
                    _text('Sign in or create a secure account to save your application privately.', 'আপনার আবেদন নিরাপদে সংরক্ষণ করতে লগইন করুন বা নতুন অ্যাকাউন্ট খুলুন।'),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: UndalSpacingTokens.xl),
                  SegmentedButton<bool>(
                    segments: <ButtonSegment<bool>>[
                      ButtonSegment<bool>(value: false, label: Text(_text('Sign in', 'লগইন'))),
                      ButtonSegment<bool>(value: true, label: Text(_text('Create account', 'অ্যাকাউন্ট খুলুন'))),
                    ],
                    selected: <bool>{_registering},
                    onSelectionChanged: _busy ? null : (Set<bool> value) => setState(() { _registering = value.single; _errorCode = null; }),
                  ),
                  const SizedBox(height: UndalSpacingTokens.lg),
                  if (_registering) ...<Widget>[
                    TextField(
                      key: const ValueKey<String>('partner-auth-name'),
                      controller: _name,
                      textCapitalization: TextCapitalization.words,
                      autofillHints: const <String>[AutofillHints.name],
                      decoration: InputDecoration(labelText: _text('Your legal name', 'আপনার আইনগত নাম'), border: const OutlineInputBorder()),
                    ),
                    const SizedBox(height: UndalSpacingTokens.md),
                  ],
                  TextField(
                    key: const ValueKey<String>('partner-auth-email'),
                    controller: _email,
                    keyboardType: TextInputType.emailAddress,
                    autofillHints: const <String>[AutofillHints.email],
                    decoration: InputDecoration(labelText: _text('Email address', 'ইমেইল ঠিকানা'), border: const OutlineInputBorder()),
                  ),
                  const SizedBox(height: UndalSpacingTokens.md),
                  TextField(
                    key: const ValueKey<String>('partner-auth-password'),
                    controller: _password,
                    obscureText: true,
                    autofillHints: <String>[_registering ? AutofillHints.newPassword : AutofillHints.password],
                    decoration: InputDecoration(labelText: _text('Password', 'পাসওয়ার্ড'), border: const OutlineInputBorder()),
                  ),
                  if (_errorCode != null) ...<Widget>[
                    const SizedBox(height: UndalSpacingTokens.md),
                    Text(_errorText(_errorCode!), key: const ValueKey<String>('partner-auth-error'), style: TextStyle(color: colors.error)),
                  ],
                  const SizedBox(height: UndalSpacingTokens.lg),
                  FilledButton.icon(
                    key: const ValueKey<String>('partner-auth-submit'),
                    onPressed: _busy ? null : _submit,
                    icon: _busy
                        ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                        : Icon(_registering ? Icons.person_add_alt_1 : Icons.login),
                    label: Text(_registering ? _text('Create account', 'অ্যাকাউন্ট খুলুন') : _text('Sign in', 'লগইন')),
                  ),
                  const SizedBox(height: UndalSpacingTokens.md),
                  Text(
                    _text('Your password and session stay on this device and Supabase Auth. Never share a one-time code or password.', 'আপনার পাসওয়ার্ড ও সেশন এই ডিভাইস এবং Supabase Auth-এ থাকে। পাসওয়ার্ড বা একবারের কোড কাউকে দেবেন না।'),
                    style: theme.textTheme.bodySmall,
                    textAlign: TextAlign.center,
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _submit() async {
    final String email = _email.text.trim().toLowerCase();
    final String password = _password.text;
    if (!email.contains('@') || password.length < 8 || (_registering && _name.text.trim().length < 2)) {
      setState(() => _errorCode = 'VALIDATION_FAILED');
      return;
    }
    setState(() { _busy = true; _errorCode = null; });
    try {
      final PartnerSession session = _registering
          ? await widget.api.signUp(email: email, password: password, fullName: _name.text.trim())
          : await widget.api.signIn(email: email, password: password);
      if (mounted) widget.onAuthenticated(session);
    } on PartnerApiException catch (error) {
      if (mounted) setState(() => _errorCode = error.code);
    } on Exception {
      if (mounted) setState(() => _errorCode = 'NETWORK_UNAVAILABLE');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _errorText(String code) {
    return switch (code) {
      'EMAIL_CONFIRMATION_REQUIRED' => _text('Check your email, confirm your account, then sign in.', 'ইমেইল যাচাই করে আবার লগইন করুন।'),
      'INVALID_LOGIN_CREDENTIALS' || 'invalid_credentials' || 'SESSION_EXPIRED' => _text('Email or password could not be verified.', 'ইমেইল বা পাসওয়ার্ড যাচাই করা যায়নি।'),
      'USER_ALREADY_EXISTS' || 'user_already_exists' => _text('An account already exists for this email. Sign in instead.', 'এই ইমেইলে অ্যাকাউন্ট আছে। লগইন করুন।'),
      'AUTH_NOT_CONFIGURED' || 'API_NOT_CONFIGURED' => _text('Partner sign-in is not configured for this build. Contact Undal support.', 'এই বিল্ডে পার্টনার লগইন কনফিগার করা নেই। উন্দাল সাপোর্টে যোগাযোগ করুন।'),
      'NETWORK_UNAVAILABLE' => _text('Could not reach the secure sign-in service. Check your connection.', 'নিরাপদ লগইন সার্ভিসে সংযোগ হয়নি। ইন্টারনেট পরীক্ষা করুন।'),
      _ => _text('Please check the fields and try again.', 'তথ্যগুলো পরীক্ষা করে আবার চেষ্টা করুন।'),
    };
  }
}
