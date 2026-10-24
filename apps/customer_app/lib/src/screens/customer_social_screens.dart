/// Customer order chat, favourites, and server-backed delivery-address screens (`c-24..c-31`).
///
/// All mutations are authenticated W1 requests, public kitchen cards use the privacy-filtered view,
/// and address pins are resolved by the server rather than trusted from local preview state.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:undal_core/undal_core.dart';

import '../i18n/customer_copy.dart';
import '../models/customer_experience_models.dart';
import '../state/customer_commerce_state.dart';
import '../state/customer_controller.dart';
import '../state/customer_experience_state.dart';

/// Order-participant chat for the assigned rider (`c-24`) or kitchen (`c-25`).
class CustomerOrderChatScreen extends StatefulWidget {
  /// Creates one participant-safe order chat view.
  const CustomerOrderChatScreen({super.key, required this.controller});

  /// Root customer controller.
  final CustomerController controller;

  @override
  State<CustomerOrderChatScreen> createState() => _CustomerOrderChatScreenState();
}

class _CustomerOrderChatScreenState extends State<CustomerOrderChatScreen> {
  late final TextEditingController _messageController;
  Timer? _refreshTimer;

  @override
  void initState() {
    super.initState();
    _messageController = TextEditingController();
    _refreshTimer = Timer.periodic(const Duration(seconds: 5), (_) {
      if (mounted && !widget.controller.experience.chatLoading && !widget.controller.experience.chatSending) {
        widget.controller.experience.loadChatMessages();
      }
    });
  }

  @override
  void dispose() {
    _refreshTimer?.cancel();
    _messageController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final CustomerExperienceState state = widget.controller.experience;
    final bool rider = state.chatPair == 'customer_rider';
    final String lang = Localizations.localeOf(context).languageCode;
    return Scaffold(
      key: ValueKey<String>(rider ? 'screen-c-24' : 'screen-c-25'),
      appBar: AppBar(
        title: Text(rider ? cText(context, 'Chat with rider', 'রাইডারের সঙ্গে চ্যাট') : cText(context, 'Chat with kitchen', 'রান্নাঘরের সঙ্গে চ্যাট')),
        leading: BackButton(onPressed: () => widget.controller.returnFromCustomerExperience(tabIndex: 2)),
        actions: <Widget>[
          IconButton(
            tooltip: cText(context, 'Refresh messages', 'বার্তা রিফ্রেশ'),
            onPressed: state.chatLoading ? null : state.loadChatMessages,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: Column(children: <Widget>[
        Expanded(
          child: state.chatLoading && state.chatMessages.isEmpty
              ? const Center(child: CircularProgressIndicator())
              : state.chatError != null && state.chatMessages.isEmpty
                  ? _ChatNotice(onRetry: state.loadChatMessages)
                  : ListView.builder(
                      key: const ValueKey<String>('order-chat-timeline'),
                      reverse: true,
                      padding: const EdgeInsets.all(UndalSpacingTokens.md),
                      itemCount: state.chatMessages.length + 1,
                      itemBuilder: (BuildContext context, int index) {
                        if (index == state.chatMessages.length) {
                          return Padding(
                            padding: const EdgeInsets.only(bottom: UndalSpacingTokens.md),
                            child: Text(
                              cText(context, 'Messages are saved securely. Phone numbers and external links are filtered.', 'বার্তাগুলো নিরাপদে সংরক্ষিত হয়। ফোন নম্বর ও বাইরের লিংক ফিল্টার করা হয়।'),
                              textAlign: TextAlign.center,
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                          );
                        }
                        final CustomerChatMessage message = state.chatMessages[state.chatMessages.length - index - 1];
                        final bool mine = message.senderId == widget.controller.session?.userId;
                        return Align(
                          alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
                          child: ConstrainedBox(
                            constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.78),
                            child: Card(
                              color: mine ? Theme.of(context).colorScheme.primaryContainer : null,
                              child: Padding(
                                padding: const EdgeInsets.all(UndalSpacingTokens.sm),
                                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[
                                  Text(message.body),
                                  if (message.isBlocked)
                                    Text(cText(context, 'Contact details were filtered for safety.', 'নিরাপত্তার জন্য যোগাযোগের তথ্য ফিল্টার করা হয়েছে।'), style: Theme.of(context).textTheme.labelSmall),
                                  if (message.createdAt != null)
                                    Text(_chatTime(message.createdAt!, lang), style: Theme.of(context).textTheme.labelSmall),
                                ]),
                              ),
                            ),
                          ),
                        );
                      },
                    ),
        ),
        SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(UndalSpacingTokens.sm, 0, UndalSpacingTokens.sm, UndalSpacingTokens.sm),
            child: Row(children: <Widget>[
              Expanded(
                child: TextField(
                  key: const ValueKey<String>('order-chat-composer'),
                  controller: _messageController,
                  minLines: 1,
                  maxLines: 4,
                  maxLength: 500,
                  textCapitalization: TextCapitalization.sentences,
                  decoration: InputDecoration(hintText: cText(context, 'Write a message', 'বার্তা লিখুন'), counterText: ''),
                  onChanged: (_) => setState(() {}),
                ),
              ),
              const SizedBox(width: UndalSpacingTokens.xs),
              IconButton.filled(
                key: const ValueKey<String>('order-chat-send'),
                tooltip: cText(context, 'Send message', 'বার্তা পাঠান'),
                onPressed: state.chatSending || _messageController.text.trim().isEmpty
                    ? null
                    : () async {
                        final String text = _messageController.text.trim();
                        final bool sent = await state.sendChatMessage(text);
                        if (!mounted) return;
                        if (sent) {
                          _messageController.clear();
                          setState(() {});
                        } else {
                          ScaffoldMessenger.of(context).showSnackBar(SnackBar(
                            content: Text(cText(context, 'Message could not be sent. Check the order chat window and try again.', 'বার্তা পাঠানো যায়নি। অর্ডার চ্যাট চালু আছে কি না দেখে আবার চেষ্টা করুন।')),
                          ));
                        }
                      },
                icon: state.chatSending ? const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.send),
              ),
            ]),
          ),
        ),
      ]),
    );
  }
}

