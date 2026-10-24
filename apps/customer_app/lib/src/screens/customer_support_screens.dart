/// Help centre, customer support ticket history, and first-party ticket chat (`c-36..c-37`).
///
/// FAQs describe current COD/pickup rules; ticket creation, replies, and history are persisted by W1.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:undal_core/undal_core.dart';

import '../i18n/customer_copy.dart';
import '../models/customer_experience_models.dart';
import '../models/customer_models.dart';
import '../state/customer_controller.dart';
import '../state/customer_experience_state.dart';

/// Help articles and real support-ticket entry points (`c-36`).
class CustomerHelpCenterScreen extends StatefulWidget {
  /// Creates the help and support index.
  const CustomerHelpCenterScreen({super.key, required this.controller});

  /// Root customer controller.
  final CustomerController controller;

  @override
  State<CustomerHelpCenterScreen> createState() => _CustomerHelpCenterScreenState();
}

class _CustomerHelpCenterScreenState extends State<CustomerHelpCenterScreen> {
  bool _creatingTicket = false;

  @override
  void initState() {
    super.initState();
    if (widget.controller.isAuthenticated) widget.controller.experience.loadSupportThreads();
  }

  Future<void> _newTicket() async {
    if (!widget.controller.isAuthenticated) {
      widget.controller.openAuthHub();
      return;
    }
    final TextEditingController subject = TextEditingController();
    final TextEditingController body = TextEditingController();
    String category = 'general';
    final bool? submit = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) => StatefulBuilder(
        builder: (BuildContext dialogContext, StateSetter setState) => AlertDialog(
          title: Text(cText(dialogContext, 'Contact Undal Support', 'উন্দাল সহায়তায় যোগাযোগ')),
          content: Column(mainAxisSize: MainAxisSize.min, children: <Widget>[
            DropdownButtonFormField<String>(
              value: category,
              decoration: InputDecoration(labelText: cText(dialogContext, 'Topic', 'বিষয়')),
              items: <DropdownMenuItem<String>>[
                DropdownMenuItem(value: 'general', child: Text(cText(dialogContext, 'General question', 'সাধারণ প্রশ্ন'))),
                DropdownMenuItem(value: 'account', child: Text(cText(dialogContext, 'Account', 'অ্যাকাউন্ট'))),
                DropdownMenuItem(value: 'order', child: Text(cText(dialogContext, 'Order', 'অর্ডার'))),
                DropdownMenuItem(value: 'privacy', child: Text(cText(dialogContext, 'Privacy request', 'গোপনীয়তার অনুরোধ'))),
              ],
              onChanged: (String? value) => setState(() => category = value ?? 'general'),
            ),
            TextField(controller: subject, maxLength: 120, onChanged: (_) => setState(() {}), decoration: InputDecoration(labelText: cText(dialogContext, 'Subject', 'বিষয়'))),
            TextField(controller: body, minLines: 2, maxLines: 4, maxLength: 1000, onChanged: (_) => setState(() {}), decoration: InputDecoration(labelText: cText(dialogContext, 'How can we help?', 'কীভাবে সহায়তা করতে পারি?'))),
          ]),
          actions: <Widget>[
            TextButton(onPressed: () => Navigator.of(dialogContext).pop(false), child: Text(cText(dialogContext, 'Cancel', 'বাতিল'))),
            FilledButton(
              onPressed: subject.text.trim().length < 3 || body.text.trim().length < 2 ? null : () => Navigator.of(dialogContext).pop(true),
              child: Text(cText(dialogContext, 'Create ticket', 'টিকিট তৈরি করুন')),
            ),
          ],
        ),
      ),
    );
    if (submit == true && mounted) {
      setState(() => _creatingTicket = true);
      final bool created = await widget.controller.experience.createSupportThread(
        category: category,
        subject: subject.text.trim(),
        body: body.text.trim(),
      );
      if (mounted) {
        setState(() => _creatingTicket = false);
        if (!created) {
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text(cText(context, 'Support ticket could not be created. Try again.', 'সহায়তা টিকিট তৈরি হয়নি। আবার চেষ্টা করুন।')),
          ));
        }
      }
    }
    subject.dispose();
    body.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final CustomerExperienceState state = widget.controller.experience;
    final String languageCode = Localizations.localeOf(context).languageCode;
    final List<(String, String, String, String)> faqs = <(String, String, String, String)>[
      ('Cash on delivery', 'ক্যাশ অন ডেলিভারি', 'Orders are paid to the rider in cash when handed over. Undal does not store a customer cash balance.', 'অর্ডার হাতে পাওয়ার সময় রাইডারকে নগদে মূল্য দিন। উন্দাল গ্রাহকের নগদ ব্যালেন্স রাখে না।'),
      ('Counter pickup', 'কাউন্টার পিকআপ', 'For a ready pickup order, show the secure QR at the kitchen counter. The rider collects the full COD amount; no cash is exchanged at the counter.', 'পিকআপ প্রস্তুত হলে রান্নাঘরের কাউন্টারে নিরাপদ QR দেখান। পুরো COD রাইডার নেন; কাউন্টারে নগদ লেনদেন হয় না।'),
      ('Delivery zones', 'ডেলিভারি জোন', 'Delivery availability is checked against the active service-zone pin saved with your address.', 'আপনার ঠিকানার পিন সক্রিয় সার্ভিস জোনে আছে কি না তা যাচাই করা হয়।'),
      ('Order chat', 'অর্ডার চ্যাট', 'Chat is available with the assigned rider or kitchen while the order conversation is open. Phone numbers and external links are filtered.', 'অর্ডার চ্যাট খোলা থাকলে নিয়োগকৃত রাইডার বা রান্নাঘরের সঙ্গে বার্তা পাঠাতে পারবেন। ফোন নম্বর ও বাইরের লিংক ফিল্টার হয়।'),
      ('Fees and receipt', 'ফি ও রসিদ', 'Your receipt shows the server-calculated food, delivery, platform, discount, tax-included, and COD totals in BDT.', 'রসিদে সার্ভার-হিসাব করা খাবার, ডেলিভারি, প্ল্যাটফর্ম, ছাড়, ভ্যাটসহ ও COD মূল্য BDT-তে দেখানো হয়।'),
    ];
    return Scaffold(
      key: const ValueKey<String>('screen-c-36'),
      appBar: AppBar(title: Text(cText(context, 'Help center', 'সহায়তা কেন্দ্র')), leading: BackButton(onPressed: () => widget.controller.returnFromCustomerExperience(tabIndex: 4))),
      body: ListView(padding: const EdgeInsets.all(UndalSpacingTokens.md), children: <Widget>[
        for (final (String, String, String, String) item in faqs)
          Card(child: ExpansionTile(title: Text(cText(context, item.$1, item.$2)), childrenPadding: const EdgeInsets.all(UndalSpacingTokens.md), children: <Widget>[Align(alignment: Alignment.centerLeft, child: Text(cText(context, item.$3, item.$4)))])),
        const SizedBox(height: UndalSpacingTokens.sm),
        FilledButton.icon(key: const ValueKey<String>('help-create-ticket'), onPressed: _creatingTicket ? null : _newTicket, icon: _creatingTicket ? const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.support_agent), label: Text(widget.controller.isAuthenticated ? cText(context, 'Contact support', 'সহায়তায় যোগাযোগ করুন') : cText(context, 'Sign in to contact support', 'সহায়তায় যোগাযোগ করতে লগইন করুন'))),
        const SizedBox(height: UndalSpacingTokens.md),
        Text(cText(context, 'Your support tickets', 'আপনার সহায়তা টিকিট'), style: Theme.of(context).textTheme.titleLarge),
        if (!widget.controller.isAuthenticated)
          Text(cText(context, 'Sign in to view support tickets linked to your account.', 'আপনার অ্যাকাউন্টের সহায়তা টিকিট দেখতে লগইন করুন।'))
        else if (state.supportLoading && state.supportThreads.isEmpty)
          const LinearProgressIndicator()
        else if (state.supportError != null && state.supportThreads.isEmpty)
          TextButton.icon(onPressed: state.loadSupportThreads, icon: const Icon(Icons.refresh), label: Text(cText(context, 'Retry', 'আবার চেষ্টা করুন')))
        else if (state.supportThreads.isEmpty)
          Text(cText(context, 'No support tickets yet.', 'এখনো কোনো সহায়তা টিকিট নেই।')),
        if (widget.controller.isAuthenticated)
          for (final CustomerSupportThread thread in state.supportThreads)
          Card(child: ListTile(
            key: ValueKey<String>('support-thread-${thread.id}'),
            leading: const Icon(Icons.forum_outlined),
            title: Text(thread.subject),
            subtitle: Text('${_supportStatus(context, thread.status)} · ${_supportTime(thread.createdAt, languageCode)}'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => state.openSupportThread(thread.id),
          )),
      ]),
    );
  }
}

