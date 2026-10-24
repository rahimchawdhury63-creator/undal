/// Horizontal navigation for the stable Appendix N Partner application screen IDs.
library;

import 'package:flutter/material.dart';
import 'package:undal_core/undal_core.dart';

import '../models/partner_models.dart';

/// Displays only the onboarding routes assigned to this applicant (`p-01..p-07`, vault `p-35`).
class PartnerApplicationStepNavigation extends StatelessWidget {
  /// Creates a track-aware navigation strip for the current wizard state.
  const PartnerApplicationStepNavigation({
    super.key,
    required this.track,
    required this.activeScreen,
    required this.isBangla,
    required this.busy,
    required this.onNavigate,
  });

  /// The persisted track determines which restaurant/home-cloud document screen to open.
  final PartnerTrack? track;

  /// Current Appendix N screen ID.
  final String activeScreen;

  /// Whether Bangla labels are active.
  final bool isBangla;

  /// Whether W1 currently has an application mutation in flight.
  final bool busy;

  /// Navigates to the selected stable screen ID.
  final ValueChanged<String> onNavigate;

  @override
  Widget build(BuildContext context) {
    final String documentScreen = track == PartnerTrack.restaurant ? 'p-02' : 'p-03';
    final String Function(String, String) text = (String en, String bn) => isBangla ? bn : en;
    final List<(String, String, IconData)> destinations = <(String, String, IconData)>[
      ('p-01', text('Profile', 'প্রোফাইল'), Icons.storefront_outlined),
      ('p-04', text('Pin', 'পিন'), Icons.map_outlined),
      (documentScreen, text('KYC', 'KYC'), Icons.fact_check_outlined),
      ('p-05', text('Hours', 'সময়'), Icons.schedule_outlined),
      ('p-06', text('Payout', 'পেআউট'), Icons.account_balance_wallet_outlined),
      ('p-07', text('Status', 'অবস্থা'), Icons.rule_folder_outlined),
      ('p-35', text('Vault', 'ভল্ট'), Icons.folder_open),
    ];
    return SafeArea(
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: UndalSpacingTokens.xs, vertical: UndalSpacingTokens.xxs),
        child: Row(children: destinations.map(((String, String, IconData) destination) => Padding(
          padding: const EdgeInsets.symmetric(horizontal: UndalSpacingTokens.xxs),
          child: ActionChip(
            key: ValueKey<String>('partner-nav-${destination.$1}'),
            avatar: Icon(destination.$3, size: 18),
            label: Text('${destination.$1} · ${destination.$2}'),
            backgroundColor: activeScreen == destination.$1 ? Theme.of(context).colorScheme.secondaryContainer : null,
            onPressed: busy ? null : () => onNavigate(destination.$1),
          ),
        )).toList(growable: false)),
      ),
    );
  }
}