/// Displays public kitchen cards saved through W1, with verified favourite toggles (`c-29`).
class CustomerFavouritesScreen extends StatefulWidget {
  /// Creates the authenticated customer favourites screen.
  const CustomerFavouritesScreen({super.key, required this.controller});

  /// Root customer controller.
  final CustomerController controller;

  @override
  State<CustomerFavouritesScreen> createState() => _CustomerFavouritesScreenState();
}

class _CustomerFavouritesScreenState extends State<CustomerFavouritesScreen> {
  @override
  void initState() {
    super.initState();
    widget.controller.experience.loadFavourites();
  }

  @override
  Widget build(BuildContext context) {
    final CustomerExperienceState state = widget.controller.experience;
    final String lang = Localizations.localeOf(context).languageCode;
    return Scaffold(
      key: const ValueKey<String>('screen-c-29'),
      appBar: AppBar(title: Text(cText(context, 'Favourite kitchens', 'প্রিয় রান্নাঘর')), leading: BackButton(onPressed: () => widget.controller.returnFromCustomerExperience(tabIndex: 4))),
      body: state.favouritesLoading && state.favourites.isEmpty
          ? const Center(child: CircularProgressIndicator())
          : state.favouritesError != null && state.favourites.isEmpty
              ? _AccountLoadNotice(onRetry: state.loadFavourites)
              : state.favourites.isEmpty
                  ? _AccountEmptyState(icon: Icons.favorite_border, text: cText(context, 'You have not saved a kitchen yet.', 'এখনো কোনো রান্নাঘর পছন্দের তালিকায় নেই।'))
                  : RefreshIndicator(
                      onRefresh: state.loadFavourites,
                      child: ListView.builder(
                        padding: const EdgeInsets.all(UndalSpacingTokens.md),
                        itemCount: state.favourites.length,
                        itemBuilder: (BuildContext context, int index) {
                          final CustomerFavouriteEntry favourite = state.favourites[index];
                          return Card(
                            key: ValueKey<String>('favourite-${favourite.vendorId}'),
                            child: ListTile(
                              leading: favourite.logoUrl == null
                                  ? const CircleAvatar(child: Icon(Icons.restaurant))
                                  : CircleAvatar(backgroundImage: NetworkImage(favourite.logoUrl!)),
                              title: Text(favourite.name(lang).isEmpty ? cText(context, 'Kitchen no longer available', 'রান্নাঘরটি আর উপলভ্য নয়') : favourite.name(lang)),
                              subtitle: Text(favourite.area(lang).isEmpty ? cText(context, 'No public kitchen details', 'রান্নাঘরের প্রকাশ্য তথ্য নেই') : '${favourite.area(lang)} · ★ ${favourite.ratingAverage.toStringAsFixed(1)} (${favourite.ratingCount})'),
                              onTap: favourite.slug.isEmpty ? null : () => widget.controller.commerce.openVendorBySlug(favourite.slug),
                              trailing: IconButton(
                                tooltip: cText(context, 'Remove favourite', 'পছন্দ থেকে সরান'),
                                onPressed: state.isFavouritePending(favourite.vendorId) ? null : () async {
                                  final bool removed = await state.toggleFavourite(favourite.vendorId);
                                  if (!removed && context.mounted) {
                                    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
                                      content: Text(cText(context, 'Favourite could not be updated. Check your connection and retry.', 'পছন্দের তালিকা আপডেট হয়নি। সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।')),
                                    ));
                                  }
                                },
                                icon: state.isFavouritePending(favourite.vendorId) ? const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.favorite),
                              ),
                            ),
                          );
                        },
                      ),
                    ),
    );
  }
}