String _supportStatus(BuildContext context, String status) => switch (status.toLowerCase()) {
      'open' => cText(context, 'Open', 'খোলা'),
      'in_progress' || 'assigned' => cText(context, 'In progress', 'চলমান'),
      'waiting_customer' => cText(context, 'Waiting for you', 'আপনার উত্তরের অপেক্ষায়'),
      'resolved' => cText(context, 'Resolved', 'সমাধান হয়েছে'),
      'closed' => cText(context, 'Closed', 'বন্ধ'),
      _ => cText(context, 'Updated', 'আপডেট হয়েছে'),
    };

String _supportTime(DateTime? value, String languageCode) {
  if (value == null) return '';
  final DateTime dhaka = value.toUtc().add(const Duration(hours: 6));
  final String formatted = '${dhaka.year}-${dhaka.month.toString().padLeft(2, '0')}-${dhaka.day.toString().padLeft(2, '0')} ${dhaka.hour.toString().padLeft(2, '0')}:${dhaka.minute.toString().padLeft(2, '0')}';
  return languageCode == 'bn' ? toBengaliDigits(formatted) : formatted;
}

/// Text-only customer support ticket conversation stored in W1 (`c-37`).
class CustomerSupportChatScreen extends StatefulWidget {
  /// Creates the selected support-ticket conversation.
  const CustomerSupportChatScreen({super.key, required this.controller});

