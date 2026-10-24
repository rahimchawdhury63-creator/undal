part of 'customer_commerce_state.dart';

/// Required/min-max variant, add-on, and bundle-slot interaction rules for c-14/c-15.
extension CustomerCommerceCustomizationOperations on CustomerCommerceState {
  /// Opens c-14 for an item and initializes any server-required choices.
  void openItem(StorefrontMenuItem item) {
    _activeItem = item;
    _itemQuantity = 1;
    _itemInstructions = '';
    _variantChoices.clear();
    _optionChoices.clear();
    _bundleChoices.clear();
    for (final StorefrontVariantGroup group in item.variantGroups) {
      final StorefrontChoice? first = group.variants.where((StorefrontChoice c) => c.available).firstOrNull;
      if (group.minSelect > 0 && first != null) _variantChoices[group.id] = first.id;
    }
    for (final StorefrontChoiceGroup group in item.optionGroups) {
      final List<StorefrontChoice> defaults = group.choices.where((StorefrontChoice c) => c.available).take(group.minSelect).toList();
      if (defaults.isNotEmpty) _optionChoices[group.id] = defaults.map((StorefrontChoice c) => c.id).toSet();
    }
    _activeScreen = CustomerScreenId.c14ItemCustomizer;
    _onChanged();
  }

  /// Selects an available size/portion variant in the requested group.
  void selectVariant(String groupId, String variantId) {
    final StorefrontVariantGroup? group = _activeItem?.variantGroups.where((StorefrontVariantGroup g) => g.id == groupId).firstOrNull;
    if (group == null || !group.variants.any((StorefrontChoice c) => c.id == variantId && c.available)) return;
    _variantChoices[groupId] = variantId;
    _onChanged();
  }

  /// Clears an optional variant when its group does not require a choice.
  void clearVariant(String groupId) {
    final StorefrontVariantGroup? group = _activeItem?.variantGroups.where((StorefrontVariantGroup row) => row.id == groupId).firstOrNull;
    if (group == null || group.minSelect > 0 || _variantChoices.remove(groupId) == null) return;
    _onChanged();
  }

  /// Toggles an option while enforcing the server-defined maximum selection count.
  bool toggleOption(String groupId, String optionId) {
    final StorefrontChoiceGroup? group = _activeItem?.optionGroups.where((StorefrontChoiceGroup g) => g.id == groupId).firstOrNull;
    final StorefrontChoice? option = group?.choices.where((StorefrontChoice c) => c.id == optionId).firstOrNull;
    if (group == null || option == null || !option.available) return false;
    final Set<String> selected = _optionChoices.putIfAbsent(groupId, () => <String>{});
    if (selected.remove(optionId)) {
      _onChanged();
      return true;
    }
    if (selected.length >= group.maxSelect) return false;
    selected.add(optionId);
    _onChanged();
    return true;
  }

  /// Toggles an eligible bundle item while enforcing the slot's maximum selection count.
  bool toggleBundleChoice(String slotId, String itemId) {
    final BundleSlot? slot = _activeItem?.bundleSlots.where((BundleSlot s) => s.id == slotId).firstOrNull;
    final BundleSlotChoice? choice = slot?.choices.where((BundleSlotChoice c) => c.itemId == itemId).firstOrNull;
    if (slot == null || choice == null || !choice.available) return false;
    final Set<String> selected = _bundleChoices.putIfAbsent(slotId, () => <String>{});
    if (selected.remove(itemId)) {
      _onChanged();
      return true;
    }
    if (selected.length >= slot.maxPick) return false;
    selected.add(itemId);
    _onChanged();
    return true;
  }

  /// Opens c-15 for a configured bundle with at least one server-defined slot.
  void openBundleBuilder() {
    if (_activeItem?.isBundle != true || _activeItem!.bundleSlots.isEmpty) return;
    _activeScreen = CustomerScreenId.c15BundleBuilder;
    _onChanged();
  }

  /// Returns from c-15 to c-14 without discarding current bundle choices.
  void backToItemCustomizer() {
    _activeScreen = CustomerScreenId.c14ItemCustomizer;
    _onChanged();
  }

  /// Updates item quantity in the inclusive one-to-fifty range.
  void setItemQuantity(int value) {
    _itemQuantity = value.clamp(1, 50);
    _onChanged();
  }

  /// Updates bounded special instructions for the current item.
  void setItemInstructions(String value) {
    _itemInstructions = value.length > 200 ? value.substring(0, 200) : value;
    _onChanged();
  }

  /// Returns the quantity selected on c-14/c-15.
  int get itemQuantity => _itemQuantity;

  /// Returns the selected variant ID for a group.
  String? selectedVariant(String groupId) => _variantChoices[groupId];

  /// Returns whether one add-on choice is selected.
  bool isOptionSelected(String groupId, String optionId) => _optionChoices[groupId]?.contains(optionId) ?? false;

  /// Returns whether one meal choice is selected in a bundle slot.
  bool isBundleChoiceSelected(String slotId, String itemId) => _bundleChoices[slotId]?.contains(itemId) ?? false;

  /// Adds the current customized dish or bundle if every required/min/max constraint passes.
  CartAddResult addConfiguredItem({bool confirmVendorReplacement = false}) {
    final StorefrontMenuItem? item = _activeItem;
    if (item == null || !item.isOrderable) return CartAddResult.unavailable;
    final VendorStorefront? liveStorefront = _storefront;
    if (liveStorefront?.isLiveSnapshot == true && liveStorefront!.vendor.operationalStatus != 'open') {
      _commerceErrorCode = 'VENDOR_CLOSED';
      _onChanged();
      return CartAddResult.unavailable;
    }
    if (_readOffline()) return CartAddResult.offline;
    if (!_groupsValid) return CartAddResult.unavailable;
    if (_api.isConfigured && (!_storefrontLive || !item.isLiveSnapshot || !CustomerCommerceState._isUuid(item.dish.id))) {
      _commerceErrorCode = 'MENU_REFRESH_REQUIRED';
      _onChanged();
      return CartAddResult.requiresLiveRefresh;
    }
    final CartAddResult result = _addLine(
      item: item,
      quantity: _itemQuantity,
      unitPricePoisha: itemUnitPricePoisha,
      variantId: _variantChoices.values.firstOrNull,
      selections: _serializeSelections(),
      note: _itemInstructions,
      confirmVendorReplacement: confirmVendorReplacement,
    );
    if (result == CartAddResult.added) _commerceErrorCode = null;
    return result;
  }

  List<Map<String, Object?>> _serializeSelections() {
    final List<Map<String, Object?>> rows = <Map<String, Object?>>[];
    for (final StorefrontChoiceGroup group in _activeItem!.optionGroups) {
      for (final String optionId in _optionChoices[group.id] ?? <String>{}) {
        rows.add(<String, Object?>{'kind': 'option', 'group_id': group.id, 'option_id': optionId});
      }
    }
    for (final BundleSlot slot in _activeItem!.bundleSlots) {
      for (final String itemId in _bundleChoices[slot.id] ?? <String>{}) {
        rows.add(<String, Object?>{'kind': 'bundle', 'slot_id': slot.id, 'item_id': itemId});
      }
    }
    return rows;
  }

}