/// Shows the W1-saved customer address book and protects the active checkout pin (`c-30`).
class CustomerAddressesScreen extends StatefulWidget {
  /// Creates the saved address screen.
  const CustomerAddressesScreen({super.key, required this.controller});

  /// Root customer controller.
  final CustomerController controller;

  @override
  State<CustomerAddressesScreen> createState() => _CustomerAddressesScreenState();
}

class _CustomerAddressesScreenState extends State<CustomerAddressesScreen> {
  @override
  void initState() {
    super.initState();
    widget.controller.experience.loadAddresses();
  }

  Future<void> _selectAddress(CustomerAddressEntry address) async {
    final ZoneResolutionVerdict verdict = await widget.controller.api.resolveZone(address.point);
    if (!mounted) return;
    widget.controller.selectExperienceAddress(address, serverVerdict: verdict);
    widget.controller.returnFromCustomerExperience(tabIndex: 4);
  }

  Future<void> _deleteAddress(CustomerAddressEntry address) async {
    final bool? confirmed = await showDialog<bool>(
      context: context,
      builder: (BuildContext context) => AlertDialog(
        title: Text(cText(context, 'Remove this address?', 'এই ঠিকানাটি সরাবেন?')),
        content: Text(cText(context, 'This only removes the saved address. Existing order snapshots are not changed.', 'এতে শুধু সংরক্ষিত ঠিকানা সরবে। আগের অর্ডারের ঠিকানা বদলাবে না।')),
        actions: <Widget>[
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: Text(cText(context, 'Keep it', 'রাখুন'))),
          FilledButton(onPressed: () => Navigator.of(context).pop(true), child: Text(cText(context, 'Remove', 'সরান'))),
        ],
      ),
    );
    if (confirmed == true) {
      final bool deleted = await widget.controller.experience.deleteAddress(address.id);
      if (deleted && mounted) widget.controller.deleteSavedAddress(address.id);
    }
  }

  Future<void> _makeDefault(CustomerAddressEntry address) async {
    final CustomerAddressEntry? saved = await widget.controller.experience.saveAddress(address, addressId: address.id, isDefault: true);
    if (saved == null || !mounted) return;
    final ZoneResolutionVerdict verdict = await widget.controller.api.resolveZone(saved.point);
    if (mounted) widget.controller.selectExperienceAddress(saved, serverVerdict: verdict);
  }

  @override
  Widget build(BuildContext context) {
    final CustomerExperienceState state = widget.controller.experience;
    return Scaffold(
      key: const ValueKey<String>('screen-c-30'),
      appBar: AppBar(
        title: Text(cText(context, 'Saved addresses', 'সংরক্ষিত ঠিকানা')),
        leading: BackButton(onPressed: () => widget.controller.returnFromCustomerExperience(tabIndex: 4)),
        actions: <Widget>[
          IconButton(tooltip: cText(context, 'Refresh addresses', 'ঠিকানা রিফ্রেশ'), onPressed: state.addressesLoading ? null : state.loadAddresses, icon: const Icon(Icons.refresh)),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        key: const ValueKey<String>('address-add-new'),
        onPressed: () => state.openAddressEditor(null),
        icon: const Icon(Icons.add_location_alt_outlined),
        label: Text(cText(context, 'Add address', 'ঠিকানা যোগ করুন')),
      ),
      body: state.addressesLoading && state.addresses.isEmpty
          ? const Center(child: CircularProgressIndicator())
          : state.addressesError != null && state.addresses.isEmpty
              ? _AccountLoadNotice(onRetry: state.loadAddresses)
              : state.addresses.isEmpty
                  ? _AccountEmptyState(icon: Icons.location_off_outlined, text: cText(context, 'No saved delivery addresses.', 'কোনো সংরক্ষিত ডেলিভারি ঠিকানা নেই।'))
                  : RefreshIndicator(
                      onRefresh: state.loadAddresses,
                      child: ListView.builder(
                        padding: const EdgeInsets.all(UndalSpacingTokens.md),
                        itemCount: state.addresses.length,
                        itemBuilder: (BuildContext context, int index) {
                          final CustomerAddressEntry address = state.addresses[index];
                          final bool selected = widget.controller.activeAddress.id == address.id;
                          return Card(child: ListTile(
                            key: ValueKey<String>('saved-address-${address.id}'),
                            leading: Icon(selected ? Icons.radio_button_checked : Icons.location_on_outlined, color: Theme.of(context).colorScheme.primary),
                            title: Text('${address.label}${address.isDefault ? ' · ${cText(context, 'Default', 'ডিফল্ট')}' : ''}'),
                            subtitle: Text('${address.addressText}\n${address.plusCode} · ${address.inServiceArea ? cText(context, 'Serviceable', 'সেবার আওতায়') : cText(context, 'Outside active delivery zones', 'সক্রিয় ডেলিভারি এলাকার বাইরে')}'),
                            onTap: () => _selectAddress(address),
                            trailing: PopupMenuButton<String>(
                              tooltip: cText(context, 'Address actions', 'ঠিকানার কাজ'),
                              onSelected: (String action) {
                                if (action == 'edit') state.openAddressEditor(address);
                                if (action == 'delete') _deleteAddress(address);
                                if (action == 'default' && !address.isDefault) _makeDefault(address);
                              },
                              itemBuilder: (BuildContext context) => <PopupMenuEntry<String>>[
                                PopupMenuItem(value: 'edit', child: Text(cText(context, 'Edit', 'সম্পাদনা'))),
                                if (!address.isDefault) PopupMenuItem(value: 'default', child: Text(cText(context, 'Make default', 'ডিফল্ট করুন'))),
                                PopupMenuItem(value: 'delete', child: Text(cText(context, 'Delete', 'মুছুন'))),
                              ],
                            ),
                          ));
                        },
                      ),
                    ),
    );
  }
}