  /// Root customer controller.
  final CustomerController controller;

  @override
  State<CustomerSupportChatScreen> createState() => _CustomerSupportChatScreenState();
}

class _CustomerSupportChatScreenState extends State<CustomerSupportChatScreen> {
  late final TextEditingController _composer = TextEditingController();
  Timer? _refreshTimer;

  @override
  void initState() {
    super.initState();
    _refreshTimer = Timer.periodic(const Duration(seconds: 5), (_) {
      final CustomerExperienceState state = widget.controller.experience;
      if (mounted && state.supportThreadId != null && !state.supportLoading && !state.supportSending) {
        state.loadSupportMessages();
      }
    });
  }

  @override
  void dispose() {
    _refreshTimer?.cancel();
    _composer.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final CustomerExperienceState state = widget.controller.experience;
    CustomerSupportThread? thread;
    for (final CustomerSupportThread row in state.supportThreads) {
      if (row.id == state.supportThreadId) {
        thread = row;
        break;
      }
    }
    return Scaffold(
      key: const ValueKey<String>('screen-c-37'),
      appBar: AppBar(
        title: Text(thread?.subject ?? cText(context, 'Support conversation', 'সহায়তা কথোপকথন')),
        leading: BackButton(onPressed: () => widget.controller.openCustomerExperienceScreen(CustomerScreenId.c36HelpCenter, parentTab: 4)),
      ),
      body: state.supportThreadId == null
          ? Center(child: Text(cText(context, 'Open a ticket from the Help Center to start a support conversation.', 'সহায়তা কথোপকথন শুরু করতে সহায়তা কেন্দ্র থেকে টিকিট খুলুন।')))
          : Column(children: <Widget>[
              Expanded(
                child: state.supportLoading && state.supportMessages.isEmpty
                    ? const Center(child: CircularProgressIndicator())
                    : ListView.builder(
                        reverse: true,
                        padding: const EdgeInsets.all(UndalSpacingTokens.md),
                        itemCount: state.supportMessages.length,
                        itemBuilder: (BuildContext context, int index) {
                          final Map<String, Object?> message = state.supportMessages[state.supportMessages.length - index - 1];
                          final bool mine = customerJsonString(message['sender_id']) == widget.controller.session?.userId;
                          return Align(
                            alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
                            child: Card(child: Padding(
                              padding: const EdgeInsets.all(UndalSpacingTokens.sm),
                              child: Text(customerJsonString(message['body'])),
                            )),
                          );
                        },
                      ),
              ),
              SafeArea(top: false, child: Padding(
                padding: const EdgeInsets.all(UndalSpacingTokens.sm),
                child: Row(children: <Widget>[
                  Expanded(child: TextField(
                    controller: _composer,
                    maxLength: 1000,
                    minLines: 1,
                    maxLines: 4,
                    decoration: InputDecoration(hintText: cText(context, 'Write a reply', 'উত্তর লিখুন'), counterText: ''),
                    onChanged: (_) => setState(() {}),
                  )),
                  IconButton.filled(
                    key: const ValueKey<String>('support-chat-send'),
                    tooltip: cText(context, 'Send reply', 'উত্তর পাঠান'),
                    onPressed: state.supportSending || _composer.text.trim().isEmpty ? null : () async {
                      final bool sent = await state.sendSupportMessage(_composer.text.trim());
                      if (!mounted) return;
                      if (sent) {
                        _composer.clear();
                        setState(() {});
                      } else {
                        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
                          content: Text(cText(context, 'Reply could not be sent. Check your connection and try again.', 'উত্তর পাঠানো যায়নি। সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।')),
                        ));
                      }
                    },
                    icon: state.supportSending ? const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.send),
                  ),
                ]),
              )),
            ]),
    );
  }
}