/// Edits an address pin and instructions using W1's zone-checked address endpoint (`c-31`).
class CustomerAddressEditorScreen extends StatefulWidget {
  /// Creates a map-pin address editor for a saved or new delivery address.
  const CustomerAddressEditorScreen({super.key, required this.controller});

  /// Root customer controller.
  final CustomerController controller;

  @override
  State<CustomerAddressEditorScreen> createState() => _CustomerAddressEditorScreenState();
}

class _CustomerAddressEditorScreenState extends State<CustomerAddressEditorScreen> {
  late final CustomerAddressEntry? _original = widget.controller.experience.addressBeingEdited;
  late final TextEditingController _label = TextEditingController(text: _original?.label ?? 'Home');
  late final TextEditingController _address = TextEditingController(text: _original?.addressText ?? '');
  late final TextEditingController _instructions = TextEditingController(text: _original?.landmarkNote ?? '');
  late GeoPoint _center = _original?.point ?? widget.controller.activeAddress.point;
  late bool _isDefault = _original?.isDefault ?? widget.controller.experience.addresses.isEmpty;
  bool _saving = false;

  @override
  void dispose() {
    _label.dispose();
    _address.dispose();
    _instructions.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_saving || _address.text.trim().length < 3 || _label.text.trim().isEmpty) return;
    setState(() => _saving = true);
    final CustomerAddressEntry draft = CustomerAddressEntry(
      id: _original?.id ?? '',
      label: _label.text.trim(),
      point: _center,
      addressText: _address.text.trim(),
      landmarkNote: _instructions.text.trim(),
      zoneId: _original?.zoneId,
      isDefault: _isDefault,
    );
    final CustomerAddressEntry? saved = await widget.controller.experience.saveAddress(draft, addressId: _original?.id, isDefault: _isDefault);
    if (saved != null && mounted) {
      final ZoneResolutionVerdict verdict = await widget.controller.api.resolveZone(saved.point);
      if (!mounted) return;
      widget.controller.selectExperienceAddress(saved, serverVerdict: verdict);
      widget.controller.returnFromCustomerExperience(tabIndex: 4);
    }
    if (mounted) setState(() => _saving = false);
  }

  @override
  Widget build(BuildContext context) {
    final CustomerExperienceState state = widget.controller.experience;
    final bool canSave = _label.text.trim().isNotEmpty && _address.text.trim().length >= 3 && !_saving;
    return Scaffold(
      key: const ValueKey<String>('screen-c-31'),
      appBar: AppBar(title: Text(_original == null ? cText(context, 'Add address', 'ঠিকানা যোগ করুন') : cText(context, 'Edit address', 'ঠিকানা সম্পাদনা')), leading: BackButton(onPressed: () => widget.controller.returnFromCustomerExperience(tabIndex: 4))),
      body: ListView(padding: const EdgeInsets.all(UndalSpacingTokens.md), children: <Widget>[
        Text(cText(context, 'Move the map until the pin is at your delivery point. The server checks the active zone when you save.', 'মানচিত্র সরিয়ে পিনটি ডেলিভারি স্থানে দিন। সেভ করার সময় সার্ভার সক্রিয় জোন যাচাই করবে।')),
        const SizedBox(height: UndalSpacingTokens.sm),
        SizedBox(height: 280, child: UndalOsmMap(
          center: _center,
          showCenterPin: true,
          tileProxyBaseUrl: widget.controller.api.config.effectiveTileProxyUrl,
          onCenterChanged: (GeoPoint point) => setState(() => _center = point),
        )),
        const SizedBox(height: UndalSpacingTokens.sm),
        Text('${cText(context, 'Pin', 'পিন')} · ${encodePlusCode(_center)}'),
        TextField(controller: _label, maxLength: 60, decoration: InputDecoration(labelText: cText(context, 'Address label', 'ঠিকানার নাম')), onChanged: (_) => setState(() {})),
        TextField(controller: _address, maxLength: 400, minLines: 2, maxLines: 3, decoration: InputDecoration(labelText: cText(context, 'Area, road, or landmark', 'এলাকা, রাস্তা বা পরিচিত স্থান')), onChanged: (_) => setState(() {})),
        TextField(controller: _instructions, maxLength: 300, minLines: 1, maxLines: 3, decoration: InputDecoration(labelText: cText(context, 'Rider instructions (optional)', 'রাইডারের জন্য নির্দেশনা (ঐচ্ছিক)'))),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          value: _isDefault,
          onChanged: (bool value) => setState(() => _isDefault = value),
          title: Text(cText(context, 'Use as default delivery address', 'ডিফল্ট ডেলিভারি ঠিকানা করুন')),
        ),
        if (state.addressesError != null)
          Text(cText(context, 'Address could not be saved. Check your connection and try again.', 'ঠিকানা সেভ করা যায়নি। সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।'), style: TextStyle(color: Theme.of(context).colorScheme.error)),
        FilledButton.icon(
          key: const ValueKey<String>('address-save'),
          onPressed: canSave ? _save : null,
          icon: _saving ? const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.save_outlined),
          label: Text(cText(context, 'Save address', 'ঠিকানা সেভ করুন')),
        ),
      ]),
    );
  }
}

class _ChatNotice extends StatelessWidget {
  const _ChatNotice({required this.onRetry});
  final VoidCallback onRetry;
  @override
  Widget build(BuildContext context) => Center(child: FilledButton.icon(onPressed: onRetry, icon: const Icon(Icons.refresh), label: Text(cText(context, 'Retry chat', 'চ্যাট আবার চেষ্টা করুন'))));
}

class _AccountLoadNotice extends StatelessWidget {
  const _AccountLoadNotice({required this.onRetry});
  final VoidCallback onRetry;
  @override
  Widget build(BuildContext context) => Center(child: FilledButton.icon(onPressed: onRetry, icon: const Icon(Icons.refresh), label: Text(cText(context, 'Try again', 'আবার চেষ্টা করুন'))));
}

class _AccountEmptyState extends StatelessWidget {
  const _AccountEmptyState({required this.icon, required this.text});
  final IconData icon;
  final String text;
  @override
  Widget build(BuildContext context) => Center(child: Padding(padding: const EdgeInsets.all(UndalSpacingTokens.xl), child: Column(mainAxisSize: MainAxisSize.min, children: <Widget>[Icon(icon, size: 48), const SizedBox(height: UndalSpacingTokens.sm), Text(text, textAlign: TextAlign.center)])));
}

String _chatTime(DateTime time, String languageCode) {
  final DateTime dhaka = time.toUtc().add(const Duration(hours: 6));
  final String minute = dhaka.minute.toString().padLeft(2, '0');
  final String period = dhaka.hour < 12 ? 'AM' : 'PM';
  final int hour = dhaka.hour % 12 == 0 ? 12 : dhaka.hour % 12;
  final String formatted = languageCode == 'bn' ? '$hour:$minute' : '$hour:$minute $period';
  return languageCode == 'bn' ? toBengaliDigits(formatted) : formatted;
}
